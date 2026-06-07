'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleCallback = async () => {
      // Supabase OAuth redirects back with hash fragments
      // The Supabase client automatically handles the hash
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        console.error('Auth callback error:', error)
        router.replace('/auth/login?error=' + encodeURIComponent(error.message))
        return
      }

      if (session) {
        const next = searchParams.get('next') || '/dashboard'
        router.replace(next)
        return
      }

      // Wait a moment for hash to be processed
      setTimeout(async () => {
        const { data: { session: s2 } } = await supabase.auth.getSession()
        if (s2) {
          const next = searchParams.get('next') || '/dashboard'
          router.replace(next)
        } else {
          router.replace('/auth/login')
        }
      }, 1000)
    }

    handleCallback()
  }, [router, searchParams])

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-400">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p>Completing sign in...</p>
      </div>
    </div>
  )
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p>Completing sign in...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
