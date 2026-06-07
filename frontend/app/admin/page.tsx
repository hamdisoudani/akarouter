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
  last_error_msg: string | null
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-400', healthy: 'bg-emerald-400', refreshing: 'bg-blue-400',
    degraded: 'bg-amber-400', dead: 'bg-red-400', pending: 'bg-zinc-500',
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={`w-2 h-2 rounded-full ${colors[status] || 'bg-zinc-500'}`} />
      <span className="text-zinc-400 capitalize">{status}</span>
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
    flow_id: string; verification_uri: string; verification_uri_complete: string; user_code: string
  } | null>(null)
  const [pollStatus, setPollStatus] = useState('')
  const [pollResult, setPollResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<any>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/auth/login'); return }
      setToken(session.access_token)
      try {
        const me = await getMe(session.access_token)
        if (me.role !== 'admin') { router.push('/dashboard'); return }
        setIsAdmin(true)
      } catch {
        const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY
        if (adminKey) { setToken(adminKey); setIsAdmin(true) }
        else { router.push('/dashboard'); return }
      }
      setAuthChecked(true)
    })
  }, [router])

  const loadProviders = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/admin/providers`, { headers: authHeaders() })
      if (res.ok) { const data = await res.json(); setProviders(data.providers || []) }
    } catch {}
    setLoading(false)
  }, [API_URL, token, authHeaders])

  const loadStats = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/admin/stats`, { headers: authHeaders() })
      if (res.ok) setStats(await res.json())
    } catch {}
  }, [API_URL, token, authHeaders])

  useEffect(() => {
    if (!authChecked || !isAdmin) return
    loadProviders(); loadStats()
    const channel = supabase
      .channel('admin-providers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'providers' }, (payload: any) => {
        setProviders(prev => {
          const next = [...prev]
          const idx = next.findIndex(a => a.id === (payload.new?.id || payload.old?.id))
          if (payload.eventType === 'INSERT' && payload.new && idx === -1) next.push(payload.new as ProviderAccount)
          else if (payload.eventType === 'UPDATE' && payload.new && idx >= 0) next[idx] = payload.new as ProviderAccount
          else if (payload.eventType === 'DELETE' && payload.old && idx >= 0) next.splice(idx, 1)
          return next
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [authChecked, isAdmin, loadProviders, loadStats])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const startStatusPolling = useCallback((flowId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/admin/providers/oauth/status/${flowId}`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        setPollStatus(data.status)
        setPollResult(data.result || null)
        if (data.status === 'authorized') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null; setDeviceCodeInfo(null); loadProviders(); loadStats()
        } else if (data.status === 'failed' || data.status === 'timeout') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null; setError(data.error || `OAuth ${data.status}`)
        }
      } catch {}
    }
    pollRef.current = setInterval(check, 5000); check()
  }, [API_URL, authHeaders, loadProviders, loadStats])

  const handleAddAccount = async () => {
    setAddingAccount(true); setPollStatus(''); setPollResult(null); setError('')
    try {
      const label = `hermes-${Date.now().toString(36)}`
      const res = await fetch(`${API_URL}/admin/providers/oauth/initiate?account_label=${label}`, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error(`Initiate failed: ${res.status}`)
      const data = await res.json()
      setDeviceCodeInfo({ flow_id: data.flow_id, verification_uri: data.verification_uri, verification_uri_complete: data.verification_uri_complete || '', user_code: data.user_code })
      setPollStatus('pending')
      const pollRes = await fetch(`${API_URL}/admin/providers/oauth/poll/${data.flow_id}`, { method: 'POST', headers: authHeaders() })
      if (pollRes.ok) { setPollStatus('polling'); startStatusPolling(data.flow_id) }
    } catch (err: any) { setError(err.message) } finally { setAddingAccount(false) }
  }

  const handleRefresh = async (id: string) => {
    try { await fetch(`${API_URL}/admin/providers/${id}/refresh`, { method: 'POST', headers: authHeaders() }); loadProviders() } catch {}
  }

  if (!authChecked) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-zinc-500 text-sm">Checking access…</div>
  if (!isAdmin) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-red-400 text-sm">Access denied</div>

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="border-b border-zinc-800/60 px-6 py-4 sticky top-0 bg-[#0a0a0f]/80 backdrop-blur-xl z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold">A</div>
            <span className="text-base font-semibold tracking-tight">AkaRouter</span>
            <span className="text-xs text-zinc-600 font-medium ml-1">Admin</span>
          </div>
          <a href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← Dashboard</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex justify-between">
            {error}<button onClick={() => setError('')} className="text-red-500 hover:text-red-400 ml-2">×</button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-[#12121a] border border-zinc-800/60 p-5">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Providers</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.providers?.total || 0}</p>
              <p className="text-xs text-emerald-400">{stats.providers?.active || 0} active</p>
            </div>
            <div className="rounded-2xl bg-[#12121a] border border-zinc-800/60 p-5">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Requests</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.providers?.total_requests || 0}</p>
            </div>
            <div className="rounded-2xl bg-[#12121a] border border-zinc-800/60 p-5">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Errors</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.providers?.total_errors || 0}</p>
            </div>
            <div className="rounded-2xl bg-[#12121a] border border-zinc-800/60 p-5">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Users</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.accounts?.total || 0}</p>
            </div>
          </div>
        )}

        {/* Connected Accounts */}
        <section className="rounded-2xl bg-[#12121a] border border-zinc-800/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Hermes Accounts</h2>
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Realtime
              </span>
            </div>
            <button
              onClick={handleAddAccount}
              disabled={addingAccount}
              className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50 transition-all"
            >
              {addingAccount ? 'Starting…' : '+ Add Account'}
            </button>
          </div>

          {deviceCodeInfo && (
            <div className="mb-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm font-medium text-blue-300 mb-2">Authorize a new Hermes account:</p>
              <ol className="text-sm text-blue-400 space-y-1 list-decimal list-inside">
                <li>Open <a href={deviceCodeInfo.verification_uri_complete || deviceCodeInfo.verification_uri} target="_blank" rel="noopener noreferrer" className="underline font-medium">{deviceCodeInfo.verification_uri}</a></li>
                <li>Enter code: <code className="bg-blue-500/20 px-2 py-0.5 rounded font-mono font-bold">{deviceCodeInfo.user_code}</code></li>
              </ol>
              <div className="mt-3 flex items-center gap-3">
                <StatusDot status={pollStatus} />
                {pollStatus === 'polling' && <span className="text-xs text-blue-400 animate-pulse">Waiting…</span>}
              </div>
              {pollResult && (
                <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                  ✓ Account <strong>{pollResult.account_label}</strong> connected!
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="py-10 text-center text-sm text-zinc-600">Loading…</div>
          ) : providers.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-600">No accounts yet. Click &quot;+ Add Account&quot;.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/60 text-left text-[10px] text-zinc-600 uppercase tracking-wider">
                    <th className="pb-2 font-medium">Label</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Load</th>
                    <th className="pb-2 font-medium">Requests</th>
                    <th className="pb-2 font-medium">Errors</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map(a => (
                    <tr key={a.id} className="border-b border-zinc-800/30 group">
                      <td className="py-2.5 font-medium text-white">{a.account_label || '—'}</td>
                      <td className="py-2.5"><StatusDot status={a.health_status} /></td>
                      <td className="py-2.5 text-zinc-500 text-xs">{a.in_flight}/{a.max_concurrent}</td>
                      <td className="py-2.5 text-zinc-400">{a.total_requests}</td>
                      <td className="py-2.5 text-zinc-400">{a.total_errors}</td>
                      <td className="py-2.5">
                        <button onClick={() => handleRefresh(a.id)} className="text-xs text-violet-500 hover:text-violet-400 opacity-0 group-hover:opacity-100 transition-all">Refresh</button>
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
