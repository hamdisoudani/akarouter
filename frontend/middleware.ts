import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths — no auth needed
  const publicPaths = ['/', '/auth/login', '/auth/callback', '/api']
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Check for Supabase auth cookie
  // Supabase stores session in cookies named sb-<ref>-auth-token
  const hasAuthCookie = request.cookies.getAll().some(c => c.name.includes('auth-token'))

  // Protected paths require auth
  const protectedPaths = ['/dashboard', '/admin', '/keys']
  if (protectedPaths.some(p => pathname.startsWith(p))) {
    if (!hasAuthCookie) {
      const loginUrl = new URL('/auth/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
