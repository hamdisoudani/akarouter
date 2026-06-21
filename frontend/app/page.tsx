import Link from 'next/link'
import Image from 'next/image'
import { MarketingNav } from '@/components/MarketingNav'
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
import { fetchServerPlans, fetchServerModels, fetchServerBillingMatrix } from '@/lib/server-api'
import { CopyButton } from '@/components/CopyButton'
import { ModelCatalog } from '@/components/ModelCatalog'
import { PointsTable } from '@/components/PointsTable'
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
      '150 points/mo',
    ],
  },
  {
    key: 'pro',
    name: 'Pro Plan',
    price: '$19.99',
    billing: 'monthly',
    desc: 'Perfect for production apps and high-volume use.',
    badge: 'Most Popular',
    limits: [
      'Monthly Budget: $15.00',
      'RPM Limit: 60 RPM',
      '5-Hour Limit: $5.00',
      '7-Day Limit: $20.00',
      '2,500 points/mo',
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
      '21,000 points/mo',
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
      // Don't ever auto-append a free-trial badge. Per user directive
      // 2026-06-21, AkaRouter does not run a 7-day free trial program —
      // subscribers pay from day 1 and new accounts land directly on
      // the free tier if they don't pick a paid plan.
      let badge = plan.badge ?? matching?.badge ?? null
      if (badge && /free trial/i.test(badge)) {
        // Strip trial wording from DB-supplied badges so an old
        // "Most popular • 7-day free trial" row doesn't leak the
        // removed trial copy.
        badge = badge.replace(/\s*[•·]\s*\d+\s*-?\s*day\s+free\s+trial/i, '').trim() || null
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

  // Fetch the billing matrix for the points-pricing table so the
  // displayed points/call always matches what the endpoint actually
  // charges. Was hardcoded with stale numbers (table said MiniMax
  // M3 = 1 pt and Claude Haiku = 2 pt, but both endpoints charge 1
  // pt under the current matrix). User-reported 2026-06-21.
  const billingMatrix = await fetchServerBillingMatrix()

  // Server-only URL — never sent to the browser.
  const gatewayUrl = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')

  const codeSnippet = `from openai import OpenAI

client = OpenAI(
  base_url="${gatewayUrl}/v1",
  api_key="akar_your_key_here"
)

response = client.chat.completions.create(
  model="step-37-flash",
  messages=[{"role": "user", "content": "Hello AkaRouter!"}]
)`

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col overflow-hidden selection:bg-[#ef4444]/30 selection:text-foreground grid-bg">
      {/* Red ambient glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[500px] bg-gradient-to-b from-[#ef4444]/5 via-transparent to-transparent rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[400px] right-[-100px] w-[300px] h-[300px] bg-[#ef4444]/2 rounded-full blur-[100px] pointer-events-none" />

      {/* Navigation (theme-aware + user-aware via useApp from providers) */}
      <MarketingNav />

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pt-16 pb-12 z-10">
        <div className="w-full max-w-4xl text-center space-y-6 flex flex-col items-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-muted/40 border border-border font-mono text-[9px] tracking-widest text-[#ef4444] uppercase">
            <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
            [SYS_STATUS]: GATEWAY_ONLINE_READY
          </div>

          {/* Headline — led by the savings number */}
          <h2 className="text-3xl sm:text-5xl md:text-7xl font-black font-mono tracking-tighter leading-[0.95] uppercase text-foreground break-words w-full px-2">
            CLAUDE MAX 20X
            <br />
            <span className="text-muted-foreground/70 line-through decoration-[#ef4444] decoration-4">$200/MO</span>{' '}
            <span className="text-gradient-primary">$20/MO</span>
          </h2>

          <p className="mt-2 text-sm md:text-base text-foreground/80 max-w-2xl mx-auto font-mono leading-relaxed px-2">
            Same Opus 4.8. Same prompt size limits. <span className="text-[#ef4444] font-bold">91% cheaper.</span>
            <br className="hidden sm:block" />
            <span className="text-muted-foreground/80 text-xs md:text-sm">Pay-per-request. One API key. Every frontier model.</span>
          </p>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/auth/login"
              className="bg-[#ef4444] text-black font-mono text-xs font-bold py-3.5 px-8 hover:bg-[#ef4444] transition-all red-glow flex items-center gap-2"
            >
              <span className="font-bold">[+]</span> GET 100 FREE POINTS
            </Link>
            <a
              href="#why"
              className="bg-muted border border-border text-foreground/80 font-mono text-xs font-bold py-3.5 px-8 hover:border-muted-foreground hover:text-foreground transition-all"
            >
              SEE_COMPARISON
            </a>
            <a
              href="#pricing"
              className="bg-muted border border-border text-muted-foreground font-mono text-xs font-bold py-3.5 px-8 hover:border-muted-foreground hover:text-foreground transition-all"
            >
              VIEW_PRICING
            </a>
          </div>

          <p className="text-[9px] text-[#ef4444] font-mono uppercase tracking-widest pt-2 animate-pulse font-bold">
            * Every signup ships with 100 free points on 1pt models (10/day cap). No credit card.
          </p>

          {/* Code IDE Container */}
          <div className="mt-12 w-full max-w-2xl text-left bg-card border border-border crosshair-corners overflow-hidden">
            <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[#ef4444] red-glow" />
                <span className="text-[10px] text-muted-foreground font-mono font-bold tracking-widest uppercase">CONNECTION_CONFIG.PY</span>
              </div>
              <CopyButton text={codeSnippet} />
            </div>
            <div className="p-5 font-mono text-[11px] text-foreground/80 overflow-x-auto bg-card/80 leading-relaxed max-w-full">
              <pre className="whitespace-pre sm:whitespace-pre-wrap">{codeSnippet}</pre>
            </div>
          </div>

          {/* Trust strip */}
          <div className="mt-10 w-full max-w-3xl grid grid-cols-2 sm:grid-cols-4 gap-px bg-muted border border-border">
            <div className="bg-background p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-[#ef4444]">$0.08</div>
              <div className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest mt-1">per Opus 4.8 call</div>
            </div>
            <div className="bg-background p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-emerald-400">11</div>
              <div className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest mt-1">frontier models</div>
            </div>
            <div className="bg-background p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-amber-400">0¢</div>
              <div className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest mt-1">context-length anxiety</div>
            </div>
            <div className="bg-background p-4 text-center">
              <div className="text-xl sm:text-2xl font-black font-mono text-foreground">1 KEY</div>
              <div className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest mt-1">unified API</div>
            </div>
          </div>
        </div>
      </main>

      {/* WHY AKAROUTER — competitor comparison */}
      <section id="why" className="border-t border-border py-20 bg-background px-6 micro-grid">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
              <TrendingDown className="w-3 h-3 text-[#ef4444]" />
              the brutal math
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-foreground">
              Why pay 5x–90x more for the same model?
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground font-mono uppercase tracking-wider max-w-2xl mx-auto">
              Same upstream models. Same prompts. Same response quality. AkaRouter routes you to the same providers
              the big guys use — we just don't mark it up 50x.
            </p>
          </div>

          {/* Comparison matrix */}
          <div className="border border-border bg-background overflow-x-auto">
            <table className="w-full font-mono text-[10px] sm:text-xs">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="text-left p-3 sm:p-4 text-muted-foreground/80 uppercase tracking-wider font-bold">Feature</th>
                  <th className="p-3 sm:p-4 text-center">
                    <div className="text-[#ef4444] uppercase font-black tracking-wider text-[11px] sm:text-sm">AkaRouter</div>
                    <div className="text-[9px] text-muted-foreground/80 mt-0.5">Pro $20/mo</div>
                  </th>
                  <th className="p-3 sm:p-4 text-center text-muted-foreground uppercase tracking-wider font-bold">
                    <div>Claude Max 20x</div>
                    <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-normal">$200/mo</div>
                  </th>
                  <th className="p-3 sm:p-4 text-center text-muted-foreground uppercase tracking-wider font-bold">
                    <div>ChatGPT Pro</div>
                    <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-normal">$200/mo</div>
                  </th>
                  <th className="p-3 sm:p-4 text-center text-muted-foreground uppercase tracking-wider font-bold">
                    <div>OpenRouter</div>
                    <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-normal">pay-as-you-go</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {/* Price row */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">Per-call cost (Opus 4)</td>
                  <td className="p-3 sm:p-4 text-center text-[#ef4444] font-bold text-base">$0.08</td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground">$0.90</td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground/80">N/A</td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground">$0.45+</td>
                </tr>
                {/* Opus calls per month on $20 plan */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">Opus 4 calls on $20</td>
                  <td className="p-3 sm:p-4 text-center text-[#ef4444] font-bold text-base">250</td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground">~22</td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground/80">0 (no API)</td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground">~44</td>
                </tr>
                {/* API access */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">API access (Claude Code, scripts)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
                {/* Multiple model families */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">Multi-provider (Anthropic + OpenAI + Google)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
                {/* Flat per-request billing */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">Flat per-call (no token math)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                </tr>
                {/* No context-length anxiety */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">Same price for 5K or 200K prompt</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground/80 text-[10px]">mixed</td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                </tr>
                {/* Free frontier model included */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">Free frontier model included</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                </tr>
                {/* One key for everything */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">One key, every model</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground/80 text-[10px]">Claude only</td>
                  <td className="p-3 sm:p-4 text-center text-muted-foreground/80 text-[10px]">OpenAI only</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
                {/* Bring-your-own client */}
                <tr className="hover:bg-muted/40/50">
                  <td className="p-3 sm:p-4 text-foreground/80">OpenAI-compatible (any client)</td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><X className="w-4 h-4 text-muted-foreground/70 mx-auto" /></td>
                  <td className="p-3 sm:p-4 text-center"><Check className="w-4 h-4 text-emerald-400 mx-auto" /></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Real-world economics callout */}
          <div className="grid md:grid-cols-3 gap-4 pt-4">
            <div className="border border-border bg-background p-6 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-[#ef4444]/5 blur-2xl rounded-full" />
              <div className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest">Heavy Claude Code user</div>
              <div className="font-mono">
                <div className="text-[10px] text-muted-foreground line-through">Claude Max 20x: $200/mo</div>
                <div className="text-[10px] text-muted-foreground line-through">OpenRouter direct: $540/mo</div>
              </div>
              <div className="text-2xl font-black font-mono text-[#ef4444]">AkaRouter Ultra: $50/mo</div>
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                750 Opus 4.8 calls + free frontier + unlimited cheap models. <span className="text-emerald-400 font-bold">91% cheaper</span> than Max 20x.
              </p>
            </div>

            <div className="border border-border bg-background p-6 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 blur-2xl rounded-full" />
              <div className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest">Indie / weekend hacker</div>
              <div className="font-mono">
                <div className="text-[10px] text-muted-foreground line-through">ChatGPT Plus: $20/mo (no API)</div>
                <div className="text-[10px] text-muted-foreground line-through">API key: separate $20+</div>
              </div>
              <div className="text-2xl font-black font-mono text-emerald-400">AkaRouter Pro: $20/mo</div>
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                250 Opus + 500 Sonnet + 5000+ cheap calls in ONE key. <span className="text-emerald-400 font-bold">Replace two subscriptions</span>.
              </p>
            </div>

            <div className="border border-border bg-background p-6 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 blur-2xl rounded-full" />
              <div className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest">Cost-conscious team</div>
              <div className="font-mono">
                <div className="text-[10px] text-muted-foreground line-through">OpenAI API: $500+/mo</div>
                <div className="text-[10px] text-muted-foreground line-through">Claude API: $400+/mo</div>
              </div>
              <div className="text-2xl font-black font-mono text-amber-400">AkaRouter Ultra: $50/mo</div>
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                Route everything through ONE gateway. <span className="text-emerald-400 font-bold">87% off</span> retail API spend at the same workload.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PAY-PER-REQUEST EXPLAINED — killer feature */}
      <section id="pay-per-request" className="border-t border-border py-20 bg-card px-6 micro-grid">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-[9px] font-mono text-amber-400 uppercase tracking-wider">
              <Zap className="w-3 h-3" />
              the billing model that makes sense
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-foreground">
              Pay per request. <span className="text-[#ef4444]">Not per token.</span>
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground font-mono max-w-2xl mx-auto leading-relaxed">
              Most APIs charge per million tokens. We charge per call — flat. Same price whether your prompt is 500 words or 200,000 tokens.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Token billing card */}
            <div className="border border-border bg-background p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] text-muted-foreground/80 uppercase tracking-widest">the old way</div>
                <DollarSign className="w-5 h-5 text-muted-foreground/70" />
              </div>
              <h4 className="text-lg font-mono font-bold text-foreground/80">Pay-per-token (OpenRouter, direct APIs)</h4>
              <div className="border border-border bg-black/40 p-4 font-mono text-[10px] space-y-2 text-muted-foreground">
                <div className="flex justify-between">
                  <span>5K-token prompt</span>
                  <span className="text-muted-foreground/80">$0.025</span>
                </div>
                <div className="flex justify-between">
                  <span>50K-token prompt (medium Claude Code)</span>
                  <span className="text-muted-foreground/80">$0.25</span>
                </div>
                <div className="flex justify-between">
                  <span>200K-token prompt (full context Opus)</span>
                  <span className="text-red-400 font-bold">$1.00+</span>
                </div>
                <div className="border-t border-border pt-2 flex justify-between text-foreground/80 font-bold">
                  <span>Same question, 40x cost variance</span>
                </div>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                Every time you stuff more code into context, you pay more. Every long doc. Every large repo clone. Token anxiety is real.
              </p>
            </div>

            {/* AkaRouter card */}
            <div className="border border-[#ef4444] bg-background p-6 space-y-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#ef4444]/10 blur-2xl rounded-full pointer-events-none" />
              <div className="flex items-center justify-between relative">
                <div className="font-mono text-[10px] text-[#ef4444] uppercase tracking-widest font-bold">AkaRouter way</div>
                <Zap className="w-5 h-5 text-[#ef4444]" />
              </div>
              <h4 className="text-lg font-mono font-bold text-foreground relative">Flat per-call, every size</h4>
              <div className="border border-[#ef4444]/30 bg-black/40 p-4 font-mono text-[10px] space-y-2 relative">
                <div className="flex justify-between">
                  <span className="text-foreground/80">5K-token prompt</span>
                  <span className="text-[#ef4444] font-bold">10 pts ($0.08)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/80">50K-token prompt</span>
                  <span className="text-[#ef4444] font-bold">10 pts ($0.08)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/80">200K-token prompt</span>
                  <span className="text-[#ef4444] font-bold">10 pts ($0.08)</span>
                </div>
                <div className="border-t border-[#ef4444]/30 pt-2 flex justify-between text-foreground font-bold">
                  <span>Same question, same price</span>
                  <Check className="w-3 h-3 text-emerald-400" />
                </div>
              </div>
              <p className="text-[10px] font-mono text-foreground/80 leading-relaxed relative">
                <span className="text-[#ef4444] font-bold">As long as your prompt fits in the model's context window</span>, you pay the same. Opus 4.8 fits 200K tokens. Use them all.
              </p>
            </div>
          </div>

          {/* Three killer benefits */}
          <div className="grid md:grid-cols-3 gap-px bg-muted border border-border mt-8">
            <div className="bg-background p-6 space-y-3">
              <Layers className="w-6 h-6 text-[#ef4444]" />
              <h4 className="font-mono text-sm font-bold uppercase text-foreground">No token math</h4>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                Don't calculate input/output token splits. Don't estimate cost before every request. Just call the model.
              </p>
            </div>
            <div className="bg-background p-6 space-y-3">
              <Brain className="w-6 h-6 text-amber-400" />
              <h4 className="font-mono text-sm font-bold uppercase text-foreground">Use full context</h4>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                Stuff the whole codebase in. Drop in 10 PDFs. Use the full 200K Opus window without a calculator.
              </p>
            </div>
            <div className="bg-background p-6 space-y-3">
              <Code2 className="w-6 h-6 text-emerald-400" />
              <h4 className="font-mono text-sm font-bold uppercase text-foreground">Predictable bills</h4>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                100 Opus calls = $8. Always. Same on Monday, same on Sunday. No surprise overages.
              </p>
            </div>
          </div>

          <div className="text-center pt-4">
            <p className="text-[10px] font-mono text-muted-foreground/80 uppercase tracking-wider">
              * Per-call pricing applies as long as your prompt fits within the model's documented context window. Hit the limit? Split your request — or upgrade to a model with a bigger window.
            </p>
          </div>
        </div>
      </section>

      {/* POINTS PRICING — full transparency */}
      <section id="points-table" className="border-t border-border py-20 bg-background px-6">
        <div className="max-w-6xl mx-auto space-y-10">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
              <DollarSign className="w-3 h-3 text-emerald-400" />
              full pricing transparency
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-foreground">
              Every model. Every point cost.
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground font-mono max-w-2xl mx-auto">
              No hidden tiers. No "premium" markups. The whole menu, at the price you'll actually pay.
            </p>
          </div>

          <PointsTable matrix={billingMatrix} />

          <div className="text-center">
            <p className="text-[10px] font-mono text-muted-foreground/80 uppercase tracking-wider">
              Pro Plan ships with 2,500 points/month. Ultra ships with 7,500. Mix and match freely — no model locking.
            </p>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="border-t border-border py-24 bg-card/40 px-6 micro-grid">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center space-y-3">
            <h3 className="text-2xl font-bold font-mono tracking-wider uppercase text-foreground">ROBUST LLM GATEWAY KERNEL</h3>
            <p className="text-xs text-muted-foreground/80 font-mono uppercase tracking-widest">Built from the ground up for high availability and low-latency inference workloads.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-0 border border-border">
            <div className="p-8 space-y-4 border-b md:border-b-0 md:border-r border-border hover:bg-muted/40/20 transition-all group">
              <div className="w-10 h-10 border border-border bg-muted flex items-center justify-center text-muted-foreground group-hover:text-[#ef4444] group-hover:border-[#ef4444] transition-all">
                <Cpu className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold font-mono tracking-wider uppercase text-foreground">SMART LOAD BALANCING</h4>
              <p className="text-xs text-muted-foreground font-mono leading-relaxed">Round-robin routing with real-time health weighting and dynamic in-flight concurrency tracking.</p>
            </div>

            <div className="p-8 space-y-4 border-b md:border-b-0 md:border-r border-border hover:bg-muted/40/20 transition-all group">
              <div className="w-10 h-10 border border-border bg-muted flex items-center justify-center text-muted-foreground group-hover:text-[#ef4444] group-hover:border-[#ef4444] transition-all">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold font-mono tracking-wider uppercase text-foreground">HIGH-AVAILABILITY FAILOVER</h4>
              <p className="text-xs text-muted-foreground font-mono leading-relaxed">Automatic request retry and hot-swap routing. If a routing target goes down, traffic is immediately re-allocated.</p>
            </div>

            <div className="p-8 space-y-4 hover:bg-muted/40/20 transition-all group">
              <div className="w-10 h-10 border border-border bg-muted flex items-center justify-center text-muted-foreground group-hover:text-[#ef4444] group-hover:border-[#ef4444] transition-all">
                <Shield className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold font-mono tracking-wider uppercase text-foreground">QUOTA MANAGEMENT</h4>
              <p className="text-xs text-muted-foreground font-mono leading-relaxed">Granular subscription tier rate limits, sliding token budgets, and cost analytics logged per API key.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Models Section — preview with link to full catalog */}
      <section id="models" className="border-t border-border py-24 bg-background px-6">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="text-center space-y-3">
            <h3 className="text-2xl font-bold font-mono tracking-wider uppercase text-foreground">AVAILABLE MODELS</h3>
            <p className="text-xs text-muted-foreground/80 font-mono uppercase tracking-widest">All models accessible through a single API key. Supports per-token and per-request billing.</p>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              Per-Token & Per-Request Billing Active
            </div>
            <div className="pt-2">
              <Link
                href="/models"
                className="inline-flex items-center gap-2 px-4 py-2 bg-muted border border-border hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-foreground/80 hover:text-foreground font-mono text-[10px] uppercase tracking-wider transition-all"
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
      <section id="pricing" className="border-t border-border py-20 bg-background relative micro-grid">
        <div className="max-w-6xl mx-auto px-6 space-y-12">
          <div className="text-center space-y-4 flex flex-col items-center">
            <h3 className="text-2xl sm:text-4xl font-mono font-bold tracking-tight uppercase text-foreground">Pricing Profiles</h3>
            <div className="w-[3px] h-6 bg-[#ef4444] red-glow"></div>
            <p className="text-xs sm:text-sm text-muted-foreground font-mono uppercase tracking-wider max-w-xl">
              Choose a flexible subscription plan that matches your production throughput demands.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-6">
            {displayPlans.map((plan) => (
              <div
                key={plan.key}
                className={`relative bg-card border ${plan.badge ? 'border-[#ef4444] red-glow' : 'border-border'} p-8 flex flex-col justify-between hover:border-muted-foreground transition-all crosshair-corners`}
              >
                {plan.badge && (
                  <div className="absolute top-0 right-6 -translate-y-1/2 bg-[#ef4444] text-foreground font-mono text-[8px] font-bold px-2 py-0.5 tracking-widest uppercase red-glow">
                    {plan.badge}
                  </div>
                )}

                <div className="space-y-6">
                  <div className="space-y-1">
                    <h4 className="font-mono text-xs text-foreground font-bold uppercase tracking-wider">{plan.name}</h4>
                    <p className="text-[10px] font-mono text-muted-foreground/80 uppercase leading-relaxed">{plan.desc}</p>
                  </div>

                  <div className="flex items-baseline gap-1 py-3 border-y border-border">
                    <span className="font-mono text-3xl text-foreground font-bold tracking-tighter">{plan.price}</span>
                    <span className="font-mono text-[9px] text-muted-foreground/80 uppercase">/ {plan.billing}</span>
                  </div>

                  <ul className="space-y-2.5 font-mono text-[9px] text-muted-foreground">
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
                    className="w-full text-center block font-mono text-[9px] py-3.5 bg-muted border border-border text-foreground/80 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-foreground transition-all tracking-widest uppercase font-bold"
                  >
                    Select Plan
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-6 text-center border-t border-border">
            <p className="text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest leading-relaxed">
              * Need custom limits or an enterprise setup? Join our Telegram support group at <a href="https://t.me/akarouter_support" target="_blank" rel="noopener noreferrer" className="text-[#ef4444] hover:underline font-bold">t.me/akarouter_support</a> — we don't do email, just the group.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground/70 bg-background micro-grid">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-[10px]">
          <p>© 2026 AkaRouter by HAMDI. Kernel: v1.0.0-STABLE.</p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-muted-foreground transition-colors uppercase">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-muted-foreground transition-colors uppercase">Privacy Policy</Link>
            <Link href="/cookies" className="hover:text-muted-foreground transition-colors uppercase">Cookie Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}