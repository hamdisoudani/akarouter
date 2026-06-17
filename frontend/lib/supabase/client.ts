'use client'

import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'

/**
 * Browser-side Supabase client for use in Client Components.
 *
 * Uses the browser-specific `createBrowserClient` from @supabase/ssr which
 * reads/writes cookies from `document.cookie` automatically.
 *
 * SECURITY: this is the ONLY Supabase client that should ever be imported
 * from a `'use client'` module. The previous `lib/supabase.ts` used
 * `@supabase/supabase-js` directly with a process.env fallback to empty
 * strings, which silently created a misconfigured client that could not
 * validate sessions server-side.
 *
 * The lazy singleton pattern keeps the client cold until first use, which
 * is what the previous implementation was trying to do (with a Proxy
 * indirection that also worked but was harder to reason about).
 */

let _client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowser() {
  if (!_client) {
    _client = createBrowserClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    )
  }
  return _client
}