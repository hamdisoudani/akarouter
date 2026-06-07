'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Exchange the hash-fragment token for a session cookie
        const { data, error } = await supabase.auth.getSession()

        if (error || !data.session) {
          setError('Session not established. Please try again.')
          setTimeout(() => router.replace('/auth/login'), 3000)
          return
        }

        // Success — redirect to dashboard
        router.replace('/dashboard')
      } catch (e) {
        console.error('Callback error:', e)
        setError('Authentication error. Please try again.')
        setTimeout(() => router.replace('/auth/login'), 3000)
      }
    }

    handleCallback()
  }, [supabase, router])

  if (error) {
    return (
      <div className="relative min-h-screen bg-[#030303] flex items-center justify-center">
        <div className="glass-panel p-8 rounded-3xl text-center">
          <h2 className="text-xl font-semibold text-red-400">Authentication Failed</h2>
          <p className="text-zinc-400 mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#030303] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto" />
        <p className="text-zinc-400 mt-4">Signing you in...</p>
      </div>
    </div>
  )
}
