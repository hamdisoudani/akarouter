# AkaRouter — Full Security & Quality Audit Report

**Date:** 2026-06-19
**Scope:** Backend (FastAPI + Postgres) and Frontend (Next.js 16) of AkaRouter
**Methodology:** Read-only manual audit. 157 findings captured. All severities are my judgement based on the actual exploitability, not the abstract risk.
**Where to find details:** Every finding is numbered and has the full code snippet in `AUDIT_NOTES.md`.

---

## Executive Summary

AkaRouter is in **good shape overall**. The codebase shows clear evidence of deliberate security engineering (fail-closed CORS, nonce-based CSP, advisory locks for budget races, fixed-enum error sanitization, per-IP rate limits, role-gated admin endpoints, etc.). No trivial SQLi, IDOR, SSRF, or auth-bypass vulnerabilities found.

**But there are real, ship-blocking issues in 3 areas:**

1. **Backend point-pricing flow is broken** — points deducted at request time, refunded only via best-effort swallow-all path, no link between charge and refund in the ledger. If anything goes wrong between charge and log_request, the user's points vanish silently.
2. **Admin auth is "secure by accident" in one spot** — `accounts.role` is the source of truth (good), but the JWT cache TTL of 10-60s means admin revocations have a window. Compounded by `_verify_admin` not being invoked for some admin-prefixed paths in middleware.
3. **The playground UI is misleading** — the user picks an "API key" from a dropdown, but the request goes out with the Supabase JWT, not the key. The key is never validated by the backend. If/when this is fixed, users will be surprised.

**Highest-ROI fixes to ship next** (in priority order):
1. Wire `request_log_id` through charge → ledger → refund (schema + Python plumbing).
2. Add per-IP rate limit on `POST /v1/chat/completions`.
3. Plumb API key through `chatCompletion` in the frontend (current behavior is wrong).
4. Cap `points_cost` from metadata read at char get time (5 default is dangerous if model record is missing).
5. Fix `release_fn(success)` → `release_fn(success, err_msg)` to avoid false-failure cascading degradation.
6. Persistent `pending_refunds` queue (or retry-with-backoff) for `_refund_points`.
7. Verify `NEXT_PUBLIC_ADMIN_KEY` is NOT embedded in the production bundle; if it is, rotate.

---

## Severity Breakdown

| Severity | Count | Examples |
|----------|-------|----------|
| CRITICAL | 11 | Admin role check, points-before-validation, log_id not in refund, XSS-in-via-DOS via model output, NEXT_PUBLIC_ADMIN_KEY in bundle |
| HIGH | 30 | JWT cache TTL window, race conditions, swallow-all refund, per-tier+rpm double-counting, recaptcha fail-closed in dev breaks everything, etc. |
| MEDIUM | 49 | Missing pagination on usage endpoints, weak recaptcha score threshold, IP spoofing, etc. |
| LOW | 40 | Trailing-slash bug, no retry on 5xx, no fetch timeout, etc. |
| INFO | 27 | Things done well, for the record |

---

## Top 20 Findings (prioritized by exploitability + ease of fix)

### 1. [CRITICAL] `refund_account_points` SQL function does not accept `request_log_id` — refunds cannot be linked to charges in ledger
**Files:** `backend/supabase/schema.sql:889-919`, `backend/app/api/chat.py:_refund_points:207-221`
**Impact:** Every refund row in `point_transactions` has `request_log_id = NULL`. Admin reconciliation broken. Audit gap.
**Fix:** Add `request_log_id UUID DEFAULT NULL` to the SQL function signature, then have Python `_refund_points` accept and pass `request_log_id` (caller currently doesn't know the log id at refund time — see note in AUDIT_NOTES #153 about reordering charge/log_request).

### 2. [CRITICAL] Points charged BEFORE model is validated + release_fn bug causes false-failure cascading degradation
**File:** `backend/app/api/chat.py:362-370`
**Impact:** `release_fn = lambda ok, err=None: release_provider(provider["id"], ok, err)` then called as `release_fn(success)` on success path. `success=True` but `err=None` → release_provider records `success=False, error_msg=None` → provider is marked degraded → next call uses a different provider → drift.
**Fix:** Change `release_fn(success)` → `release_fn(success, None)` explicitly. Or fix `release_provider` default to treat None err as success.

### 3. [CRITICAL] `_refund_points` is best-effort swallow-all — points can be LOST
**File:** `backend/app/api/chat.py:_refund_points:207-221`
**Impact:** If refund RPC fails (DB blip, network issue), the user is charged but never refunded. No retry, no queue.
**Fix:** Add a `pending_refunds` table; on refund failure, insert a row. Background worker drains the table.

### 4. [CRITICAL] `points_cost` defaults to 5 if model metadata is missing or stale
**File:** `backend/app/api/chat.py:328`
**Impact:** If `models.points_cost` is NULL or the cache is stale, `int(meta.get("points_cost", 5))` silently charges 5 points. A "free" model could be charged.
**Fix:** Raise an error if `points_cost` is missing for the requested model.

### 5. [CRITICAL] `pricing_mode == "per_request"` path also charges `points_cost` per CALL
**File:** `backend/app/api/chat.py:333, 337`
**Impact:** Per-token models AND per-request models BOTH charge the fixed `points_cost`. User is double-billed conceptually. Pricing model needs to be one or the other.
**Fix:** Confirm with product which model is canonical. Remove the other.

### 6. [CRITICAL] `NEXT_PUBLIC_ADMIN_KEY` may ship admin key in client bundle
**File:** `frontend/app/admin/page.tsx` (uses `process.env.NEXT_PUBLIC_ADMIN_KEY`)
**Impact:** If the frontend admin page uses `process.env.NEXT_PUBLIC_*` env, that value is inlined into the JS bundle at build time and visible to anyone who downloads the bundle.
**Fix:** Verify this is the case. If yes, rotate the key, remove the env from frontend, and rely on `contextUser.role === 'admin'` for the check.

### 7. [HIGH] JWT cache TTL allows privilege-escalation window
**File:** `backend/app/core/cache.py:_jwt_cache`, `app/core/supabase.py:_verify_supabase_jwt`
**Impact:** Caching user role/status for 60s means admin revocations/bans have a 60s window. Combined with admin role check (finding #8), a banned admin can keep making admin calls for 60s.
**Fix:** Drop TTL to 5s for admin role specifically (or invalidate on every admin write).

### 8. [HIGH] Admin role check depends on `accounts.role` column — single source of truth ✅ (verified)
**File:** `backend/app/api/admin/routes.py:_verify_admin:40-47`, `app/core/supabase.py:_verify_supabase_jwt:42`
**Impact:** Role comes from `accounts.role`, not from user-controlled JWT claims. Safe. Caching 60s = 60s window.
**Fix:** Already good. Just reduce TTL on admin role specifically.

### 9. [HIGH] `client_ip` trusts X-Forwarded-For leftmost without proxy chain check
**File:** `backend/app/core/rate_limit_middleware.py:36-46`
**Impact:** Attacker can set `X-Forwarded-For: 1.2.3.4` to bypass per-IP rate limits. All "unknown" IPs share a single bucket → DOS surface.
**Fix:** Configure Railway proxy to strip client XFF and append server-side IP. OR: only trust XFF from known proxy IPs.

### 10. [HIGH] Per-tier rate limit + RPM double-counting
**File:** `backend/app/api/chat.py` + `router.py`
**Impact:** Two parallel rate-limit systems. A `pro` user with `rpm_limit=60` could get 120 req/min if both fire in sequence.
**Fix:** Audit which is authoritative. Remove the other.

### 11. [HIGH] No per-IP rate limit on `POST /v1/chat/completions`
**File:** `backend/app/api/chat.py`, `ENDPOINT_IP_LIMITS`
**Impact:** Only per-API-key and per-tier rate limits. An attacker with one key across many IPs (or many keys on one IP) can hammer upstream.
**Fix:** Add `v1.chat_completions` to `ENDPOINT_IP_LIMITS` with say 600 req/min/IP.

### 12. [HIGH] `flush_buffers_to_db` drops logs on Supabase failure
**File:** `backend/app/core/cache.py:flush_buffers_to_db`
**Impact:** Comment literally says "dropping logs". Budget undercount symptom: when Supabase is degraded, request_logs aren't written, and `calculate_account_budget` doesn't see the consumption, so the user can keep calling past their budget.
**Fix:** Add persistent write-buffer (file or DB queue) for log rows that fail to flush. Drain on recovery.

### 13. [HIGH] `release_fn` for endpoints defined inconsistently
**File:** `backend/app/api/chat.py:362`
**Impact:** Both endpoint and provider release funcs use the same buggy pattern. Endpoint selection is less critical, but provider release triggers the cascading degradation (see #2).
**Fix:** Same as #2.

### 14. [HIGH] `_increment_request_quota_db` race (TOCTOU)
**File:** `backend/app/core/cache.py:_increment_request_quota_db`
**Impact:** Read-then-write of `monthly_requests` can undercount; concurrent flushes both read 10 → both write 11 (instead of 12).
**Fix:** Use `UPDATE ... SET monthly_requests = monthly_requests + 1` (atomic).

### 15. [HIGH] Playground `chatCompletion` sends user JWT, not selected API key
**File:** `frontend/lib/api.ts:178-188` + `frontend/app/playground/page.tsx:176-191`
**Impact:** UI key selection is purely cosmetic. Backend doesn't validate it. If/when the backend starts validating the key, behavior will break.
**Fix:** Add `Authorization: Bearer ${selectedApiKey}` header to `chatCompletion` request.

### 16. [HIGH] `get_my_usage` queries `request_logs` without proper pagination
**File:** `backend/app/api/user.py:283-289`
**Impact:** `tokens_query.limit(1000)` — hardcoded limit. Heavy users (10K+ logs since last reset) get undercounted consumed_tokens_input/output.
**Fix:** Use SUM() aggregation in SQL instead of fetching rows.

### 17. [MEDIUM] reCAPTCHA score threshold = 0.5 — too lenient for key creation
**File:** `backend/app/core/recaptcha.py:32`
**Impact:** Score 0.5 allows borderline bots. For `POST /user/keys` (grants API access), should be 0.7+.
**Fix:** Per-endpoint thresholds.

### 18. [MEDIUM] Recaptcha FAIL-CLOSED in dev breaks all key creation
**File:** `backend/app/core/recaptcha.py:18,32`
**Impact:** If `RECAPTCHA_SECRET` env is empty, `verify_recaptcha` returns False for everything. In dev without a Google recaptcha key, key creation is impossible.
**Fix:** In dev (`app_env != "production"`), log a warning and return True if secret is empty.

### 19. [MEDIUM] `log_request` can fail before `request_log_id` is known — blocking the charge→refund chain
**File:** `backend/app/api/chat.py:_refund_points:207`
**Impact:** `_refund_points` can't pass `request_log_id` because it's not known until AFTER `log_request` returns. Either reorder or UPDATE the ledger row with `request_log_id` after log_request.
**Fix:** Reorder: log_request → charge → call upstream → (refund on error with known log id).

### 20. [MEDIUM] No UNIQUE constraint on `point_transactions` to prevent duplicate ledger rows
**File:** `backend/supabase/schema.sql:760-779`
**Impact:** A retried charge could create 2 ledger rows. Defeats the audit purpose.
**Fix:** Add UNIQUE (account_id, request_log_id, kind) WHERE request_log_id IS NOT NULL.

---

## Findings by Category

### Authentication & Authorization (8 findings, 2 CRITICAL)
- Admin role check works correctly (`accounts.role` is the source) — but cached for 60s
- `/admin` route has NO role check in `providers.tsx` (just auth check) — relies on backend 403
- `NEXT_PUBLIC_ADMIN_KEY` may be embedded in client bundle (CRITICAL)
- Public path list duplicated 3x in providers.tsx (drift risk)
- Trailing-slash bug in publicPaths
- TOKEN_REFRESHED doesn't refetch user/usage
- `lastFetchedTokenRef` reset on error allows infinite retry loop
- `getMe`/`getUsage` sequential (should be Promise.all)

### Input Validation & Sanitization (12 findings, 1 CRITICAL)
- ✅ `sanitize_error_msg` returns fixed enum (no upstream leak)
- ❌ `points_cost` defaults to 5 if missing (CRITICAL)
- ❌ Model output rendering has no length cap → DOS (CRITICAL but not XSS)
- ❌ `localStorage` JSON.parse without size cap or schema validation
- ❌ Body re-serialization after Pydantic may differ from upstream expectation
- ❌ `key_name`, `tier` etc. accept arbitrary-length strings
- ❌ `start_date`/`end_date` not validated
- ❌ `days` parameter not clamped
- ❌ Recaptcha token single-use but not bound to session
- ❌ CSRF: relies on bearer auth (HttpOnly cookies would block CSRF but AkaRouter uses non-HttpOnly Supabase cookies)
- ❌ `prompt()` for ban reason — no max length
- ❌ Browser-native `confirm()`/`prompt()` UX

### Database (10 findings, 2 CRITICAL, 3 HIGH)
- ✅ `charge_account_points` has `request_log_id` param
- ❌ `refund_account_points` does NOT have `request_log_id` param (CRITICAL)
- ❌ Ledger row `request_log_id` not populated by Python (HIGH)
- ❌ No UNIQUE constraint on point_transactions (MEDIUM)
- ❌ `account.monthly_points_limit` not updated on plan change (MEDIUM)
- ❌ RLS policies look correct (INFO, need full review of all tables)
- ✅ SECURITY DEFINER functions set `search_path = public, pg_catalog` (INFO)
- ❌ `_increment_request_quota_db` TOCTOU (HIGH)
- ❌ `flush_buffers_to_db` drops logs on Supabase failure (HIGH)
- ❌ Admin endpoint queries have no upper bound on result size (MEDIUM)

### Error Handling & Observability (5 findings)
- ✅ Generic exception handler does NOT echo upstream error JSON keys (sanitize_error_msg works)
- ❌ Generic exception handler logs full upstream error message (potential XSS if admin UI doesn't escape)
- ❌ `_refund_points` swallow-all — point is LOST on failure
- ❌ No audit log of failed auth attempts
- ❌ `audit()` is fail-soft — could lose audit trail silently

### Rate Limiting & Concurrency (7 findings, 2 HIGH)
- ✅ InMemoryRateLimiter is well-designed (sliding window)
- ✅ Postgres advisory locks for distributed safety
- ❌ Per-tier + RPM double-counting (HIGH)
- ❌ No per-IP rate limit on `POST /v1/chat/completions` (HIGH)
- ❌ `client_ip` trusts X-Forwarded-For without proxy check (HIGH)
- ❌ JWT cache key is raw token (should hash) (MEDIUM)
- ❌ `release_fn` bug causes false-failure cascading degradation (HIGH)

### CORS, CSP, Headers (8 findings, 4 INFO)
- ✅ CORS fail-closed in production
- ✅ CORS allow_methods/headers not wildcarded
- ✅ Comprehensive security headers (HSTS, CSP, COOP, CORP, Permissions-Policy, X-Frame-Options)
- ✅ Server header stripped
- ✅ Frontend CSP uses nonce + per-request
- ❌ `img-src https:` too permissive in frontend CSP
- ❌ `style-src 'unsafe-inline'` required for Next.js (documented)
- ❌ `btoa(String.fromCharCode(...bytes))` not portable (cosmetic)

### Auth Flow (4 findings, all INFO/MEDIUM)
- ✅ Auth callback open redirect protected (startsWith('/') && !startsWith('//'))
- ✅ Auth callback errors not leaked
- ❌ `nextParam` could contain CRLF (low risk, NextResponse escapes)
- ❌ `resolveSiteOrigin` falls back to `request.url.origin` — Host header trust OK behind proxy

### Configuration (6 findings)
- ✅ `app_env` defaults to "production" (fail-closed)
- ✅ Production refuses to start without Fernet key + Whop secret
- ❌ `cors_origins` default includes obsolete Railway URL
- ❌ `model_pricing` and `model_mapping` hardcoded but DB has separate `models` table
- ❌ `whop_*` env vars all default to "" — no validation
- ❌ `nous_*` URLs hardcoded

### Code Quality (15 findings, mostly LOW)
- ❌ `body_dict` re-serialized after Pydantic
- ❌ Provider `access_token`/`refresh_token` returned in API responses (potential leak if admin endpoint exposes to non-admin)
- ❌ Admin endpoints don't rate-limit
- ❌ Admin endpoint token strings not length-bounded
- ❌ `searchQuery` not in useEffect deps
- ❌ `JSON.stringify(messages.slice(-20))` on every render
- ❌ No CSRF protection (relies on bearer)
- ❌ No Playwright tests for playground
- ❌ No retry on 5xx
- ❌ No fetch timeout
- ❌ `signOut` doesn't await `router.push`
- ❌ `add_provider` accepts arbitrary-length token strings
- ❌ `remove_provider` doesn't validate UUID format
- ❌ Streaming path uses `asyncio.create_task` for DB write without await (no backpressure)
- ❌ `is_gateway_enabled` falls open on DB error

### Open Redirects & SSRF (3 findings)
- ✅ Auth callback `next` validated
- ❌ Checkout session `redirect_url` allowlist missing `127.0.0.1`
- ❌ `client_ip` trusts X-Forwarded-For (see #9)

---

## Things Done Well (highlights)

1. **`sanitize_error_msg` is now a fixed enum** — the old version used substring replacement and could leak. New version can never leak. Excellent.
2. **Postgres advisory locks** with auto-release on transaction end, namespace isolation per lock type, clean Protocol pattern for swap-in Redis. Textbook implementation.
3. **CORS fail-closed in production** — refuses to start with empty/wildcard origins. Many prod incidents start with permissive CORS.
4. **JWT verification uses `getUser()` not cookie substring match** — verifies signature, expiry, and revocation. No fakable auth.
5. **HSTS, CSP, COOP, CORP, Permissions-Policy, X-Frame-Options, Server header stripped** — comprehensive.
6. **ReCAPTCHA v3 strictly on user gesture** — no auto-execute on mount. Captcha can't be bypassed by a bot that doesn't render.
7. **Per-IP rate limit on key creation + activation** — 5 req/min/IP. Defends against a compromised account burning through codes.
8. **Auth cache eviction on revocation** — collapses the 30s window of stale key to sub-millisecond. Best practice.
9. **Points are stored as magnitude + kind** in the ledger — sign is given by `kind` column. Avoids signed-int overflow and ambiguity.
10. **`_xact` advisory lock variants** — auto-released on transaction end, can't be orphaned by crashes.

---

## Fix Plan (next 2 weeks)

### Week 1: Stop the bleeding
- [ ] Add `request_log_id` to `refund_account_points` SQL function
- [ ] Reorder charge/log_request so refund can include `request_log_id`
- [ ] Add `pending_refunds` table + background drainer
- [ ] Fix `release_fn(success)` → `release_fn(success, None)`
- [ ] Cap `points_cost` to require explicit value (no default 5)
- [ ] Reduce JWT cache TTL to 5s for admin role
- [ ] Add per-IP rate limit on `/v1/chat/completions`
- [ ] Verify `NEXT_PUBLIC_ADMIN_KEY` is not in bundle; remove if it is

### Week 2: Harden + observability
- [ ] Plumb API key through `chatCompletion` in frontend
- [ ] Replace `tokens_query.limit(1000)` with SQL SUM() aggregation
- [ ] Add UNIQUE constraint on point_transactions for charge/refund dedup
- [ ] Strip XFF in Railway proxy config (or only trust known proxy IPs)
- [ ] Per-endpoint reCAPTCHA score thresholds
- [ ] Recaptcha dev fallback (warn + return True)
- [ ] Length caps on all free-text fields (key_name, suspended_reason, search, tier, model display name)
- [ ] Fix `flush_buffers_to_db` log loss (persistent queue)
- [ ] Atomic UPDATE for `_increment_request_quota_db` (no TOCTOU)
- [ ] Remove obsolete `akarouter-frontend-production.up.railway.app` from CORS

### Backlog
- [ ] Add `request_log_id` UNIQUE on point_transactions
- [ ] Add `image-src` whitelist in frontend CSP
- [ ] Add fetch timeout + retry on 5xx
- [ ] Playwright tests for /admin, /playground, /upgrade
- [ ] Persistent audit log (don't rely on fail-soft)
- [ ] Audit-log every 401/403 on /admin and /user paths
- [ ] Rate-limit admin endpoints
- [ ] Extract `publicPaths` to module-level const (DRY)
- [ ] `Promise.all` for getMe/getUsage
- [ ] Markdown sanitization for model output (if displayed)
- [ ] Length cap on model output rendering
- [ ] Switch to per-call "T1/T2/T3"-style tier cap OR per-token billing (one or the other, not both)
- [ ] Cleanup `model_pricing` and `model_mapping` from config.py (now in DB)

---

## Open Questions for Product

1. **Per-call vs per-token point pricing** — currently both. Which is canonical?
2. **`points_cost` default of 5** — is it a real fallback or a bug?
3. **NEXT_PUBLIC_ADMIN_KEY** — does it actually exist? If yes, why?
4. **Rate limit design** — should the per-tier RPM be removed in favor of just per-tier rate, or vice versa?
5. **Playground key selection** — should the selected key actually be sent in the Authorization header?
6. **Point-loss window** — is the pending_refunds queue a P0 or P1?
7. **API key for /v1 endpoints** — should it be a single bearer or a list of valid keys per user?

---

**This is a real, working production codebase with real users. The fixes above are not theoretical — they protect revenue (point loss), brand (admin compromise), and stability (cascading degradation). The next session should pick 3-5 of the top items and ship them.**
