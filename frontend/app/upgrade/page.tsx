'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import { createCheckoutSession, getPlans, type PlanPreset } from '@/lib/api'
import { LogOut, RefreshCw } from 'lucide-react'

export default function UpgradePage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut, refetchUsage } = useApp()

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [dbPlans, setDbPlans] = useState<PlanPreset[]>([])

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
        limits: [
          'Monthly Budget: $10.00',
          'RPM Limit: 60 RPM',
          '5-Hour Limit: $1.00',
          '7-Day Limit: $5.00',
          'Hosted Agents: 0'
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
          'Hosted Agents: 2 (1GB RAM)'
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
          'Hosted Agents: 5 (4GB RAM)'
        ]
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
        price: matchingFallback?.price || '$0.00',
        billing: matchingFallback?.billing || 'monthly',
        desc: matchingFallback?.desc || 'Custom limits tier.',
        badge: matchingFallback?.badge || null,
        limits: [
          `Monthly Budget: $${plan.monthly_limit.toFixed(2)}`,
          `RPM Limit: ${plan.rpm_limit} RPM`,
          `5-Hour Limit: $${plan.tokens_5h_limit.toFixed(2)}`,
          `7-Day Limit: $${plan.tokens_7d_limit.toFixed(2)}`,
          `Hosted Agents: ${plan.max_agents ?? 0}`
        ]
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
              Your account is currently on the free trial/tier. AkaRouter requires an active subscription to provision API keys, allocate token limits, or deploy hosted OpenClaw agents. Please select a plan below to activate your API gateway service.
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

              return (
                <div 
                  key={plan.key} 
                  className="relative bg-[#050507] border border-zinc-900 p-6 flex flex-col justify-between transition-all hover:border-zinc-700 crosshair-corners"
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

                    <ul className="space-y-2 font-mono text-[9px] text-zinc-400">
                      {plan.limits.map((limit, idx) => (
                        <li key={idx} className="flex items-center gap-2">
                          <span className="w-1 h-1 bg-[#ef4444] red-glow"></span>
                          <span className="uppercase">{limit}</span>
                        </li>
                      ))}
                    </ul>
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
