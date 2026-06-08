import { NextRequest, NextResponse } from 'next/server'
import { getMe } from '@/lib/api'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

    if (!token) {
      // Fallback to checking Supabase session cookie
      const authCookie = request.cookies.getAll().find(c => c.name.includes('auth-token'))
      if (authCookie) {
        const decoded = decodeURIComponent(authCookie.value)
        const parsed = JSON.parse(decoded)
        token = Array.isArray(parsed) ? parsed[0] : (parsed?.access_token || null)
      }
    }

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userData = await getMe(token)
    return NextResponse.json(userData)
  } catch (error: any) {
    console.error('Error in GET /api/me:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
