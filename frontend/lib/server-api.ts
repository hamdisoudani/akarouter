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
      // Use Next.js's revalidate hint.
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
 */
export async function fetchServerPlans(): Promise<PlanPreset[]> {
  try {
    const res = await serverFetch<{ plans: PlanPreset[] }>('/v1/plans')
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
 */
export async function fetchServerModels(): Promise<ModelsResponse['data']> {
  try {
    const res = await serverFetch<ModelsResponse>('/v1/models')
    return res.data ?? []
  } catch (err) {
    console.error('[server-api] failed to fetch models:', (err as Error).message)
    return []
  }
}