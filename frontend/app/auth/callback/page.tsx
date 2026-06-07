'use client'

import { useEffect, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const result = await supabase.auth.getSession()
        const session = result?.data?.session ?? null
        let token = session?.access_token ?? null
        let refreshToken = session?.refresh_token ?? null

        if (!token) {
          const hash = window.location.hash || window.location.search || ''
          const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
          token = params.get('access_token')
          refreshToken = refreshToken || params.get('refresh_token')
        }

        if (!token) {
          router.replace('/auth/login?error=auth_failed')
          return
        }

        await supabase.auth.setSession({ access_token: token, refresh_token: refreshToken ?? '' })
        router.replace('/dashboard')
      } catch (error) {
        router.replace('/auth/login?error=auth_error')
      }
    }
    handleCallback()
  }, [router])

  return (
    <div className="relative min-h-screen bg-[#030303] flex items-center justify-center overflow-hidden">
      {/* Background Gradient */}
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
