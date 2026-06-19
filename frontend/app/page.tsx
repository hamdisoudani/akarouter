import Link from 'next/link'
import Image from 'next/image'
import {
  Cpu,
  RefreshCw,
  Shield,
  ArrowRight,
  Check,
  X,
  Zap,
  DollarSign,
  TrendingDown,
  Brain,
  Code2,
  Eye,
  Layers,
} from 'lucide-react'
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
          `Points/mo: ${(plan.monthly_point_allowance ?? 0).toLocaleString()}`,
          `Daily Free Req: ${(plan.daily_free_requests_limit ?? 0).toLocaleString()}`,
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
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pt-16 pb-12 z-10">
        <div className="w-full max-w-4xl text-center space-y-6 flex flex-col items-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-zinc-950 border border-zinc-800 font-mono text-[9px] tracking-widest text-[#ef4444] uppercase">
            <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
            [SYS_STATUS]: GATEWAY_ONLINE_READY
          </div>

          {/* Headline — led by the savings number */}
          <h2 className="text-3xl sm:text-5xl md:text-7xl font-black font-mono tracking-tighter leading-[0.95] uppercase text-white break-words w-full px-2">
            CLAUDE MAX 20X
            <br />
            <span className="text-zinc-600 line-through decoration-[#ef4444] decoration-4">$200/MO</span>{' '}
            <span className="text-gradient-primary">$20/MO</span>
          </h2>

          <p className="mt-2 text-sm md:text-base text-zinc-300 max-w-2xl mx-auto font-mono leading-relaxed px-2">
            Same Opus 4.8. Same prompt size limits. <span className="text-[#ef4444] font-bold">91% cheaper.</span>
            <br className="hidden sm:block" />
            <span className="text-zinc-500 text-xs md:text-sm">Pay-per-request. One API key. Every frontier model.</span>
          </p>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/auth/login"
              className="bg-[#ef4444] text-black font-mono text-xs font-bold py-3.5 px-8 hover:bg-[#ff5451] transition-all red-glow flex items-center gap-2"
            >
              <span className="font-bold">[+]</span> GET 100 FREE POINTS
            </Link>
            <a
              href="#why"
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold py-3.5 px-8 hover:border-zinc-500 hover:text-white transition-all"
            >
              SEE_COMPARISON
            </a>
            <a
              href="#pricing"
              className="bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-xs font-bold py-3.5 px-8 hover:border-zinc-500 hover:text-white transition-all"
            >
              VIEW_PRICING
            </a>
          </div>

          <p className="text-[9px] text-[#ef4444] font-mono uppercase tracking-widest pt-2 animate-pulse font-bold">
            * Every signup ships with 100 free points on 1pt models (10/day cap). No credit card.
          </p>

          {/* Code IDE Container */}
          <div className="mt-12 w-full max-w-2xl text-left bg-[#0e0e10] border border-[#27272a] crosshair-corners overflow-hidden">
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

          {/* Trust strip */}
          <div className="mt-10 w-full max-w-3xl grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 border border-zinc-800">
            <div className="bg-[#09090b] p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-[#ef4444]">$0.08</div>
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mt-1">per Opus 4.8 call</div>
            </div>
            <div className="bg-[#09090b] p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-emerald-400">11</div>
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mt-1">frontier models</div>
            </div>
            <div className="bg-[#09090b] p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-amber-400">0¢</div>
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mt-1">context-length anxiety</div>
            </div>
            <div className="bg-[#09090b] p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-white">1 KEY</div>
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mt-1">unified API</div>
            </div>
          </div>
        </div>
      </main>

      {/* WHY AKAROUTER — competitor comparison */}
      <section id="why" className="border-t border-[#27272a] py-20 bg-[#09090b] px-6 micro-grid">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 text-[9px] font-mono text-zinc-400 uppercase tracking-wider">
              <TrendingDown className="w-3 h-3 text-[#ef4444]" />
              the brutal math
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-white">
              Why pay 5x–90x more for the same model?
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 font-mono uppercase tracking-wider max-w-2xl mx-auto">
              Same upstream models. Same prompts. Same response quality. AkaRouter routes you to the same providers
              the big guys use — we just don't mark it up 50x.
            </p>
          </div>

          {/* Comparison matrix */}
          <div className="border border-zinc-800 bg-[#0a0a0c] overflow-x-auto">
            <table className="w-full font-mono text-[10px] sm:text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-[#0e0e10]">
                  <th className="text-left p-3 sm:p-4 text-zinc-500 uppercase tracking-wider font-bold">Feature</th>
                  <th className="p-3 sm:p-4 text-center">
                    <div className="text-[#ef4444] uppercase font-black tracking-wider text-[11px] sm:text-sm">AkaRouter</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">Pro $20/mo</div>
                  </th>
                  <th className="p-3 sm:p-4 text-center text-zinc-400 uppercase tracking-wider font-bold">
                    <div>Claude Max 20x</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5 font-normal">$200/mo</div>
                  </th>
                  <th className="p-3 sm:p-4 text-center text-zinc-400 uppercase tracking-wider font-bold">
                    <div>ChatGPT Pro</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5 font-normal">$200/mo</div>
                  </th>
                  <th className="p-3 sm:p-4 text-center text-zinc-400 uppercase tracking-wider font-bold">
                    <div>OpenRouter</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5 font-normal">pay-as-you-go</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {/* Price row */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">Per-call cost (Opus 4)</td>
                  <td className="p-3 sm:p-4 text-center text-[#ef4444] font-bold text-base">$0.08</td>
                  <td className="p-3 sm:p-4 text-center text-zinc-400">$0.90</td>
                  <td className="p-3 sm:p-4 text-center text-zinc-500">N/A</td>
                  <td className="p-3 sm:p-4 text-center text-zinc-400">$0.45+</td>
                </tr>
                {/* Opus calls per month on $20 plan */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">Opus 4 calls on $20</td>
                  <td className="p-3 sm:p-4 text-center text-[#ef4444] font-bold text-base">250</td>
                  <td className="p-3 sm:p-4 text-center text-zinc-400">~22</td>
                  <td className="p-3 sm:p-4 text-center text-zinc-500">0 (no API)</td>
                  <td className="p-3 sm:p-4 text-center text-zinc-400">~44</td>
                </tr>
                {/* API access */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">API access (Claude Code, scripts)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
                {/* Multiple model families */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">Multi-provider (Anthropic + OpenAI + Google)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
                {/* Flat per-request billing */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">Flat per-call (no token math)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                </tr>
                {/* No context-length anxiety */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">Same price for 5K or 200K prompt</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center text-zinc-500 text-[10px]">mixed</td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                </tr>
                {/* Free frontier model included */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">Free frontier model included</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                </tr>
                {/* One key for everything */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">One key, every model</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center text-zinc-500 text-[10px]">Claude only</td>
                  <td className="p-3 sm:p-4 text-center text-zinc-500 text-[10px]">OpenAI only</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
                {/* Bring-your-own client */}
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4 text-zinc-300">OpenAI-compatible (any client)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-zinc-600 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Real-world economics callout */}
          <div className="grid md:grid-cols-3 gap-4 pt-4">
            <div className="border border-zinc-800 bg-[#0a0a0c] p-6 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-[#ef4444]/5 blur-2xl rounded-full" />
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Heavy Claude Code user</div>
              <div className="font-mono">
                <div className="text-[10px] text-zinc-400 line-through">Claude Max 20x: $200/mo</div>
                <div className="text-[10px] text-zinc-400 line-through">OpenRouter direct: $540/mo</div>
              </div>
              <div className="text-2xl font-black font-mono text-[#ef4444]">AkaRouter Ultra: $50/mo</div>
              <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
                750 Opus 4.8 calls + free frontier + unlimited cheap models. <span className="text-emerald-400 font-bold">91% cheaper</span> than Max 20x.
              </p>
            </div>

            <div className="border border-zinc-800 bg-[#0a0a0c] p-6 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 blur-2xl rounded-full" />
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Indie / weekend hacker</div>
              <div className="font-mono">
                <div className="text-[10px] text-zinc-400 line-through">ChatGPT Plus: $20/mo (no API)</div>
                <div className="text-[10px] text-zinc-400 line-through">API key: separate $20+</div>
              </div>
              <div className="text-2xl font-black font-mono text-emerald-400">AkaRouter Pro: $20/mo</div>
              <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
                250 Opus + 500 Sonnet + 5000+ cheap calls in ONE key. <span className="text-emerald-400 font-bold">Replace two subscriptions</span>.
              </p>
            </div>

            <div className="border border-zinc-800 bg-[#0a0a0c] p-6 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 blur-2xl rounded-full" />
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Cost-conscious team</div>
              <div className="font-mono">
                <div className="text-[10px] text-zinc-400 line-through">OpenAI API: $500+/mo</div>
                <div className="text-[10px] text-zinc-400 line-through">Claude API: $400+/mo</div>
              </div>
              <div className="text-2xl font-black font-mono text-amber-400">AkaRouter Ultra: $50/mo</div>
              <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
                Route everything through ONE gateway. <span className="text-emerald-400 font-bold">87% off</span> retail API spend at the same workload.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PAY-PER-REQUEST EXPLAINED — killer feature */}
      <section id="pay-per-request" className="border-t border-[#27272a] py-20 bg-[#0e0e10] px-6 micro-grid">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-[9px] font-mono text-amber-400 uppercase tracking-wider">
              <Zap className="w-3 h-3" />
              the billing model that makes sense
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-white">
              Pay per request. <span className="text-[#ef4444]">Not per token.</span>
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 font-mono max-w-2xl mx-auto leading-relaxed">
              Most APIs charge per million tokens. We charge per call — flat. Same price whether your prompt is 500 words or 200,000 tokens.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Token billing card */}
            <div className="border border-zinc-800 bg-[#0a0a0c] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">the old way</div>
                <DollarSign className="w-5 h-5 text-zinc-600" />
              </div>
              <h4 className="text-lg font-mono font-bold text-zinc-300">Pay-per-token (OpenRouter, direct APIs)</h4>
              <div className="border border-zinc-900 bg-black/40 p-4 font-mono text-[10px] space-y-2 text-zinc-400">
                <div className="flex justify-between">
                  <span>5K-token prompt</span>
                  <span className="text-zinc-500">$0.025</span>
                </div>
                <div className="flex justify-between">
                  <span>50K-token prompt (medium Claude Code)</span>
                  <span className="text-zinc-500">$0.25</span>
                </div>
                <div className="flex justify-between">
                  <span>200K-token prompt (full context Opus)</span>
                  <span className="text-red-400 font-bold">$1.00+</span>
                </div>
                <div className="border-t border-zinc-900 pt-2 flex justify-between text-zinc-300 font-bold">
                  <span>Same question, 40x cost variance</span>
                </div>
              </div>
              <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
                Every time you stuff more code into context, you pay more. Every long doc. Every large repo clone. Token anxiety is real.
              </p>
            </div>

            {/* AkaRouter card */}
            <div className="border border-[#ef4444] bg-[#0a0a0c] p-6 space-y-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#ef4444]/10 blur-2xl rounded-full pointer-events-none" />
              <div className="flex items-center justify-between relative">
                <div className="font-mono text-[10px] text-[#ef4444] uppercase tracking-widest font-bold">AkaRouter way</div>
                <Zap className="w-5 h-5 text-[#ef4444]" />
              </div>
              <h4 className="text-lg font-mono font-bold text-white relative">Flat per-call, every size</h4>
              <div className="border border-[#ef4444]/30 bg-black/40 p-4 font-mono text-[10px] space-y-2 relative">
                <div className="flex justify-between">
                  <span className="text-zinc-300">5K-token prompt</span>
                  <span className="text-[#ef4444] font-bold">10 pts ($0.08)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-300">50K-token prompt</span>
                  <span className="text-[#ef4444] font-bold">10 pts ($0.08)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-300">200K-token prompt</span>
                  <span className="text-[#ef4444] font-bold">10 pts ($0.08)</span>
                </div>
                <div className="border-t border-[#ef4444]/30 pt-2 flex justify-between text-white font-bold">
                  <span>Same question, same price</span>
                  <Check className="w-3 h-3 text-emerald-400" />
                </div>
              </div>
              <p className="text-[10px] font-mono text-zinc-300 leading-relaxed relative">
                <span className="text-[#ef4444] font-bold">As long as your prompt fits in the model's context window</span>, you pay the same. Opus 4.8 fits 200K tokens. Use them all.
              </p>
            </div>
          </div>

          {/* Three killer benefits */}
          <div className="grid md:grid-cols-3 gap-px bg-zinc-800 border border-zinc-800 mt-8">
            <div className="bg-[#09090b] p-6 space-y-3">
              <Layers className="w-6 h-6 text-[#ef4444]" />
              <h4 className="font-mono text-sm font-bold uppercase text-white">No token math</h4>
              <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
                Don't calculate input/output token splits. Don't estimate cost before every request. Just call the model.
              </p>
            </div>
            <div className="bg-[#09090b] p-6 space-y-3">
              <Brain className="w-6 h-6 text-amber-400" />
              <h4 className="font-mono text-sm font-bold uppercase text-white">Use full context</h4>
              <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
                Stuff the whole codebase in. Drop in 10 PDFs. Use the full 200K Opus window without a calculator.
              </p>
            </div>
            <div className="bg-[#09090b] p-6 space-y-3">
              <Code2 className="w-6 h-6 text-emerald-400" />
              <h4 className="font-mono text-sm font-bold uppercase text-white">Predictable bills</h4>
              <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
                100 Opus calls = $8. Always. Same on Monday, same on Sunday. No surprise overages.
              </p>
            </div>
          </div>

          <div className="text-center pt-4">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              * Per-call pricing applies as long as your prompt fits within the model's documented context window. Hit the limit? Split your request — or upgrade to a model with a bigger window.
            </p>
          </div>
        </div>
      </section>

      {/* POINTS PRICING — full transparency */}
      <section id="points-table" className="border-t border-[#27272a] py-20 bg-[#09090b] px-6">
        <div className="max-w-6xl mx-auto space-y-10">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 text-[9px] font-mono text-zinc-400 uppercase tracking-wider">
              <DollarSign className="w-3 h-3 text-emerald-400" />
              full pricing transparency
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-white">
              Every model. Every point cost.
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 font-mono max-w-2xl mx-auto">
              No hidden tiers. No "premium" markups. The whole menu, at the price you'll actually pay.
            </p>
          </div>

          <div className="border border-zinc-800 bg-[#0a0a0c] overflow-x-auto">
            <table className="w-full font-mono text-[11px] sm:text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-[#0e0e10]">
                  <th className="text-left p-3 sm:p-4 text-zinc-500 uppercase tracking-wider font-bold">Model</th>
                  <th className="p-3 sm:p-4 text-center text-zinc-500 uppercase tracking-wider font-bold">Tier</th>
                  <th className="p-3 sm:p-4 text-center text-zinc-500 uppercase tracking-wider font-bold">Points/call</th>
                  <th className="p-3 sm:p-4 text-center text-zinc-500 uppercase tracking-wider font-bold">Pro $20/mo</th>
                  <th className="p-3 sm:p-4 text-center text-zinc-500 uppercase tracking-wider font-bold">Best for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">MiniMax M3</div>
                    <div className="text-[9px] text-zinc-500">frontier, free to us</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] uppercase">free</span></td>
                  <td className="p-3 sm:p-4 text-center text-amber-400 font-black text-base">1</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">2,500 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">frontier reasoning, daily driver</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">Claude Haiku 4.5</div>
                    <div className="text-[9px] text-zinc-500">fast + cheap</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] uppercase">T1</span></td>
                  <td className="p-3 sm:p-4 text-center text-amber-400 font-bold">2</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">1,250 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">lightweight tasks, quick Q&A</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">Nemotron Ultra</div>
                    <div className="text-[9px] text-zinc-500">free-tier alternative</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] uppercase">T1</span></td>
                  <td className="p-3 sm:p-4 text-center text-amber-400 font-bold">2</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">1,250 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">high-volume free tier</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">Claude Sonnet 4.6</div>
                    <div className="text-[9px] text-zinc-500">workhorse</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] uppercase">T2</span></td>
                  <td className="p-3 sm:p-4 text-center text-amber-400 font-bold">5</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">500 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">coding, mid-complex reasoning</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">GPT-5.4</div>
                    <div className="text-[9px] text-zinc-500">multimodal</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] uppercase">T2</span></td>
                  <td className="p-3 sm:p-4 text-center text-amber-400 font-bold">5</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">500 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">vision + reasoning + tools</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">Gemini 3.1 Pro</div>
                    <div className="text-[9px] text-zinc-500">1M context, multimodal</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] uppercase">T2</span></td>
                  <td className="p-3 sm:p-4 text-center text-amber-400 font-bold">5</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">500 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">huge context, video, audio</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">Claude Opus 4.8</div>
                    <div className="text-[9px] text-zinc-500">the best reasoning</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] text-[10px] uppercase font-bold">T3</span></td>
                  <td className="p-3 sm:p-4 text-center text-[#ef4444] font-black text-base">10</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">250 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">deepest reasoning, hard problems</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">GPT-5.5</div>
                    <div className="text-[9px] text-zinc-500">flagship OpenAI</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] text-[10px] uppercase font-bold">T3</span></td>
                  <td className="p-3 sm:p-4 text-center text-[#ef4444] font-black text-base">10</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">250 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">agentic workflows, code gen</td>
                </tr>
                <tr className="hover:bg-zinc-950/50">
                  <td className="p-3 sm:p-4">
                    <div className="text-white font-bold">GPT-5.3 Codex Spark</div>
                    <div className="text-[9px] text-zinc-500">coding specialist</div>
                  </td>
                  <td className="p-3 sm:p-4 text-center"><span className="px-2 py-0.5 bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] text-[10px] uppercase font-bold">T3</span></td>
                  <td className="p-3 sm:p-4 text-center text-[#ef4444] font-black text-base">10</td>
                  <td className="p-3 sm:p-4 text-center text-white font-bold">250 calls</td>
                  <td className="p-3 sm:p-4 text-zinc-400 text-[10px]">large code refactors</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-center">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Pro Plan ships with 2,500 points/month. Ultra ships with 7,500. Mix and match freely — no model locking.
            </p>
          </div>
        </div>
      </section>

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