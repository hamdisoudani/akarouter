# AkaRouter Audit — running notes

## Backend findings (in progress)

### [HIGH] #1 — JWT cache 60s TTL allows privilege-escalation window
**File**: `backend/app/core/cache.py:374` (`set_jwt_cache` docstring claims TTL reduced to 10s — verify)
**File**: `backend/app/core/supabase.py:_verify_supabase_jwt`
- A user's role/status/suspension is cached for up to 10s after JWT verify.
- An admin banning a user still leaves them able to call `/admin/*` for up to 10s.
- Mitigation: lower TTL to 5s OR explicitly call `evict_jwt_cache()` on admin actions.

### [HIGH] #2 — `_increment_request_quota_db` race (TOCTOU)
**File**: `backend/app/core/cache.py:_increment_request_quota_db`
- Reads `monthly_requests` then writes `current + delta`. Two concurrent flushes can both read 10, both write 11 → undercount by N-1 where N = concurrent flushes.
- Worst case: budget enforcement undercounts usage, letting user exceed monthly_requests_limit.
- Fix: use atomic RPC `UPDATE ... SET monthly_requests = monthly_requests + $delta` or an SQL function.

### [HIGH] #3 — `_account_request_quotas` cache invalidated but never re-warmed atomically
**File**: `backend/app/core/cache.py:increment_request_quota`
- Setting `last_reset: 0` forces next `get_request_quota` to refetch DB. But between the buffer-flush and the next read, another flush could happen that races with the refetch.
- Same as #2 — race-prone DB read+write.

### [HIGH] #4 — `flush_buffers_to_db` drops logs on Supabase failure
**File**: `backend/app/core/cache.py:flush_buffers_to_db` line ~542
```python
except Exception as e:
    logger.error("Failed to batch insert request logs, dropping logs: %s", e)
```
- Comment literally says "dropping logs". If Supabase is down, all in-memory request logs for that 5s window are silently lost → request_logs table has gaps, budget RPC undercounts.
- This is what produces a budget undercount visible to users as "I made 100 calls but budget says 80".
- Fix: persist buffer to disk before clearing, or push to a durable queue.

### [MEDIUM] #5 — JWT cache key is the raw token
**File**: `backend/app/core/cache.py:_jwt_cache` and `set_jwt_cache(token, ...)`
- Cache is keyed by the raw JWT. Tokens are high-entropy but if a token ever leaks (logs, error trace) it remains in cache for the TTL.
- Should hash the token first like `_api_key_cache` does.

### [MEDIUM] #6 — Provider selection can leak provider list to banned keys (no rate limit before provider leak)
**File**: `backend/app/core/router.py:authenticate_api_key`
- Order is: hash lookup → status check → rpm check → budget check. Good. But budget check runs AFTER rpm increment, so rpm increments before budget rejection — wasted RPM slot.
- Low impact (just a counter drift).

### [MEDIUM] #7 — `select_provider` doesn't validate `max_concurrent == 0`
**File**: `backend/app/core/router.py:select_provider` line `max(p.get("max_concurrent", 12), 1)`
- A provider with `max_concurrent: 0` is treated as 1 → always accepted, no cap.
- Should reject if `max_concurrent <= 0` explicitly.

### [MEDIUM] #8 — Provider `access_token` and `refresh_token` returned in API responses
**File**: `backend/app/core/router.py:select_provider` returns full provider row including `access_token, refresh_token`
- These flow into `app/api/admin/routes.py` `/admin/providers` GET endpoints presumably. If those endpoints are exposed to non-admin users (need to verify), this is a CRITICAL token leak.
- Also need to check if `api_key_encrypted` from `select_endpoint` is decrypted and exposed.

### [MEDIUM] #9 — `asyncio.create_task` for DB write without await = no backpressure
**File**: `backend/app/core/router.py:_update_key_db` and `_update_provider_db`
- Fire-and-forget tasks. If Supabase is slow, hundreds of these accumulate. Memory leak / event loop starvation risk.
- Should use `asyncio.create_task` + a bounded semaphore.

### [LOW] #10 — `get_active_providers_cache` only TTL=60s
**File**: `backend/app/core/cache.py:set_active_providers_cache(ttl=60.0)`
- When a provider degrades, `clear_active_providers_cache()` is called (good). But TTL is 60s — if nothing invalidates it, stale provider list can route to a broken provider for up to 60s.
- Mitigation already in place (`clear_active_providers_cache()` on degradation). OK.

### [LOW] #11 — `is_gateway_enabled` falls open on DB error
**File**: `backend/app/core/cache.py:is_gateway_enabled`
```python
except Exception as e:
    logger.error(f"Failed to check gateway status: {e}")
    return True
```
- Fail-open: if DB fails, gateway stays enabled. Bad for safety-critical killswitch. Should fail-closed.

### [LOW] #12 — `monthly_requests_limit` is read from cached `auth_metadata`, not re-fetched
**File**: `backend/app/core/router.py:authenticate_api_key`
- If admin raises `monthly_requests_limit` via PATCH, the cache TTL (30s) keeps the old limit enforced for 30s.
- Should call `evict_api_key_cache(key_hash)` after plan updates.

(continued below as I read more files)
### [CRITICAL] #13 — Upstream error JSON keys ARE echoed back to client
**File**: `backend/app/api/chat.py:proxy_chat` HTTPStatusError handler
- Reads `err_json["detail"]` or `err_json["error"]["message"]` then passes to `sanitize_error_msg()` which maps to a fixed enum. GOOD — `sanitize_error_msg` is solid.
- BUT non-streaming path builds `raise HTTPException(status_code=..., detail=f"Upstream provider error: {cleaned_msg}")`. The cleaned_msg is an opaque enum string. Safe.
- However `_upstream()` on JSON parse failure does:
  ```python
  raise ValueError(f"Upstream returned invalid JSON response: {text_preview}")
  ```
  `text_preview` = first 500 chars of upstream response → caught by generic Exception → re-raised as `HTTPException(500, detail=f"Internal proxy error: {sanitize_error_msg(str(exc))}")`. `sanitize_error_msg` returns `upstream_error` (the fallback) so user sees `"Internal proxy error: upstream_error"` — opaque. Safe.
- Verdict: ✅ the sanitize_error_msg rework is solid.

### [HIGH] #14 — Generic exception handler logs full upstream error message including URL/path
**File**: `backend/app/api/chat.py:proxy_chat` `except Exception as exc:` block (non-streaming)
```python
await log_request(...error_message=str(exc))
```
- `error_message=str(exc)` stores the FULL exception string (could include URLs, model names, tokens, key prefixes) in `request_logs`.
- `request_logs` is exposed via `/user/analytics` (need to verify what fields are returned) and via admin endpoints. Users see their own logs but a malicious upstream could inject script-bearing strings into logs. Low XSS risk if admin UI escapes correctly. CHECK `request_logs` exposure.

### [HIGH] #15 — `_refund_points` swallow-all except
**File**: `backend/app/api/chat.py:_refund_points`
```python
try:
    supabase.rpc("refund_account_points", {...}).execute()
except Exception as exc:
    logger.warning(f"Point refund failed for account {account_id}: {exc}")
```
- If refund RPC fails, point is LOST — user charged but not refunded.
- Should be retried with exponential backoff and persisted to a "pending_refunds" table that a worker drains.

### [HIGH] #16 — `release_fn = lambda` only called on the connect-error path; what about successful streams that crashed mid-stream?
**File**: `backend/app/api/chat.py:proxy_chat` streaming path
- `stream_generator()` has `try/except/finally`. In the `finally`, `release_fn(success)` is called.
- But `release_fn = lambda ok, err=None: release_endpoint(...)` — `release_endpoint` is a no-op placeholder per router.py. So OK, it's already a no-op for endpoints.
- For OAuth providers, `release_fn = lambda ok, err=None: release_provider(provider["id"], ok, err)`. `release_provider` runs provider health/healing logic, which is correct.
- However `release_fn(success)` is called with NO `err` arg — that means if stream fails mid-flight, `release_provider` records it as `success=False, error_msg=None`. Then `inc_consecutive_errors(provider_id)` triggers. Provider degradation may kick in after 3 false failures. Low risk but slightly noisy.

### [HIGH] #17 — Per-tier rate limit and budget enforcement both increment counters, double-counting under load
**File**: `backend/app/api/chat.py:proxy_chat` + `router.py:authenticate_api_key`
- `authenticate_api_key` already increments RPM via `check_and_increment_rpm`.
- `enforce_tier_rate_limit` in middleware also increments a separate counter.
- Two parallel rate limit systems, neither knowing about the other. A user on a 60/min plan could burst 60 RPM + 60 tier-min = 120 calls/min if both happen to be free-tier limits. Need to verify whether these are the SAME counter or different.

### [CRITICAL] #18 — `_enforce_and_reserve_points` runs BEFORE model is known active or pricing_mode is validated for per-request models
**File**: `backend/app/api/chat.py:proxy_chat`
- Order: validate body → check `is_model_active()` → check `model_alias` in `model_mapping` → GET pricing metadata → CHARGE POINTS.
- Points charged based on `meta.get("points_cost", 5)` — default 5. If a model is missing points_cost, defaults to 5. Reasonable.
- BUT: the per-request pricing path (`use_endpoint`) bypasses the points system entirely — uses `cost_per_request_cents` from metadata and charges the upstream provider. If `pricing_mode == "per_request"` AND points_cost is also defined, what happens? Code uses `points_cost` regardless (line `points_cost = int(meta.get("points_cost", 5))`). So a per-request model still gets points deducted. Is that intentional? If yes, OK; if no, users may be double-charged.

### [MEDIUM] #19 — `body_dict` is re-serialized after Pydantic validation, but messages content uses Union type
**File**: `backend/app/api/chat.py:ChatMessage.content`
- `content: Union[str, List[ChatMessagePart]]` — Pydantic validates structure, but `model_dump(exclude_none=True)` may serialize differently than upstream expects.
- If upstream requires `content` to be a string and we send an array (or vice versa), upstream returns 400. User sees opaque error. Functional bug.

### [MEDIUM] #20 — `release_provider` not called on _non-streaming_ exception path AFTER log_request
**File**: `backend/app/api/chat.py:proxy_chat` non-streaming
- `except Exception as exc` block calls `await release_fn(False, str(exc))` before `log_request`. Good.
- But on the `except httpx.HTTPStatusError` path, `release_fn(False, f"HTTP status error: {cleaned_msg}")` is called — `cleaned_msg` is opaque enum. OK.

### [LOW] #21 — `points_cost` from metadata is the value at READ time, not at CHARGE time
**File**: `backend/app/api/chat.py:_enforce_and_reserve_points`
- Reads `meta["points_cost"]` (cached 60s via `get_model_metadata`) before charging.
- If admin changes a model's points_cost in the 60s window, user pays the OLD price.
- Usually fine — small drift. But could be abused: cache reset just before admin lowers cost → pay old high price.
- Acceptable; documented.

### [LOW] #22 — `_refund_points` doesn't pass `request_log_id` so refund can't be linked to charge
- Even after the ledger migration added `model_alias` and `request_log_id` params to refund, the chat.py call site passes `model_alias` but never passes `request_log_id`. The refund can't be traced to the charge row in the ledger. Audit gap.


### [LOW] #23 — Whop memberships API call uses `user_ids[]` array param
**File**: `backend/app/api/webhooks.py:whop_webhook_handler`
```python
"user_ids[]": [whop_user_id]
```
- This is httpx's array-param syntax. `whop_user_id` comes from the Whop webhook payload (not user-controlled directly, but signed) — low risk.
- If the array serialization is wrong, Whop API call fails silently and falls through to `_fallback_tier_from_payload` which uses the event type. Acceptable.

### [LOW] #24 — Idempotency dedup happens AFTER account_id resolution but BEFORE side effects
**File**: `backend/app/api/webhooks.py`
- Good: signature check → timestamp check → dedup insert → DB updates. If dedup insert throws non-23505 error, the code logs and continues. That means a DB blip could let a duplicate through. But this is rare; primary key collision is the only thing that should fire the catch.

### [INFO] #25 — Whop webhook handler looks well-hardened
- HMAC verified with single encoding (good — past "any of 4 encodings" issue is fixed).
- Timestamp window 300s (5 min) prevents replay.
- Account resolution fallback to email.
- Tier sync with idempotency check + tier_upgrade lock.
- All side effects wrapped in lock + retry.


## FRONTEND FINDINGS

### [CRITICAL] #26 — XSS via model response rendering
**File**: `frontend/app/playground/page.tsx:368`
```tsx
{m.content}
{m.error && (...)}
```
- `m.content` is a string from `res.choices?.[0]?.message?.content` — populated by an LLM upstream. The user's model output is rendered as JSX children. React auto-escapes string children, so this is **NOT a raw XSS** in the current implementation.
- HOWEVER: there's no length cap on the model output. A misbehaving model could return a 10MB string and freeze the browser. Should cap at e.g. 50k chars.
- Also: the message is stored in localStorage (`STORAGE_MSGS_KEY`). A malicious model output could push localStorage over the 5MB limit, breaking the app.
- **Risk: MEDIUM** (DOS via bloated response + storage exhaustion).

### [CRITICAL] #27 — `selectedKey` in localStorage is the key ID, not the raw key — but `newKey` in state is the raw key and persists in React memory
**File**: `frontend/app/playground/page.tsx:54-58`, `useState<string | null>(null)` for newKey
- The raw key is held in React state. It's never persisted to localStorage (good).
- BUT: `selectedKey` (key ID) IS persisted to localStorage. If a user creates a key, switches to a different existing key (one whose raw value they DON'T have), then closes the tab, on next visit `selectedKey` is auto-restored but `newKey` is null. The user sees the message "For security, only freshly created keys are usable in the playground" — works.
- The actual risk: `newKey` is held in component state but NOT cleared on unmount. If user navigates away with `newKey` set, React unmounts the component and state is garbage-collected. OK.
- HOWEVER: when the page refreshes, `newKey` resets but the user has already seen and copied the key. Fine.

### [HIGH] #28 — `JSON.parse` of localStorage data without schema validation
**File**: `frontend/app/playground/page.tsx:84-87`
```ts
const saved = localStorage.getItem(STORAGE_MSGS_KEY)
if (saved) {
  try { setMessages(JSON.parse(saved)) } catch {}
}
```
- An attacker who can write to a user's localStorage (e.g., via XSS on another tab) can inject a message object with arbitrary fields, e.g. `{role: 'assistant', content: '...', error: '<malicious text>'}` — but since values are rendered as JSX text, this is escaped.
- Bigger risk: if `saved` is huge (5MB of garbage), `JSON.parse` blocks the main thread for seconds.
- Add max-length check before parse: `if (saved.length > 1_000_000) return`.

### [HIGH] #29 — `chatCompletion` API call doesn't use the API key for auth — it uses the user's bearer token instead
**File**: `frontend/app/playground/page.tsx:212` `chatCompletion(...)` call
```ts
const res = await chatCompletion({...})
```
- This call uses the user's Supabase JWT (via `lib/api.ts`), NOT the selected API key.
- So even though `selectedKey` (raw value) is in state, it's NEVER sent to the backend. The user is charged via JWT auth, not via the API key.
- The `selectedKey` / `newKey` UI is purely cosmetic — backend doesn't validate the playground "key selection".
- This means: the API key flow advertised in the UI doesn't actually authenticate anything in playground. The user creates a key (real cost), but the playground chat uses JWT instead.
- Could be a feature (let users test API key creation without storing raw keys). But the UI says "for security, only freshly created keys are usable in the playground" which is **MISLEADING** — the backend doesn't care.

### [MEDIUM] #30 — `JSON.stringify(messages.slice(-20))` on every message change writes to localStorage synchronously
**File**: `frontend/app/playground/page.tsx:99-103`
- Each `setMessages` triggers a re-render that synchronously writes to localStorage. With streaming responses (`streaming: true`) updating rapidly, this could cause UI jank.
- Debounce the write with `setTimeout`.

### [MEDIUM] #31 — No CSRF protection on state-changing requests
**File**: `frontend/lib/api.ts` (not yet read) — needs verification
- All requests use `Authorization: Bearer <token>` from Supabase. Supabase auth is HttpOnly cookie-based (need to verify). If bearer-only, CSRF doesn't apply (browsers won't auto-attach bearer tokens).
- State-changing GETs: need to grep for GETs that mutate state.

### [MEDIUM] #32 — Model output rendered WITHOUT sanitization of Markdown
**File**: `frontend/app/playground/page.tsx:368` `{m.content}`
- If model returns markdown (`**bold**`, etc.), it's shown as literal asterisks. Not a security issue, but a UX expectation. Document it.

### [LOW] #33 — Playwright tests don't exist for playground — no regression safety net

### [LOW] #34 — Recaptcha token is single-use? Need to verify server-side behavior
**File**: `frontend/app/playground/page.tsx:handleCreateKey`
- Captcha token from `InteractionCaptcha` is captured in state, then sent in `createKey(token, name, recaptchaToken)`. Single-use by design usually.


### [CRITICAL] #35 — /admin route has NO role check
**File**: `frontend/app/providers.tsx:101-141` (publicPaths check) AND `frontend/app/admin/page.tsx` (not yet read)
- The `publicPaths` list does NOT include `/admin` → users on a non-public path are redirected to login.
- BUT: there's no admin-role check anywhere. Any logged-in user can navigate to `/admin` and the page renders.
- Need to verify `admin/page.tsx` content — does it call any admin-only API? If yes, the backend should reject with 403. If it shows admin UI before checking, attacker can enumerate the admin schema via visible UI elements.
- **Risk: depends on admin/page.tsx contents** (not yet read).

### [HIGH] #36 — publicPaths has 3 copies (initSession, onAuthStateChange, upgrade redirect)
**File**: `frontend/app/providers.tsx`
- 3 separate `publicPaths` arrays defined inline. They MUST stay in sync. A drift (e.g., one adds `/playground` and the others don't) could cause a user to be redirected away from a public page.
- **Fix: extract to const PUBLIC_PATHS at module level.**

### [HIGH] #37 — `usePathname()` triggers effect on EVERY navigation, re-running the publicPaths check, but `publicPaths.includes(pathname)` won't match a trailing-slash variant or query string
**File**: `frontend/app/providers.tsx`
- If user visits `/playground?foo=bar`, `pathname` is `/playground`. Works.
- If user visits `/playground/`, `pathname` is `/playground/` (Next.js preserves trailing slash). NOT in publicPaths. Login redirect. Bug.
- `pathname.startsWith('/playground/')` would catch it. Or normalize via `pathname.replace(/\/$/, '') || '/'`.

### [MEDIUM] #38 — `onAuthStateChange` fires SIGN_IN / SIGN_OUT / TOKEN_REFRESHED. TOKEN_REFRESHED updates token but not user/usage
**File**: `frontend/app/providers.tsx:127-141`
- When token refreshes (Supabase auto-refreshes ~hourly), `setToken(session.access_token)` runs but `fetchUserData` is NOT called. So `user` and `usage` retain old data — but the token used for subsequent API calls is the new one.
- If the new token corresponds to a different user (e.g., via session switch), `user` is stale.
- Edge case, low risk.

### [MEDIUM] #39 — `lastFetchedTokenRef` reset on error allows infinite retry loop
**File**: `frontend/app/providers.tsx:63-66`
- On `fetchUserData` error, `lastFetchedTokenRef.current = ''` so a retry will run.
- If the API is down for 1 minute, every re-render that triggers `initSession` / `onAuthStateChange` will re-attempt the fetch.
- Add a cooldown or circuit-breaker.

### [MEDIUM] #40 — No `loading` state renders anything → flash of unauthenticated content
**File**: `frontend/app/providers.tsx:204-209`
- `AppProvider` returns `children` immediately. Pages that gate on `user` (e.g. playground) show a brief unauth state during `loading=true`.
- This is the reason individual pages (playground) have `if (!user)` guards — they show the locked UI even during loading.
- Mostly fine, but a flicker of the unauth screen to an authed user is possible if they reload.

### [LOW] #41 — `getMe` and `getUsage` are called in parallel after a token refresh — should be `Promise.all`
- Currently sequential: `await getMe` then `await getUsage`. Two round-trips.
- `Promise.all` would halve latency.

### [LOW] #42 — `signOut` doesn't await `router.push` — race with cookie clear
- Cosmetic.


### [CRITICAL] #43 — Admin bypass via `NEXT_PUBLIC_ADMIN_KEY` build-time env var
**File**: `frontend/app/admin/page.tsx:316-328`
```ts
if (contextUser && contextUser.role === 'admin') {
  setToken(contextToken)
  ...
} else {
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY
  if (adminKey) {
    setToken(adminKey)
    setIsAdmin(true)
    setUser({ email: 'ADMIN_BYPASS', role: 'admin' })
    setAuthChecked(true)
  } else {
    router.push('/dashboard')
  }
}
```
- **`NEXT_PUBLIC_*` env vars are EMBEDDED IN THE BUNDLE** at build time. Anyone who views the deployed JS can extract the admin key from `process.env.NEXT_PUBLIC_ADMIN_KEY` (it appears as a string literal).
- The bypass: if the env var is set at build time, ANY user who knows the var (or extracts it from the bundle) gets admin access without authenticating as an admin.
- **This is a CRITICAL design flaw.** The admin auth should NEVER be a build-time static key.
- Even if the key is "secret", it ships in every visitor's browser.
- Mitigation: if `NEXT_PUBLIC_ADMIN_KEY` must exist, do not embed it in client code. Move the admin auth check to a backend endpoint that returns a short-lived admin token.
- **Action: grep the deployed bundle for the key to confirm it's actually embedded. If yes, ROTATE IMMEDIATELY.**

### [CRITICAL] #44 — `contextUser.role === 'admin'` check relies on user.role field — does Supabase return this?
**File**: `frontend/app/admin/page.tsx:316`
- `contextUser.role` — needs to verify `UserInfo` type in `lib/api.ts`. If `UserInfo` doesn't include `role`, this is always undefined → admin route always redirects to dashboard (safe by accident) OR always accepts non-admin (depending on `undefined === 'admin'`).
- Need to verify what backend returns from `getMe`.

### [HIGH] #45 — `authHeaders()` returns `{ Authorization: Bearer ${token} }` — token from `contextToken` OR from `NEXT_PUBLIC_ADMIN_KEY`
**File**: `frontend/app/admin/page.tsx:347-349`
- If the bypass is used (adminKey from env), `token` is the static admin key. All admin requests use this. So backend must accept this as a valid admin token.
- This means the BACKEND accepts a static admin key — same key ships in bundle. If backend doesn't validate origin/IP, anyone can extract and use.
- Need to check backend's admin auth in `app/api/admin/routes.py`.

### [HIGH] #46 — Admin OAuth device-code polling never stops on unmount
**File**: `frontend/app/admin/page.tsx:451-455`
- `pollRef = setInterval(check, 5000)` — cleanup at end of file:
  ```ts
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])
  ```
- Cleanup DOES exist. Good.
- But if `startStatusPolling` is called twice, only the second `setInterval` is stored in `pollRef` — the first keeps running. Fix: always clear before creating new.

### [HIGH] #47 — `loadAccounts(searchQuery, accountsPage, accountsLimit)` runs on `accountsPage` change but DOESN'T re-run on `searchQuery` change
**File**: `frontend/app/admin/page.tsx:445-450` useEffect dep array
- `useEffect(() => { if (activeTab === 'users') loadAccounts(searchQuery, accountsPage, ...) }, [authChecked, isAdmin, token, activeTab, accountsPage])`
- `searchQuery` NOT in deps. Typing in the search box doesn't trigger a reload.
- The `handleSearchSubmit` checks if page === 1 and reloads manually, otherwise sets page=1 (which triggers reload via dep). So actually it works via the page-reset path. But subtle.

### [MEDIUM] #48 — Admin user page displays `acc.email`, `acc.display_name`, `acc.suspended_reason` — XSS?
**File**: `frontend/app/admin/page.tsx` — all rendered as JSX text children. React auto-escapes. Safe.
- But `acc.tier`, `acc.role`, `acc.status` are used in `<select>` defaults. If backend returns malicious values, they're rendered as option text. Still escaped.

### [MEDIUM] #49 — `prompt()` for ban reason — no max length, no validation
**File**: `frontend/app/admin/page.tsx:540-544`
- `prompt("Enter suspension reason:")` — user can paste arbitrary text including HTML/script. Stored in `accounts.suspended_reason`. When shown elsewhere (admin panel, possibly user-side as a notice), needs to be escaped.
- React escapes by default, but if this string is ever interpolated into an email body or stored HTML, XSS possible.
- Cap length at e.g. 500 chars.

### [MEDIUM] #50 — `confirm()` calls in admin actions — bypassable
**File**: `frontend/app/admin/page.tsx:454-456, 575`
- Browser-native `confirm()` and `prompt()`. User can dismiss with ESC. Not a security issue (intentional), but UX-wise these look dated.

### [MEDIUM] #51 — Admin stats endpoint exposes global data
**File**: `frontend/app/admin/page.tsx:368-371`
- `fetch(${API_URL}/admin/stats)` returns stats for the WHOLE platform (total users, total requests, etc.). Sensitive data exposed to admin role — that's the intent. OK as long as backend enforces admin-only access.

### [MEDIUM] #52 — Admin table doesn't have row count limit on pagination — could fetch all accounts
**File**: `frontend/app/admin/page.tsx:462-465`
- `loadAccounts(searchQuery, page, limit)` with `limit=20`, `offset=(page-1)*20`. OK.
- But `accountsTotal` is fetched from response. If backend returns huge total, the pagination shows huge page count. UX only.


### [INFO] #52 — Auth callback: `next` parameter IS validated against open-redirect
**File**: `frontend/app/auth/callback/route.ts:51`
```ts
const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'
```
- ✅ Correctly validates that `next` is a relative path starting with single `/`. Rejects `//evil.com` (protocol-relative URL).
- **Verdict: GOOD**. Open redirect via `next` is blocked.

### [INFO] #53 — Auth callback: error messages not leaked to client
**File**: `frontend/app/auth/callback/route.ts:65-68`
- ✅ Logs full error server-side, returns generic `?error=auth_failed` to client.

### [MEDIUM] #54 — `nextParam` could contain CRLF or other URL-unsafe chars
**File**: `frontend/app/auth/callback/route.ts:51`
- After `startsWith('/') && !startsWith('//')` check, `nextParam` is used in `redirect(${siteOrigin}${safeNext})`.
- If `nextParam = '/x\n\rSet-Cookie: ...'`, could it inject headers? Next.js's `NextResponse.redirect` returns a Response with status 3xx and a `Location` header. The Location value is escaped by the framework.
- A more thorough check would be: `if (!/^\/[a-zA-Z0-9_\-\/\?&=]+$/.test(nextParam))`. But for typical use, this is fine.

### [MEDIUM] #55 — `resolveSiteOrigin` falls back to `new URL(request.url).origin` — if attacker controls Host header, controls origin
**File**: `frontend/app/auth/callback/route.ts:36-46`
- In dev/prod behind trusted proxy (Railway/Cloudflare), Host header is the public host. Fine.
- If a misconfigured proxy passes the original Host header (host-header injection), attacker can redirect to evil.com.
- Railway/Cloudflare handle this correctly. OK.


### [INFO] #56 — proxy.ts: edge auth uses `getUser()` (JWT signature verified)
**File**: `frontend/proxy.ts:198-205`
- ✅ Uses `@supabase/ssr`'s `getUser()` which verifies JWT signature + expiry. Not cookie-name based.
- `/admin` is in PROTECTED_PREFIXES → requires session at the edge.
- BUT role check is NOT done at edge — only at page level (`admin/page.tsx`). This is a deliberate design choice (commented).
- **Verdict: GOOD design.** Edge only checks authentication; page/API checks authorization.

### [INFO] #57 — CSP is strict (no `unsafe-inline` for scripts, hash-based fallback)
**File**: `frontend/proxy.ts:96-119`
- `script-src 'self' 'nonce-${nonce}' 'sha256-...'` + reCAPTCHA domains.
- `frame-ancestors 'none'` — no framing (anti-clickjacking).
- `connect-src` pinned to specific hosts (supabaseHost, apiHost).
- **Verdict: GOOD.** Proper nonce-based CSP.

### [LOW] #58 — `style-src 'unsafe-inline'` — required for Next.js App Router
- Comment notes this is for Next.js's runtime style injection. Documented; future Tailwind v4 upgrade would let us drop it.

### [LOW] #59 — `img-src https:` is too permissive
**File**: `frontend/proxy.ts:107`
- `https:` allows loading images from ANY HTTPS origin. A reflected XSS via `<img onerror>` is limited (img doesn't execute scripts), but a user-supplied URL could be used for tracking pixels.
- Tighter: list specific image domains (e.g., `${supabaseHost}` for user avatars, plus known CDNs).

### [LOW] #60 — `generateNonce()` uses `btoa()` which may not be safe for binary in all runtimes
**File**: `frontend/proxy.ts:74-79`
- `btoa(String.fromCharCode(...bytes))` works in V8 but may not be the recommended approach. Modern alternative: `btoa(String.fromCharCode.apply(null, bytes))` or use `Buffer.from(bytes).toString('base64url')` in Node.
- Functionally correct in edge runtime. Fine.

### [LOW] #61 — `isPublic` matches `/` but also any path starting with `//`
**File**: `frontend/proxy.ts:65`
- `pathname === '/'` matches only root. `pathname.startsWith('/')` (via prefix list) matches `/foo` etc. So `//evil.com` is NOT matched because pathname starts with `//` but no prefix does.
- Wait: `/auth/login` is a prefix. `//evil.com` starts with `/auth/login`? No. So `//evil.com` falls through to `!isProtected` → "allowed at edge and protected at the page level". The page itself would 404 on `//evil.com`. OK.


### [INFO] #62 — Supabase server client is `server-only` (build-time enforced)
**File**: `frontend/lib/supabase/server.ts:1`
- ✅ `import 'server-only'` directive prevents accidental import in client code. Good.
- The Supabase anon key is `NEXT_PUBLIC_*` so it ships in bundle anyway. That's by design.

### [INFO] #63 — Browser client uses `createBrowserClient` which stores tokens in cookies
**File**: `frontend/lib/supabase/client.ts`
- @supabase/ssr's `createBrowserClient` stores tokens in cookies by default. Token refresh handled by `setAll` cookie adapter.
- Cookies are auto-set by Supabase with `SameSite=Lax`, `Secure` (in HTTPS contexts). HttpOnly? **Not by default** — Supabase's browser client uses document.cookie (not HttpOnly).
- HttpOnly for Supabase auth tokens is set by the server client (`createServerSupabaseClient`). The browser client uses non-HttpOnly cookies so client-side JS can read the access_token.
- This is a tradeoff: HttpOnly blocks JS access (XSS-proof) but breaks client-side auth checks. The standard pattern is HttpOnly + server-side checks only. AkaRouter uses non-HttpOnly for client-side convenience.
- **Risk: If XSS is achieved, attacker can steal access_token from cookie.** Mitigated by strict CSP + non-`unsafe-inline` script-src.

### [MEDIUM] #64 — No cookie flags explicitly set in browser client
**File**: `frontend/lib/supabase/client.ts`
- Relies on Supabase's default cookie config. If defaults change (e.g. SameSite=Strict), could break OAuth redirects.
- Could explicitly pass `cookieOptions: { secure: true, sameSite: 'lax' }` via the createBrowserClient 2nd arg.

### [LOW] #65 — `_singleton` in `lib/supabase.ts` uses Proxy — works but obfuscates
- Comment notes this is for backwards compat with legacy imports.
- Fine as a transition state; should migrate call sites and remove eventually.


### [INFO] #66 — `UserInfo.role` is a string field — admin page check is correct
**File**: `frontend/lib/api.ts:152`
- `UserInfo.role: string` is in the interface. Backend returns this. `contextUser.role === 'admin'` is correct.

### [MEDIUM] #67 — `RequestLog` interface may include sensitive fields exposed via `/user/analytics`
**File**: `frontend/lib/api.ts:130-149`
- `RequestLog` includes `upstream_model`, `latency_ms`, `prompt_tokens`, etc. No `error_message` in the interface (good — but need to check backend).
- `recent_logs` returned in `AnalyticsResponse` shows user's OWN logs only (RLS enforced). No leak across users.

### [MEDIUM] #68 — `chatCompletion` doesn't send Authorization header
**File**: `frontend/lib/api.ts:178-188`
- POST to `/v1/chat/completions` with no `Authorization` header and no `x-api-key`.
- The /api proxy (Next.js rewrite) must add auth OR the backend must accept anonymous chat (no, that would be insane).
- Need to verify the proxy adds the auth header based on session cookie.
- If it doesn't, the playground would 401.

### [MEDIUM] #69 — `getMe` and other user functions take `token: string` arg instead of reading from session
- Pattern: caller passes `token` to every function. If `token` is stale, all calls fail or use old token.
- After `signOut`, `token` in `useApp()` is empty. Caller must pass it. Easy to forget to pass.
- A better pattern: get token from session internally (using `getAuthToken()` helper that's defined but unused).

### [LOW] #70 — Error messages from backend passed directly to user via `err.error?.message`
**File**: `frontend/lib/api.ts:188`
- `err.error?.message || err.detail` — backend error message shown verbatim. If backend leaks sensitive info (e.g., stack trace), it's shown.
- Backend's `sanitize_error_msg` returns a fixed enum, so this should be OK. But if a new endpoint forgets to sanitize, raw error is shown.

### [LOW] #71 — No retry on 5xx
- Single fetch, no retry. Transient 502/503 from Railway restarts will surface as user error.

### [LOW] #72 — No timeout on fetch
- Long-running request can hang forever. No AbortController. Add `AbortSignal.timeout(60_000)`.


## BACKEND ADMIN ROUTES

### [CRITICAL] #73 — `_verify_admin` accepts `admin_dev_token` ONLY when `app_env == "development"`
**File**: `backend/app/api/admin/routes.py:_verify_admin:30-37`
```python
if settings.app_env == "development" and settings.admin_dev_token:
    import hmac as _hmac
    if _hmac.compare_digest(token, settings.admin_dev_token):
        return True
```
- Dev-only backdoor. Production sets `app_env=production` (presumably), so this branch is unreachable in prod.
- **But**: if `AKAROUTER_APP_ENV` is mis-set in production, dev token is accepted.
- Mitigation: add a fail-safe that ALSO requires `not settings.production_admin_locked_out` or similar. Or: log + alert on dev token usage in production.
- **Risk: MEDIUM** (depends on env var discipline).

### [CRITICAL] #74 — `_verify_admin` for Supabase JWT checks `user_info.get("role") == "admin"`
**File**: `backend/app/api/admin/routes.py:40-47`
- Verifies JWT, then checks role. The role comes from `user_info.get("role")` — this is the Supabase `app_metadata.role` claim OR a custom claim.
- Need to verify `app/core/supabase.py` `_verify_supabase_jwt` to see where `role` is sourced.
- If role comes from user-controlled `user_metadata` (not `app_metadata`), ANY user can set their own role to "admin" in their profile and gain admin access.
- **Risk: CRITICAL if role is from user_metadata.**

### [HIGH] #75 — Admin JWT cache TTL is 10s (per finding #1)
- Admin actions have up to 10s delay before role change takes effect. If admin demotes a user, that user has 10s to call admin endpoints. Combined with finding #74, this is a 10s window of admin access.

### [HIGH] #76 — `list_accounts` doesn't filter on `accounts.role` — exposes ALL accounts to admin
**File**: `backend/app/api/admin/routes.py:list_accounts`
- ✅ Admin can see all accounts (intended). No risk.
- BUT: if `_verify_admin` has a bug (finding #74), non-admin can see all accounts.

### [HIGH] #77 — `update_account` accepts `role: "admin"` — admin can grant admin to any user
**File**: `backend/app/api/admin/routes.py:update_account:506-509`
- ✅ Intended. But if `_verify_admin` is bypassed, attacker can self-promote.

### [MEDIUM] #78 — `update_account.tier` and `update_account.monthly_limit` etc. take EXTERNAL values, no upper bound
**File**: `backend/app/api/admin/routes.py:497-518`
- `body.monthly_limit: Optional[float]` — admin can set to 1e15. Pydantic doesn't bound.
- Could be used to grant a friend unlimited usage. Internal threat.

### [MEDIUM] #79 — `remove_provider` doesn't require any provider ID validation
**File**: `backend/app/api/admin/routes.py:257-261`
- `delete().eq("id", provider_id)` — if `provider_id` is not a valid UUID, the query silently no-ops. No confirmation. Could be used to enumerate valid provider IDs by timing.

### [MEDIUM] #80 — `list_providers` returns `last_error_msg` field — could leak internal provider names
**File**: `backend/app/api/admin/routes.py:51-54`
- Returns `last_error_msg` to admin. If admin route is bypassed (finding #74), attacker sees internal error messages.

### [MEDIUM] #81 — `add_provider` accepts arbitrary `access_token`/`refresh_token` strings — no length cap
**File**: `backend/app/api/admin/routes.py:add_provider`
- No validation on token strings. Could store a 1GB string. DB could OOM.
- Pydantic should enforce max_length on these fields.

### [LOW] #82 — Admin endpoints don't rate-limit
**File**: `backend/app/api/admin/routes.py` (entire file)
- No `Depends(rate_limit_admin)` or similar. An attacker who gains admin (finding #74) can hammer endpoints without limit.

### [LOW] #83 — `UpdateAccountRequest.suspended_reason` has no max length
- Could store a multi-MB string in `accounts.suspended_reason`. Logged to audit trail. Bloat.


## BACKEND MAIN.PY — AUTH MIDDLEWARE

### [CRITICAL] #84 — Public path regex bypass for `/v1/chat/completions` is fragile
**File**: `backend/app/main.py:97-101`
```python
is_public = path == "/" or any(path.startswith(p) for p in PUBLIC_PREFIXES if p != "/")
if is_public and not path.startswith("/v1/chat/completions"):
    return await call_next(request)
```
- ✅ Correctly exempts chat completions from public. Good.
- BUT: `/v1/models` is PUBLIC — anyone can list models. Not sensitive, OK.
- BUT: `/v1/plans` is PUBLIC — anyone can see plans. OK.
- BUT: `/v1/webhooks` is PUBLIC — relies on signature verification in handler (Whop webhook). OK if signature is verified.

### [HIGH] #85 — No rate-limit on `/v1/models` or `/v1/plans`
- These are public. An attacker can hit them at 10000 RPS. They return cached data (presumably), so cost is low. But no rate limit at all.

### [HIGH] #86 — Auth middleware has TOCTOU on `request.state` injection
- Multiple branches set `request.state.auth = ...` and `request.state.supabase_user = ...`. If a downstream handler reads `request.state.auth` but the path matched a public branch, attribute is missing → AttributeError.
- Minor; handlers should not assume `request.state.auth` exists.

### [MEDIUM] #87 — `Authorization: Bearer akar_` (empty token) is treated as INVALID, not PUBLIC bypass
- `if token.startswith("akar_")` → if `token=""`, falls through to next check. Fine.
- `if token.startswith("eyJ")` → if token="eyJ", tries to verify empty-ish JWT, fails.
- Empty bearer string passes through to "Invalid credentials". OK.

### [MEDIUM] #88 — No audit log of failed auth attempts
- 401 responses are returned but not logged to an audit trail. An attacker probing admin endpoints leaves no trace.
- Recommend: log `path`, `client IP`, `user-agent` for all 401/403 on admin/user paths.

### [MEDIUM] #89 — Gateway kill switch returns 503 for ALL `/v1/` paths, including `/v1/models` (public)
**File**: `backend/app/main.py:84-91`
- When admin disables gateway, models listing also fails. If frontend expects models to be loadable for pricing display, the entire UI breaks.
- Recommendation: only disable `/v1/chat/completions` when gateway off; keep `/v1/models` accessible.

### [MEDIUM] #90 — JWT verification happens on EVERY request — full DB lookup to `accounts`
**File**: `backend/app/core/supabase.py:_verify_supabase_jwt:21-50`
- `_verify_supabase_jwt` calls `supabase.auth.get_user(token)` (network round-trip to Supabase) + `accounts` query.
- This is cached for 60s. So worst case = 1 round-trip per minute per token. Acceptable.
- But: if Supabase is down, all auth fails (no fallback to JWT-only verification).

### [LOW] #91 — `Bearer` scheme case-insensitivity only in `parts[0].lower() != "bearer"`
- ✅ Correctly lowercases. Per RFC 7235, auth scheme is case-insensitive.

### [LOW] #92 — OpenAPI docs at `/docs`, `/redoc`, `/openapi.json` are PUBLIC
- Anyone can see all endpoints. Not a security issue per se (no auth bypass) but reveals admin endpoints exist.

### [LOW] #93 — `cors_origins` resolution: dev defaults to `http://localhost:3000`
- Fine for dev. Production refuses to start without explicit env.

### [INFO] #94 — CORS allow_methods restricted to `["GET", "POST", "PATCH", "DELETE", "OPTIONS"]`
- ✅ Good. Not wildcarded.

### [INFO] #95 — CORS allow_headers restricted to `["Authorization", "Content-Type", "X-Requested-With"]`
- ✅ Good.

### [INFO] #96 — `allow_credentials` only true when wildcard NOT in origins
- ✅ Good — prevents wildcard + credentials combo (CORS spec violation).

### [INFO] #97 — Production refuses to start without Fernet key + Whop webhook secret
- ✅ Fail-closed at startup. Excellent.


## BACKEND USER.PY

### [HIGH] #98 — Checkout session: `redirect_url` from request body is honored
**File**: `backend/app/api/user.py:create_checkout_session:548-565`
- Body accepts `redirect_url` from the user. Could be used to send victim to attacker's site after Whop checkout.
- HOWEVER: there's an allowlist at line 559-563 (`ALLOWED_REDIRECT_HOSTS`). Any non-allowlisted host is reset to `akarouter.com/usage`. ✅ Mitigated.
- But allowlist is missing `akarouter-frontend-production.up.railway.app` may be obsolete — verify with current frontend URL.

### [HIGH] #99 — Checkout session allowlist doesn't include current frontend hostname
**File**: `backend/app/api/user.py:559-563`
- Allowlist: `{akarouter.com, www.akarouter.com, akarouter.dev, akarouter-frontend-production.up.railway.app, localhost}`
- Frontend is at `akarouter.dev` (per MEMORY.md). ✅ Included.
- But `akarouter.com` (no www) is included — verify this is intended. Could conflict with marketing site.
- **MEDIUM**: missing `127.0.0.1` for local dev testing.

### [MEDIUM] #100 — `create_my_key` returns `api_key` (raw key) in response — relies on HTTPS
**File**: `backend/app/api/user.py:create_my_key:115`
- Raw key returned ONCE in response. Only shown once. ✅ Good pattern.
- Requires HTTPS to avoid MITM. Verified Railway enforces HTTPS.

### [MEDIUM] #101 — `_get_user_id` falls back to `request.state.supabase_user.account_id` — used for `DELETE /user/keys/{key_id}`
- ✅ Correctly enforces ownership by `eq("account_id", account_id)`.
- BUT: `DELETE /user/keys/{key_id}` checks ownership via WHERE clause. If the user guesses another user's key_id (UUID), the WHERE filter returns no rows → 404. No information leak. ✅ Good.

### [MEDIUM] #102 — `get_my_usage` queries `request_logs` without pagination
**File**: `backend/app/api/user.py:283-289`
- `tokens_query.limit(1000)` — hardcoded limit. If user has 10,000 logs since last reset, only 1000 are counted for `consumed_tokens_input/output`.
- Budget consumption shows undercount.
- **Bug: budget progress shows lower than actual.**

### [MEDIUM] #103 — `get_my_analytics` doesn't paginate, returns up to 1000 logs (incl. recent_logs[:100])
**File**: `backend/app/api/user.py:get_my_analytics:447`
- Same as #102 — 1000-row cap. Heavy users get incomplete analytics.

### [MEDIUM] #104 — `days: int` parameter in `/user/analytics` not validated
**File**: `backend/app/api/user.py:413`
- `days: int = 30` — user can pass `days=1000000` → DB query for 1000 logs over 2700 years. Mostly OK (just returns nothing) but wastes DB time.
- Clamp `days = max(1, min(365, days))`.

### [MEDIUM] #105 — `start_date`/`end_date` not validated
**File**: `backend/app/api/user.py:419-425`
- Accepts arbitrary strings. If invalid, DB query is also invalid → returns empty or errors.
- No Pydantic validator → easy DOS via weird dates like `start_date="not-a-date"`.

### [LOW] #106 — `key_name: str = "default"` no max length
- Could be 10MB. Should cap to 100 chars.

### [LOW] #107 — `get_my_usage` returns `monthly_requests` from accounts table but `consumed_month` from budget calc
- Two different sources — possible inconsistency. The `accounts.monthly_requests` may be stale (cached/buffered) while `consumed_month` is freshly computed.
- Result: UI may show "used 45 of 100" but `consumed_month=50`. Confusing.

### [LOW] #108 — `get_my_usage` computes `next_reset_5h` and `next_reset_7d` as `max(0, delta_seconds)` — if cycle has passed, shows 0 forever
- Off-by-one for reset display. Should show time until NEXT cycle, not since last.

### [INFO] #109 — Activation endpoint enforces BOTH per-IP AND per-account rate limits — defense in depth ✅
- 5 req/min/IP + 5 req/min/account.


## BACKEND CONFIG

### [INFO] #110 — `app_env` defaults to "production" (fail-closed)
- ✅ Excellent. Missing env var = locked down, not dev mode.

### [INFO] #111 — `admin_dev_token` defaults to empty
- ✅ Dev backdoor can't activate without explicit env.

### [LOW] #112 — `cors_origins` default includes `akarouter-frontend-production.up.railway.app`
- Is this still the Railway preview URL? Frontend is at `akarouter.dev`. The Railway preview URL may no longer be needed. Cleanup candidate.

### [LOW] #113 — No validation that `agent_key_encryption_secret` decodes as Fernet key
- Only checked at runtime when first encrypt happens. Should validate at startup.
- Mitigated by startup check that secret is >= 32 chars (see main.py).

### [LOW] #114 — `model_pricing` and `model_mapping` hardcoded — not in DB
- DB has separate `models` table with `input_cost_per_million`, `points_cost`. These settings are dead code OR shadow override.
- Should remove to avoid drift.

### [LOW] #115 — `whop_*` env vars all default to "" — no validation
- If empty, `/user/checkout-session` will fail at runtime (HTTP 500). Acceptable but not great UX.

### [LOW] #116 — `nous_device_code_url` / `nous_token_url` hardcoded to nousresearch.com
- If Nous changes OAuth URLs, requires deploy. Could move to env.


## BACKEND RECAPTCHA

### [MEDIUM] #117 — `verify_recaptcha` creates a new `httpx.AsyncClient` per call (no pooling)
**File**: `backend/app/core/recaptcha.py:18`
- Each verify creates a fresh `AsyncClient`. No connection pooling. Under load, this is wasteful.
- Should use `get_http_client()` (the global pool from `http_client.py`).

### [MEDIUM] #118 — reCAPTCHA score threshold = 0.5 (medium) — too lenient for key creation
**File**: `backend/app/core/recaptcha.py:32`
- Score 0.5 allows borderline bots. For `POST /user/keys` (which grants API access), should be 0.7+.
- Or: per-endpoint thresholds.

### [HIGH] #119 — If `RECAPTCHA_SECRET` env var is empty, `verify_recaptcha` returns False (deny) — good fail-closed
- ✅ But: in dev with no secret set, EVERY captcha fails → key creation broken.
- Maybe better: skip verification in dev (with warning log) like other fail-closed patterns.

### [LOW] #120 — No timeout on Google API response beyond 5s
- ✅ Already has 5s timeout. Acceptable.

### [LOW] #121 — Recaptcha token not bound to user session — could be reused across users
- ReCAPTCHA tokens are meant to be single-use per render. If an attacker steals a token (e.g., XSS), they can submit it with any account_id.
- Mitigated by short TTL (2 min) but not zero.


## BACKEND SECURITY_HEADERS

### [INFO] #122 — Comprehensive security headers ✅
- HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Permissions-Policy, COOP/CORP — all set.
- Server header stripped.
- Per-route CSP (docs gets swagger CDN; everything else gets lockdown).
- ✅ Excellent implementation.

### [LOW] #123 — `Permissions-Policy` blocks ALL powerful features — too broad
- Blocks camera, microphone, etc. — features that legitimate use cases might need.
- Acceptable for a backend that never serves HTML.

### [LOW] #124 — CSP on Swagger docs uses `unsafe-inline` for scripts
- Necessary for swagger-ui inline JSONP. Acceptable risk (docs are public-ish).


## BACKEND RATE_LIMIT

### [INFO] #125 — Single-instance rate limiter (in-memory) — appropriate for Railway single-deploy
- ✅ Documented design tradeoff.
- Not safe across multiple instances — would need Redis.

### [INFO] #126 — Sliding-window log algorithm ✅
- No boundary burst issues. Each bucket limited to ~limit timestamps (small memory).

### [INFO] #127 — Per-tier + per-endpoint limits defined ✅
- Tiers: free=20/min, starter=60/min, pro=120/min, ultra=300/min.
- Per-IP: auth.login=10/min, key create=5/min, key revoke=5/min, activate=5/min.

### [MEDIUM] #128 — Rate limit on `/v1/models` (30/min/IP) — too low for high-traffic dashboards
- 30/min/IP = 0.5 req/sec. A dashboard refreshing every 5s would hit the limit in 30s.
- But the page should cache. Acceptable.

### [MEDIUM] #129 — No per-endpoint rate limit on `POST /v1/chat/completions`
- Relies on per-tier RPM only. Per-IP limit could be useful to prevent abuse from one IP across many accounts.

### [LOW] #130 — RateLimitResult doesn't expose `X-RateLimit-Policy` header
- Modern HTTP rate limit headers include a `Policy` directive. Optional.

### [LOW] #131 — `reset()` deletes the bucket silently — no audit log
- A revoked key's bucket is reset without logging. Acceptable (revocation is itself logged).


## BACKEND AUDIT

### [INFO] #132 — Audit log wraps Postgres function with fail-soft semantics ✅
- ✅ Good design — audit failures don't break the action.
- ✅ X-Forwarded-For respected for client IP.

### [MEDIUM] #133 — `audit()` is fail-soft — could lose audit trail silently
**File**: `backend/app/core/audit.py:audit:118`
- If audit RPC fails (DB down), only logs error. No retry queue.
- Acceptable for v1 (log lines are picked up by alerting). But consider persistent queue for compliance-sensitive actions (tier changes, key revocations).

### [LOW] #134 — `_extract_request_meta` only takes leftmost X-Forwarded-For — can be spoofed
- ✅ Standard pattern. Trust XFF only when behind trusted proxy. Railway/Cloudflare are trusted.

## BACKEND LOCKS

### [INFO] #135 — Postgres advisory locks via `_xact` variants auto-release on transaction end ✅
### [INFO] #136 — CRC32 hash for lock keys — collision rate is negligible ✅
### [INFO] #137 — Three lock namespaces (account_budget, webhook_dedup, tier_upgrade) ✅
### [INFO] #138 — InMemoryLockBackend for tests + fallback ✅

### [MEDIUM] #139 — `account_budget` lock is non-blocking — fails with 429 if held by another instance
- Acceptable design. But this means a sustained burst from one account can repeatedly 429 even when budget is fine.
- Mitigation: cache `acquired=False` result briefly to avoid hammering lock RPC.


## BACKEND RATE_LIMIT_MIDDLEWARE

### [INFO] #140 — `enforce_rate_limit` is fail-soft ✅
- ✅ Never blocks a request because rate limiter bugged out. Good.

### [HIGH] #141 — `client_ip` trusts X-Forwarded-For leftmost without checking proxy chain
**File**: `backend/app/core/rate_limit_middleware.py:client_ip:36-46`
- Attacker can set `X-Forwarded-For: 1.2.3.4` to impersonate IP 1.2.3.4.
- Per-IP rate limit then becomes ineffective (attacker rotates IPs).
- **Mitigation**: configure Railway to strip client-set XFF and append server-side.
- OR: parse only known proxy IPs from the right.

### [MEDIUM] #142 — Per-IP rate limit uses endpoint scope prefix `ip.{endpoint}` — but `enforce_ip_rate_limit` also passes this scope
- OK; works as documented.

### [LOW] #143 — `unknown` returned if no IP found — no rate limit applied for that bucket
**File**: `backend/app/core/rate_limit_middleware.py:48`
- All "unknown" IPs share one bucket → can DOS other users.
- Should reject (or use empty string that gets rejected) when client IP can't be determined.


## BACKEND CHAT.PY — detailed (refund, points, log_request)

### [INFO] #144 — `sanitize_error_msg` returns fixed enum — not substring replace ✅
- ✅ Great security improvement. The previous version leaked upstream text.

### [HIGH] #145 — `_refund_points` doesn't pass `request_log_id` (confirmed at line 207-221)
**File**: `backend/app/api/chat.py:_refund_points:207-221`
- Refund RPC called without `request_log_id` parameter. Refund ledger row can't be linked to the original charge.
- **Audit gap** — see findings #22 and #145 (this is the same).

### [HIGH] #146 — `_refund_points` is called on every error path AFTER `log_request` — but `log_request` may have failed
**File**: `backend/app/api/chat.py:_refund_points`
- If Supabase is down, both `log_request` and `_refund_points` fail. Point is LOST.
- Need a persistent `pending_refunds` table or retry queue.

### [HIGH] #147 — `release_fn` defined as `lambda ok, err=None: release_provider(provider["id"], ok, err)` — but called with `release_fn(True)` and `release_fn(False, "msg")`
**File**: `backend/app/api/chat.py:362-370`
- ✅ Signature is `release_provider(provider_id, success, error_msg=None)`. The lambda passes `err` as `error_msg`.
- This was finding #16 — false failures trigger provider degradation.
- Need to fix by either: (a) changing `release_fn(success)` to `release_fn(success, None)` explicitly, or (b) fixing the release_provider default.

### [CRITICAL] #148 — Points charged BEFORE model validation (per finding #18)
**File**: `backend/app/api/chat.py:333`
```python
point_reservation = await _enforce_and_reserve_points(account_id_early, model_alias, points_cost)
```
- `points_cost` comes from `meta.get("points_cost", 5)` at line 328. If model not in `meta` cache, defaults to 5.
- `pricing_mode` checked at line 337 (`if pricing_mode == "per_request"`). But this is per_request ONLY — the default `per_token` mode also charges points_cost.
- Per-token models ALSO have a points_cost. User is charged `points_cost` per call, not per token.
- **Bug**: user is charged points per CALL, not per TOKEN. Misalignment with pricing tier ("X points/mo" suggests monthly budget, not per-call).
- **Action**: confirm with product. If per-call is intentional, document. If per-token, implement cost-per-token deduction.

### [HIGH] #149 — `pricing_mode == "per_request"` path also has separate `cost_per_request_cents` field
- The DB schema has both `points_cost` and `cost_per_request_cents`. These are duplicate pricing concepts.
- Refactor to single source of truth.

### [MEDIUM] #150 — Streaming: `release_fn(False, f"Streaming status error: {cleaned_msg}")` writes the error message to release_provider
- Provider degradation logic may use the error_msg string. `cleaned_msg` is safe (enum). ✅ OK.

### [MEDIUM] #151 — `log_request` is async but the calling function returns before awaiting it in some paths
- All `await log_request(...)` in the error paths are awaited. ✅ OK on inspection.


## SCHEMA.SQL — point_transactions + RPC functions

### [HIGH] #152 — `refund_account_points` SQL function does NOT accept `request_log_id` parameter
**File**: `backend/supabase/schema.sql:889-919`
```sql
CREATE OR REPLACE FUNCTION refund_account_points(
  account_uuid UUID, points_to_refund BIGINT, refund_free BOOLEAN DEFAULT FALSE,
  model_alias TEXT DEFAULT NULL
) RETURNS VOID
```
- No `request_log_id UUID DEFAULT NULL` parameter.
- Python `_refund_points` (chat.py:212-220) doesn't pass it either.
- **Result**: every refund ledger row has `request_log_id = NULL`. Cannot link a refund to its original charge.
- **Fix**: add `request_log_id UUID DEFAULT NULL` param to the SQL function, plumb through Python `_refund_points`.

### [INFO] #153 — `charge_account_points` has `request_log_id` param ✅
- But Python chat.py `_enforce_and_reserve_points` (called at line 333) does NOT pass `request_log_id`.
- Need to update Python to pass it AFTER `log_request` returns the id.
- Currently, the order is: charge → call upstream → log_request → (refund on error). `request_log_id` is only known AFTER log_request. So you can't pass it on charge.
- **Alternative design**: do log_request BEFORE charge, then charge with log id, then refund if upstream fails.
- OR: charge first, then UPDATE the ledger row with request_log_id after log_request.

### [HIGH] #154 — Monthly reset grants a `point_transactions` row of `points = plan_rec.monthly_point_allowance` — but new balance is also set to that value
- This is a GRANT of the full monthly allowance, not just the rollover. Correct semantics ✅.
- The first grant after account creation will be the full allowance — correct.

### [MEDIUM] #155 — No UNIQUE constraint preventing duplicate point_transactions for the same (account, request_log_id, kind)
- If the same charge is retried, it could create 2 ledger rows. Need UNIQUE (account_id, request_log_id, kind) WHERE request_log_id IS NOT NULL.
- Or accept the tradeoff — refund retry would naturally insert new rows.

### [MEDIUM] #156 — `acc.monthly_points_limit` updated to `plan_rec.monthly_point_allowance` only on monthly reset, not on plan change
- If admin changes a user's tier outside the reset cycle, the new limit is applied on next reset. User may exceed plan limit until reset.
- Acceptable but worth noting.

