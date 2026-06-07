# Changes for Railway deploy

## What was wrong
- Backend queried wrong Supabase table: `accounts` instead of `providers`
- Backend used wrong column names: `account_label` vs `account_label` on providers, `is_active` vs `health_status='active'`, `expires_at` vs `token_expires_at`, `refresh_lock_at` vs `refresh_lock_acquired_at`
- `/v1/models` returned empty because no Hermes accounts loaded
- `/admin/accounts` returned 404 instead of the new admin route
- Admin dashboard UI didn’t exist
- No landing page link to Admin Panel

## Files changed
1. `app/core/router.py` — full rewrite: query `providers` table, map correct schema columns
2. `app/api/health.py` — query `providers` table with correct columns
3. `app/api/chat.py` — update token refresh/persist to use `providers` columns
4. `app/api/models.py` — reload accounts + include default models
5. `app/main.py` — include admin router + startup event to load accounts
6. `app/api/admin.py` — NEW: `/admin/accounts`, `/admin/accounts/init-device-code`, `/admin/accounts/poll/{id}`
7. `frontend/app/admin/page.tsx` — NEW: admin dashboard with Realtime + Add Account flow
8. `frontend/app/dashboard/page.tsx` — show actual API URL from env
9. `frontend/app/page.tsx` — add Admin Panel link on landing page
10. `frontend/middleware.ts` — simplified (auth disabled for admin reads)

## How to apply
```bash
cd /home/ubuntu/akarouter-deploy
cd frontend && npm install && cd ..
# Copy the changed files above from this folder
# Then:
git add -A
git commit -m "fix: use providers table, add admin dashboard + device code flow"
git push origin main
```

Railway auto-deploys main branch. Both AKAROUTER and AKAROUTER-frontend services will rebuild.
