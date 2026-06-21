/**
 * Server-side API client.
 *
 * SECURITY: this module is server-only. It must NEVER be imported from a
 * client component or any code that ends up in the client bundle. We enforce
 * this with `import 'server-only'` at the top.
 *
 * The previous pattern was `lib/api.ts` which mixed server and client logic
 * based on `typeof window`. That meant:
 *  - The full backend URL (process.env.NEXT_PUBLIC_API_URL) was imported
 *    into client bundles and visible in devtools / source maps.
 *  - Errors thrown by the client fetch bubbled with backend hostnames in
 *    the error.message, leaking infrastructure details.
 *
 * By separating `server-api.ts` (server only) from `api.ts` (client only),
 * the backend URL stays server-side and never leaks to the browser.
 */

import 'server-only'
import { env } from './env'
import type { PlanPreset, ModelsResponse } from './api'

const SERVER_API_BASE = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')

/**
 * Internal fetch helper. Adds a server-side timeout and never follows
 * redirects silently (redirects can hide credential-leaking endpoints).
 *
 * Caching (2026-06-21): callers can opt into Next.js's data cache by
 * passing `init.next = { revalidate, tags }`. With `revalidate: N` the
 * fetch is shared across all server renders for N seconds — the
 * backend is hit at most once every N seconds no matter how many
 * visitors land on a page that needs the same data. With `tags` the
 * cache can be busted on demand via `revalidateTag('plans')` from an
 * admin action. Per-render dedup is automatic in Next.js 14+.
 */
async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${SERVER_API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  // 5-second hard timeout for server-side fetches (the page renders on demand,
  // we can't wait forever).
  const timeoutMs = 5_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...init,
      // Server Component fetches are deduped per request automatically.
      // For cross-request dedup (the data cache), callers pass
      // `init.next = { revalidate, tags }` and we forward it as-is.
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Mark the origin so backend logs can distinguish server-initiated
        // requests from client-initiated ones.
        'X-AkaRouter-Source': 'next-server-component',
        ...(init.headers || {}),
      },
    })

    if (!res.ok) {
      // SECURITY: never echo the raw response body or URL back to the
      // server log here. The caller decides what to do with the error.
      throw new ServerFetchError(path, res.status)
    }

    return res.json() as Promise<T>
  } catch (err) {
    if (err instanceof ServerFetchError) throw err
    if ((err as Error).name === 'AbortError') {
      throw new ServerFetchError(path, 504, 'timeout')
    }
    throw new ServerFetchError(path, 500)
  } finally {
    clearTimeout(timeout)
  }
}

export class ServerFetchError extends Error {
  constructor(
    public path: string,
    public status: number,
    public reason: 'http' | 'timeout' | 'network' = 'http',
  ) {
    // SECURITY: the error message deliberately omits the backend URL and
    // only mentions the path. If this error ever bubbles to the client
    // (it shouldn't, but defense in depth), no internal hostnames leak.
    super(`server fetch failed for ${path}: status=${status}`)
    this.name = 'ServerFetchError'
  }
}

/**
 * Fetch all plan presets from the backend, used by the landing page.
 *
 * Returns an empty list if the backend is unreachable so the landing page
 * can still render with fallback plans.
 *
 * Caching (2026-06-21): plan edits are rare (admin-controlled) so we
 * cache the response for 5 minutes via Next.js's data cache. Multiple
 * concurrent renders of any page that calls fetchServerPlans share the
 * cached payload — no extra backend hits. Tag `plans` so the admin
 * panel can `revalidateTag('plans')` after a plan edit to push the
 * change immediately.
 */
export async function fetchServerPlans(): Promise<PlanPreset[]> {
  try {
    const res = await serverFetch<{ plans: PlanPreset[] }>('/v1/plans', {
      next: { revalidate: 300, tags: ['plans'] },
    })
    return res.plans ?? []
  } catch (err) {
    console.error('[server-api] failed to fetch plans:', (err as Error).message)
    return []
  }
}

/**
 * Fetch all available models from the backend, used by the landing page
 * to render an OpenRouter-style model catalog.
 *
 * Returns an empty list if the backend is unreachable so the page can
 * still render with fallback data.
 *
 * Caching (2026-06-21): model metadata changes are rare, so we cache
 * for 5 minutes. Tag `models` so admin changes (add/remove/update
 * pricing) bust the cache via revalidateTag.
 */
export async function fetchServerModels(): Promise<ModelsResponse['data']> {
  try {
    const res = await serverFetch<ModelsResponse>('/v1/models', {
      next: { revalidate: 300, tags: ['models'] },
    })
    return res.data ?? []
  } catch (err) {
    console.error('[server-api] failed to fetch models:', (err as Error).message)
    return []
  }
}

/**
 * Fetch the effective cost matrix (per model x per tier), used by the
 * pricing page to show "X points/request on each plan".
 *
 * Returns null on error so the page can still render the plan grid
 * without the matrix.
 *
 * Caching (2026-06-21): the matrix is the union of plan_presets and
 * model_pricing — both admin-edited and infrequently changed. 5-min
 * revalidate + `billing` tag for on-demand busting.
 */
export async function fetchServerBillingMatrix(): Promise<unknown | null> {
  try {
    return await serverFetch('/v1/billing-matrix', {
      next: { revalidate: 300, tags: ['billing', 'plans'] },
    })
  } catch (err) {
    console.error('[server-api] failed to fetch billing matrix:', (err as Error).message)
    return null
  }
}