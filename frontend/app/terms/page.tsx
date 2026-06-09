'use client'

import Link from 'next/link'
import { Terminal, Shield, ArrowLeft } from 'lucide-react'

export default function TermsOfService() {
  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex flex-col antialiased selection:bg-[#ef4444]/30 selection:text-white grid-bg">
      {/* Top Header */}
      <header className="flex justify-between items-center w-full px-6 py-4 bg-[#09090b] border-b border-zinc-900 sticky top-0 z-10 micro-grid">
        <div className="flex font-mono text-[11px] text-zinc-400 items-center gap-4">
          <div className="w-[2px] h-4 bg-[#ef4444]"></div>
          <span className="tracking-[0.2em] uppercase font-bold text-zinc-300">LEGALIZATION_MATRIX</span>
        </div>
        <Link 
          href="/" 
          className="flex items-center gap-2 border border-zinc-800 bg-[#0e0e10] px-3 py-1.5 font-mono text-[11px] text-zinc-400 hover:text-white hover:border-[#ef4444] transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>RETURN_HOME</span>
        </Link>
      </header>

      {/* Content Canvas */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-6 md:py-16 space-y-8 z-10">
        <div className="border border-zinc-900 bg-[#0e0e10] p-8 md:p-12 crosshair-corners relative">
          <div className="absolute inset-0 opacity-[0.03] micro-grid pointer-events-none" />
          
          <div className="space-y-6">
            {/* Header info */}
            <div className="border-b border-zinc-900 pb-6 space-y-2">
              <h1 className="font-mono text-xl md:text-2xl text-white font-bold tracking-wider flex items-center gap-3 uppercase">
                <Terminal className="w-6 h-6 text-[#ef4444]" />
                Terms of Service
              </h1>
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Last Updated: June 2026 | Document Reference: AR_TOS_v1.0
              </p>
            </div>

            {/* Document Body */}
            <div className="font-mono text-xs text-zinc-400 space-y-6 leading-relaxed">
              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  1. Acceptance of Terms
                </h2>
                <p>
                  By accessing the AkaRouter API Gateway platform, routing networks, and interface utilities, you agree to comply with and be bound by these Terms of Service. If you do not accept these terms in their entirety, you are prohibited from utilizing the services.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  2. Gateway & Node API Utilization
                </h2>
                <p>
                  AkaRouter grants you a limited, non-exclusive, non-transferable license to access AI routing services via authorized API keys. All keys generated remain the property of AkaRouter and may be degraded, suspended, or revoked by the system administrator under suspicion of service misuse.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  3. Token Budgets & Sliding Window Quotas
                </h2>
                <p>
                  Standard usage is regulated by token consumption windows ($ 5-hour, $ 7-day, and $ monthly budget limits). System resource allocations are evaluated dynamically. Exceeding assigned limits will return a HTTP 429 rate/budget limit exception. Request counts are preserved solely for performance matrix analytics.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  4. Fair Use & Suspensions
                </h2>
                <p>
                  Users must not engage in any activity that overloads the routing latency arrays, attempts brute-force token generation, or circumvents the 60 RPM rate limit rules. AkaRouter reserves the right to suspend or ban account nodes with or without prior notice under terms violation.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  5. Disclaimer of Warranties
                </h2>
                <p>
                  AkaRouter services are provided "as is" and "as available". We offer no warranties concerning gateway uptime, models output correctness, or prompt latency times. Upstream connection states (e.g. OpenRouter, Hermes channels) are beyond local latency guarantees.
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8 text-center text-xs text-zinc-650 bg-[#09090b] micro-grid mt-auto">
        <p className="font-mono text-[9px] uppercase tracking-widest">
          © 2026 AkaRouter by HAMDI. Kernel: v1.0.0-STABLE.
        </p>
      </footer>
    </div>
  )
}
