import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { env } from '@/lib/env'

/**
 * Server-side Supabase client factory (for use in Route Handlers, Server
 * Components, and Server Actions).
 *
 * SECURITY: this module is server-only. The `import 'server-only'` directive
 * makes any accidental import from a client component fail at build time
 * with a clear error instead of leaking the Supabase anon key path into
 * the client bundle.
 *
 * Each call creates a fresh client because the cookie store is request-
 * scoped in Next.js — the request's cookies are bound to the response
 * lifecycle. Caching the client across requests would leak session data.
 *
 * The `setAll` cookie adapter writes refreshed cookies back into the
 * response so Supabase's token-refresh logic works through the same
 * request/response cycle. Omitting this (the `@supabase/ssr` 0.5+ default)
 * causes "Auth session missing" warnings and breaks PKCE flow.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // `setAll` from Server Components is a no-op when called from a
            // page that is being statically rendered. Safe to ignore.
            // (Documented behavior in @supabase/ssr 0.5.)
          }
        },
      },
    },
  )
}