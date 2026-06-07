'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface ProviderAccount {
  id: string
  account_label: string | null
  provider_name: string
  health_status: string
  weight: number
  total_requests: number
  total_errors: number
  in_flight: number
  max_concurrent: number
  last_used_at: string | null
  token_expires_at: string | null
  created_at: string | null
  updated_at: string | null
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    healthy: 'bg-green-100 text-green-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    dead: 'bg-red-100 text-red-800',
    pending: 'bg-blue-100 text-blue-800',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  )
}

export default function AdminDashboard() {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [addingAccount, setAddingAccount] = useState(false)
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{ verification_uri: string; user_code: string; connection_id: string } | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('')

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'

  const loadAccounts = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/accounts`)
      if (res.ok) {
        const data = await res.json()
        setAccounts(data)
      }
    } catch {
      // fallback to direct Supabase query
    }
    setLoading(false)
  }

  useEffect(() => {
    loadAccounts()

    // Subscribe to realtime updates on providers table
    const channel = supabase
      .channel('admin-providers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'providers' },
        (payload: any) => {
          setAccounts((prev) => {
            const next = [...prev]
            const idx = next.findIndex((a) => a.id === (payload.new?.id as string || payload.old?.id as string))
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

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const handleAddAccount = async () => {
    setAddingAccount(true)
    setPollStatus('')
    try {
      const res = await fetch(`${API_URL}/admin/accounts/init-device-code`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to initiate device code')
      const data = await res.json()
      setDeviceCodeInfo({
        verification_uri: data.verification_uri,
        user_code: data.user_code,
        connection_id: data.connection_id,
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
      const res = await fetch(`${API_URL}/admin/accounts/poll/${deviceCodeInfo.connection_id}`)
      const data = await res.json()
      setPollStatus(data.status)
      if (data.status === 'completed') {
        setDeviceCodeInfo(null)
        loadAccounts()
      }
    } catch (err: any) {
      setPollStatus(`Error: ${err.message}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <h1 className="text-2xl font-bold akarouter-text-gradient">AKAROUTER Admin</h1>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-blue-600 hover:underline">Back to dashboard</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Connected Accounts */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Connected Hermes Accounts</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Realtime enabled
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
                <a href={deviceCodeInfo.verification_uri} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                  {deviceCodeInfo.verification_uri}
                </a>
              </p>
              <p className="text-sm text-blue-700">2. Enter code: <code className="bg-blue-100 px-2 py-0.5 rounded font-mono font-bold">{deviceCodeInfo.user_code}</code></p>
              <button
                onClick={handlePoll}
                className="mt-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Check Authorization Status
              </button>
              {pollStatus && (
                <p className="text-sm mt-2 text-blue-700">Status: <span className="font-medium">{pollStatus}</span></p>
              )}
            </div>
          )}

          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">Loading accounts…</div>
          ) : accounts.length === 0 ? (
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
                    <th className="pb-2 font-medium">Token Expires</th>
                    <th className="pb-2 font-medium">Last Used</th>
                    <th className="pb-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-b border-gray-100">
                      <td className="py-2 font-medium text-gray-900">{a.account_label || '—'}</td>
                      <td className="py-2"><StatusBadge status={a.health_status} /></td>
                      <td className="py-2 text-gray-600">{a.weight}</td>
                      <td className="py-2 text-gray-600">{a.in_flight}/{a.max_concurrent}</td>
                      <td className="py-2 text-gray-600">{a.total_requests}</td>
                      <td className="py-2 text-gray-600">{a.total_errors}</td>
                      <td className="py-2 text-gray-600 text-xs">{a.token_expires_at ? new Date(a.token_expires_at).toLocaleString() : '—'}</td>
                      <td className="py-2 text-gray-600 text-xs">{a.last_used_at ? new Date(a.last_used_at).toLocaleString() : '—'}</td>
                      <td className="py-2 text-gray-600 text-xs">{a.updated_at ? new Date(a.updated_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Account Details Grid */}
        {accounts.length > 0 && (
          <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((a) => (
              <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{a.account_label || 'Unnamed'}</h3>
                  <StatusBadge status={a.health_status} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-gray-500">Requests</dt>
                  <dd className="text-gray-900">{a.total_requests}</dd>
                  <dt className="text-gray-500">Errors</dt>
                  <dd className="text-gray-900">{a.total_errors}</dd>
                  <dt className="text-gray-500">Weight</dt>
                  <dd className="text-gray-900">{a.weight}</dd>
                  <dt className="text-gray-500">In Flight</dt>
                  <dd className="text-gray-900">{a.in_flight}/{a.max_concurrent}</dd>
                </dl>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
