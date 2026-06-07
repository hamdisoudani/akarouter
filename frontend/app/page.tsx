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
    <div className="relative min-h-screen bg-[#030303] text-zinc-100 flex flex-col overflow-hidden selection:bg-indigo-500/30 selection:text-white">
      {/* Visual background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[500px] bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[400px] right-[-100px] w-[300px] h-[300px] bg-violet-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Navigation */}
      <nav className="sticky top-0 w-full z-50 border-b border-zinc-800/40 bg-[#030303]/70 backdrop-blur-xl transition-all duration-300">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/10">
              <Layers className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              AkaRouter
            </span>
          </div>

          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Features</a>
            <a href="#models" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Models</a>
            <Link href="/auth/login" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">
              Sign in
            </Link>
            <Link 
              href="/auth/login" 
              className="relative inline-flex items-center gap-1 bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 px-4 py-2 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/15 transition-all duration-300 hover:scale-[1.02]"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-16 z-10">
        <div className="max-w-4xl text-center space-y-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-indigo-500/5 border border-indigo-500/10 text-[11px] font-semibold tracking-wider text-indigo-400 uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            Zero Latency Overhead Proxy
          </div>

          {/* Heading */}
          <h2 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.15]">
            AI Inference routing.
            <br />
            <span className="text-gradient-primary">One key, every account.</span>
          </h2>

          <p className="mt-4 text-base md:text-lg text-zinc-400 max-w-2xl mx-auto font-medium">
            Access high-performance LLMs by proxying multiple upstream accounts. Features round-robin routing, health load-balancing, and automated OAuth token rotation.
          </p>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Link 
              href="/auth/login" 
              className="rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 text-sm font-bold shadow-xl shadow-indigo-500/20 active:scale-[0.98] transition-all duration-200"
            >
              Start for Free
            </Link>
            <a 
              href="#models" 
              className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-800/40 px-8 py-4 text-sm font-bold text-zinc-300 hover:text-white transition-all duration-200"
            >
              Explore Models
            </a>
          </div>

          {/* Code IDE Container */}
          <div className="mt-16 w-full max-w-2xl text-left glass-panel rounded-2xl overflow-hidden shadow-2xl animate-fade-in border border-zinc-800/60">
            <div className="bg-zinc-900/80 border-b border-zinc-800/60 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="text-[11px] text-zinc-500 font-mono ml-2 font-bold">quickstart.py</span>
              </div>
              <button 
                onClick={copyToClipboard}
                className="p-1.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/30 transition-all"
                title="Copy code"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="p-5 font-mono text-xs text-zinc-300 overflow-x-auto bg-[#07070a]/90 leading-relaxed">
              <pre>{codeSnippet}</pre>
            </div>
          </div>
        </div>
      </main>

      {/* Features Grid */}
      <section id="features" className="border-t border-zinc-800/40 py-24 bg-gradient-to-b from-transparent to-[#050508]/40 px-6">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center space-y-4">
            <h3 className="text-3xl font-bold tracking-tight">Robust Proxy Routing Architecture</h3>
            <p className="text-sm text-zinc-400 max-w-lg mx-auto">Built from the ground up to support high availability and distributed inference workloads.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="glass-card p-6 rounded-2xl space-y-4 hover:border-indigo-500/20 transition-all duration-300 group">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                <Cpu className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">Smart Load Balancing</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">Round-robin routing with real-time health weighting and dynamic in-flight concurrency tracking.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl space-y-4 hover:border-indigo-500/20 transition-all duration-300 group">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                <RefreshCw className="w-5 h-5 animate-spin-slow" />
              </div>
              <h4 className="text-base font-bold text-white">OAuth Token Rotation</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">Automated single-use refresh token rotation with background synchronization, keeping your connections alive indefinitely.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl space-y-4 hover:border-indigo-500/20 transition-all duration-300 group">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                <Shield className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">Quota Management</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">Granular subscription tier rate limits, monthly request counts, and token analytics logged per API key.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Models Section */}
      <section id="models" className="border-t border-zinc-800/40 py-24 bg-[#030303] px-6">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h3 className="text-3xl font-bold tracking-tight">Available Model Aliases</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">Standard endpoints mapped dynamically to their highest performing upstream equivalents.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="glass-card p-6 rounded-2xl hover:border-zinc-700/50 hover:bg-zinc-900/10 transition-all duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold text-xs">
                    Pro
                  </div>
                  <div>
                    <h4 className="font-semibold text-white">akarouter-pro</h4>
                    <p className="text-[10px] text-zinc-500 font-mono">Upstream: Step 3.7 Flash</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-400 uppercase tracking-wider">Default</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">High intelligence, versatile LLM optimized for detailed reasoning, complex coding, and structured Q&A.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl hover:border-zinc-700/50 hover:bg-zinc-900/10 transition-all duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400 font-bold text-xs">
                    <Zap className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-white">akarouter-flash</h4>
                    <p className="text-[10px] text-zinc-500 font-mono">Upstream: Nemotron 3 Ultra</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-400 uppercase tracking-wider">Fast</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">Low-latency, highly concurrent completions ideal for summarization, real-time agents, and high-throughput applications.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/40 py-8 text-center text-xs text-zinc-600 bg-[#030303]">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© 2026 AkaRouter. All rights reserved. Powered by Supabase & Next.js.</p>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-zinc-400 transition-colors">Documentation</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
