'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { getMe } from '@/lib/api'

interface ProviderAccount {
  id: string
  account_label: string | null
  health_status: string
  weight: number
  total_requests: number
  total_errors: number
  in_flight: number
  max_concurrent: number
  last_used_at: string | null
  last_error_at: string | null
  last_error_msg: string | null
  created_at: string | null
  updated_at: string | null
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    healthy: 'bg-green-500/20 text-green-400',
    refreshing: 'bg-blue-500/20 text-blue-400',
    degraded: 'bg-yellow-500/20 text-yellow-400',
    dead: 'bg-red-500/20 text-red-400',
    pending: 'bg-gray-500/20 text-gray-400',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  )
}

export default function AdminDashboard() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [providers, setProviders] = useState<ProviderAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [addingAccount, setAddingAccount] = useState(false)
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{
    flow_id: string
    verification_uri: string
    verification_uri_complete: string
    user_code: string
    expires_in: number
  } | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('')
  const [pollResult, setPollResult] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [error, setError] = useState<string>('')
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${token}`
  }), [token])

  // Auth check + role guard
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/auth/login')
        return
      }
      setToken(session.access_token)
      try {
        const me = await getMe(session.access_token)
        if (me.role !== 'admin') {
          router.push('/dashboard')
          return
        }
        setIsAdmin(true)
      } catch {
        // Fallback: try service role key for admin access
        const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY
        if (adminKey) {
          setToken(adminKey)
          setIsAdmin(true)
        } else {
          router.push('/dashboard')
          return
        }
      }
      setAuthChecked(true)
    })
  }, [router])

  const loadProviders = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/admin/providers`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setProviders(data.providers || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [API_URL, token, authHeaders])

  const loadStats = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/admin/stats`, { headers: authHeaders() })
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
  }, [API_URL, token, authHeaders])

  useEffect(() => {
    if (!authChecked || !isAdmin) return
    loadProviders()
    loadStats()

    const channel = supabase
      .channel('admin-providers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'providers' },
        (payload: any) => {
          setProviders((prev) => {
            const next = [...prev]
            const idx = next.findIndex((a) => a.id === (payload.new?.id || payload.old?.id))
            if (payload.eventType === 'INSERT' && payload.new) {
              if (idx === -1) next.push(payload.new as ProviderAccount)
            } else if (payload.eventType === 'UPDATE' && payload.new) {
              if (idx >= 0) next[idx] = payload.new as ProviderAccount
            } else if (payload.eventType === 'DELETE' && payload.old) {
              if (idx >= 0) next.splice(idx, 1)
            }
            return next
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [authChecked, isAdmin, loadProviders, loadStats])

  useEffect(() => {
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current) }
  }, [])

  const startStatusPolling = useCallback((flowId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/admin/providers/oauth/status/${flowId}`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        setPollStatus(data.status)
        setPollResult(data.result || null)
        if (data.status === 'authorized') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
          setDeviceCodeInfo(null)
          loadProviders()
          loadStats()
        } else if (data.status === 'failed' || data.status === 'timeout') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
          setError(data.error || `OAuth flow ${data.status}`)
        }
      } catch { /* ignore */ }
    }
    pollIntervalRef.current = setInterval(checkStatus, 5000)
    checkStatus()
  }, [API_URL, authHeaders, loadProviders, loadStats])

  const handleAddAccount = async () => {
    setAddingAccount(true)
    setPollStatus('')
    setPollResult(null)
    setError('')
    try {
      const label = `hermes-${Date.now().toString(36)}`
      const res = await fetch(`${API_URL}/admin/providers/oauth/initiate?account_label=${label}`, {
        method: 'POST', headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`Initiate failed: ${res.status}`)
      const data = await res.json()
      setDeviceCodeInfo({
        flow_id: data.flow_id,
        verification_uri: data.verification_uri,
        verification_uri_complete: data.verification_uri_complete || '',
        user_code: data.user_code,
        expires_in: data.expires_in,
      })
      setPollStatus('pending')

      const pollRes = await fetch(`${API_URL}/admin/providers/oauth/poll/${data.flow_id}`, {
        method: 'POST', headers: authHeaders(),
      })
      if (pollRes.ok) {
        setPollStatus('polling')
        startStatusPolling(data.flow_id)
      }
    } catch (err: any) {
      setError(`Error: ${err.message}`)
    } finally {
      setAddingAccount(false)
    }
  }

  const handleRefresh = async (providerId: string) => {
    try {
      await fetch(`${API_URL}/admin/providers/${providerId}/refresh`, {
        method: 'POST', headers: authHeaders(),
      })
      loadProviders()
    } catch { /* ignore */ }
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-400">Checking access...</div>
  }

  if (!isAdmin) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-red-400">Access denied. Admin only.</div>
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">
            <span className="bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">AKAROUTER</span>
            <span className="ml-2 text-sm text-gray-500 font-normal">Admin</span>
          </h1>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-300">Dashboard</a>
            <a href="/admin/providers" className="text-sm text-purple-400 hover:text-purple-300">Providers</a>
            <a href="/admin/oauth" className="text-sm text-purple-400 hover:text-purple-300">OAuth</a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-500 hover:text-red-400">×</button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase">Providers</p>
              <p className="text-2xl font-bold mt-1">{stats.providers?.total || 0}</p>
              <p className="text-xs text-green-400">{stats.providers?.active || 0} active</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase">Total Requests</p>
              <p className="text-2xl font-bold mt-1">{stats.providers?.total_requests || 0}</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase">Total Errors</p>
              <p className="text-2xl font-bold mt-1">{stats.providers?.total_errors || 0}</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase">User Accounts</p>
              <p className="text-2xl font-bold mt-1">{stats.accounts?.total || 0}</p>
              <p className="text-xs text-green-400">{stats.accounts?.active || 0} active</p>
            </div>
          </div>
        )}

        {/* Connected Accounts */}
        <section className="rounded-xl border border-gray-800 bg-gray-800/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Connected Hermes Accounts</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Realtime
              </span>
              <button
                onClick={handleAddAccount}
                disabled={addingAccount}
                className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {addingAccount ? 'Starting...' : '+ Add Account'}
              </button>
            </div>
          </div>

          {/* Device Code Flow */}
          {deviceCodeInfo && (
            <div className="mb-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm font-medium text-blue-300 mb-2">Authorize a new Hermes account:</p>
              <ol className="text-sm text-blue-400 space-y-1 list-decimal list-inside">
                <li>Open <a href={deviceCodeInfo.verification_uri_complete || deviceCodeInfo.verification_uri} target="_blank" rel="noopener noreferrer" className="underline font-medium">{deviceCodeInfo.verification_uri}</a></li>
                <li>Enter code: <code className="bg-blue-500/20 px-2 py-0.5 rounded font-mono font-bold">{deviceCodeInfo.user_code}</code></li>
              </ol>
              <div className="mt-3 flex items-center gap-3">
                <StatusBadge status={pollStatus} />
                {pollStatus === 'polling' && <span className="text-xs text-blue-400 animate-pulse">Waiting for authorization...</span>}
              </div>
              {pollResult && (
                <div className="mt-2 p-2 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-400">
                  ✓ Account <strong>{pollResult.account_label}</strong> connected!
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">Loading accounts…</div>
          ) : providers.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">
              No Hermes accounts connected yet. Click &quot;+ Add Account&quot; to connect one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left text-gray-500">
                    <th className="pb-2 font-medium">Label</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Weight</th>
                    <th className="pb-2 font-medium">In Flight</th>
                    <th className="pb-2 font-medium">Requests</th>
                    <th className="pb-2 font-medium">Errors</th>
                    <th className="pb-2 font-medium">Last Error</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((a) => (
                    <tr key={a.id} className="border-b border-gray-800/50">
                      <td className="py-2 font-medium">{a.account_label || '—'}</td>
                      <td className="py-2"><StatusBadge status={a.health_status} /></td>
                      <td className="py-2 text-gray-400">{a.weight}</td>
                      <td className="py-2 text-gray-400">{a.in_flight}/{a.max_concurrent}</td>
                      <td className="py-2 text-gray-400">{a.total_requests}</td>
                      <td className="py-2 text-gray-400">{a.total_errors}</td>
                      <td className="py-2 text-gray-500 text-xs truncate max-w-[200px]">{a.last_error_msg || '—'}</td>
                      <td className="py-2">
                        <button onClick={() => handleRefresh(a.id)} className="text-xs text-purple-400 hover:text-purple-300">Refresh</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
