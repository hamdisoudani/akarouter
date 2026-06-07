'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

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
    active: 'bg-green-100 text-green-800',
    healthy: 'bg-green-100 text-green-800',
    refreshing: 'bg-blue-100 text-blue-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    dead: 'bg-red-100 text-red-800',
    pending: 'bg-gray-100 text-gray-800',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  )
}

export default function AdminDashboard() {
  const [providers, setProviders] = useState<ProviderAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [adminKey, setAdminKey] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')
  const [addingAccount, setAddingAccount] = useState(false)
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{
    flow_id: string
    verification_uri: string
    verification_uri_complete: string
    user_code: string
    expires_in: number
  } | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('')
  const [stats, setStats] = useState<any>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'

  const authHeaders = () => ({ Authorization: `Bearer ${adminKey}` })

  const loadProviders = async () => {
    if (!authed) return
    try {
      const res = await fetch(`${API_URL}/admin/providers`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setProviders(data.providers || [])
      }
    } catch { /* ignore */ }
  }

  const loadStats = async () => {
    if (!authed) return
    try {
      const res = await fetch(`${API_URL}/admin/stats`, { headers: authHeaders() })
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
  }

  const handleAuth = async () => {
    setAuthError('')
    try {
      const res = await fetch(`${API_URL}/admin/providers`, { headers: authHeaders() })
      if (res.ok) {
        setAuthed(true)
        const data = await res.json()
        setProviders(data.providers || [])
        loadStats()
      } else {
        setAuthError('Invalid admin key')
      }
    } catch {
      setAuthError('Connection failed')
    }
  }

  useEffect(() => {
    if (!authed) return
    loadProviders()
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
  }, [authed])

  const handleAddAccount = async () => {
    setAddingAccount(true)
    setPollStatus('')
    try {
      const res = await fetch(`${API_URL}/admin/providers/oauth/initiate?account_label=hermes-${Date.now().toString(36)}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error('Failed to initiate device code')
      const data = await res.json()
      setDeviceCodeInfo({
        flow_id: data.flow_id,
        verification_uri: data.verification_uri,
        verification_uri_complete: data.verification_uri_complete || '',
        user_code: data.user_code,
        expires_in: data.expires_in,
      })
      setPollStatus('pending')
    } catch (err: any) {
      setPollStatus(`Error: ${err.message}`)
    } finally {
      setAddingAccount(false)
    }
  }

  const handlePoll = async () => {
    if (!deviceCodeInfo) return
    try {
      const res = await fetch(`${API_URL}/admin/providers/oauth/status/${deviceCodeInfo.flow_id}`, {
        headers: authHeaders(),
      })
      const data = await res.json()
      setPollStatus(data.status)
      if (data.status === 'authorized') {
        setDeviceCodeInfo(null)
        loadProviders()
        loadStats()
      }
    } catch (err: any) {
      setPollStatus(`Error: ${err.message}`)
    }
  }

  const handleRefresh = async (providerId: string) => {
    try {
      await fetch(`${API_URL}/admin/providers/${providerId}/refresh`, {
        method: 'POST',
        headers: authHeaders(),
      })
      loadProviders()
    } catch { /* ignore */ }
  }

  // Auth gate
  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">AKAROUTER Admin</h1>
          <p className="text-sm text-gray-500 mb-6">Enter the Supabase service role key to access the admin panel.</p>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            placeholder="Supabase service role key"
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none mb-3"
          />
          {authError && <p className="text-sm text-red-600 mb-3">{authError}</p>}
          <button
            onClick={handleAuth}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Authenticate
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">AKAROUTER Admin</h1>
          <div className="flex items-center gap-4">
            <a href="/admin/providers" className="text-sm text-blue-600 hover:underline">Providers</a>
            <a href="/admin/oauth" className="text-sm text-blue-600 hover:underline">OAuth</a>
            <a href="/dashboard" className="text-sm text-blue-600 hover:underline">Dashboard</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid md:grid-cols-4 gap-4 mb-8">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Providers</p>
              <p className="text-2xl font-bold text-gray-900">{stats.providers?.total || 0}</p>
              <p className="text-xs text-green-600">{stats.providers?.active || 0} active</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Total Requests</p>
              <p className="text-2xl font-bold text-gray-900">{stats.providers?.total_requests || 0}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Total Errors</p>
              <p className="text-2xl font-bold text-gray-900">{stats.providers?.total_errors || 0}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Accounts</p>
              <p className="text-2xl font-bold text-gray-900">{stats.accounts?.total || 0}</p>
              <p className="text-xs text-green-600">{stats.accounts?.active || 0} active</p>
            </div>
          </div>
        )}

        {/* Connected Accounts */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Connected Hermes Accounts</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Realtime
              </span>
              <button
                onClick={handleAddAccount}
                disabled={addingAccount}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {addingAccount ? 'Starting...' : '+ Add Account'}
              </button>
            </div>
          </div>

          {/* Device Code Flow */}
          {deviceCodeInfo && (
            <div className="mb-4 p-4 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-sm font-medium text-blue-900">Authorize a new Hermes account:</p>
              <p className="text-sm text-blue-700 mt-1">
                1. Open{' '}
                <a
                  href={deviceCodeInfo.verification_uri_complete || deviceCodeInfo.verification_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  {deviceCodeInfo.verification_uri}
                </a>
              </p>
              <p className="text-sm text-blue-700">
                2. Enter code:{' '}
                <code className="bg-blue-100 px-2 py-0.5 rounded font-mono font-bold">
                  {deviceCodeInfo.user_code}
                </code>
              </p>
              <button
                onClick={handlePoll}
                className="mt-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Check Authorization Status
              </button>
              {pollStatus && (
                <p className="text-sm mt-2 text-blue-700">
                  Status: <span className="font-medium">{pollStatus}</span>
                </p>
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
                  <tr className="border-b border-gray-200 text-left text-gray-500">
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
                    <tr key={a.id} className="border-b border-gray-100">
                      <td className="py-2 font-medium text-gray-900">{a.account_label || '—'}</td>
                      <td className="py-2"><StatusBadge status={a.health_status} /></td>
                      <td className="py-2 text-gray-600">{a.weight}</td>
                      <td className="py-2 text-gray-600">{a.in_flight}/{a.max_concurrent}</td>
                      <td className="py-2 text-gray-600">{a.total_requests}</td>
                      <td className="py-2 text-gray-600">{a.total_errors}</td>
                      <td className="py-2 text-gray-600 text-xs truncate max-w-[200px]">
                        {a.last_error_msg || '—'}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => handleRefresh(a.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Refresh Token
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
