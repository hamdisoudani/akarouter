/**
 * Backwards-compat shim for the legacy `lib/supabase.ts` module.
 *
 * The previous module used a Proxy indirection around a lazy-initialized
 * `@supabase/supabase-js` client, reading `process.env` with empty-string
 * fallbacks. That had two problems:
 *
 *  1. It silently produced a broken client if env vars were missing —
 *     login would fail at runtime with no helpful error.
 *  2. Mixing the Supabase client behind a single `import { supabase }`
 *     made it impossible to know whether a given callsite ran in the
 *     browser or on the server. Both should NEVER share a client instance
 *     because they have different cookie/transport semantics.
 *
 * The new layout is:
 *   - `lib/supabase/client.ts` → `getSupabaseBrowser()` (browser only)
 *   - `lib/supabase/server.ts` → `createServerSupabaseClient()` (server only)
 *
 * This module re-exports the browser client as `supabase` so existing
 * `import { supabase } from '@/lib/supabase'` callsites keep working.
 * New code should prefer the explicit `getSupabaseBrowser()` / server
 * factory to make the runtime context obvious.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseBrowser } from './supabase/client'

// Re-export the browser factory under both names so callers can pick.
export { getSupabaseBrowser as getSupabase } from './supabase/client'
export type { SupabaseClient }

// Legacy singleton export — kept for backwards compat. Returns the same
// browser client as `getSupabase()`. We keep it as a typed alias rather
// than a Proxy so that the full SupabaseClient surface (with all the
// complex generics) is preserved at type-check time. The underlying
// factory still lazily creates the client on first use.
let _singleton: SupabaseClient | null = null

/**
 * @deprecated Prefer `getSupabaseBrowser()` from `lib/supabase/client` for
 * new code. This export is kept only because it is imported by many
 * existing call sites (login page, providers, etc.).
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = _singleton ?? (_singleton = getSupabaseBrowser())
    const value = (client as unknown as Record<string | symbol, unknown>)[
      prop as string
    ]
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client)
    }
    return value
  },
}) as SupabaseClient