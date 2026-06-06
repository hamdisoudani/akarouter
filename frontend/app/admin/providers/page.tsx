'use client'

import { useEffect, useMemo, useState } from 'react'
import { type Provider, listProviders, initiateOAuth, startOAuthPoll, getOAuthStatus, refreshProvider, refreshAllProviders, deleteProvider, getAdminStats } from '@/lib/adminApi'

function timeAgo(iso: string | null) {
  if (!iso) return 'never'
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function expiryLabel(p: Provider) {
  if (p.is_expired) return <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 text-xs">Expired</span>
  if (p.seconds_until_expiry == null) return <span className="px-2 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 text-xs">Unknown</span>
  if (p.seconds_until_expiry < 600) return <span className="px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 text-xs">~{Math.round(p.seconds_until_expiry / 60)}m left</span>
  return <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs">~{Math.round(p.seconds_until_expiry / 60)}m left</span>
}

function statusClass(status: string) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    degraded: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    dead: 'bg-red-500/10 text-red-400 border-red-500/30',
    refreshing: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
    pending: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
    polling: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
    authorized: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
    timeout: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  }
  return map[status] || 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [stats, setStats] = useState<{ providers: any; accounts: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [pendingFlow, setPendingFlow] = useState<{ flow_id: string; verification_uri: string; user_code: string } | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const [provs, statsData] = await Promise.all([listProviders(), getAdminStats()])
      setProviders(provs)
      setStats(statsData)
    } catch (e) {
      console.error('Failed to load admin data', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // Poll OAuth status while waiting for user to authorize
  useEffect(() => {
    if (!pendingFlow) return
    let cancelled = false
    let timer: any

    async function tick() {
      if (cancelled) return
      try {
        const status = await getOAuthStatus(pendingFlow.flow_id)
        if (!cancelled) {
          if (status.status === 'authorized' || status.status === 'failed' || status.status === 'timeout') {
            setPendingFlow(prev => prev ? { ...prev, status: status.status, error: status.error, result: status.result } : prev)
            clearTimeout(timer)
            setTimeout(() => { setPendingFlow(null); setShowAddForm(false); loadData() }, 2000)
          }
          // otherwise keep polling
        }
      } catch (e) { /* ignore transient poll errors */ }
      if (!cancelled) timer = setTimeout(tick, 3000)
    }

    tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [pendingFlow?.flow_id])

  const handleOAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    try {
      const result = await initiateOAuth(label)
      setNewLabel('')
      setShowAddForm(false)
      setPendingFlow({ flow_id: result.flow_id, verification_uri: result.verification_uri, user_code: result.user_code })
      await startOAuthPoll(result.flow_id)
    } catch (e) {
      console.error('OAuth initiate failed', e)
      alert('Failed to start OAuth flow. Check console for details.')
    }
  }

  const handleRefreshAll = async () => {
    setRefreshing(true)
    try { await refreshAllProviders(); await loadData() } catch (e) { alert('Refresh failed') } finally { setRefreshing(false) }
  }

  const handleRefreshOne = async (id: string) => {
    try { await refreshProvider(id); await loadData() } catch (e) { alert('Refresh failed') }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this provider? This cannot be undone.')) return
    await deleteProvider(id)
    await loadData()
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin — Providers</h1>
            <p className="text-zinc-500 mt-1">Connected Hermes accounts and token health</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleRefreshAll}
              disabled={refreshing}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 text-sm disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh All'}
            </button>
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="px-4 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-zinc-200"
            >
              + Add Hermes Account
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-2xl font-bold">{stats.providers.active}/{stats.providers.total}</div>
              <div className="text-xs text-zinc-500 mt-1">Active Providers</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-2xl font-bold">{stats.providers.total_requests}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Requests</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-2xl font-bold">{stats.accounts.active}/{stats.accounts.total}</div>
              <div className="text-xs text-zinc-500 mt-1">Active Accounts</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-2xl font-bold">{stats.providers.total_errors}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Errors</div>
            </div>
          </div>
        )}

        {/* OAuth Flow Modal */}
        {pendingFlow && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-6">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-sky-400">OAuth Authorization in Progress</h3>
                <p className="text-zinc-400 mt-2 text-sm">
                  Authorization code: <span className="font-mono text-white bg-white/10 px-2 py-0.5 rounded">{pendingFlow.user_code}</span>
                </p>
                <p className="text-zinc-400 mt-2 text-sm">
                  1. Open the verification page<br/>
                  2. Log in / authorize Hermes<br/>
                  3. We&apos;ll automatically poll and save the tokens.
                </p>
                <div className="flex gap-3 mt-4">
                  <a
                    href={pendingFlow.verification_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-black font-semibold text-sm hover:bg-sky-400"
                  >
                    Open Verification Page →
                  </a>
                </div>
              </div>
              {pendingFlow.status && (
                <span className={`px-3 py-1 rounded-full border text-xs ${statusClass(pendingFlow.status)}`}>
                  {pendingFlow.status}
                </span>
              )}
            </div>
            {pendingFlow.error && <p className="text-red-400 text-sm mt-3">Error: {pendingFlow.error}</p>}
          </div>
        )}

        {/* Add Account Form */}
        {showAddForm && !pendingFlow && (
          <form onSubmit={handleOAuth} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-lg font-semibold mb-4">Add New Hermes Account</h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Account label (e.g. hermes-1)"
                className="flex-1 bg-black border border-white/10 rounded-lg px-4 py-2 text-white placeholder:text-zinc-600 focus:border-white/20 outline-none"
              />
              <button
                type="submit"
                className="px-6 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-zinc-200"
              >
                Start OAuth
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              A device code flow will start. You&apos;ll get a link to log in with your Hermes/Nous account. Tokens are stored securely.
            </p>
          </form>
        )}

        {/* Providers Table */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-zinc-500">Loading providers…</div>
          ) : providers.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">No providers yet. Click <span className="text-white">+ Add Hermes Account</span> to start.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-zinc-500 text-xs uppercase">
                  <th className="p-4">Account</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Health</th>
                  <th className="p-4">Tokens</th>
                  <th className="p-4">Usage</th>
                  <th className="p-4">Last Used</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {providers.map(p => (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="p-4">
                      <div className="font-medium">{p.account_label}</div>
                      <div className="text-xs text-zinc-500 font-mono">{p.id.slice(0, 12)}…</div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full border text-xs ${statusClass(p.health_status)}`}>
                        {p.health_status}
                      </span>
                      {expiryLabel(p)}
                    </td>
                    <td className="p-4">
                      <div className="text-xs text-zinc-400">
                        {p.total_requests} reqs · {p.total_errors} errs · {p.in_flight}/{p.max_concurrent} live
                      </div>
                    </td>
                    <td className="p-4 text-xs font-mono text-zinc-500">
                      <div>access: {p.access_token_preview}</div>
                      <div>refresh: {p.refresh_token_preview}</div>
                    </td>
                    <td className="p-4 text-xs text-zinc-400">
                      errors: {p.total_requests ? ((p.total_errors / p.total_requests) * 100).toFixed(1) : '0'}%
                    </td>
                    <td className="p-4 text-xs text-zinc-400">{timeAgo(p.last_used_at)}</td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleRefreshOne(p.id)}
                          className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs hover:border-white/20"
                        >
                          Refresh
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400 hover:bg-red-500/20"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
