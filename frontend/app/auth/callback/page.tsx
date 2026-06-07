'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleCallback = async () => {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) {
        router.replace('/auth/login?error=' + encodeURIComponent(error.message))
        return
      }
      if (session) {
        router.replace(searchParams.get('next') || '/dashboard')
        return
      }
      // Wait for hash processing
      setTimeout(async () => {
        const { data: { session: s2 } } = await supabase.auth.getSession()
        router.replace(s2 ? (searchParams.get('next') || '/dashboard') : '/auth/login')
      }, 1500)
    }
    handleCallback()
  }, [router, searchParams])

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-zinc-400 text-sm">Completing sign in…</p>
      </div>
    </div>
  )
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
