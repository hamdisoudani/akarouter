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
 *
 * REDIRECT URL RESOLUTION:
 *   The `origin` of an incoming request can be a Docker container
 *   hostname (e.g. http://830635b86b84:8080) when the route handler is
 *   reached through a Docker network instead of the public hostname.
 *   Using that as the redirect target would send the user's browser to
 *   an internal address they can't reach. We therefore prefer
 *   `NEXT_PUBLIC_SITE_URL` if set, and fall back to the request origin
 *   only if the env var is absent. The fallback is bounded by the
 *   request's own host header so we never redirect to an arbitrary
 *   third-party URL.
 */
function resolveSiteOrigin(request: NextRequest): string {
  // 1. Configured site URL wins (preferred in production).
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) {
    // Strip trailing slash, reject anything that isn't http(s).
    const cleaned = configured.replace(/\/+$/, '')
    if (/^https?:\/\//i.test(cleaned)) return cleaned
  }
  // 2. Fall back to the request's origin. This is the host the browser
  //    actually saw, so it must be reachable. (In dev, that's localhost;
  //    in prod behind a reverse proxy, Railway/Cloudflare will set the
  //    Host header to the public hostname.)
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  // `next` is the path the user was trying to reach before being bounced
  // to login. Falls back to /dashboard.
  const nextParam = searchParams.get('next')
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'
  const siteOrigin = resolveSiteOrigin(request)

  if (!code) {
    return NextResponse.redirect(`${siteOrigin}/auth/login?error=auth_missing_code`)
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      // SECURITY: don't echo `error.message` into the redirect URL — it
      // can contain hints about the OAuth config that are useful to
      // attackers probing the auth endpoint.
      console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
      return NextResponse.redirect(`${siteOrigin}/auth/login?error=auth_failed`)
    }

    // Session is now set in cookies (via the createServerSupabaseClient
    // setAll adapter). Redirect to the intended destination.
    return NextResponse.redirect(`${siteOrigin}${safeNext}`)
  } catch (err) {
    console.error('[auth/callback] unexpected error:', (err as Error).message)
    return NextResponse.redirect(`${siteOrigin}/auth/login?error=auth_failed`)
  }
}

// Always re-evaluate; this route's response is a redirect and must not be cached.
export const dynamic = 'force-dynamic'
