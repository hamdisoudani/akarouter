'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, usePathname } from 'next/navigation'
import { getMe, getUsage, type UserInfo, type UsageStats } from '@/lib/api'

interface AppContextType {
  user: UserInfo | null
  token: string
  usage: UsageStats | null
  loading: boolean
  error: string
  refetchUser: () => Promise<void>
  refetchUsage: () => Promise<void>
  refetchAll: () => Promise<void>
  signOut: () => Promise<void>
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [token, setToken] = useState<string>('')
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Keep track of the token we are currently fetching or have successfully fetched for
  const lastFetchedTokenRef = useRef<string>('')

  const fetchUserData = useCallback(async (accessToken: string) => {
    // Deduplicate calls: if we are already fetching or have fetched for this token, skip.
    if (!accessToken || lastFetchedTokenRef.current === accessToken) {
      return
    }
    lastFetchedTokenRef.current = accessToken

    try {
      setError('')
      const me = await getMe(accessToken)
      setUser(me)

      if (me.status !== 'pending') {
        const usageData = await getUsage(accessToken)
        setUsage(usageData)
      } else {
        setUsage(null)
      }
    } catch (err: any) {
      console.error('Failed to fetch user/usage data:', err)
      setError(err.message || 'Failed to load user session')
      // Reset ref on failure to allow retry if needed
      lastFetchedTokenRef.current = ''
    }
  }, [])

  const refetchUser = useCallback(async () => {
    if (!token) return
    try {
      const me = await getMe(token)
      setUser(me)
    } catch (err: any) {
      console.error('Failed to refetch user:', err)
    }
  }, [token])

  const refetchUsage = useCallback(async () => {
    if (!token) return
    try {
      const usageData = await getUsage(token)
      setUsage(usageData)
    } catch (err: any) {
      console.error('Failed to refetch usage:', err)
    }
  }, [token])

  const refetchAll = useCallback(async () => {
    if (!token) return
    // Reset cached token ref to force a refetch
    lastFetchedTokenRef.current = ''
    await fetchUserData(token)
  }, [token, fetchUserData])

  const signOut = useCallback(async () => {
    lastFetchedTokenRef.current = ''
    setUser(null)
    setToken('')
    setUsage(null)
    await supabase.auth.signOut()
    router.push('/auth/login')
  }, [router])

  useEffect(() => {
    let active = true

    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!active) return

        if (session) {
          setToken(session.access_token)
          await fetchUserData(session.access_token)
        } else {
          setToken('')
          setUser(null)
          setUsage(null)
          lastFetchedTokenRef.current = ''
          // Public pages: anyone can browse (marketing site).
          // /models and /models/[id] MUST be public so prospects can see specs/pricing
          // before signing up. Locked pages are gated inside their own client component
          // by calling requireAuth() — see e.g. /keys, /dashboard, /usage, /agents, /upgrade.
          const publicPaths = [
            '/',
            '/auth/login',
            '/auth/callback',
            '/models',
            '/privacy',
            '/terms',
            '/cookies',
            '/docs',
          ]
          const isPublic =
            publicPaths.includes(pathname) ||
            pathname.startsWith('/models/') ||
            pathname.startsWith('/docs/') ||
            pathname.startsWith('/privacy') ||
            pathname.startsWith('/terms') ||
            pathname.startsWith('/cookies') ||
            pathname.startsWith('/auth/')
          if (!isPublic) {
            router.push(`/auth/login?next=${encodeURIComponent(pathname)}`)
          }
        }
      } catch (err: any) {
        console.error('Session initialization error:', err)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    initSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return

      if (session) {
        setToken(session.access_token)
        await fetchUserData(session.access_token)
      } else {
        setToken('')
        setUser(null)
        setUsage(null)
        lastFetchedTokenRef.current = ''
        // Public pages: anyone can browse (marketing site).
        // /models and /models/[id] MUST be public so prospects can see specs/pricing
        // before signing up. Locked pages are gated inside their own client component
        // by calling requireAuth() — see e.g. /keys, /dashboard, /usage, /agents, /upgrade.
        const publicPaths = [
          '/',
          '/auth/login',
          '/auth/callback',
          '/models',
          '/privacy',
          '/terms',
          '/cookies',
          '/docs',
        ]
        const isPublic =
          publicPaths.includes(pathname) ||
          pathname.startsWith('/models/') ||
          pathname.startsWith('/docs/') ||
          pathname.startsWith('/privacy') ||
          pathname.startsWith('/terms') ||
          pathname.startsWith('/cookies') ||
          pathname.startsWith('/auth/')
        if (!isPublic) {
          router.push(`/auth/login?next=${encodeURIComponent(pathname)}`)
        }
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [fetchUserData, pathname, router])

  // Redirect free tier users to /upgrade so they must subscribe before using the system
  useEffect(() => {
    if (!loading && token && user && user.status !== 'pending') {
      if (usage && usage.tier === 'free' && pathname !== '/upgrade') {
        // Public pages (mirror list above) are exempt from the free-tier upgrade nudge.
        const publicPaths = [
          '/',
          '/auth/login',
          '/auth/callback',
          '/models',
          '/privacy',
          '/terms',
          '/cookies',
          '/docs',
          '/upgrade',
        ]
        const isPublic =
          publicPaths.includes(pathname) ||
          pathname.startsWith('/models/') ||
          pathname.startsWith('/docs/') ||
          pathname.startsWith('/privacy') ||
          pathname.startsWith('/terms') ||
          pathname.startsWith('/cookies') ||
          pathname.startsWith('/auth/')
        if (!isPublic) {
          router.push('/upgrade')
        }
      }
    }
  }, [loading, token, user, usage, pathname, router])

  return (
    <AppContext.Provider value={{ user, token, usage, loading, error, refetchUser, refetchUsage, refetchAll, signOut }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
