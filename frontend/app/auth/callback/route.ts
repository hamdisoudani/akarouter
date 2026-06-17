import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * GET /auth/callback — PKCE OAuth code exchange.
 *
 * SECURITY: the previous /auth/callback/page.tsx used the *implicit* flow,
 * parsing the access_token directly out of the URL fragment. Implicit flow
 * is deprecated by OAuth 2.1 because:
 *  1. Access tokens are exposed in browser history, server logs, and
 *     Referer headers to third-party sites.
 *  2. There is no per-request cryptographic binding — anyone who obtains
 *     the URL can use the token.
 *  3. Refresh tokens cannot be rotated safely with implicit flow.
 *
 * The PKCE flow (RFC 7636) used here:
 *  1. Client requests /authorize with a `code_challenge` derived from a
 *     random `code_verifier`.
 *  2. Supabase redirects back here with `?code=...`.
 *  3. We POST `code` + `code_verifier` to Supabase, which returns the
 *     access_token + refresh_token. The verifier is read from local
 *     storage that the browser client wrote earlier.
 *  4. Tokens are stored as HTTP-only, Secure, SameSite=Lax cookies.
 *
 * This route handler runs server-side, can read/write cookies through
 * next/headers, and can call `exchangeCodeForSession()` on the server.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // `next` is the path the user was trying to reach before being bounced
  // to login. Falls back to /dashboard.
  const nextParam = searchParams.get('next')
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_missing_code`)
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      // SECURITY: don't echo `error.message` into the redirect URL — it
      // can contain hints about the OAuth config that are useful to
      // attackers probing the auth endpoint.
      console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
      return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
    }

    // Session is now set in cookies (via the createServerSupabaseClient
    // setAll adapter). Redirect to the intended destination.
    return NextResponse.redirect(`${origin}${safeNext}`)
  } catch (err) {
    console.error('[auth/callback] unexpected error:', (err as Error).message)
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }
}

// Always re-evaluate; this route's response is a redirect and must not be cached.
export const dynamic = 'force-dynamic'