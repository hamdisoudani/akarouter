'use client'

import { useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

function CallbackContent() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleCallback = async () => {
      // The @supabase/ssr browser client automatically detects the
      // hash fragment (#access_token=...&refresh_token=...) from the
      // OAuth redirect and exchanges it for a session stored in cookies.
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        console.error('OAuth callback error:', error)
        router.replace('/auth/login?error=oauth_failed')
        return
      }

      if (session?.access_token) {
        router.replace('/dashboard')
        return
      }

      // No session — redirect to login
      router.replace('/auth/login?error=no_session')
    }

    handleCallback()
  }, [router])

  return (
    <div className="relative min-h-screen bg-[#030303] flex items-center justify-center overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="text-center z-10 glass-panel px-10 py-8 rounded-3xl glow-indigo animate-fade-in">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-4" />
        <h3 className="text-lg font-medium text-zinc-100">Completing authentication</h3>
        <p className="text-zinc-500 text-xs mt-1">Please wait while we set up your session…</p>
      </div>
    </div>
  )
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="relative min-h-screen bg-[#030303] flex items-center justify-center overflow-hidden">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
