'use server'

import { cookies } from 'next/headers'
import { getMe, getUsage } from '@/lib/api'

export async function getServerToken(): Promise<string | null> {
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()
  const authCookie = allCookies.find(c => c.name.includes('auth-token'))
  if (!authCookie) return null

  try {
    const decoded = decodeURIComponent(authCookie.value)
    
    // Parse JSON
    const parsed = JSON.parse(decoded)
    if (Array.isArray(parsed)) {
      return parsed[0] || null
    }
    if (parsed && typeof parsed === 'object') {
      return parsed.access_token || null
    }
  } catch (e) {
    console.error('Failed to parse auth cookie:', e)
  }
  
  return null
}

export async function getMeAction() {
  const token = await getServerToken()
  if (!token) {
    throw new Error('Not authenticated')
  }
  return getMe(token)
}

export async function getUsageAction() {
  const token = await getServerToken()
  if (!token) {
    throw new Error('Not authenticated')
  }
  return getUsage(token)
}
