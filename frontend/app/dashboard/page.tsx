'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import {
  getMe, getMyKeys, createKey, revokeKey, getUsage, getAnalytics,
  type ApiKey, type UsageStats, type ModelAnalytics, type UserInfo,
} from '@/lib/api'

function Spinner() {
  return <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-[#12121a] border border-zinc-800/60 p-5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent || 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function UserDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [token, setToken] = useState('')
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [analytics, setAnalytics] = useState<ModelAnalytics[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'keys' | 'analytics' | 'quickstart'>('keys')

  const loadData = useCallback(async (accessToken: string) => {
    try {
      const [me, keysData, usageData, analyticsData] = await Promise.all([
        getMe(accessToken), getMyKeys(accessToken), getUsage(accessToken), getAnalytics(accessToken),
      ])
      setUser(me)
      setKeys(keysData.keys)
      setUsage(usageData)
      setAnalytics(analyticsData.models)
    } catch (err: any) {
      if (err.message?.includes('401')) {
        router.push('/auth/login')
        return
      }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/auth/login'); return }
      setToken(session.access_token)
      await loadData(session.access_token)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) { router.push('/auth/login') } else { setToken(session.access_token); await loadData(session.access_token) }
    })
    return () => subscription.unsubscribe()
  }, [loadData, router])

  const handleCreateKey = async () => {
    if (!token) return
    setError('')
    try {
      const result = await createKey(token, newKeyName || 'default')
      setCreatedKey(result.api_key)
      setNewKeyName('')
      const keysData = await getMyKeys(token)
      setKeys(keysData.keys)
    } catch (err: any) { setError(err.message) }
  }

  const handleRevokeKey = async (keyId: string) => {
    if (!token) return
    setError('')
    try {
      await revokeKey(token, keyId)
      setKeys(keys.filter(k => k.id !== keyId))
    } catch (err: any) { setError(err.message) }
  }

  const signOut = async () => { await supabase.auth.signOut(); router.push('/auth/login') }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-zinc-800/60 px-6 py-4 sticky top-0 bg-[#0a0a0f]/80 backdrop-blur-xl z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="text-base font-semibold tracking-tight">AkaRouter</span>
          </div>
          <div className="flex items-center gap-4">
            {user?.role === 'admin' && (
              <a href="/admin" className="text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors px-3 py-1.5 rounded-lg bg-violet-500/10">
                Admin
              </a>
            )}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300">
                {user?.email?.[0]?.toUpperCase() || '?'}
              </div>
              <span className="text-sm text-zinc-400 hidden sm:block">{user?.email}</span>
            </div>
            <button onClick={signOut} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center justify-between">
            {error}
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-400 ml-2">×</button>
          </div>
        )}

        {/* Usage Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Plan" value={(usage?.tier || 'free').toUpperCase()} accent="text-violet-400" />
          <StatCard label="Used" value={usage?.monthly_requests || 0} sub={`of ${usage?.monthly_limit || 0}`} />
          <StatCard label="Remaining" value={usage?.remaining || 0} accent="text-emerald-400" />
          <StatCard label="Total" value={usage?.total_requests || 0} />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 rounded-xl bg-[#12121a] border border-zinc-800/60">
          {(['keys', 'analytics', 'quickstart'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'keys' ? '🔑 API Keys' : tab === 'analytics' ? '📊 Analytics' : '⚡ Quick Start'}
            </button>
          ))}
        </div>

        {/* API Keys Tab */}
        {activeTab === 'keys' && (
          <section className="space-y-4">
            {/* New key banner */}
            {createdKey && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                <p className="text-sm font-medium text-emerald-400">API key created — copy it now, it won&apos;t show again:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-3 rounded-xl bg-[#0a0a0f] text-emerald-300 font-mono text-xs break-all">{createdKey}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(createdKey)}
                    className="shrink-0 p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </div>
                <button onClick={() => setCreatedKey(null)} className="text-xs text-zinc-600 hover:text-zinc-400">Dismiss</button>
              </div>
            )}

            {/* Create key form */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. production)"
                className="flex-1 rounded-xl border border-zinc-800 bg-[#12121a] px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:ring-1 focus:ring-violet-500 focus:border-transparent outline-none"
              />
              <button
                onClick={handleCreateKey}
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 active:scale-[0.98] transition-all"
              >
                Create Key
              </button>
            </div>

            {/* Keys list */}
            {keys.length === 0 ? (
              <div className="text-center py-12 text-zinc-600 text-sm">
                No API keys yet. Create one above to start making requests.
              </div>
            ) : (
              <div className="space-y-2">
                {keys.map(key => (
                  <div key={key.id} className="flex items-center justify-between p-4 rounded-2xl bg-[#12121a] border border-zinc-800/60 group hover:border-zinc-700/60 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-white">{key.key_name}</p>
                      <p className="text-xs text-zinc-600 font-mono mt-0.5">{key.key_prefix}•••••••</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-zinc-700">{new Date(key.created_at).toLocaleDateString()}</span>
                      <button
                        onClick={() => handleRevokeKey(key.id)}
                        className="text-xs text-red-500/70 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <section className="space-y-4">
            {analytics.length === 0 ? (
              <div className="text-center py-12 text-zinc-600 text-sm">
                No usage data yet. Make some API requests to see analytics here.
              </div>
            ) : (
              <div className="space-y-3">
                {analytics.map(m => (
                  <div key={m.model} className="p-5 rounded-2xl bg-[#12121a] border border-zinc-800/60">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-white">{m.model}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        m.error_requests > 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
                      }`}>
                        {m.error_requests > 0 ? `${m.error_requests} errors` : 'healthy'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Requests</p>
                        <p className="text-lg font-bold text-white mt-0.5">{m.total_requests}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Prompt Tokens</p>
                        <p className="text-lg font-bold text-zinc-300 mt-0.5">{m.total_prompt_tokens.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Completion Tokens</p>
                        <p className="text-lg font-bold text-zinc-300 mt-0.5">{m.total_completion_tokens.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Total Tokens</p>
                        <p className="text-lg font-bold text-violet-400 mt-0.5">{m.total_tokens.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Avg Latency</p>
                        <p className="text-lg font-bold text-zinc-300 mt-0.5">{m.avg_latency_ms}ms</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Quick Start Tab */}
        {activeTab === 'quickstart' && (
          <section className="space-y-4">
            <div className="p-5 rounded-2xl bg-[#12121a] border border-zinc-800/60">
              <h3 className="text-sm font-semibold text-white mb-3">Python (OpenAI SDK)</h3>
              <pre className="bg-[#0a0a0f] rounded-xl p-4 text-xs text-zinc-300 font-mono overflow-x-auto leading-relaxed">{`pip install openai

from openai import OpenAI
import os

client = OpenAI(
    base_url="https://akarouter-production.up.railway.app/v1",
    api_key=os.environ["AKAROUTER_API_KEY"]
)

response = client.chat.completions.create(
    model="akarouter-pro",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`}</pre>
            </div>
            <div className="p-5 rounded-2xl bg-[#12121a] border border-zinc-800/60">
              <h3 className="text-sm font-semibold text-white mb-3">cURL</h3>
              <pre className="bg-[#0a0a0f] rounded-xl p-4 text-xs text-zinc-300 font-mono overflow-x-auto leading-relaxed">{`curl https://akarouter-production.up.railway.app/v1/chat/completions \\
  -H "Authorization: Bearer $AKAROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "akarouter-pro",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}</pre>
            </div>
            <div className="p-5 rounded-2xl bg-[#12121a] border border-zinc-800/60">
              <h3 className="text-sm font-semibold text-white mb-3">Available Models</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#0a0a0f]">
                  <div>
                    <p className="text-sm font-medium text-violet-400">akarouter-pro</p>
                    <p className="text-xs text-zinc-600">Step 3.7 Flash — fast general-purpose</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-medium">PRO</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#0a0a0f]">
                  <div>
                    <p className="text-sm font-medium text-blue-400">akarouter-flash</p>
                    <p className="text-xs text-zinc-600">Nemotron 3 Ultra — ultra-fast responses</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">FLASH</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
