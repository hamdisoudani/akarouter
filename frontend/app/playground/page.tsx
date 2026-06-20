'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import {
  getModels,
  getMyKeys,
  createKey,
  getUsage,
  getPointTransactions,
  chatCompletion,
  type ModelsResponse,
  type ApiKey,
  type PointTransaction,
} from '@/lib/api'
import { TopNav } from '@/components/TopNav'
import InteractionCaptcha from '@/components/InteractionCaptcha'
import {
  Send,
  Key,
  Sparkles,
  AlertTriangle,
  Loader2,
  Zap,
  Check,
  Copy,
  RefreshCw,
  Coins,
  ArrowRight,
} from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  points_cost?: number
  model?: string
  streaming?: boolean
  error?: string
}

const STORAGE_KEY = 'akarouter_playground_key'
const STORAGE_MODEL_KEY = 'akarouter_playground_model'
const STORAGE_MSGS_KEY = 'akarouter_playground_messages'

export default function PlaygroundPage() {
  const router = useRouter()
  const { user, token, usage, refetchUsage } = useApp()
  const [models, setModels] = useState<ModelsResponse | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>('akarouter-mini')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [creatingKey, setCreatingKey] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null)
  const [recentTx, setRecentTx] = useState<PointTransaction[]>([])
  const [refreshingBudget, setRefreshingBudget] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // Load persisted state
  useEffect(() => {
    if (typeof window === 'undefined') return
    const k = localStorage.getItem(STORAGE_KEY)
    if (k) setSelectedKey(k)
    const m = localStorage.getItem(STORAGE_MODEL_KEY)
    if (m) setSelectedModel(m)
    const saved = localStorage.getItem(STORAGE_MSGS_KEY)
    if (saved) {
      try { setMessages(JSON.parse(saved)) } catch {}
    }
  }, [])

  useEffect(() => {
    if (selectedKey && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, selectedKey)
    }
  }, [selectedKey])
  useEffect(() => {
    if (selectedModel && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_MODEL_KEY, selectedModel)
    }
  }, [selectedModel])
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Cap saved history at 20 messages so we don't blow storage
      localStorage.setItem(STORAGE_MSGS_KEY, JSON.stringify(messages.slice(-20)))
    }
  }, [messages])

  // Load models + keys on mount when authenticated
  useEffect(() => {
    if (!user || !token) return
    if (user.status === 'pending') return
    const init = async () => {
      try {
        const [m, k] = await Promise.allSettled([getModels(), getMyKeys(token)])
        if (m.status === 'fulfilled') setModels(m.value)
        if (k.status === 'fulfilled') {
          setKeys(k.value.keys || [])
          // Auto-select first active key
          const firstActive = (k.value.keys || []).find(x => x.is_active)
          if (firstActive && !selectedKey) setSelectedKey(firstActive.id)
        }
      } catch (err) {
        console.warn('Playground init failed:', err)
      }
    }
    init()
  }, [user, token])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const refreshBudget = useCallback(async () => {
    if (!token) return
    setRefreshingBudget(true)
    try {
      await Promise.allSettled([refetchUsage(), (async () => {
        const data = await getPointTransactions(token, { limit: 5 })
        setRecentTx(data.transactions)
      })()])
    } finally {
      setRefreshingBudget(false)
    }
  }, [token, refetchUsage])

  const handleCreateKey = async () => {
    if (!token) return
    setCreatingKey(true)
    setError(null)
    try {
      const res = await createKey(token, 'playground', recaptchaToken || undefined)
      setNewKey(res.api_key)
      // Refresh keys list
      const k = await getMyKeys(token)
      setKeys(k.keys || [])
      const created = (k.keys || []).find(x => x.key_prefix && res.api_key.startsWith(x.key_prefix))
      if (created) setSelectedKey(created.id)
    } catch (e: any) {
      setError(e?.message || 'Failed to create key')
    } finally {
      setCreatingKey(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || !selectedModel || sending) return
    if (!selectedKey) {
      setError('Create an API key first to use the playground.')
      return
    }
    const userMsg: ChatMessage = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)
    setError(null)

    // Build placeholder for assistant response
    const assistantIdx = newMessages.length
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    try {
      // Find the key value (we need the raw key for the chat call)
      // We need to track keys with their value — if user just created it, we have it in state
      let apiKeyValue = newKey
      // If using an existing key, we can't recover the raw value client-side
      // Workaround: if selectedKey was just created, use newKey; otherwise prompt
      if (!apiKeyValue) {
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx ? { ...m, streaming: false, error: 'For security, only freshly created keys are usable in the playground. Create a new key to start chatting.' } : m
        ))
        setSending(false)
        return
      }

      // Get model's points_cost
      const modelInfo = models?.data?.find(m => m.id === selectedModel)
      const pointsCost = modelInfo?.points_cost ?? 5

      const res = await chatCompletion({
        model: selectedModel,
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
      })

      const reply = res.choices?.[0]?.message?.content || '(empty response)'
      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx
          ? { ...m, content: reply, streaming: false, points_cost: pointsCost, model: selectedModel }
          : m
      ))
      // Refresh budget after a successful call
      refreshBudget()
    } catch (e: any) {
      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx
          ? { ...m, streaming: false, error: e?.message || 'Chat failed' }
          : m
      ))
      // Even on failure, the server may have charged + refunded. Refresh anyway.
      refreshBudget()
    } finally {
      setSending(false)
    }
  }

  const copyKey = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  // Auth gating
  if (!user) {
    return (
      <main className="min-h-screen bg-[#09090b] text-zinc-300">
        <TopNav />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <Key className="w-10 h-10 text-amber-500 mx-auto mb-4" />
          <h1 className="font-mono text-2xl text-white uppercase tracking-wider mb-3">PLAYGROUND_LOCKED</h1>
          <p className="text-sm text-zinc-500 mb-6">Sign in to use the AkaRouter playground. You&apos;ll get a free API key on the spot.</p>
          <button
            onClick={() => router.push('/auth/login?next=/playground')}
            className="font-mono text-xs uppercase tracking-wider bg-amber-500 text-black px-5 py-2.5 hover:bg-amber-400 transition-colors"
          >
            Sign in to continue →
          </button>
        </div>
      </main>
    )
  }
  if (user.status === 'pending') {
    return (
      <main className="min-h-screen bg-[#09090b] text-zinc-300">
        <TopNav />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <h1 className="font-mono text-xl uppercase tracking-wider mb-3">ACCOUNT_PENDING_ACTIVATION</h1>
          <p className="text-sm text-zinc-500">Your account is being activated. Refresh in a few seconds.</p>
        </div>
      </main>
    )
  }

  const selectedModelInfo = models?.data?.find(m => m.id === selectedModel)
  const monthlyRemaining = usage?.monthly_points_remaining ?? 0
  const monthlyLimit = usage?.monthly_points_limit ?? 0
  const freeRemaining = usage?.daily_free_requests_remaining ?? 0
  const pct = monthlyLimit > 0 ? Math.min(100, (monthlyRemaining / monthlyLimit) * 100) : 0
  const isFreeModel = (selectedModelInfo?.points_cost ?? 5) <= 1

  return (
    <main className="min-h-screen bg-[#09090b] text-zinc-300">
      <TopNav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h1 className="font-mono text-2xl text-white uppercase tracking-[0.2em]">PLAYGROUND</h1>
            </div>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
              Test every model on your real plan. No fake demo keys. No credit card.
            </p>
          </div>
          <Link
            href="/dashboard/usage"
            className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-amber-400 transition-colors"
          >
            Full usage ledger →
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          {/* Main chat area */}
          <div className="bg-[#0e0e10] border border-zinc-900 flex flex-col h-[640px]">
            {/* Model selector bar */}
            <div className="border-b border-zinc-900 p-3 flex items-center gap-3 flex-wrap">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">MODEL</span>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={!models}
                className="bg-[#050507] border border-zinc-900 text-zinc-200 font-mono text-xs px-3 py-1.5 focus:outline-none focus:border-amber-500"
              >
                {!models && <option>Loading...</option>}
                {models?.data?.filter(m => m.is_active).map(m => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} · {m.points_cost ?? 5}pt{m.points_cost === 1 ? ' (FREE)' : ''}
                  </option>
                ))}
              </select>
              {selectedModelInfo && (
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase text-zinc-500">
                  <span className="px-2 py-0.5 border border-zinc-900 text-zinc-400">{selectedModelInfo.context_length?.toLocaleString()} ctx</span>
                  <span className="px-2 py-0.5 border border-zinc-900 text-zinc-400">{selectedModelInfo.capabilities?.join('+') || 'text'}</span>
                  {isFreeModel && <span className="px-2 py-0.5 border border-amber-500/40 text-amber-400">DAILY CAP: {freeRemaining}</span>}
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <Zap className="w-8 h-8 text-amber-500/40 mb-3" />
                  <p className="font-mono text-[11px] text-zinc-600 uppercase tracking-wider">
                    Pick a model and start talking.
                  </p>
                  <p className="font-mono text-[10px] text-zinc-700 uppercase tracking-wider mt-1 max-w-md">
                    Costs are debited from your point balance per call. Refunds are automatic on upstream failure.
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] ${
                    m.role === 'user'
                      ? 'bg-amber-500/10 border border-amber-500/30 text-zinc-100'
                      : m.error
                        ? 'bg-red-500/5 border border-red-500/30 text-red-300'
                        : 'bg-[#050507] border border-zinc-900 text-zinc-200'
                  } px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words`}>
                    {m.streaming && !m.content && (
                      <div className="flex items-center gap-2 text-zinc-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-[10px] uppercase tracking-wider">thinking...</span>
                      </div>
                    )}
                    {m.content}
                    {m.error && (
                      <div className="mt-2 text-[10px] uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" /> {m.error}
                      </div>
                    )}
                    {!m.streaming && m.points_cost !== undefined && m.role === 'assistant' && (
                      <div className="mt-2 pt-2 border-t border-zinc-900 flex items-center gap-3 text-[9px] uppercase tracking-wider text-zinc-600">
                        <span>−{m.points_cost} PT</span>
                        <span>·</span>
                        <span>{m.model}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Error bar */}
            {error && (
              <div className="border-t border-red-500/30 bg-red-500/5 px-4 py-2 text-[11px] font-mono text-red-300 flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> {error}
              </div>
            )}

            {/* Input bar */}
            <div className="border-t border-zinc-900 p-3 flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
                disabled={sending || !selectedKey}
                rows={2}
                className="flex-1 bg-[#050507] border border-zinc-900 text-zinc-200 font-mono text-xs px-3 py-2 focus:outline-none focus:border-amber-500 resize-none placeholder:text-zinc-700"
              />
              <button
                onClick={handleSend}
                disabled={sending || !input.trim() || !selectedKey}
                className="bg-amber-500 text-black font-mono text-xs uppercase tracking-wider px-4 hover:bg-amber-400 disabled:bg-zinc-900 disabled:text-zinc-600 transition-colors flex items-center gap-1.5"
              >
                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                SEND
              </button>
            </div>
          </div>

          {/* Right rail: budget + key */}
          <div className="space-y-4">
            {/* Budget meter */}
            <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Coins className="w-3.5 h-3.5 text-amber-500" />
                  <h3 className="font-mono text-[11px] text-white uppercase tracking-[0.2em] font-bold">BUDGET</h3>
                </div>
                <button
                  onClick={refreshBudget}
                  disabled={refreshingBudget}
                  className="text-zinc-600 hover:text-amber-400 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingBudget ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Main: monthly points */}
              <div className="space-y-1.5">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider">
                  <span className="text-zinc-500">MONTHLY POINTS</span>
                  <span className="text-zinc-400">{monthlyRemaining.toLocaleString()} / {monthlyLimit.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-zinc-950 border border-zinc-900 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {usage?.points_reset_at && (
                  <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
                    Resets {new Date(usage.points_reset_at).toLocaleDateString()}
                  </p>
                )}
              </div>

              {/* Free daily cap */}
              <div className="space-y-1.5 pt-2 border-t border-zinc-900">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider">
                  <span className="text-zinc-500">FREE-MODEL DAILY</span>
                  <span className={freeRemaining > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {freeRemaining} LEFT
                  </span>
                </div>
                <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
                  1pt models only · Rolls every 24h
                </p>
              </div>

              {monthlyRemaining < (selectedModelInfo?.points_cost ?? 5) && (
                <div className="border border-red-500/30 bg-red-500/5 px-3 py-2 text-[10px] font-mono text-red-300 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  Insufficient for {selectedModelInfo?.display_name}
                </div>
              )}
            </div>

            {/* API key */}
            <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-amber-500" />
                <h3 className="font-mono text-[11px] text-white uppercase tracking-[0.2em] font-bold">API KEY</h3>
              </div>

              {newKey ? (
                <div className="space-y-2">
                  <div className="bg-amber-500/5 border border-amber-500/30 px-3 py-2 text-[10px] font-mono text-amber-300 uppercase tracking-wider">
                    Save this now — it won&apos;t be shown again
                  </div>
                  <div className="bg-[#050507] border border-zinc-900 px-3 py-2 font-mono text-[10px] text-zinc-200 break-all flex items-start gap-2">
                    <span className="flex-1">{newKey}</span>
                    <button onClick={() => copyKey(newKey)} className="text-zinc-500 hover:text-amber-400 flex-shrink-0" title="Copy">
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              ) : keys.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                    No keys yet. Create one to start chatting.
                  </p>
                  {!createKeyOpen ? (
                    <button
                      onClick={() => setCreateKeyOpen(true)}
                      className="w-full bg-amber-500 text-black font-mono text-[10px] uppercase tracking-wider py-2 hover:bg-amber-400 transition-colors"
                    >
                      + Create API key
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <InteractionCaptcha onVerified={t => setRecaptchaToken(t)} />
                      <div className="flex gap-2">
                        <button
                          onClick={handleCreateKey}
                          disabled={creatingKey}
                          className="flex-1 bg-amber-500 text-black font-mono text-[10px] uppercase tracking-wider py-2 hover:bg-amber-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                        >
                          {creatingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
                        </button>
                        <button
                          onClick={() => setCreateKeyOpen(false)}
                          className="px-3 border border-zinc-900 text-zinc-500 hover:text-zinc-300 font-mono text-[10px] uppercase"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                    Use a key you can see the value of. For security, only freshly-created keys work here.
                  </p>
                  <select
                    value={selectedKey}
                    onChange={e => setSelectedKey(e.target.value)}
                    className="w-full bg-[#050507] border border-zinc-900 text-zinc-200 font-mono text-[10px] px-2 py-1.5 focus:outline-none focus:border-amber-500"
                  >
                    {keys.filter(k => k.is_active).map(k => (
                      <option key={k.id} value={k.id}>{k.key_name} · {k.key_prefix}…</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { setNewKey(null); setCreateKeyOpen(true); setSelectedKey('') }}
                    className="w-full text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-amber-400 border border-zinc-900 hover:border-amber-500/30 py-1.5 transition-colors"
                  >
                    + Create new key
                  </button>
                </div>
              )}
            </div>

            {/* Recent transactions */}
            {recentTx.length > 0 && (
              <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-[11px] text-white uppercase tracking-[0.2em] font-bold">RECENT ACTIVITY</h3>
                  <Link href="/dashboard/usage" className="text-[9px] font-mono uppercase text-zinc-600 hover:text-amber-400 tracking-wider">
                    View all →
                  </Link>
                </div>
                <div className="space-y-1">
                  {recentTx.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between text-[10px] font-mono">
                      <div className="min-w-0 flex-1">
                        <div className="text-zinc-300 truncate">
                          {tx.kind === 'charge' ? (tx.model_alias || 'call') : tx.reason || tx.kind}
                        </div>
                        <div className="text-[8px] text-zinc-600 uppercase tracking-wider">
                          {new Date(tx.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <span className={
                        tx.kind === 'charge' ? 'text-red-400 tabular-nums' :
                        tx.kind === 'refund' ? 'text-emerald-400 tabular-nums' :
                        'text-amber-400 tabular-nums'
                      }>
                        {tx.kind === 'charge' ? '−' : '+'}{tx.points}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Link
              href="/dashboard/upgrade"
              className="block bg-amber-500/5 border border-amber-500/30 px-4 py-3 text-center hover:bg-amber-500/10 transition-colors group"
            >
              <div className="font-mono text-[10px] text-amber-300 uppercase tracking-wider flex items-center justify-center gap-1.5">
                Need more points? Upgrade <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
