import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { env } from '@/lib/env'

/**
 * Edge proxy for route protection.
 *
 * Note: in Next.js 16 the `middleware.ts` convention has been renamed to
 * `proxy.ts`. The runtime behavior, the `NextRequest`/`NextResponse` API,
 * and the `config.matcher` pattern are identical — only the file name and
 * the exported function name changed. See:
 *   https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 *   https://nextjs.org/docs/messages/middleware-to-proxy
 *
 * SECURITY: the previous middleware used a cookie-name match
 * (`c.name.includes('auth-token')`) to decide if the user was authenticated.
 * This is fake auth: any cookie whose name contains the substring
 * 'auth-token' (e.g. an attacker setting a cookie via subdomain XSS, or a
 * leftover cookie from a previous session) would pass the check. There was
 * no JWT signature verification, no expiry check, and no role check on the
 * edge.
 *
 * This proxy uses @supabase/ssr's getUser() which:
 *  1. Verifies the JWT signature against Supabase's published JWKS.
 *  2. Checks exp / nbf claims.
 *  3. Rejects revoked sessions.
 *
 * If getUser() throws or returns null, we redirect to /auth/login with the
 * intended destination in the `next` query parameter so the user can be
 * bounced back after sign-in.
 */

// Pages that require an authenticated Supabase session
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/admin',
  '/keys',
  '/usage',
  '/upgrade',
  '/agents',
  '/account',
]

// Public paths that never require auth
const PUBLIC_PREFIXES = [
  '/',
  '/auth/login',
  '/auth/callback',
  '/auth/signup',
  '/auth/logout',
  '/api/health',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/privacy',
  '/terms',
  '/cookies',
  '/docs',
  '/logo.png',
]

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip public paths and static assets
  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  // Only protect the protected prefixes; everything else is allowed at the
  // edge and protected at the page level by the page's own auth check.
  if (!isProtected(pathname)) {
    return NextResponse.next()
  }

  // Build a response object we can attach refreshed cookies to
  const response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // SECURITY: getUser() validates the JWT signature and expiry server-side.
  // We do NOT trust getSession() (which is client-only and can be spoofed).
  // If the call throws or returns no user, redirect to /auth/login.
  let user = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (!error) {
      user = data?.user ?? null
    }
  } catch {
    user = null
  }

  if (!user) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // SECURITY: for /admin paths, additionally require the user have a
  // non-'user' role. This check uses the JWT claims (which Supabase signs),
  // not a cookie-name match.
  if (pathname.startsWith('/admin')) {
    const role =
      (user.app_metadata?.role as string | undefined) ||
      (user.user_metadata?.role as string | undefined) ||
      'user'
    if (role !== 'admin') {
      // Don't leak that the path exists — redirect to dashboard with 302.
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  // Run on all paths except Next internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}