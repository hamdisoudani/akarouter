'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Layers, Terminal, Sparkles, Copy, Check, Cpu, RefreshCw, Zap, Shield, ArrowRight } from 'lucide-react'

export default function Home() {
  const [copied, setCopied] = useState(false)
  const codeSnippet = `from openai import OpenAI

client = OpenAI(
  base_url="http://localhost:8000/v1", # Local or production URL
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
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-24 h-12 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <img src="/logo.png" alt="AkaRouter Logo" className="w-full h-full object-contain scale-[2.5]" />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <a href="#features" className="text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors">Features</a>
            <a href="#models" className="text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white transition-colors">Models</a>
            <Link href="/auth/login" className="text-xs font-mono uppercase tracking-wider text-zinc-300 hover:text-white transition-colors">
              Sign in
            </Link>
            <Link 
              href="/auth/login" 
              className="relative inline-flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 text-white font-mono text-xs py-2 px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all crosshair-corners"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-16 z-10">
        <div className="max-w-4xl text-center space-y-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-zinc-950 border border-zinc-800 font-mono text-[9px] tracking-widest text-[#ef4444] uppercase">
            <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
            [SYS_STATUS]: GATEWAY_ONLINE_READY
          </div>

          {/* Heading */}
          <h2 className="text-4xl md:text-6xl font-black font-mono tracking-tighter leading-none uppercase text-white">
            AI INFERENCE ROUTING
            <br />
            <span className="text-gradient-primary">ONE KEY, EVERY MODEL</span>
          </h2>

          <p className="mt-4 text-xs md:text-sm text-zinc-400 max-w-2xl mx-auto font-mono uppercase tracking-wide leading-relaxed">
            Access high-performance LLMs through a unified, high-availability API gateway. Features low-latency routing, smart load-balancing, and robust error failover.
          </p>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Link 
              href="/auth/login" 
              className="bg-[#ef4444] text-black font-mono text-xs font-bold py-3.5 px-8 hover:bg-[#ff5451] transition-all red-glow flex items-center gap-2"
            >
              <span className="font-bold">[+]</span> START FOR FREE
            </Link>
            <a 
              href="#models" 
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold py-3.5 px-8 hover:border-zinc-500 hover:text-white transition-all"
            >
              EXPLORE_MODELS
            </a>
          </div>

          {/* Code IDE Container */}
          <div className="mt-16 w-full max-w-2xl text-left bg-[#0e0e10] border border-[#27272a] crosshair-corners">
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
            <div className="p-5 font-mono text-[11px] text-zinc-300 overflow-x-auto bg-[#050507] leading-relaxed">
              <pre>{codeSnippet}</pre>
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
              <p className="text-xs text-zinc-400 font-mono leading-relaxed">Granular subscription tier rate limits, monthly request counts, and token analytics logged per API key.</p>
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

          <div className="grid md:grid-cols-2 gap-0 border border-[#27272a]">
            <div className="p-8 hover:bg-zinc-950/20 border-b md:border-b-0 md:border-r border-[#27272a] transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-[#ef4444] font-mono text-xs font-bold">
                    PRO
                  </div>
                  <div>
                    <h4 className="font-semibold font-mono text-white text-xs uppercase tracking-wider">akarouter-pro</h4>
                    <p className="text-[9px] text-zinc-500 font-mono">Target: Step 3.7 Flash</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 border border-[#ef4444]/30 bg-[#ef4444]/10 text-[9px] font-mono text-[#ef4444] uppercase tracking-wider">Default</span>
              </div>
              <p className="text-xs text-zinc-400 font-mono leading-relaxed">High intelligence, versatile LLM optimized for detailed reasoning, complex coding, and structured Q&A.</p>
            </div>

            <div className="p-8 hover:bg-zinc-950/20 transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 border border-zinc-800 bg-zinc-900 flex items-center justify-center text-[#ef4444] font-mono text-xs font-bold">
                    FSH
                  </div>
                  <div>
                    <h4 className="font-semibold font-mono text-white text-xs uppercase tracking-wider">akarouter-flash</h4>
                    <p className="text-[9px] text-zinc-500 font-mono">Target: Nemotron 3 Ultra</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 border border-zinc-800 bg-zinc-900 text-[9px] font-mono text-zinc-400 uppercase tracking-wider">Fast</span>
              </div>
              <p className="text-xs text-zinc-400 font-mono leading-relaxed">Low-latency, highly concurrent completions ideal for summarization, real-time agents, and high-throughput applications.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#27272a] py-8 text-center text-xs text-zinc-600 bg-[#09090b] micro-grid">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-[10px]">
          <p>© 2026 AkaRouter. Kernel: v4.2.0-STABLE. Powered by Supabase & Next.js.</p>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-zinc-400 transition-colors uppercase">Documentation</a>
            <a href="#" className="hover:text-zinc-400 transition-colors uppercase">Terms of Service</a>
            <a href="#" className="hover:text-zinc-400 transition-colors uppercase">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
