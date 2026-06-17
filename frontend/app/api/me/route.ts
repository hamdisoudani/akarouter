import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getMe } from '@/lib/api'

/**
 * GET /api/me — returns the current user's profile.
 *
 * SECURITY: the previous implementation read the Supabase session cookie
 * by name match (`c.name.includes('auth-token')`) and JSON.parsed the value
 * to extract an `access_token` — without any signature verification.
 * Any cookie whose name contained the substring 'auth-token' was treated
 * as a valid session, and any client could mint a token via JSON parse
 * of their own cookie. This is fake auth.
 *
 * The new implementation:
 *  1. Uses `@supabase/ssr` `createServerClient` to read cookies via the
 *     request context.
 *  2. Calls `supabase.auth.getUser()` which validates the JWT signature
 *     against Supabase's published JWKS, checks `exp`/`nbf`, and rejects
 *     revoked sessions.
 *  3. Returns 401 if any step fails.
 *  4. Extracts the access_token from the validated session (never from
 *     untrusted cookie JSON).
 *  5. Forwards the token to the backend's `getMe(token)` which is the
 *     server-to-server call.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Use the validated session's access_token, not anything from cookies
    // directly. The JWT was just verified server-side by getUser().
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userData = await getMe(accessToken)
    return NextResponse.json(userData)
  } catch (error) {
    // SECURITY: never echo `error.message` back to the client — the
    // Supabase SDK error messages can include the JWT contents and other
    // internal details.
    console.error('[api/me] failed:', (error as Error).message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// Avoid caching this route — every request must re-validate the session.
export const dynamic = 'force-dynamic'