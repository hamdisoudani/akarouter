'use client'

import { useState, useEffect } from 'react'
import { type Provider, getOAuthStatus, listProviders } from '@/lib/adminApi'
import Link from 'next/link'

export default function AdminOAuthPage() {
  const [flowId, setFlowId] = useState('')
  const [flowStatus, setFlowStatus] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)

  const checkStatus = async (id: string) => {
    if (!id.trim()) return
    setLoading(true)
    try {
      const data = await getOAuthStatus(id.trim())
      setFlowStatus(data)
    } catch (e) {
      setFlowStatus({ ok: false, error: String(e) })
    } finally {
      setLoading(false)
    }
  }

  // watch for authorized/timed_out status and auto-refresh providers
  useEffect(() => {
    if (!flowStatus?.status) return
    if (!['authorized', 'failed', 'timeout'].includes(flowStatus.status)) return
    const t = setTimeout(async () => {
      setPolling(false)
      setFlowStatus(null)
      setFlowId('')
    }, 4000)
    return () => clearTimeout(t)
  }, [flowStatus?.status])

  const startPoll = async () => {
    if (!flowId.trim()) return
    setPolling(true)
    setFlowStatus({ status: 'polling_started' })
    // poll every 4s
    const timer = setInterval(async () => {
      if (!flowId.trim()) { clearInterval(timer); setPolling(false); return }
      try {
        const data = await getOAuthStatus(flowId.trim())
        setFlowStatus(data)
        if (['authorized', 'failed', 'timeout'].includes(data.status)) {
          clearInterval(timer)
          setPolling(false)
        }
      } catch { /* ignore transient errors */ }
    }, 4000)
    return () => clearInterval(timer)
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        {/* breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
          <Link href="/admin/providers" className="hover:text-white">Providers</Link>
          <span>/</span>
          <span className="text-white">OAuth Flow Status</span>
        </div>

        <h1 className="text-2xl font-bold mb-2">OAuth Authorization Status</h1>
        <p className="text-zinc-500 text-sm mb-6">
          Track active Hermes OAuth flows and paste a flow id to check its current state.
        </p>

        {/* Flow ID input */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <input
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            placeholder="Paste flow id (device code)"
            className="md:col-span-2 bg-black border border-white/10 rounded-lg px-4 py-2 text-sm font-mono text-white placeholder:text-zinc-600 focus:border-white/20 outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => checkStatus(flowId)}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:border-white/20"
            >
              Check Status
            </button>
            <button
              onClick={startPoll}
              disabled={polling}
              className="flex-1 px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50"
            >
              {polling ? 'Polling…' : 'Start Poll'}
            </button>
          </div>
        </div>

        {/* Status card */}
        {flowStatus && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Flow Status</h2>
              <span className={`px-2 py-0.5 rounded-full border text-xs ${flowStatus.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                {flowStatus.status || flowStatus.ok ? 'Active' : 'Error'}
              </span>
            </div>
            <div className="space-y-2 text-sm">
              {flowStatus.verification_uri && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Verification URI</span>
                  <a href={flowStatus.verification_uri} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline truncate max-w-[260px]">
                    {flowStatus.verification_uri}
                  </a>
                </div>
              )}
              {flowStatus.user_code && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">User Code</span>
                  <span className="font-mono">{flowStatus.user_code}</span>
                </div>
              )}
              {flowStatus.result && (
                <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="text-emerald-400 font-semibold mb-1">✓ Authorization successful</div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <div>Provider ID: {flowStatus.result.provider_id}</div>
                    <div>Label: {flowStatus.result.account_label}</div>
                    <div>Access: {flowStatus.result.access_token_preview}</div>
                    <div>Refresh: {flowStatus.result.refresh_token_preview}</div>
                    <div>Expires: {flowStatus.result.expires_at}</div>
                  </div>
                </div>
              )}
              {flowStatus.error && (
                <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-red-400">
                  Error: {flowStatus.error}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-8">
          <Link href="/admin/providers" className="text-sm text-zinc-500 hover:text-white">
            ← Back to providers
          </Link>
        </div>
      </div>
    </div>
  )
}
