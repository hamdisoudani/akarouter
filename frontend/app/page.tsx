import Link from 'next/link'
import Image from 'next/image'
import { Cpu, RefreshCw, Shield, ArrowRight } from 'lucide-react'
import { env } from '@/lib/env'
import { fetchServerPlans, fetchServerModels } from '@/lib/server-api'
import { CopyButton } from '@/components/CopyButton'
import { ModelCatalog } from '@/components/ModelCatalog'
import type { PlanPreset } from '@/lib/api'

/**
 * Landing page (Server Component).
 *
 * SECURITY + PERF: the previous implementation was `'use client'` and
 * fetched plans on mount with a useEffect. That meant:
 *  1. Every visitor downloaded ~100KB+ of React/Next runtime before seeing
 *     a single character of the page.
 *  2. Google saw a blank HTML page (no SSR content), so SEO was effectively
 *     zero.
 *  3. The fetch logic was exposed in the client bundle, including the
 *     URL construction logic with `process.env.NEXT_PUBLIC_API_URL` baked
 *     into the JS.
 *
 * This Server Component:
 *  - Renders fully on the server (HTML sent in initial response).
 *  - Fetches plans server-side via `fetchServerPlans()`, which keeps the
 *    backend URL out of the client bundle.
 *  - Streams via Suspense implicitly (Next 16 enables this for RSC by default).
 *  - Falls back to static pricing if the backend is unreachable.
 *  - Only the tiny CopyButton is client-side (because clipboard API is
 *    browser-only).
 *
 * Caching: `revalidate = 60` means Next.js will refresh the plans list
 * every 60 seconds at most. For marketing pages this is fine — plans
 * change rarely. If you ever need to force-refresh on plan edits, use
 * `revalidateTag()` from the admin action.
 */
export const revalidate = 60

const FALLBACK_PLANS: Array<{
  key: string
  name: string
  price: string
  billing: string
  desc: string
  badge?: string | null
  limits: string[]
}> = [
  {
    key: 'starter',
    name: 'Starter Plan',
    price: '$4.99',
    billing: 'monthly',
    desc: 'Ideal for individual developers and small projects.',
    badge: 'GET STARTED',
    limits: [
      'Monthly Budget: $3.00',
      'RPM Limit: 60 RPM',
      '5-Hour Limit: $1.00',
      '7-Day Limit: $5.00',
      'T1 Calls/mo: 60',
      'T2 Calls/mo: 40',
      'T3 Calls/mo: 15',
    ],
  },
  {
    key: 'pro',
    name: 'Pro Plan',
    price: '$19.99',
    billing: 'monthly',
    desc: 'Perfect for production apps and high-volume use.',
    badge: 'Popular • 7-Day Free Trial',
    limits: [
      'Monthly Budget: $15.00',
      'RPM Limit: 60 RPM',
      '5-Hour Limit: $5.00',
      '7-Day Limit: $20.00',
      'T1 Calls/mo: 400',
      'T2 Calls/mo: 250',
      'T3 Calls/mo: 100',
    ],
  },
  {
    key: 'ultra',
    name: 'Ultra Plan',
    price: '$99.99',
    billing: 'monthly',
    desc: 'Ultimate capacity for high-scale workloads.',
    badge: 'Elite Performance',
    limits: [
      'Monthly Budget: $80.00',
      'RPM Limit: 1,000 RPM',
      '5-Hour Limit: $100.00',
      '7-Day Limit: $500.00',
      'T1 Calls/mo: 1,500',
      'T2 Calls/mo: 900',
      'T3 Calls/mo: 400',
    ],
  },
]

type DisplayPlan = (typeof FALLBACK_PLANS)[number]

function formatPlans(dbPlans: PlanPreset[]): DisplayPlan[] {
  if (!dbPlans || dbPlans.length === 0) {
    return FALLBACK_PLANS
  }
  return dbPlans
    .filter((p) => p.tier !== 'free' && p.tier !== 'enterprise')
    .map((plan) => {
      const matching = FALLBACK_PLANS.find((fp) => fp.key === plan.tier)
      let badge = plan.badge ?? matching?.badge ?? null
      if (plan.has_trial && plan.trial_days) {
        badge = `${plan.trial_days}-Day Free Trial`
      }
      return {
        key: plan.tier,
        name: `${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan`,
        price: plan.price || matching?.price || '$0.00',
        billing: plan.billing_period || matching?.billing || 'monthly',
        desc: plan.description || matching?.desc || 'Custom limits tier.',
        badge,
        limits: [
          `Monthly Budget: ${plan.monthly_limit >= 999999999 ? 'UNLIMITED' : `$${plan.monthly_limit.toFixed(2)}`}`,
          `RPM Limit: ${plan.rpm_limit} RPM`,
          `5-Hour Limit: $${plan.tokens_5h_limit.toFixed(2)}`,
          `7-Day Limit: $${plan.tokens_7d_limit.toFixed(2)}`,
          `T1 Calls/mo: ${(plan.t1_requests_limit ?? 0).toLocaleString()}`,
          `T2 Calls/mo: ${(plan.t2_requests_limit ?? 0).toLocaleString()}`,
          `T3 Calls/mo: ${(plan.t3_requests_limit ?? 0).toLocaleString()}`,
        ],
      }
    })
}

export default async function Home() {
  // Server-side fetch — no client leak, 5s timeout, fallback on error.
  const dbPlans = await fetchServerPlans()
  const displayPlans = formatPlans(dbPlans)

  // Fetch models for the OpenRouter-style catalog. Falls back to [] on
  // backend errors so the page still renders.
  const models = await fetchServerModels()

  // Server-only URL — never sent to the browser.
  const gatewayUrl = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')

  const codeSnippet = `from openai import OpenAI

client = OpenAI(
  base_url="${gatewayUrl}/v1",
  api_key="akar_your_key_here"
)

response = client.chat.completions.create(
  model="akarouter-pro",
  messages=[{"role": "user", "content": "Hello AkaRouter!"}]
)`

  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex flex-col overflow-hidden selection:bg-[#ef4444]/30 selection:text-white grid-bg">
      {/* Red ambient glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[500px] bg-gradient-to-b from-[#ef4444]/5 via-transparent to-transparent rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[400px] right-[-100px] w-[300px] h-[300px] bg-[#ef4444]/2 rounded-full blur-[100px] pointer-events-none" />

      {/* Navigation */}
      <nav className="sticky top-0 w-full z-50 border-b border-[#27272a] bg-[#09090b]/80 backdrop-blur-xl micro-grid">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-24 h-10 sm:w-[208px] sm:h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-6">
            <a href="#features" className="hidden sm:block text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors">Features</a>
            <a href="#models" className="hidden sm:block text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors">Models</a>
            <a href="#pricing" className="hidden sm:block text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors">Pricing</a>
            <Link href="/auth/login" className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-zinc-300 hover:text-white transition-colors">
              Sign in
            </Link>
            <Link
              href="/auth/login"
              className="relative inline-flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 text-white font-mono text-[10px] sm:text-xs py-1.5 px-3 sm:py-2 sm:px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all crosshair-corners"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pt-20 pb-16 z-10">
        <div className="w-full max-w-4xl text-center space-y-6 flex flex-col items-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-zinc-950 border border-zinc-800 font-mono text-[9px] tracking-widest text-[#ef4444] uppercase">
            <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
            [SYS_STATUS]: GATEWAY_ONLINE_READY
          </div>

          {/* Heading */}
          <h2 className="text-2xl sm:text-4xl md:text-6xl font-black font-mono tracking-tighter leading-none uppercase text-white break-words w-full px-2">
            AI INFERENCE ROUTING
            <br />
            <span className="text-gradient-primary">ONE KEY, EVERY MODEL</span>
          </h2>

          <p className="mt-4 text-xs md:text-sm text-zinc-400 max-w-2xl mx-auto font-mono uppercase tracking-wide leading-relaxed px-2">
            Access high-performance LLMs through a unified, high-availability API gateway. Features low-latency routing, smart load-balancing, and robust error failover.
          </p>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/auth/login"
              className="bg-[#ef4444] text-black font-mono text-xs font-bold py-3.5 px-8 hover:bg-[#ff5451] transition-all red-glow flex items-center gap-2"
            >
              <span className="font-bold">[+]</span> SUBSCRIBE & START
            </Link>
            <a
              href="#pricing"
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold py-3.5 px-8 hover:border-zinc-500 hover:text-white transition-all"
            >
              EXPLORE_PRICING
            </a>
            <a
              href="#models"
              className="bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-xs font-bold py-3.5 px-8 hover:border-zinc-500 hover:text-white transition-all"
            >
              EXPLORE_MODELS
            </a>
          </div>

          <p className="text-[9px] text-[#ef4444] font-mono uppercase tracking-widest pt-2 animate-pulse font-bold">
            * Subscription plans are available with a 7-day free trial on the Pro Plan. Check our pricing page below.
          </p>

          {/* Code IDE Container */}
          <div className="mt-16 w-full max-w-2xl text-left bg-[#0e0e10] border border-[#27272a] crosshair-corners overflow-hidden">
            <div className="bg-[#0e0e10] border-b border-[#27272a] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[#ef4444] red-glow" />
                <span className="text-[10px] text-zinc-400 font-mono font-bold tracking-widest uppercase">CONNECTION_CONFIG.PY</span>
              </div>
              <CopyButton text={codeSnippet} />
            </div>
            <div className="p-5 font-mono text-[11px] text-zinc-300 overflow-x-auto bg-[#050507] leading-relaxed max-w-full">
              <pre className="whitespace-pre sm:whitespace-pre-wrap">{codeSnippet}</pre>
            </div>
          </div>
        </div>
      </main>

      {/* Features Grid */}
      <section id="features" className="border-t border-[#27272a] py-24 bg-[#0e0e10]/40 px-6 micro-grid">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center space-y-3">
            <h3 className="text-2xl font-bold font-mono tracking-wider uppercase text-white">ROBUST LLM GATEWAY KERNEL</h3>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest">Built from the ground up for high availability and low-latency inference workloads.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-0 border border-[#27272a]">
            <div className="p-8 space-y-4 border-b md:border-b-0 md:border-r border-[#27272a] hover:bg-zinc-950/20 transition-all group">
              <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-zinc-400 group-hover:text-[#ef4444] group-hover:border-[#ef4444] transition-all">
                <Cpu className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold font-mono tracking-wider uppercase text-white">SMART LOAD BALANCING</h4>
              <p className="text-xs text-zinc-400 font-mono leading-relaxed">Round-robin routing with real-time health weighting and dynamic in-flight concurrency tracking.</p>
            </div>

            <div className="p-8 space-y-4 border-b md:border-b-0 md:border-r border-[#27272a] hover:bg-zinc-950/20 transition-all group">
              <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-zinc-400 group-hover:text-[#ef4444] group-hover:border-[#ef4444] transition-all">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold font-mono tracking-wider uppercase text-white">HIGH-AVAILABILITY FAILOVER</h4>
              <p className="text-xs text-zinc-400 font-mono leading-relaxed">Automatic request retry and hot-swap routing. If a routing target goes down, traffic is immediately re-allocated.</p>
            </div>

            <div className="p-8 space-y-4 hover:bg-zinc-950/20 transition-all group">
              <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-zinc-400 group-hover:text-[#ef4444] group-hover:border-[#ef4444] transition-all">
                <Shield className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold font-mono tracking-wider uppercase text-white">QUOTA MANAGEMENT</h4>
              <p className="text-xs text-zinc-400 font-mono leading-relaxed">Granular subscription tier rate limits, sliding token budgets, and cost analytics logged per API key.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Models Section — preview with link to full catalog */}
      <section id="models" className="border-t border-[#27272a] py-24 bg-[#09090b] px-6">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="text-center space-y-3">
            <h3 className="text-2xl font-bold font-mono tracking-wider uppercase text-white">AVAILABLE MODELS</h3>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest">All models accessible through a single API key. Supports per-token and per-request billing.</p>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 text-[9px] font-mono text-zinc-400 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              Per-Token & Per-Request Billing Active
            </div>
            <div className="pt-2">
              <Link
                href="/models"
                className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-zinc-300 hover:text-white font-mono text-[10px] uppercase tracking-wider transition-all"
              >
                Browse All Models
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          <ModelCatalog models={models} />
        </div>
      </section>

      {/* Pricing + Billing Modes Status */}
      <section id="pricing" className="border-t border-[#27272a] py-20 bg-[#09090b] relative micro-grid">
        <div className="max-w-6xl mx-auto px-6 space-y-12">
          <div className="text-center space-y-4 flex flex-col items-center">
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-white">Pricing Profiles</h3>
            <div className="w-[3px] h-6 bg-[#ef4444] red-glow"></div>
            <p className="text-xs sm:text-sm text-zinc-400 font-mono uppercase tracking-wider max-w-xl">
              Choose a flexible subscription plan that matches your production throughput demands.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-6">
            {displayPlans.map((plan) => (
              <div
                key={plan.key}
                className={`relative bg-[#0e0e10] border ${plan.badge ? 'border-[#ef4444] red-glow' : 'border-zinc-800'} p-8 flex flex-col justify-between hover:border-zinc-500 transition-all crosshair-corners`}
              >
                {plan.badge && (
                  <div className="absolute top-0 right-6 -translate-y-1/2 bg-[#ef4444] text-white font-mono text-[8px] font-bold px-2 py-0.5 tracking-widest uppercase red-glow">
                    {plan.badge}
                  </div>
                )}

                <div className="space-y-6">
                  <div className="space-y-1">
                    <h4 className="font-mono text-xs text-white font-bold uppercase tracking-wider">{plan.name}</h4>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase leading-relaxed">{plan.desc}</p>
                  </div>

                  <div className="flex items-baseline gap-1 py-3 border-y border-zinc-900">
                    <span className="font-mono text-3xl text-white font-bold tracking-tighter">{plan.price}</span>
                    <span className="font-mono text-[9px] text-zinc-500 uppercase">/ {plan.billing}</span>
                  </div>

                  <ul className="space-y-2.5 font-mono text-[9px] text-zinc-400">
                    {plan.limits.map((limit) => (
                      <li key={limit} className="flex items-center gap-2">
                        <span className="w-1 h-1 bg-[#ef4444] red-glow"></span>
                        <span className="uppercase">{limit}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-8 mt-auto">
                  <Link
                    href="/auth/login"
                    className="w-full text-center block font-mono text-[9px] py-3.5 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white transition-all tracking-widest uppercase font-bold"
                  >
                    Select Plan
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-6 text-center border-t border-zinc-900">
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest leading-relaxed">
              * Need custom limits or an enterprise setup? Please contact support at <a href="mailto:support@akarouter.com" className="text-[#ef4444] hover:underline font-bold">support@akarouter.com</a> to custom configure your plan.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#27272a] py-8 text-center text-xs text-zinc-600 bg-[#09090b] micro-grid">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-[10px]">
          <p>© 2026 AkaRouter by HAMDI. Kernel: v1.0.0-STABLE.</p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-zinc-400 transition-colors uppercase">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-zinc-400 transition-colors uppercase">Privacy Policy</Link>
            <Link href="/cookies" className="hover:text-zinc-400 transition-colors uppercase">Cookie Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}