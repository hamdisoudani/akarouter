'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import { createCheckoutSession, getPlans, getModels, type PlanPreset, getPointTransactions, type PointTransaction } from '@/lib/api'
import {
  LogOut
} from 'lucide-react'


import { DashboardSidebar } from '@/components/DashboardSidebar'
export default function UsagePage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut, refetchUsage } = useApp()

  const [secondsUntilPointsReset, setSecondsUntilPointsReset] = useState<number | null>(null)

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [dbPlans, setDbPlans] = useState<PlanPreset[]>([])

  // Point transaction history
  const [pointTx, setPointTx] = useState<PointTransaction[]>([])
  const [pointTxSummary, setPointTxSummary] = useState<{ spent: number; refunded: number; granted: number }>({ spent: 0, refunded: 0, granted: 0 })
  const [pointTxLoading, setPointTxLoading] = useState(false)
  const [pointTxKind, setPointTxKind] = useState<'all' | 'charge' | 'refund' | 'grant'>('all')
  const [pointTxTotal, setPointTxTotal] = useState(0)

  const refetchPointTx = async () => {
    if (!token) return
    setPointTxLoading(true)
    try {
      const opts = pointTxKind === 'all' ? { limit: 50 } : { limit: 50, kind: pointTxKind as any }
      const data = await getPointTransactions(token, opts)
      setPointTx(data.transactions)
      setPointTxSummary(data.summary)
      setPointTxTotal(data.total)
    } catch (err) {
      console.warn('Failed to fetch point transactions:', err)
    } finally {
      setPointTxLoading(false)
    }
  }

  useEffect(() => {
    if (token && usage) {
      refetchPointTx()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pointTxKind])

  // Alias → display name lookup — loaded via getModels() which now uses
  // a 60s client-side TTL cache (2026-06-21) so multiple pages on the
  // same tab share one fetch. Falls back to alias itself if the model
  // isn't in the catalog.
  const [aliasToDisplay, setAliasToDisplay] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    getModels()
      .then(data => {
        if (cancelled || !data?.data) return
        const map: Record<string, string> = {}
        for (const m of data.data) {
          // ModelsResponse items have `id` (the alias used in chat
          // calls) and `slug` (URL-safe display slug). Map both so
          // point-transaction rows can be enriched regardless of
          // which identifier the backend persisted.
          if (m.id) map[m.id] = m.display_name || m.id
          if (m.slug && m.slug !== m.id) map[m.slug] = m.display_name || m.slug
        }
        setAliasToDisplay(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const formatPointDelta = (kind: string, points: number) => {
    if (kind === 'charge') return `-${points}`
    if (kind === 'refund') return `+${points}`
    if (kind === 'grant') return `+${points}`
    return `${points}`
  }

  const kindColor = (kind: string) => {
    if (kind === 'charge') return 'text-red-400'
    if (kind === 'refund') return 'text-emerald-400'
    if (kind === 'grant') return 'text-amber-400'
    return 'text-muted-foreground'
  }

  const kindLabel = (kind: string) => {
    if (kind === 'charge') return 'CALL'
    if (kind === 'refund') return 'REFUND'
    if (kind === 'grant') return 'GRANT'
    return kind.toUpperCase()
  }

  useEffect(() => {
    if (usage) {
      setSecondsUntilPointsReset(usage.seconds_until_points_reset ?? null)
    }
  }, [usage])

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilPointsReset(prev => (prev !== null && prev > 0 ? prev - 1 : prev))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const formatRemainingTime = (seconds: number | null | undefined): string => {
    if (seconds === null || seconds === undefined || seconds <= 0) return '0s'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) {
      const remainingSecs = seconds % 60
      return `${minutes}m ${remainingSecs}s`
    }
    const hours = Math.floor(minutes / 60)
    const remainingMins = minutes % 60
    if (hours < 24) {
      return `${hours}h ${remainingMins}m`
    }
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return `${days}d ${remainingHours}h`
  }

  const handleCheckout = async (tier: string) => {
    if (!token) return
    setCheckoutLoading(tier)
    setCheckoutError(null)
    try {
      const redirectUrl = window.location.origin + '/dashboard/usage'
      const data = await createCheckoutSession(token, tier, redirectUrl)
      if (data && data.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch (err: any) {
      console.error(err)
      setCheckoutError(err.message || 'Failed to initialize checkout')
      setCheckoutLoading(null)
    }
  }

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await getPlans()
        if (res && res.plans) {
          const filtered = res.plans.filter(p => p.tier !== 'free' && p.tier !== 'enterprise')
          setDbPlans(filtered)
        }
      } catch (err) {
        console.error('Failed to load plans from backend:', err)
      }
    }
    loadPlans()
  }, [])

  const getDisplayPlans = () => {
    const fallbackPlans = [
      {
        name: 'Starter Plan',
        key: 'starter',
        price: '$4.99',
        billing: 'monthly',
        desc: 'Essential API limits for developers starting out.',
        badge: null,
      },
      {
        name: 'Pro Plan',
        key: 'pro',
        price: '$19.99',
        billing: 'monthly',
        desc: 'Perfect for production apps and agent deployments.',
        badge: 'Most Popular',
      },
      {
        name: 'Ultra Plan',
        key: 'ultra',
        price: '$99.99',
        billing: 'monthly',
        desc: 'Ultimate capacity for high-scale agent networks.',
        badge: 'Elite Performance',
      }
    ]

    if (dbPlans.length === 0) {
      return fallbackPlans
    }

    return dbPlans.map(plan => {
      const matchingFallback = fallbackPlans.find(fp => fp.key === plan.tier)
      return {
        name: matchingFallback?.name || `${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan`,
        key: plan.tier,
        price: matchingFallback?.price || plan.price || '$0.00',
        billing: matchingFallback?.billing || 'monthly',
        desc: matchingFallback?.desc || 'Custom limits tier.',
        badge: matchingFallback?.badge || null,
      }
    })
  }

  useEffect(() => {
    if (!authLoading) {
      if (!token) {
        router.push('/auth/login')
        return
      }
      if (user?.status === 'pending') {
        router.push('/dashboard')
        return
      }
      
      // Load latest usage data in the background to ensure it is fresh
      refetchUsage()
    }
  }, [authLoading, token, user, router, refetchUsage])

  // Removed fullscreen loading block to show proper page shell first

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col antialiased selection:bg-[#ef4444]/30 selection:text-foreground">
      
      {/* SideNavBar */}

      <DashboardSidebar />


      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 md:w-[calc(100%-16rem)] w-full relative">
        




        {/* Canvas */}
        <main className="flex-1 p-0 grid-bg relative">
          
          {usage?.tier === 'free' && (
            <div className="bg-[#ef4444]/15 border-b border-[#ef4444]/35 text-[#ef4444] p-4 font-mono text-xs uppercase flex items-center justify-center gap-3 red-glow animate-pulse font-bold">
              <span className="w-2 h-2 bg-[#ef4444] rounded-full status-pulse red-glow" />
              <span>[BILLING_ALERT]: SUBSCRIPTION REQUIRED. GATEWAY ACCESS AND AGENT PROVISIONING ARE RESTRICTED. CHOOSE A PLAN BELOW TO ACTIVATE YOUR SERVICE.</span>
            </div>
          )}

          {usage?.is_trialing && (
            <div className="bg-[#ef4444]/10 border-b border-[#ef4444]/25 text-[#ef4444] p-4 font-mono text-xs uppercase flex items-center justify-center gap-3 font-bold">
              <span className="w-2 h-2 bg-[#ef4444] rounded-full status-pulse red-glow" />
              <span>[BILLING_NOTICE]: FREE TRIAL ACTIVE. YOU ARE CURRENTLY TRIALING THE PRO PLAN. SUBSCRIBED VIA WHOP.</span>
            </div>
          )}

          {usage?.gateway_enabled === false && (
            <div className="bg-[#ef4444]/10 border-b border-[#ef4444] p-4 text-center font-mono text-xs text-[#ef4444] tracking-wider uppercase animate-pulse">
              [WARNING_SYSTEM_MAINTENANCE_API_GATEWAY_OFFLINE_BY_ADMINISTRATOR]
            </div>
          )}

          <div className="p-6 space-y-6">
            
            {/* KPI Row */}
            <div className="grid grid-cols-12 gap-0 tech-border bg-card crosshair-corners">
              <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 bg-card">
                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-border flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-muted border-b border-l border-border font-mono text-[8px] text-muted-foreground/70">CHN_01</div>
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span> SYSTEM TIER
                  </span>
                  <div className="font-mono text-2xl text-foreground font-bold tracking-wider uppercase">
                    {usage ? usage.tier : <span className="text-muted-foreground/60 animate-pulse">[LOAD_VAULT...]</span>}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/70 mt-1 uppercase tracking-tighter font-mono">
                    {usage ? `RPM LIMIT: ${usage.rpm_limit ?? 60}` : '[RPM_LIMIT: ...]'}
                  </span>
                </div>

                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-border flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-muted border-b border-l border-border font-mono text-[8px] text-muted-foreground/70">CHN_02</div>
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-muted"></span> MONTHLY QUOTA
                  </span>
                  <div className="font-mono text-2xl text-foreground font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.progress_percentage_month ?? 0).toFixed(1)}<span className="text-muted-foreground/60 text-xs ml-1">%</span></>
                    ) : (
                      <span className="text-muted-foreground/60 animate-pulse">[LOAD_TX...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/60 mt-1 uppercase tracking-tighter font-mono">
                    {usage ? `CONSUMED` : '[LIMIT: ...]'}
                  </span>
                </div>

                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-border flex flex-col justify-center relative overflow-hidden bg-[#ef4444]/5">
                  <div className="absolute right-0 top-0 p-1 bg-[#ef4444]/20 border-b border-l border-[#ef4444]/30 font-mono text-[8px] text-[#ef4444]">CHN_03</div>
                  <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span> CONSUMED TOKENS
                  </span>
                  <div className="font-mono text-2xl text-[#ef4444] font-bold tracking-tight red-glow-text">
                    {usage ? (
                      <>{((usage.consumed_tokens_input ?? 0) + (usage.consumed_tokens_output ?? 0)).toLocaleString()}<span className="text-[12px] ml-1">TOKENS</span></>
                    ) : (
                      <span className="text-[#ef4444]/65 animate-pulse">[LOAD_SYS...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-[#ef4444] mt-1 uppercase tracking-wider font-bold">
                    {usage ? `IN: ${(usage.consumed_tokens_input ?? 0).toLocaleString()} | OUT: ${(usage.consumed_tokens_output ?? 0).toLocaleString()}` : 'ACTIVE PERIOD'}
                  </span>
                </div>

                <div className="p-5 flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-muted border-b border-l border-border font-mono text-[8px] text-muted-foreground/70">CHN_04</div>
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-muted"></span> ALL-TIME COUNTER
                  </span>
                  <div className="font-mono text-2xl text-foreground font-bold tracking-tight">
                    {usage ? (
                      <>{usage.total_requests.toLocaleString()}<span className="text-muted-foreground/60 text-xs ml-1">REQ</span></>
                    ) : (
                      <span className="text-muted-foreground/60 animate-pulse">[LOAD_BUF...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/70 mt-1 uppercase tracking-widest font-mono">TOTAL_LOGGED_TX</span>
                </div>
              </div>
            </div>

            {/* Points meter (point-based pricing) */}
            <div className="bg-card border border-amber-500/30 p-6 crosshair-corners space-y-4">
              <div className="space-y-1">
                <h2 className="font-mono text-xs text-amber-400 flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                  <div className="w-[3px] h-3 bg-amber-500 red-glow"></div>
                  POINT_BALANCE
                </h2>
                <p className="text-[10px] font-mono text-muted-foreground/80 uppercase">Every model call costs points. Free models (1pt) are capped daily. Resets monthly.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Remaining */}
                <div className="bg-card/80 border border-amber-500/20 p-4 space-y-2">
                  <span className="font-mono text-[9px] text-amber-400 uppercase tracking-widest">REMAINING</span>
                  <div className="font-mono text-3xl text-amber-300 font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.monthly_points_remaining ?? 0).toLocaleString()}<span className="text-amber-700 text-sm ml-1">PTS</span></>
                    ) : (
                      <span className="text-amber-700 animate-pulse">[—]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/70 uppercase">
                    {usage?.points_reset_at ? `RESET ${new Date(usage.points_reset_at).toLocaleDateString()}` : 'THIS MONTH'}
                  </span>
                </div>

                {/* Monthly allowance */}
                <div className="bg-card/80 border border-border p-4 space-y-2">
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest">MONTHLY ALLOWANCE</span>
                  <div className="font-mono text-3xl text-foreground font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.monthly_points_limit ?? 0).toLocaleString()}<span className="text-muted-foreground/60 text-sm ml-1">PTS</span></>
                    ) : (
                      <span className="text-muted-foreground/60 animate-pulse">[—]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/70 uppercase">PLAN CAP</span>
                </div>

                {/* Daily free cap */}
                <div className="bg-card/80 border border-border p-4 space-y-2">
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest">DAILY FREE REQ</span>
                  <div className="font-mono text-3xl text-foreground font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.daily_free_requests_remaining ?? 0).toLocaleString()}<span className="text-muted-foreground/60 text-sm ml-1">LEFT</span></>
                    ) : (
                      <span className="text-muted-foreground/60 animate-pulse">[—]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/70 uppercase">
                    {usage?.daily_free_requests_reset_at ? `RESET ${new Date(usage.daily_free_requests_reset_at).toLocaleDateString()}` : 'ROLLS DAILY'}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="bg-card/80 border border-border p-4 space-y-2 flex flex-col justify-between">
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest">CONSUMED</span>
                  {(() => {
                    const remaining = usage?.monthly_points_remaining ?? 0
                    const limit = usage?.monthly_points_limit ?? 0
                    const pct = limit > 0 ? Math.min(100, Math.round(((limit - remaining) / limit) * 100)) : 0
                    return (
                      <>
                        <div className="font-mono text-3xl text-foreground font-bold tracking-tight">
                          {limit > 0 ? <>{pct}<span className="text-muted-foreground/60 text-sm ml-1">%</span></> : <span className="text-muted-foreground/60">N/A</span>}
                        </div>
                        <div className="w-full h-2 bg-muted/40 border border-border overflow-hidden">
                          <div
                            className="h-full bg-amber-500 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* Point transaction history */}
            <div className="bg-card border border-border p-6 crosshair-corners space-y-4">
              <div className="space-y-1">
                <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                  <div className="w-[3px] h-3 bg-amber-500" style={{ boxShadow: '0 0 8px rgba(245,158,11,0.6)' }}></div>
                  POINT_MOVEMENT_LEDGER
                </h2>
                <p className="text-[10px] font-mono text-muted-foreground/80 uppercase">Every charge, refund, and monthly grant. Most recent first.</p>
              </div>

              {/* Summary strip */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-card/80 border border-border py-2">
                  <div className="font-mono text-base text-red-400 font-bold">{pointTxSummary.spent.toLocaleString()}</div>
                  <div className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-wider">SPENT (SHOWN)</div>
                </div>
                <div className="bg-card/80 border border-border py-2">
                  <div className="font-mono text-base text-emerald-400 font-bold">{pointTxSummary.refunded.toLocaleString()}</div>
                  <div className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-wider">REFUNDED</div>
                </div>
                <div className="bg-card/80 border border-border py-2">
                  <div className="font-mono text-base text-amber-400 font-bold">{pointTxSummary.granted.toLocaleString()}</div>
                  <div className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-wider">GRANTED</div>
                </div>
              </div>

              {/* Filter */}
              <div className="flex items-center gap-1 text-[10px] font-mono uppercase">
                {(['all', 'charge', 'refund', 'grant'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setPointTxKind(k)}
                    className={`px-2.5 py-1 border tracking-wider transition-colors ${
                      pointTxKind === k
                        ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                        : 'border-border text-muted-foreground/80 hover:text-foreground/80 hover:border-border'
                    }`}
                  >
                    {k === 'all' ? 'ALL' : kindLabel(k)}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  onClick={refetchPointTx}
                  className="px-2.5 py-1 border border-border text-muted-foreground/80 hover:text-amber-400 hover:border-amber-500/40 tracking-wider"
                  title="Refresh"
                >
                  {pointTxLoading ? '...' : 'REFRESH'}
                </button>
              </div>

              {/* Table */}
              {pointTxLoading && pointTx.length === 0 ? (
                <div className="font-mono text-[10px] text-muted-foreground/80 text-center py-6 uppercase animate-pulse">LOADING LEDGER...</div>
              ) : pointTx.length === 0 ? (
                <div className="font-mono text-[10px] text-muted-foreground/80 text-center py-6 uppercase border border-dashed border-border">
                  NO {pointTxKind === 'all' ? '' : pointTxKind.toUpperCase() + ' '}TRANSACTIONS YET
                </div>
              ) : (
                <div className="border border-border divide-y divide-zinc-900 max-h-[400px] overflow-y-auto">
                  {pointTx.map(tx => {
                    const modelLabel = tx.model_alias ? (aliasToDisplay[tx.model_alias] || tx.model_alias) : null
                    return (
                      <div key={tx.id} className="grid grid-cols-[80px_1fr_auto_auto] gap-3 items-center px-3 py-2 hover:bg-muted/40/50 transition-colors font-mono text-[11px]">
                        <span className={`font-bold tracking-wider ${kindColor(tx.kind)}`}>{kindLabel(tx.kind)}</span>
                        <div className="min-w-0">
                          <div className="text-foreground/80 truncate">
                            {tx.reason || (modelLabel ? `Call: ${modelLabel}` : '—')}
                          </div>
                          <div className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                            {new Date(tx.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {tx.created_by && tx.created_by !== 'system' && <span className="ml-2">· {tx.created_by}</span>}
                          </div>
                        </div>
                        <span className={`font-bold tabular-nums ${kindColor(tx.kind)}`}>
                          {formatPointDelta(tx.kind, tx.points)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/80 tabular-nums whitespace-nowrap">
                          BAL: {tx.balance_after.toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex justify-between text-[9px] font-mono text-muted-foreground/70 uppercase tracking-wider pt-1">
                <span>SHOWING {pointTx.length} OF {pointTxTotal.toLocaleString()}</span>
                {pointTxTotal > pointTx.length && (
                  <span className="text-muted-foreground/80">PAGINATION COMING SOON</span>
                )}
              </div>
            </div>

            {/* Sliding budgets card layout */}
            <div className="bg-card border border-border p-6 crosshair-corners space-y-6">
              <div className="space-y-1">
                <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                  <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                  FIXED_CYCLE_WINDOW_TELEMETRY
                </h2>
                <p className="text-[10px] font-mono text-muted-foreground/80 uppercase">Real-time fixed cycle token budgets reset automatically on system grids.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Monthly Points budget (the only budget that matters) */}
                <div className="bg-card/80 border border-border p-5 space-y-4 md:col-span-2">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-muted-foreground font-bold uppercase tracking-wider">Monthly Points Budget</span>
                    <span className="text-[#ef4444] font-bold">
                      {usage ? `${(usage.points_pct_used ?? 0).toFixed(1)}%` : <span className="animate-pulse">0.0%</span>}
                    </span>
                  </div>

                  {/* Bar progress */}
                  <div className="w-full h-2.5 bg-muted/40 border border-border overflow-hidden">
                    <div
                      className={`h-full bg-[#ef4444] red-glow transition-all duration-500 ${!usage ? 'animate-pulse bg-muted' : ''}`}
                      style={{ width: `${usage ? (usage.points_pct_used ?? 0) : 0}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground/80 uppercase">
                    <span>
                      {usage ? `${(usage.monthly_points_remaining ?? 0).toLocaleString()} OF ${(usage.monthly_points_limit ?? 0).toLocaleString()} POINTS LEFT` : 'POINTS LEFT'}
                    </span>
                    <span>
                      {usage ? `RPM: ${usage.rpm_limit ?? 0}` : 'RPM'}
                    </span>
                  </div>

                  {usage && (secondsUntilPointsReset !== null && secondsUntilPointsReset > 0) ? (
                    <div className="border-t border-border pt-3 flex justify-between items-center text-[9px] font-mono">
                      <span className="text-muted-foreground/80 uppercase tracking-wide">[TIME_UNTIL_RESET]</span>
                      <span className="text-[#ef4444] font-bold tracking-wider">{formatRemainingTime(secondsUntilPointsReset)}</span>
                    </div>
                  ) : (
                    usage && (
                      <div className="border-t border-border pt-3 flex justify-between items-center text-[9px] font-mono">
                        <span className="text-muted-foreground/60 uppercase tracking-wide">[STATUS]</span>
                        <span className="text-emerald-500 font-bold uppercase tracking-widest">[POINTS_AVAILABLE]</span>
                      </div>
                    )
                  )}
                </div>

              </div>

              {/* Token Accumulations breakdown */}
              <div className="border-t border-border pt-6 space-y-4">
                <div className="space-y-1">
                  <h3 className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider font-bold">ACTIVE_PERIOD_TOKEN_ACCUMULATIONS</h3>
                  <p className="text-[9px] text-muted-foreground/70 font-mono uppercase">Raw token telemetry counts accumulated since the last budget reset.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-card/80 border border-border p-5 flex flex-col justify-center">
                    <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-wider">Input Tokens Count</span>
                    <span className="font-mono text-xl text-foreground font-bold tracking-wider mt-1">
                      {usage ? (usage.consumed_tokens_input ?? 0).toLocaleString() : <span className="text-muted-foreground/60 animate-pulse">[LOAD_TOKENS...]</span>}
                      {usage && <span className="text-muted-foreground/60 text-[11px] ml-1.5">TOKENS</span>}
                    </span>
                  </div>

                  <div className="bg-card/80 border border-border p-5 flex flex-col justify-center">
                    <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-wider">Output Tokens Count</span>
                    <span className="font-mono text-xl text-foreground font-bold tracking-wider mt-1">
                      {usage ? (usage.consumed_tokens_output ?? 0).toLocaleString() : <span className="text-muted-foreground/60 animate-pulse">[LOAD_TOKENS...]</span>}
                      {usage && <span className="text-muted-foreground/60 text-[11px] ml-1.5">TOKENS</span>}
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {usage?.tier === 'free' && (
              <div className="bg-[#ef4444]/10 border border-[#ef4444] p-5 font-mono text-xs text-[#ef4444] tracking-wider uppercase animate-pulse flex flex-col gap-2">
                <div>[WARNING: ACCOUNT_INACTIVE_FREE_TIER_ENFORCES_0_LIMITS]</div>
                <div className="text-[10px] text-muted-foreground/80 lowercase font-normal">[API completions are currently disabled. Please select a billing profile below to activate your account.]</div>
              </div>
            )}

            {/* Subscription Plans Section */}
            <div className="bg-card border border-border p-6 crosshair-corners space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
                <div className="space-y-1">
                  <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                    SYSTEM_SUBSCRIPTION_PROFILES
                  </h2>
                  <p className="text-[10px] font-mono text-muted-foreground/80 uppercase font-medium">
                    Select a plan via Whop Secure Checkout to adjust your system limits.
                  </p>
                </div>
                {usage?.tier && usage.tier !== 'free' && (
                  <a 
                    href="https://whop.com/hub/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[9px] text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground px-3 py-1.5 bg-muted/40 transition-colors uppercase tracking-widest font-bold"
                  >
                    Manage Subscription ↗
                  </a>
                )}
              </div>

              {checkoutError && (
                <div className="bg-[#ef4444]/10 border border-[#ef4444] p-3 font-mono text-[10px] text-[#ef4444] uppercase tracking-wider">
                  [CHECKOUT_ERROR]: {checkoutError}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
                {getDisplayPlans().map((plan) => {
                  const isCurrent = usage?.tier === plan.key;
                  const isLoading = checkoutLoading === plan.key;

                  return (
                    <div 
                      key={plan.key} 
                      className={`relative bg-card/80 border ${isCurrent ? 'border-[#ef4444] red-glow' : 'border-border'} p-6 flex flex-col justify-between transition-all hover:border-border`}
                    >
                      {plan.badge && (
                        <div className="absolute top-0 right-6 -translate-y-1/2 bg-[#ef4444] text-foreground font-mono text-[8px] font-bold px-2 py-0.5 tracking-widest uppercase red-glow">
                          {plan.badge}
                        </div>
                      )}

                      <div className="space-y-4">
                        <div className="space-y-1">
                          <h3 className="font-mono text-xs text-foreground font-bold uppercase tracking-wider">{plan.name}</h3>
                          <p className="text-[9px] font-mono text-muted-foreground/80 min-h-[30px] uppercase font-medium">{plan.desc}</p>
                        </div>

                        <div className="flex items-baseline gap-1 py-2 border-y border-border">
                          <span className="font-mono text-2xl text-foreground font-bold tracking-tighter">{plan.price}</span>
                          <span className="font-mono text-[9px] text-muted-foreground/80 uppercase">/ {plan.billing}</span>
                        </div>

                        <p className="text-[9px] font-mono text-muted-foreground/80 uppercase leading-relaxed">{plan.desc}</p>
                      </div>

                      <div className="pt-6 mt-auto">
                        <button
                          disabled={isCurrent || isLoading}
                          onClick={() => handleCheckout(plan.key)}
                          className={`w-full font-mono text-[9px] py-3 transition-all tracking-widest uppercase font-bold border ${
                            isCurrent 
                              ? 'bg-muted/40 border-border text-muted-foreground/80 cursor-not-allowed'
                              : 'bg-muted border-border text-foreground/80 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-foreground'
                          }`}
                        >
                          {isCurrent 
                            ? 'CURRENT_PLAN' 
                            : isLoading 
                              ? 'INITIALIZING...' 
                              : plan.key === 'pro' 
                                ? 'START FREE TRIAL' 
                                : 'SUBSCRIBE NOW'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 text-center border-t border-border">
                <p className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest leading-relaxed">
                  * Need custom limits or an enterprise setup? Please contact support at <a href="mailto:support@akarouter.com" className="text-[#ef4444] hover:underline font-bold">support@akarouter.com</a> to custom configure your plan.
                </p>
              </div>
            </div>

          </div>
        </main>
      </div>

    </div>
  )
}
