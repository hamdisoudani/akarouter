'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Key, BarChart3, Activity, Copy, LogOut, Trash2, Plus } from 'lucide-react'
import { getMe, getMyKeys, createKey, revokeKey, getAnalytics, getUsage } from '@/lib/api'

type Me = {
  email: string
  role: string
  tier: string
  monthly_requests: number
  monthly_limit: number
  monthly_requests: number
}

type Key = {
  id: string
  key_name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  scopes: string[] | null
}

type Analytics = {
  requests_by_model: Array<{
    model: string
    count: number
    total_tokens: number
    avg_latency: number
    errors: number
  }>
  monthly_requests: number
  total_tokens: number
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<Me | null>(null)
      const usage = await getUsage(jwt)
  const [keys, setKeys] = useState<Key[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/auth/login'); return }

      const jwt = session.access_token
      const [meData, keysData, analyticsData] = await Promise.all([
        getMe(jwt),
        getMyKeys(jwt),
        getAnalytics(jwt),
      ])
      setMe({...meData, ...usage})
      const usage = await getUsage(jwt)
      setKeys(keysData)
      setAnalytics(analyticsData)
      setLoading(false)
    }
    init()
  }, [supabase, router])

  const handleCreateKey = async () => {
    const name = prompt('Key name:')
    if (!name) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const newKey = await createKey(session.access_token, name)
    if (newKey) {
      setKeys([...keys, newKey])
      alert(`Your new API key (save it now):\n${newKey.raw_key}`)
    }
  }

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm('Revoke this key?')) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await revokeKey(session.access_token, keyId)
    setKeys(keys.filter(k => k.id !== keyId))
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/auth/login')
  }

  if (loading) {
    return <div className="min-h-screen bg-[#030303] flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" /></div>
  }

  if (!me) return null

  const remaining = Math.max(0, (me.monthly_limit || 1000) - (me.monthly_requests || 0))
  const pctUsed = me.monthly_limit ? Math.round((me.monthly_requests / me.monthly_limit) * 100) : 0

  return (
    <div className="min-h-screen bg-[#030303]">
      {/* Header */}
      <header className="border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-zinc-100">AkaRouter</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400">{me.email}</span>
            <button onClick={handleLogout} className="text-zinc-500 hover:text-zinc-300 transition"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard icon={<Activity className="w-5 h-5" />} label="Total Requests" value={me.total_requests?.toLocaleString()} />
          <StatCard icon={<BarChart3 className="w-5 h-5" />} label="Monthly Usage" value={`${me.monthly_requests}/${me.monthly_limit}`} />
          <StatCard icon={<Key className="w-5 h-5" />} label="API Keys" value={keys?.length?.toString() || '0'} />
          <StatCard icon={<Layers className="w-5 h-5" />} label="Plan" value={me.tier} />
        </div>

        {/* Usage bar */}
        <div className="glass-panel p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-300">Monthly Usage</h3>
            <span className="text-xs text-zinc-500">{pctUsed}% used · {remaining} remaining</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full transition-all" style={{ width: `${pctUsed}%` }} />
          </div>
        </div>

        {/* API Keys */}
        <div className="glass-panel p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2"><Key className="w-5 h-5 text-indigo-400" /> API Keys</h3>
            <button onClick={handleCreateKey} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-sm transition"><Plus className="w-4 h-4" /> New Key</button>
          </div>
          {!keys?.length ? (
            <p className="text-zinc-500 text-sm">No API keys yet. Create one to start using the API.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{key.key_name}</p>
                    <p className="text-xs text-zinc-500 font-mono mt-1">akar_{key.key_prefix}...</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => copyToClipboard(`akar_${key.key_prefix}`, key.id)} className="p-2 text-zinc-500 hover:text-indigo-400 transition"><Copy className="w-4 h-4" /></button>
                    <button onClick={() => handleRevokeKey(key.id)} className="p-2 text-zinc-500 hover:text-red-400 transition"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Analytics */}
        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5 text-violet-400" /> Usage Analytics</h3>
          {!analytics?.requests_by_model?.length ? (
            <p className="text-zinc-500 text-sm">No usage data yet. Make your first API call!</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-zinc-500 border-b border-white/5">
                  <th className="text-left py-2 font-medium">Model</th>
                  <th className="text-right py-2 font-medium">Requests</th>
                  <th className="text-right py-2 font-medium">Tokens</th>
                  <th className="text-right py-2 font-medium">Avg Latency</th>
                  <th className="text-right py-2 font-medium">Errors</th>
                </tr></thead>
                <tbody>
                  {analytics.requests_by_model.map((row) => (
                    <tr key={row.model} className="border-b border-white/[0.02]">
                      <td className="py-3 text-zinc-200 font-mono">{row.model}</td>
                      <td className="text-right py-3 text-zinc-400">{row.count}</td>
                      <td className="text-right py-3 text-zinc-400">{row.total_tokens}</td>
                      <td className="text-right py-3 text-zinc-400">{row.avg_latency}ms</td>
                      <td className="text-right py-3 text-zinc-400">{row.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick Start */}
        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-zinc-100 mb-4">Quick Start</h3>
          <pre className="bg-black/40 rounded-xl p-4 overflow-x-auto text-xs text-zinc-300 font-mono border border-white/5">
{`import OpenAI from 'openai'
const client = new OpenAI({
  baseURL: '${process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'}/v1',
  apiKey: 'akar_YOUR_KEY_HERE'
})

await client.chat.completions.create({
  model: 'akarouter-pro',
  messages: [{ role: 'user', content: 'Hello!' }]
})`}
          </pre>
        </div>
      </main>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass-panel p-5 rounded-2xl">
      <div className="flex items-center gap-2 text-zinc-400 mb-2">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  )
}
