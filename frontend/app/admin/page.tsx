'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
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
    polling: 'bg-blue-100 text-blue-800',
    authorized: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    timeout: 'bg-orange-100 text-orange-800',
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
  const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY || ''

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${ADMIN_KEY}`
  }), [ADMIN_KEY])

  const loadProviders = useCallback(async () => {
    if (!ADMIN_KEY) { setLoading(false); return }
    try {
      const res = await fetch(`${API_URL}/admin/providers`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setProviders(data.providers || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [API_URL, ADMIN_KEY, authHeaders])

  const loadStats = useCallback(async () => {
    if (!ADMIN_KEY) return
    try {
      const res = await fetch(`${API_URL}/admin/stats`, { headers: authHeaders() })
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
  }, [API_URL, ADMIN_KEY, authHeaders])

  useEffect(() => {
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
  }, [loadProviders, loadStats])

  // Cleanup poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  const startStatusPolling = useCallback((flowId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)

    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/admin/providers/oauth/status/${flowId}`, {
          headers: authHeaders(),
        })
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

    // Poll every 5 seconds
    pollIntervalRef.current = setInterval(checkStatus, 5000)
    // Also check immediately
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
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `Initiate failed: ${res.status}`)
      }
      const data = await res.json()
      setDeviceCodeInfo({
        flow_id: data.flow_id,
        verification_uri: data.verification_uri,
        verification_uri_complete: data.verification_uri_complete || '',
        user_code: data.user_code,
        expires_in: data.expires_in,
      })
      setPollStatus('pending')

      // Start the backend polling immediately
      const pollRes = await fetch(`${API_URL}/admin/providers/oauth/poll/${data.flow_id}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (pollRes.ok) {
        const pollData = await pollRes.json()
        setPollStatus(pollData.status || 'polling')
        // Now auto-check status every 5 seconds
        startStatusPolling(data.flow_id)
      } else {
        setError('Failed to start authorization polling')
      }
    } catch (err: any) {
      setError(`Error: ${err.message}`)
    } finally {
      setAddingAccount(false)
    }
  }

  const handleManualCheck = async () => {
    if (!deviceCodeInfo) return
    try {
      const res = await fetch(`${API_URL}/admin/providers/oauth/status/${deviceCodeInfo.flow_id}`, {
        headers: authHeaders(),
      })
      const data = await res.json()
      setPollStatus(data.status)
      setPollResult(data.result || null)
      if (data.status === 'authorized') {
        setDeviceCodeInfo(null)
        loadProviders()
        loadStats()
      }
      if (data.error) setError(data.error)
    } catch (err: any) {
      setError(`Check failed: ${err.message}`)
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

  if (!ADMIN_KEY) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">AKAROUTER Admin</h1>
          <p className="text-sm text-red-600">Admin key not configured. Set <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_ADMIN_KEY</code> in Railway environment variables.</p>
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
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-500 hover:text-red-700">×</button>
          </div>
        )}

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
              <p className="text-sm font-medium text-blue-900 mb-2">Authorize a new Hermes account:</p>
              <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                <li>
                  Open{' '}
                  <a
                    href={deviceCodeInfo.verification_uri_complete || deviceCodeInfo.verification_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    {deviceCodeInfo.verification_uri}
                  </a>
                </li>
                <li>
                  Enter code:{' '}
                  <code className="bg-blue-100 px-2 py-0.5 rounded font-mono font-bold text-blue-900">
                    {deviceCodeInfo.user_code}
                  </code>
                </li>
              </ol>
              <div className="mt-3 flex items-center gap-3">
                <StatusBadge status={pollStatus} />
                {pollStatus === 'polling' && (
                  <span className="text-xs text-blue-600 animate-pulse">Waiting for authorization...</span>
                )}
                {pollStatus === 'pending' && (
                  <button
                    onClick={handleManualCheck}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Check Now
                  </button>
                )}
              </div>
              {pollResult && (
                <div className="mt-2 p-2 rounded bg-green-50 border border-green-200 text-xs text-green-800">
                  ✓ Account <strong>{pollResult.account_label}</strong> connected! Token expires: {pollResult.expires_at}
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
                      <td className="py-2 space-x-2">
                        <button
                          onClick={() => handleRefresh(a.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Refresh
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
