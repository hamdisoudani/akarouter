'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Layers, Terminal, Sparkles, Copy, Check, Cpu, RefreshCw, Zap, Shield, ArrowRight } from 'lucide-react'
import { getGatewayUrl } from '@/lib/utils'
import { getPlans, type PlanPreset } from '@/lib/api'

export default function Home() {
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('http://localhost:8000')
  const [dbPlans, setDbPlans] = useState<PlanPreset[]>([])

  useEffect(() => {
    setOrigin(getGatewayUrl())
  }, [])

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
          'Hosted Agents: 2'
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
          'Hosted Agents: 5'
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

  const codeSnippet = `from openai import OpenAI

client = OpenAI(
  base_url="${origin}/v1",
  api_key="akar_your_key_here"
)

response = client.chat.completions.create(
  model="akarouter-pro",
  messages=[{"role": "user", "content": "Hello AkaRouter!"}]
)`

  const copyToClipboard = () => {
    navigator.clipboard.writeText(codeSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex flex-col overflow-hidden selection:bg-[#ef4444]/30 selection:text-white grid-bg">
      {/* Red ambient glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[500px] bg-gradient-to-b from-[#ef4444]/5 via-transparent to-transparent rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[400px] right-[-100px] w-[300px] h-[300px] bg-[#ef4444]/2 rounded-full blur-[100px] pointer-events-none" />

      {/* Navigation */}
      <nav className="sticky top-0 w-full z-50 border-b border-[#27272a] bg-[#09090b]/80 backdrop-blur-xl micro-grid">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-[208px] h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <img src="/logo.png" alt="AkaRouter Logo" className="w-full h-full object-contain scale-[2.5]" />
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
              <button 
                onClick={copyToClipboard}
                className="p-1.5 border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-500 transition-all"
                title="Copy code"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
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

      {/* Models Section */}
      <section id="models" className="border-t border-[#27272a] py-24 bg-[#09090b] px-6">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h3 className="text-2xl font-bold font-mono tracking-wider uppercase text-white">ACTIVE ROUTING TARGETS</h3>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest">Standard endpoints mapped dynamically to their highest performing model configurations.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-0 border border-[#27272a]">
            {/* Flash Card */}
            <div className="p-8 hover:bg-zinc-950/20 border-b md:border-b-0 md:border-r border-[#27272a] transition-all flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-zinc-400 font-mono text-xs font-bold">
                      FSH
                    </div>
                    <div>
                      <h4 className="font-semibold font-mono text-white text-xs uppercase tracking-wider">akarouter-flash</h4>
                      <p className="text-[9px] text-zinc-500 font-mono">Tier: Low-latency Completion</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 border border-zinc-850 bg-zinc-900 text-[9px] font-mono text-zinc-550 uppercase tracking-wider">Fast</span>
                </div>
                <p className="text-xs text-zinc-400 font-mono leading-relaxed">Low-latency, highly concurrent completions ideal for summarization, real-time agents, and high-throughput text workloads.</p>
                <div className="mt-4 space-y-1 font-mono text-[9px] text-zinc-500">
                  <div>[CONTEXT]: 1,000,000 TOKENS (1M)</div>
                  <div>[PRICING]: IN: $0.05/M | OUT: $0.15/M</div>
                </div>
              </div>
              <div className="mt-6">
                <span className="inline-flex items-center gap-1 text-[9px] text-zinc-500 font-mono uppercase tracking-wider bg-zinc-950 border border-zinc-900 px-2.5 py-1">
                  Text-Only LLM
                </span>
              </div>
            </div>

            {/* Large Card */}
            <div className="p-8 hover:bg-zinc-950/20 border-b md:border-b-0 md:border-r border-[#27272a] transition-all flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-emerald-450 font-mono text-xs font-bold">
                      LRG
                    </div>
                    <div>
                      <h4 className="font-semibold font-mono text-white text-xs uppercase tracking-wider">akarouter-large</h4>
                      <p className="text-[9px] text-zinc-500 font-mono">Tier: Long-Context Agentic</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 border border-emerald-950 bg-emerald-500/5 text-[9px] font-mono text-emerald-450 uppercase tracking-wider">1M Context</span>
                </div>
                <p className="text-xs text-zinc-400 font-mono leading-relaxed">Massive context window optimized for agentic tool use, multi-file code editing, and executing complex workflows.</p>
                <div className="mt-4 space-y-1 font-mono text-[9px] text-zinc-500">
                  <div>[CONTEXT]: 1,048,756 TOKENS (1M)</div>
                  <div>[PRICING]: IN: $0.10/M | OUT: $0.40/M</div>
                </div>
              </div>
              <div className="mt-6">
                <span className="inline-flex items-center gap-1 text-[9px] text-emerald-450 font-mono uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1">
                  Agentic-Optimized
                </span>
              </div>
            </div>

            {/* Pro Card */}
            <div className="p-8 hover:bg-zinc-950/20 transition-all flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-[#ef4444] font-mono text-xs font-bold red-glow">
                      PRO
                    </div>
                    <div>
                      <h4 className="font-semibold font-mono text-white text-xs uppercase tracking-wider">akarouter-pro</h4>
                      <p className="text-[9px] text-zinc-500 font-mono">Tier: Intelligence & Vision</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 border border-[#ef4444]/30 bg-[#ef4444]/10 text-[9px] font-mono text-[#ef4444] uppercase tracking-wider">Default</span>
                </div>
                <p className="text-xs text-zinc-400 font-mono leading-relaxed">High intelligence multimodal LLM optimized for deep reasoning, chain-of-thought analysis, visual understanding, and coding.</p>
                <div className="mt-4 space-y-1 font-mono text-[9px] text-zinc-500">
                  <div>[CONTEXT]: 256,000 TOKENS (256K)</div>
                  <div>[PRICING]: IN: $0.20/M | OUT: $0.80/M</div>
                </div>
              </div>
              <div className="mt-6">
                <span className="inline-flex items-center gap-1 text-[9px] text-[#ef4444] font-mono uppercase tracking-wider bg-[#ef4444]/10 border border-[#ef4444]/20 px-2.5 py-1 red-glow-text">
                  ✓ Reasoning & Vision (Images)
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
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
            {getDisplayPlans().map((plan, idx) => (
              <div 
                key={idx} 
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
                    {plan.limits.map((limit, lIdx) => (
                      <li key={lIdx} className="flex items-center gap-2">
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
