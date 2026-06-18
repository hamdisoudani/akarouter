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
 *
 * SECURITY: a per-request CSP nonce is generated here and embedded into
 * the `script-src` directive of the response's CSP header. This is what
 * allows us to drop `'unsafe-inline'` from script-src — inline scripts
 * are only allowed when they carry this nonce. The nonce is also
 * propagated via the `x-nonce` request header so server components can
 * read it via `headers().get('x-nonce')` if they need to set
 * `nonce="..."` on inline `<script>` tags.
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

/**
 * Generate a cryptographically random 16-byte nonce, base64url-encoded.
 *
 * `crypto.getRandomValues` is the Web Crypto API, available in the
 * edge runtime. We deliberately use a CSPRNG — a predictable nonce
 * would let an attacker pre-compute allowed inline scripts.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // base64url to keep CSP clean (no `+`/`/`/`=` characters that
  // would require quoting in the header value).
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Build the per-request Content-Security-Policy for HTML pages.
 *
 * `nonce` enables our own inline scripts (Next.js hydration scripts,
 * future inline user content). We deliberately omit 'unsafe-inline'
 * so a leaked nonce is the only way to run attacker-injected
 * script. The nonce is per-request and short-lived.
 *
 * `supabaseHost` is the specific Supabase project host (e.g.,
 * "abcdefgh.supabase.co") pinned at build time from
 * NEXT_PUBLIC_SUPABASE_URL. NO `*.supabase.co` wildcard.
 */
function buildAppCSP(nonce: string, supabaseHost: string): string {
  return [
    "default-src 'self'",
    // `sha256-zjP2BXYgSCCnXNMXI2IL1yRydoQdsGR/uCCr6kyKsD0=` is the hash of
    // Next.js's framework hydration script that gets inlined into the
    // document head. The nonce should reach it via the request-header CSP,
    // but some Next.js 16 build configurations still emit it without a
    // nonce — the hash is a safe fallback that allows exactly that script
    // and nothing else (an attacker would need to serve identical bytes).
    `script-src 'self' 'nonce-${nonce}' 'sha256-zjP2BXYgSCCnXNMXI2IL1yRydoQdsGR/uCCr6kyKsD0=' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/`,
    // 'unsafe-inline' for styles is required by Next.js's runtime
    // style injection in App Router. A future Tailwind v4 upgrade
    // will let us drop it.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://www.google.com/recaptcha/`,
    "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com https://accounts.google.com",
    "frame-ancestors 'none'",
    "form-action 'self' https://accounts.google.com",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}

/**
 * Extract the host (e.g. "abcdefgh.supabase.co") from a Supabase
 * project URL. Falls back to a safe placeholder if the env var is
 * unset (which lib/env.ts already prevents).
 */
function supabaseHostFromUrl(url: string | undefined): string {
  if (!url) return 'invalid.supabase.co'
  try {
    return new URL(url).host
  } catch {
    return 'invalid.supabase.co'
  }
}

/**
 * Paths that get the app HTML CSP (vs. API JSON CSP or static asset
 * passthrough). Static assets (_next/static, /favicon.ico, etc.) get
 * no CSP from this proxy — they're served with long-lived immutable
 * headers from the edge cache.
 */
function isHtmlResponse(pathname: string): boolean {
  if (pathname.startsWith('/_next/')) return false
  if (pathname.startsWith('/api/')) return false
  if (pathname === '/favicon.ico' || pathname === '/robots.txt' || pathname === '/sitemap.xml') return false
  return true
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Generate a per-request nonce and propagate it to the render.
  //
  // Next.js extracts the nonce by parsing the Content-Security-Policy
  // present on the *request* headers during server rendering, then
  // stamps it onto its own framework/React inline <script> tags. So we
  // must set the CSP on BOTH the request headers (so Next can read it)
  // and the response headers (so the browser enforces it). We also
  // expose x-nonce for server components that render their own inline
  // scripts.
  const nonce = generateNonce()
  const supabaseHost = supabaseHostFromUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  const csp = isHtmlResponse(pathname) ? buildAppCSP(nonce, supabaseHost) : null

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  if (csp) {
    requestHeaders.set('Content-Security-Policy', csp)
  }

  // For the public auth route, build a response we can attach CSP +
  // headers to.
  const buildResponse = (status = 200) => {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
      status,
    })
    if (csp) {
      response.headers.set('Content-Security-Policy', csp)
    }
    return response
  }

  // Skip public paths and static assets
  if (isPublic(pathname)) {
    return buildResponse()
  }

  // Only protect the protected prefixes; everything else is allowed at the
  // edge and protected at the page level by the page's own auth check.
  if (!isProtected(pathname)) {
    return buildResponse()
  }

  // Build a response object we can attach refreshed cookies to
  const response = buildResponse()

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
