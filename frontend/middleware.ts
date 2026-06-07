import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://fleouqrgltkodumrgxlt.supabase.co'

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''

const PUBLIC_PATHS = ['/', '/auth/login', '/auth/callback', '/auth/error', '/_next', '/favicon.ico']
const PROTECTED_PREFIXES = ['/dashboard', '/admin', '/api/user']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/'
  ) {
    return NextResponse.next()
  }

  // Build Supabase client for middleware
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value
      },
      set(name: string, value: string, options: any) {
        const response = NextResponse.next()
        response.cookies.set(name, value, options)
        return response
      },
      remove(name: string, options: any) {
        const response = NextResponse.next()
        response.cookies.set(name, '', { ...options, maxAge: 0 })
        return response
      },
    },
  })

  // For protected routes, verify JWT with getUser() (validates signature)
  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))

  if (isProtected) {
    const { data } = await supabase.auth.getUser()

    if (!data.user) {
      const url = new URL('/auth/login', request.url)
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }

    // Cache busting headers to prevent CDN caching user-specific pages
    const response = NextResponse.next({
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'CDN-Cache-Control': 'no-store',
        'Vary': 'Authorization, Cookie',
      },
    })
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/.*|favicon\\.ico).*)'],
}
