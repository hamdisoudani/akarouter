import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getUsage } from '@/lib/api'

/**
 * GET /api/usage — returns the current user's token usage statistics.
 *
 * SECURITY: same auth pattern as /api/me. The previous implementation
 * used the broken `c.name.includes('auth-token')` cookie-name match,
 * which would let any attacker with a sufficiently-named cookie impersonate
 * a user. Now uses validated Supabase getUser() + getSession().
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

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const usageData = await getUsage(accessToken)
    return NextResponse.json(usageData)
  } catch (error) {
    console.error('[api/usage] failed:', (error as Error).message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'