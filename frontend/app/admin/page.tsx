'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getMe } from '@/lib/api'
import { 
  Shield, 
  ArrowLeft, 
  Plus, 
  RefreshCw, 
  Activity, 
  ExternalLink,
  Cpu,
  BarChart3,
  ServerCrash,
  Users,
  Copy,
  Check
} from 'lucide-react'

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
    active: 'bg-emerald-400 shadow-emerald-500/50', 
    healthy: 'bg-emerald-400 shadow-emerald-500/50', 
    refreshing: 'bg-sky-400 shadow-sky-500/50',
    degraded: 'bg-amber-400 shadow-amber-500/50', 
    dead: 'bg-rose-500 shadow-rose-500/50', 
    pending: 'bg-zinc-500 shadow-zinc-500/50',
  }
  return (
    <span className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full shadow-sm animate-pulse ${colors[status] || 'bg-zinc-500 shadow-zinc-500/50'}`} />
      <span className="text-zinc-300 font-medium capitalize text-xs">{status}</span>
    </span>
  )
}

export default function AdminDashboard() {
  const router = useRouter()
  const supabase = createClient()
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
  
  // Track copied and refresh state
  const [copiedUserCode, setCopiedUserCode] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

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
    setCopiedUserCode(false)
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
    setRefreshingId(id)
    try { 
      await fetch(`${API_URL}/admin/providers/${id}/refresh`, { method: 'POST', headers: authHeaders() })
      await loadProviders() 
    } catch {}
    setRefreshingId(null)
  }

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!authChecked) {
    return (
      <div className="relative min-h-screen bg-[#030303] flex items-center justify-center overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-rose-500/5 rounded-full blur-[80px]" />
        <div className="text-zinc-500 font-medium text-sm flex items-center gap-2 z-10">
          <Activity className="w-5 h-5 animate-pulse text-rose-500" />
          Verifying administrator status…
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#030303] flex items-center justify-center">
        <div className="glass-panel p-6 rounded-2xl border-rose-500/20 text-center max-w-sm">
          <p className="text-rose-400 font-bold text-sm">Access Denied</p>
          <p className="text-zinc-500 text-xs mt-1">You must possess administrator privileges to access this area.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#030303] text-zinc-100 flex flex-col overflow-x-hidden selection:bg-rose-500/30 selection:text-white">
      {/* Background Radial Glow */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-rose-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 w-full z-50 border-b border-zinc-800/40 bg-[#030303]/70 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center shadow-md shadow-rose-500/10">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-base font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              AkaRouter
            </span>
            <span className="text-[10px] font-bold text-rose-400 px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/10 uppercase tracking-widest ml-1">
              Admin
            </span>
          </div>
          <a 
            href="/dashboard" 
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </a>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 space-y-6 z-10">
        {error && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {error}
            </div>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-400 font-bold ml-4 text-base">×</button>
          </div>
        )}

        {/* Admin Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-slide-in">
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Total Providers</p>
              <p className="text-2xl font-bold text-white">{stats.providers?.total || 0}</p>
              <p className="text-[10px] text-emerald-400">{stats.providers?.active || 0} active providers</p>
            </div>
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Routed Requests</p>
              <p className="text-2xl font-bold text-white">{(stats.providers?.total_requests || 0).toLocaleString()}</p>
              <p className="text-[10px] text-zinc-500">all provider accounts</p>
            </div>
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Request Errors</p>
              <p className={`text-2xl font-bold ${stats.providers?.total_errors > 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
                {stats.providers?.total_errors || 0}
              </p>
              <p className="text-[10px] text-zinc-500">aggregated error log</p>
            </div>
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Active Users</p>
              <p className="text-2xl font-bold text-rose-400">{stats.accounts?.total || 0}</p>
              <p className="text-[10px] text-emerald-400">{stats.accounts?.active || 0} active accounts</p>
            </div>
          </div>
        )}

        {/* Connected Accounts Section */}
        <section className="glass-panel p-6 rounded-3xl glow-rose space-y-5 animate-slide-in">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-rose-500" />
                Hermes Provider Connections
              </h2>
              <p className="text-xs text-zinc-500">Connect and manage provider accounts, balance weights, and trigger key refreshes.</p>
            </div>

            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider bg-zinc-900 border border-zinc-800/80 px-2.5 py-1 rounded-xl">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Realtime Channel
              </span>
              <button
                onClick={handleAddAccount}
                disabled={addingAccount}
                className="rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white shadow-md active:scale-[0.98] transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                {addingAccount ? 'Starting...' : 'Add Account'}
              </button>
            </div>
          </div>

          {/* Device OAuth Panel */}
          {deviceCodeInfo && (
            <div className="p-5 rounded-2xl bg-[#090506] border border-rose-500/10 text-xs space-y-4 animate-fade-in glow-rose">
              <div className="space-y-1 border-b border-rose-500/10 pb-3">
                <h3 className="font-bold text-rose-400 text-sm">OAuth Verification Needed</h3>
                <p className="text-zinc-500 text-[10px]">Follow these steps to link the new Hermes Provider connection.</p>
              </div>

              <ol className="space-y-2 text-zinc-300 list-decimal list-inside font-medium leading-relaxed">
                <li>
                  Open the authorization link: 
                  <a 
                    href={deviceCodeInfo.verification_uri_complete || deviceCodeInfo.verification_uri} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 font-bold underline ml-1.5"
                  >
                    {deviceCodeInfo.verification_uri}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li className="flex items-center flex-wrap gap-2">
                  Enter the verification code: 
                  <code className="bg-rose-500/10 border border-rose-500/20 text-rose-300 px-2 py-0.5 rounded font-mono font-bold text-xs select-all">
                    {deviceCodeInfo.user_code}
                  </code>
                  <button 
                    onClick={() => copyToClipboard(deviceCodeInfo.user_code, setCopiedUserCode)}
                    className="p-1 rounded-lg bg-zinc-950 border border-zinc-800/80 hover:text-white text-zinc-500 transition-all shrink-0"
                    title="Copy Code"
                  >
                    {copiedUserCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </li>
              </ol>

              <div className="flex items-center gap-3 pt-2">
                <StatusDot status={pollStatus} />
                {pollStatus === 'polling' && (
                  <span className="text-[10px] text-zinc-500 animate-pulse font-medium">
                    Waiting for provider login authorization…
                  </span>
                )}
              </div>
              {pollResult && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-medium">
                  ✓ Account <strong>{pollResult.account_label}</strong> linked successfully!
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-zinc-600">Loading active provider accounts…</div>
          ) : providers.length === 0 ? (
            <p className="text-xs text-zinc-600 py-6 text-center">No accounts connected. Use the Add Account button to initialize device auth.</p>
          ) : (
            <div className="overflow-x-auto border border-zinc-800/60 rounded-2xl bg-zinc-950/20">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800/60 bg-zinc-950/60 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                    <th className="p-4">Label</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">In Flight Load</th>
                    <th className="p-4">Requests</th>
                    <th className="p-4">Errors</th>
                    <th className="p-4 text-right">Refresh Hook</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {providers.map(a => (
                    <tr key={a.id} className="hover:bg-zinc-950/40 transition-colors">
                      <td className="p-4 font-bold text-white">{a.account_label || '—'}</td>
                      <td className="p-4"><StatusDot status={a.health_status} /></td>
                      <td className="p-4 text-zinc-400 font-medium">{a.in_flight}/{a.max_concurrent}</td>
                      <td className="p-4 text-zinc-300 font-mono">{(a.total_requests || 0).toLocaleString()}</td>
                      <td className="p-4 text-zinc-400 font-mono">{(a.total_errors || 0).toLocaleString()}</td>
                      <td className="p-4 text-right">
                        <button 
                          onClick={() => handleRefresh(a.id)} 
                          disabled={refreshingId === a.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-bold bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition-all disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${refreshingId === a.id ? 'animate-spin' : ''}`} />
                          Sync
                        </button>
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
