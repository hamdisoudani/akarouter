'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
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
    supabase.auth.getSession().then(async ({ data: { session } }) => {
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
    try {
      const result = await createKey(token, newKeyName || 'default')
      setCreatedKey(result.api_key)
      setNewKeyName('')
      // Reload keys
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            AKAROUTER
          </h1>
          <div className="flex items-center gap-4">
            {user?.role === 'admin' && (
              <a href="/admin" className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
                Admin Panel
              </a>
            )}
            <span className="text-sm text-gray-400">{user?.email}</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 capitalize">
              {usage?.tier || 'free'}
            </span>
            <button onClick={signOut} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
              Sign out
            </button>
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

        {/* Usage Overview */}
        {usage && (
          <div className="grid md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Plan</p>
              <p className="text-2xl font-bold capitalize mt-1">{usage.tier}</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Requests</p>
              <p className="text-2xl font-bold mt-1">{usage.monthly_requests}</p>
              <p className="text-xs text-gray-500">of {usage.monthly_limit}</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Remaining</p>
              <p className="text-2xl font-bold mt-1">{usage.remaining}</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Total Requests</p>
              <p className="text-2xl font-bold mt-1">{usage.total_requests}</p>
            </div>
          </div>
        )}

        {/* API Keys */}
        <section className="rounded-xl border border-gray-800 bg-gray-800/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">API Keys</h2>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name"
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:ring-1 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleCreateKey}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Create Key
              </button>
            </div>
          </div>

          {/* Newly created key (show once) */}
          {createdKey && (
            <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm">
              <p className="text-green-400 font-medium">New API key created! Copy it now — it won&apos;t be shown again:</p>
              <code className="block mt-1 p-2 rounded bg-gray-900 text-green-300 font-mono text-xs break-all">{createdKey}</code>
              <button onClick={() => { navigator.clipboard.writeText(createdKey); }} className="mt-1 text-xs text-green-500 hover:text-green-400">
                Copy to clipboard
              </button>
              <button onClick={() => setCreatedKey(null)} className="ml-2 text-xs text-gray-500 hover:text-gray-400">Dismiss</button>
            </div>
          )}

          {keys.length === 0 ? (
            <p className="text-sm text-gray-500">No API keys yet. Create one to start using the API.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50 border border-gray-700/50">
                  <div>
                    <p className="text-sm font-medium">{key.key_name}</p>
                    <p className="text-xs text-gray-500 font-mono">{key.key_prefix}...••••</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-600">
                      Created {new Date(key.created_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleRevokeKey(key.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Per-Model Analytics */}
        <section className="rounded-xl border border-gray-800 bg-gray-800/50 p-6">
          <h2 className="text-lg font-semibold mb-4">Usage Analytics</h2>
          {analytics.length === 0 ? (
            <p className="text-sm text-gray-500">No usage data yet. Start making API requests to see analytics.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left text-gray-500">
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 font-medium">Requests</th>
                    <th className="pb-2 font-medium">Prompt Tokens</th>
                    <th className="pb-2 font-medium">Completion Tokens</th>
                    <th className="pb-2 font-medium">Total Tokens</th>
                    <th className="pb-2 font-medium">Avg Latency</th>
                    <th className="pb-2 font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.map((m) => (
                    <tr key={m.model} className="border-b border-gray-800/50">
                      <td className="py-2 font-medium text-blue-400">{m.model}</td>
                      <td className="py-2 text-gray-300">{m.total_requests}</td>
                      <td className="py-2 text-gray-400">{m.total_prompt_tokens.toLocaleString()}</td>
                      <td className="py-2 text-gray-400">{m.total_completion_tokens.toLocaleString()}</td>
                      <td className="py-2 text-gray-300">{m.total_tokens.toLocaleString()}</td>
                      <td className="py-2 text-gray-400">{m.avg_latency_ms}ms</td>
                      <td className="py-2">
                        <span className={m.error_requests > 0 ? 'text-red-400' : 'text-gray-600'}>
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

        {/* Quick Start */}
        <section className="rounded-xl border border-gray-800 bg-gray-800/50 p-6">
          <h2 className="text-lg font-semibold mb-3">Quick Start</h2>
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-xs text-gray-300 space-y-2 overflow-x-auto">
            <p className="text-gray-500"># Install the OpenAI SDK</p>
            <p>pip install openai</p>
            <br />
            <p className="text-gray-500"># Set your API key</p>
            <p>export OPENAI_API_KEY=&quot;akar_your_key_here&quot;</p>
            <br />
            <p className="text-gray-500"># Make a request</p>
            <pre className="whitespace-pre">{`from openai import OpenAI
client = OpenAI(
    base_url="${process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'}/v1",
    api_key=os.environ["OPENAI_API_KEY"]
)
response = client.chat.completions.create(
    model="akarouter-pro",
    messages=[{"role": "user", "content": "Hello!"}]
)`}</pre>
          </div>
        </section>
      </main>
    </div>
  )
}
