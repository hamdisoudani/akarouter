# Changelog

## 2026-06-17 — Next.js hardening & version pinning

### Pinned versions (was: `latest` on 5 critical deps)
| Package | Was | Now |
|---------|-----|-----|
| `next` | `latest` | `16.2.9` |
| `react` | `latest` | `19.2.7` |
| `react-dom` | `latest` | `19.2.7` |
| `eslint` | `latest` | `9.18.0` |
| `eslint-config-next` | `latest` | `16.2.9` |
| `typescript` | `latest` | `5.7.3` |
| `@supabase/ssr` | `latest` | `0.5.2` |
| `@supabase/supabase-js` | `latest` | `2.45.4` |
| `lucide-react` | `latest` | `0.460.0` |
| `@types/node` | `latest` | `22.10.5` |
| `@types/react` | `latest` | `19.2.17` |
| `@types/react-dom` | `latest` | `19.2.3` |
| `autoprefixer` | `latest` | `10.4.20` |
| `zod` | (new) | `3.23.8` |
| `vitest` | (new) | `2.1.8` |

### Security
- Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP) added via `next.config.js` `headers()`.
- Type-safe env validation via `lib/env.ts` (Zod). Server boot fails fast on missing/malformed env.
- `poweredByHeader: false` to suppress `X-Powered-By: Next.js`.
- API routes get a stricter no-script CSP and `Cache-Control: no-store`.

### Reliability
- `app/error.tsx`, `app/not-found.tsx`, `app/loading.tsx` for root.
- `app/{dashboard,admin,keys,agents,usage,upgrade}/{error,loading}.tsx` for each protected segment.
- `.npmrc` with `engine-strict=true` to lock Node/pnpm versions.

### Build hygiene
- `engines` field requires Node ≥ 20.10.0, pnpm ≥ 9.0.0.
- `lib/env.ts` replaces ad-hoc `process.env.*` reads.
- `.env.example` updated with the new vars and clearer comments.
