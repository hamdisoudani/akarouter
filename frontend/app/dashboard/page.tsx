'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  getMe,
  getMyKeys,
  createKey,
  revokeKey,
  getUsage,
  getAnalytics,
  type ApiKey,
  type UsageStats,
  type ModelAnalytics,
  type UserInfo,
} from '@/lib/api'
import { 
  Layers, 
  User, 
  LogOut, 
  KeyRound, 
  Plus, 
  Copy, 
  Check, 
  Trash2, 
  BarChart3, 
  Terminal,
  ExternalLink,
  Shield,
  Activity,
  ServerCrash
} from 'lucide-react'

export default function UserDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [token, setToken] = useState<string>('')
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [analytics, setAnalytics] = useState<ModelAnalytics[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  
  // Track copied states
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [copiedSDK, setCopiedSDK] = useState(false)
  const [copiedCreatedKey, setCopiedCreatedKey] = useState(false)

  const supabase = createClient()

  const loadData = useCallback(async (accessToken: string) => {
    try {
      const [me, keysData, usageData, analyticsData] = await Promise.all([
        getMe(accessToken),
        getMyKeys(accessToken),
        getUsage(accessToken),
        getAnalytics(accessToken),
      ])
      setUser(me)
      setKeys(keysData.keys)
      setUsage(usageData)
      setAnalytics(analyticsData.models)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push('/auth/login')
        return
      }
      // Also get the session for the access token
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth/login')
        return
      }
      if (!session) {
        router.push('/auth/login')
        return
      }
      setToken(session.access_token)
      await loadData(session.access_token)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        router.push('/auth/login')
      } else {
        setToken(session.access_token)
        await loadData(session.access_token)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadData, router])

  const handleCreateKey = async () => {
    if (!token) return
    setError('')
    setCreatedKey(null)
    setCopiedCreatedKey(false)
    try {
      const result = await createKey(token, newKeyName || 'default')
      setCreatedKey(result.api_key)
      setNewKeyName('')
      const keysData = await getMyKeys(token)
      setKeys(keysData.keys)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleRevokeKey = async (keyId: string) => {
    if (!token) return
    setError('')
    try {
      await revokeKey(token, keyId)
      setKeys(keys.filter(k => k.id !== keyId))
    } catch (err: any) {
      setError(err.message)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const copyToClipboard = (text: string, id: string, setCopiedState: (v: any) => void) => {
    navigator.clipboard.writeText(text)
    setCopiedState(id)
    setTimeout(() => setCopiedState(null), 2000)
  }

  if (loading) {
    return (
      <div className="relative min-h-screen bg-[#030303] flex items-center justify-center overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-indigo-500/5 rounded-full blur-[80px]" />
        <div className="text-zinc-500 font-medium text-sm flex items-center gap-2 z-10">
          <Activity className="w-5 h-5 animate-pulse text-indigo-500" />
          Loading dashboard data…
        </div>
      </div>
    )
  }

  const sdkCode = `from openai import OpenAI

client = OpenAI(
    base_url="${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000'}/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="akarouter-pro",
    messages=[{"role": "user", "content": "Hello!"}]
)`

  return (
    <div className="relative min-h-screen bg-[#030303] text-zinc-100 flex flex-col overflow-x-hidden selection:bg-indigo-500/30 selection:text-white">
      {/* Background Radial Glow */}
      <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 w-full z-50 border-b border-zinc-800/40 bg-[#030303]/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/10">
              <Layers className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-base font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              AkaRouter
            </span>
          </div>

          <div className="flex items-center gap-4">
            {user?.role === 'admin' && (
              <a 
                href="/admin" 
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-all"
              >
                <Shield className="w-3.5 h-3.5" />
                Admin Panel
              </a>
            )}
            
            <div className="hidden sm:flex items-center gap-2 bg-zinc-900/60 border border-zinc-800/50 rounded-xl px-3 py-1.5 text-xs text-zinc-400 font-medium">
              <User className="w-3.5 h-3.5 text-zinc-500" />
              {user?.email}
            </div>

            <span className="px-2.5 py-1 rounded-xl text-xs font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/10">
              {usage?.tier || 'free'}
            </span>

            <button 
              onClick={signOut} 
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/60 transition-all"
              title="Sign out"
            >
              <LogOut className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 space-y-8 z-10">
        {error && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {error}
            </div>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-400 font-bold ml-4 text-base">×</button>
          </div>
        )}

        {/* Stats Grid */}
        {usage && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-slide-in">
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Subscription Plan</p>
              <p className="text-2xl font-bold capitalize bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                {usage.tier}
              </p>
            </div>
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Current Month Billing</p>
              <p className="text-2xl font-bold text-white">
                {usage.monthly_requests}
              </p>
              <p className="text-[10px] text-zinc-500">Limit: {usage.monthly_limit.toLocaleString()}</p>
            </div>
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Remaining Quota</p>
              <p className="text-2xl font-bold text-emerald-400">
                {usage.remaining}
              </p>
              <p className="text-[10px] text-zinc-500">requests left</p>
            </div>
            <div className="glass-card p-5 rounded-2xl space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">All-Time Requests</p>
              <p className="text-2xl font-bold text-indigo-400">
                {usage.total_requests}
              </p>
            </div>
          </div>
        )}

        {/* API Key Panel */}
        <section className="glass-panel p-6 rounded-3xl glow-indigo space-y-6 animate-slide-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-indigo-500" />
                API Keys
              </h2>
              <p className="text-xs text-zinc-500">Generate programmatic Bearer tokens for connecting to your routed models.</p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. dev, prod)"
                className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-colors w-44 sm:w-56"
              />
              <button
                onClick={handleCreateKey}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-md active:scale-[0.98] transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Create
              </button>
            </div>
          </div>

          {/* New Key Alert Box */}
          {createdKey && (
            <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-xs space-y-2 animate-fade-in">
              <p className="text-indigo-400 font-bold">New API Key generated successfully! Please copy it now, it will not be displayed again:</p>
              <div className="flex items-center justify-between gap-3 bg-zinc-950/80 p-3 rounded-xl border border-zinc-800/80 font-mono text-xs break-all select-all text-indigo-300">
                <code>{createdKey}</code>
                <button 
                  onClick={() => copyToClipboard(createdKey, 'createdKey', (v) => setCopiedCreatedKey(!!v))}
                  className="p-1 rounded-lg bg-zinc-900 border border-zinc-800/50 hover:text-white text-zinc-400 transition-all shrink-0"
                  title="Copy Key"
                >
                  {copiedCreatedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button onClick={() => setCreatedKey(null)} className="text-[10px] text-zinc-500 hover:text-zinc-400 font-bold underline">Dismiss</button>
            </div>
          )}

          {/* Keys list */}
          {keys.length === 0 ? (
            <p className="text-xs text-zinc-600 py-4 text-center">No active API keys found. Generate a key above to start using the proxy endpoint.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between p-4 rounded-2xl bg-zinc-950/20 border border-zinc-800/60 hover:border-zinc-700/50 transition-all">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-zinc-200">{key.key_name}</p>
                    <p className="text-[10px] text-zinc-500 font-mono">{key.key_prefix}...••••</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600 font-medium mr-1">
                      {new Date(key.created_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleRevokeKey(key.id)}
                      className="p-2 rounded-xl text-red-500 hover:text-red-400 hover:bg-red-500/5 border border-transparent hover:border-red-500/10 transition-all"
                      title="Revoke Key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Analytics Section */}
        <section className="glass-panel p-6 rounded-3xl glow-indigo space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-500" />
              Usage Analytics
            </h2>
            <p className="text-xs text-zinc-500">Latency performance metrics and total token usages logged per routed model alias.</p>
          </div>

          {analytics.length === 0 ? (
            <p className="text-xs text-zinc-600 py-4 text-center">No usage logs found. Make API calls using your keys to populate analytics.</p>
          ) : (
            <div className="overflow-x-auto border border-zinc-800/60 rounded-2xl bg-zinc-950/20">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800/60 bg-zinc-950/60 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                    <th className="p-4">Model alias</th>
                    <th className="p-4">Total Requests</th>
                    <th className="p-4">Prompt Tokens</th>
                    <th className="p-4">Completion Tokens</th>
                    <th className="p-4">Total Tokens</th>
                    <th className="p-4">Avg Latency</th>
                    <th className="p-4 text-right">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {analytics.map((m) => (
                    <tr key={m.model} className="hover:bg-zinc-950/40 transition-colors">
                      <td className="p-4 font-bold text-indigo-400">{m.model}</td>
                      <td className="p-4 text-zinc-300 font-medium">{m.total_requests.toLocaleString()}</td>
                      <td className="p-4 text-zinc-400 font-mono">{(m.total_prompt_tokens || 0).toLocaleString()}</td>
                      <td className="p-4 text-zinc-400 font-mono">{(m.total_completion_tokens || 0).toLocaleString()}</td>
                      <td className="p-4 text-zinc-300 font-mono font-medium">{(m.total_tokens || 0).toLocaleString()}</td>
                      <td className="p-4 text-zinc-400 font-medium">{m.avg_latency_ms}ms</td>
                      <td className="p-4 text-right">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${m.error_requests > 0 ? 'bg-red-500/10 text-red-400 border border-red-500/15' : 'text-zinc-600'}`}>
                          {m.error_requests}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Local Setup Quickstart */}
        <section className="glass-panel p-6 rounded-3xl glow-indigo space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Terminal className="w-5 h-5 text-indigo-500" />
              Quick Start Connection Guide
            </h2>
            <p className="text-xs text-zinc-500">Seamless integration using any standard OpenAI-compatible client library.</p>
          </div>

          <div className="space-y-3">
            <div className="bg-[#07070a] rounded-2xl border border-zinc-800/60 overflow-hidden">
              <div className="bg-zinc-900/50 border-b border-zinc-800/60 px-4 py-2.5 flex items-center justify-between text-[11px] font-mono">
                <span className="text-zinc-500 font-bold">python-openai-sdk.py</span>
                <button
                  onClick={() => copyToClipboard(sdkCode, 'sdkCode', (v) => setCopiedSDK(!!v))}
                  className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800/60 transition-all"
                  title="Copy code block"
                >
                  {copiedSDK ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <pre className="p-5 font-mono text-xs text-zinc-300 leading-relaxed overflow-x-auto whitespace-pre">
                {sdkCode}
              </pre>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
