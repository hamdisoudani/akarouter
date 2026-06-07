import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fleouqrgltkodumrgxlt.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsZW91cXJnbHRrb2R1bXJneGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQ4MTMsImV4cCI6MjA5NjMxMDgxM30.KTL_9jMVbygM8A7bepgdAv37pZZctZ4F-cGAUBm4Jgw'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths — no auth needed
  const publicPaths = ['/', '/auth/login', '/auth/callback', '/api']
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Create a Supabase server client that can read/write cookies
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) =>
          request.cookies.set(name, value)
        )
        // Apply cache headers to prevent CDN leaking sessions
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value)
        })
        supabaseResponse = NextResponse.next({
          request,
        })
      },
    },
  })

  // IMPORTANT: Use getUser() — it validates the JWT against Supabase's
  // published public keys every time. DO NOT use getSession() here.
  const { data: { user } } = await supabase.auth.getUser()

  // Protected paths require auth
  const protectedPaths = ['/dashboard', '/admin']
  if (protectedPaths.some(p => pathname.startsWith(p))) {
    if (!user) {
      const loginUrl = new URL('/auth/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
