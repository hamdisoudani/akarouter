import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // For now, skip auth middleware — Supabase auth is optional
  // Admin dashboard reads accounts table directly (anon key has RLS)
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:jpg|jpeg|gif|png|svg|ico|webp)).*)'],
}
