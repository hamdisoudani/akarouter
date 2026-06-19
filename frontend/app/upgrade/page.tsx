'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useApp } from '@/app/providers'
import { createCheckoutSession, getModels, getPlans, type PlanPreset } from '@/lib/api'
import { LogOut, RefreshCw, Brain, Zap, DollarSign, ChevronRight } from 'lucide-react'

export default function UpgradePage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut, refetchUsage } = useApp()

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [dbPlans, setDbPlans] = useState<PlanPreset[]>([])
  const [modelLabel, setModelLabel] = useState<Record<string, string>>({})

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await getPlans()
        if (res && res.plans) {
          // Filter out free and enterprise plans
          const filtered = res.plans.filter(p => p.tier !== 'free' && p.tier !== 'enterprise')
          setDbPlans(filtered)
        }
      } catch (err) {
        console.error('Failed to load plans from backend:', err)
      }
    }
    async function loadModels() {
      try {
        const res = await getModels()
        if (res && res.data) {
          const map: Record<string, string> = {}
          for (const m of res.data) {
            map[m.id] = m.display_name || m.id
          }
          setModelLabel(map)
        }
      } catch (err) {
        // Non-fatal — fall back to alias
      }
    }
    loadPlans()
    loadModels()
  }, [])

  // Derive which models are available per plan tier based on the request
  // budget. Per-token models always included; per-request models unlock as
  // the request ceiling grows.
  const getDisplayPlans = () => {
    const fallbackPlans = [
      {
        name: 'Starter Plan',
        key: 'starter',
        price: '$4.99',
        billing: 'monthly',
        desc: 'Essential API limits for developers starting out.',
        badge: null,
        limits: [
          'Monthly Budget: $10.00',
          'RPM Limit: 60 RPM',
          '5-Hour Limit: $1.00',
          '7-Day Limit: $5.00',
          'T1 Calls: 60/mo',
          'T2 Calls: 40/mo',
          'T3 Calls: 15/mo'
        ]
      },
      {
        name: 'Pro Plan',
        key: 'pro',
        price: '$19.99',
        billing: 'monthly',
        desc: 'Perfect for production apps and agent deployments.',
        badge: 'Popular • 7-Day Free Trial',
        limits: [
          'Monthly Budget: $100.00',
          'RPM Limit: 300 RPM',
          '5-Hour Limit: $10.00',
          '7-Day Limit: $50.00',
          'T1 Calls: 400/mo',
          'T2 Calls: 250/mo',
          'T3 Calls: 100/mo'
        ]
      },
      {
        name: 'Ultra Plan',
        key: 'ultra',
        price: '$99.99',
        billing: 'monthly',
        desc: 'Ultimate capacity for high-scale agent networks.',
        badge: 'Elite Performance',
        limits: [
          'Monthly Budget: $1,000.00',
          'RPM Limit: 1,000 RPM',
          '5-Hour Limit: $100.00',
          '7-Day Limit: $500.00',
          'T1 Calls: 1,500/mo',
          'T2 Calls: 900/mo',
          'T3 Calls: 400/mo'
        ]
      }
    ]

    if (dbPlans.length === 0) {
      return fallbackPlans
    }

    return dbPlans.map(plan => {
      const matchingFallback = fallbackPlans.find(fp => fp.key === plan.tier)
      const monthlyRequests = typeof plan.monthly_requests_limit === 'number' ? plan.monthly_requests_limit : null
      const perRequestCost = typeof plan.per_request_cost_cents === 'number' ? plan.per_request_cost_cents : null
      const includedModels = deriveIncludedModels(plan.tier, monthlyRequests)
      return {
        name: matchingFallback?.name || `${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan`,
        key: plan.tier,
        price: matchingFallback?.price || '$0.00',
        billing: matchingFallback?.billing || 'monthly',
        desc: matchingFallback?.desc || 'Custom limits tier.',
        badge: matchingFallback?.badge || null,
        limits: [
          `Monthly Budget: $${plan.monthly_limit.toFixed(2)}`,
          ...(monthlyRequests != null ? [`Monthly Requests: ${monthlyRequests.toLocaleString()}`] : []),
          `RPM Limit: ${plan.rpm_limit} RPM`,
          `5-Hour Cap: $${plan.tokens_5h_limit.toFixed(2)}`,
          `7-Day Cap: $${plan.tokens_7d_limit.toFixed(2)}`,
          `T1 Calls/mo: ${plan.t1_requests_limit?.toLocaleString() ?? 0}`,
          `T2 Calls/mo: ${plan.t2_requests_limit?.toLocaleString() ?? 0}`,
          `T3 Calls/mo: ${plan.t3_requests_limit?.toLocaleString() ?? 0}`,
        ],
        monthlyRequests,
        perRequestCost,
        includedModels,
      }
    })
  }

  useEffect(() => {
    if (!authLoading) {
      if (!token) {
        router.push('/auth/login')
        return
      }
      // If user has subscribed and is no longer on free tier, allow them into the dashboard
      if (usage && usage.tier !== 'free') {
        router.push('/dashboard')
      }
    }
  }, [authLoading, token, usage, router])

  const handleCheckout = async (tier: string) => {
    if (!token) return
    setCheckoutLoading(tier)
    setCheckoutError(null)

    try {
      const redirectUrl = window.location.origin + '/dashboard'
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

  if (authLoading || !usage) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#e5e1e4] flex flex-col items-center justify-center font-mono text-xs uppercase tracking-widest gap-3 grid-bg">
        <RefreshCw className="w-5 h-5 animate-spin text-[#ef4444]" />
        [VERIFYING_SECURE_VAULT_SESSION...]
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex flex-col overflow-hidden grid-bg">
      {/* TopAppBar */}
      <header className="flex justify-between items-center w-full px-6 py-3 bg-[#09090b] border-b border-zinc-900 sticky top-0 z-10 micro-grid">
        <div className="flex items-center gap-3">
          <div className="relative w-20 h-10 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
            <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
          </div>
          <span className="hidden sm:inline-block font-mono text-[10px] tracking-[0.2em] text-zinc-400 uppercase font-bold border-l border-zinc-800 pl-4 leading-none">
            Subscription Setup Portal
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px]">
          <div className="flex items-center gap-2 border border-zinc-900 bg-[#0e0e10] px-3 py-1.5 text-zinc-400">
            <span className="text-zinc-650">[USER]:</span>
            <span className="text-white font-semibold">{user?.email}</span>
          </div>

          <button 
            onClick={signOut}
            className="bg-zinc-900 border border-zinc-850 hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-zinc-300 hover:text-white px-3 py-1.5 transition-all flex items-center gap-2 font-bold uppercase tracking-wider"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-6 flex flex-col justify-center">
        {/* Warning Banner */}
        <div className="bg-[#ef4444]/15 border border-[#ef4444]/35 text-[#ef4444] p-5 font-mono text-xs uppercase flex items-center gap-4 red-glow crosshair-corners">
          <span className="w-2.5 h-2.5 bg-[#ef4444] rounded-full status-pulse red-glow shrink-0" />
          <div className="space-y-1">
            <p className="font-bold tracking-wider">[ACCESS_RESTRICTED]: SUBSCRIPTION REQUIRED</p>
            <p className="text-[10px] text-zinc-400 leading-relaxed normal-case">
              Your account is currently on the free trial/tier. AkaRouter requires an active subscription to provision API keys and allocate request limits. Please select a plan below to activate your API gateway service.
            </p>
          </div>
        </div>

        {/* Pricing Selection Grid */}
        <div className="bg-[#0e0e10] border border-zinc-900 p-8 crosshair-corners space-y-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-900 pb-5">
            <div className="space-y-1">
              <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                SYSTEM_SUBSCRIPTION_PROFILES
              </h2>
              <p className="text-[10px] font-mono text-zinc-500 uppercase font-medium">
                Choose a plan to instantly configure your gateway throughput and deploy agents.
              </p>
            </div>
            <button
              onClick={refetchUsage}
              className="font-mono text-[9px] text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-550 px-3 py-1.5 bg-zinc-950 transition-colors uppercase tracking-widest font-bold"
            >
              Verify Active Subscription ↻
            </button>
          </div>

          {checkoutError && (
            <div className="bg-[#ef4444]/10 border border-[#ef4444] p-3 font-mono text-[10px] text-[#ef4444] uppercase tracking-wider">
              [CHECKOUT_ERROR]: {checkoutError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {getDisplayPlans().map((plan) => {
              const isLoading = checkoutLoading === plan.key;
              const models = (plan as any).includedModels as { perToken: string[]; perRequest: string[] } | undefined;
              const monthlyRequests = (plan as any).monthlyRequests as number | null | undefined;

              return (
                <div
                  key={plan.key}
                  className="relative bg-[#050507] border border-zinc-900 p-6 flex flex-col transition-all hover:border-zinc-700 crosshair-corners"
                >
                  {plan.badge && (
                    <div className="absolute top-0 right-6 -translate-y-1/2 bg-[#ef4444] text-white font-mono text-[8px] font-bold px-2 py-0.5 tracking-widest uppercase red-glow">
                      {plan.badge}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h3 className="font-mono text-xs text-white font-bold uppercase tracking-wider">{plan.name}</h3>
                      <p className="text-[9px] font-mono text-zinc-500 min-h-[30px] uppercase font-medium leading-relaxed">{plan.desc}</p>
                    </div>

                    <div className="flex items-baseline gap-1 py-2 border-y border-zinc-900">
                      <span className="font-mono text-2xl text-white font-bold tracking-tighter">{plan.price}</span>
                      <span className="font-mono text-[9px] text-zinc-500 uppercase">/ {plan.billing}</span>
                    </div>

                    {/* Headline meters: budget + requests */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="border border-zinc-900 bg-zinc-950/50 p-2.5">
                        <div className="flex items-center gap-1 text-[8px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
                          <DollarSign className="w-2.5 h-2.5" /> Budget
                        </div>
                        <div className="font-mono text-xs text-emerald-400 font-bold">
                          ${plan.limits.find(l => l.includes('Monthly Budget'))?.replace(/[^\d.]/g, '') || '—'}
                        </div>
                        <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">per month</div>
                      </div>
                      <div className="border border-zinc-900 bg-zinc-950/50 p-2.5">
                        <div className="flex items-center gap-1 text-[8px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
                          <Zap className="w-2.5 h-2.5" /> Requests
                        </div>
                        <div className="font-mono text-xs text-[#ef4444] font-bold">
                          {monthlyRequests != null ? monthlyRequests.toLocaleString() : '∞'}
                        </div>
                        <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">per month</div>
                      </div>
                    </div>

                    {/* Limits list */}
                    <ul className="space-y-1.5 font-mono text-[9px] text-zinc-400">
                      {plan.limits.filter(l => !l.includes('Monthly Budget')).map((limit, idx) => (
                        <li key={idx} className="flex items-center gap-2">
                          <span className="w-1 h-1 bg-[#ef4444] red-glow shrink-0"></span>
                          <span className="uppercase">{limit}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Included models */}
                    {models && (
                      <div className="space-y-2 pt-3 border-t border-zinc-900">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">INCLUDED_MODELS</span>
                          <Link href="/models" className="text-[8px] font-mono text-[#ef4444] hover:underline uppercase tracking-wider">
                            Browse all →
                          </Link>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {models.perToken.slice(0, 3).map((id) => (
                            <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono border border-emerald-500/30 bg-emerald-500/5 text-emerald-400">
                              <Brain className="w-2.5 h-2.5" />
                              {modelLabel[id] || id}
                            </span>
                          ))}
                          {models.perRequest.slice(0, 4).map((id) => (
                            <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono border border-[#ef4444]/30 bg-[#ef4444]/5 text-[#ef4444]">
                              <Zap className="w-2.5 h-2.5" />
                              {modelLabel[id] || id}
                            </span>
                          ))}
                          {models.perRequest.length > 4 && (
                            <span className="text-[8px] font-mono text-zinc-500">+{models.perRequest.length - 4} more</span>
                          )}
                        </div>
                        <p className="text-[8px] text-zinc-600 font-mono leading-relaxed">
                          All per-token models included. Per-request models deduct from your monthly request quota.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="pt-6 mt-auto">
                    <button
                      disabled={isLoading}
                      onClick={() => handleCheckout(plan.key)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white font-mono text-[9px] py-3 transition-all tracking-widest uppercase font-bold"
                    >
                      {isLoading
                        ? 'INITIALIZING...'
                        : plan.key === 'pro'
                          ? 'START FREE TRIAL'
                          : 'SUBSCRIBE NOW'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="pt-4 text-center border-t border-zinc-900">
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest leading-relaxed">
              * Need custom limits or an enterprise setup? Please contact support at <a href="mailto:support@akarouter.com" className="text-[#ef4444] hover:underline font-bold">support@akarouter.com</a> to custom configure your plan.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

/**
 * Derive the models accessible per plan tier based on the monthly_requests
 * budget. Per-token models are always included. Per-request models unlock
 * as the request ceiling grows. This is a UI hint, not a hard gate — the
 * gateway enforces real limits.
 */
function deriveIncludedModels(
  tier: string,
  monthlyRequests: number | null,
): { perToken: string[]; perRequest: string[] } {
  const perToken = ['akarouter-flash', 'akarouter-pro', 'akarouter-large']

  if (monthlyRequests == null) {
    return { perToken, perRequest: [] }
  }

  // Tier-based model access (UI hint; matches the seeded monthly_requests_limit
  // values: starter=500, pro=5000, ultra=50000)
  const perRequestMap: Record<string, string[]> = {
    starter: ['akarouter-mini'],
    pro: ['akarouter-mini', 'akarouter-haiku', 'akarouter-sonnet', 'akarouter-gpt54'],
    ultra: [
      'akarouter-mini',
      'akarouter-haiku',
      'akarouter-sonnet',
      'akarouter-gpt54',
      'akarouter-gemini31',
      'akarouter-gpt55',
      'akarouter-opus',
    ],
    enterprise: [
      'akarouter-mini',
      'akarouter-haiku',
      'akarouter-sonnet',
      'akarouter-gpt54',
      'akarouter-gemini31',
      'akarouter-gpt55',
      'akarouter-opus',
      'akarouter-gpt53-codex',
    ],
  }

  return {
    perToken,
    perRequest: perRequestMap[tier] ?? [],
  }
}
