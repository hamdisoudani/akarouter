'use client'

import Link from 'next/link'
import { Terminal, Shield, ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
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
                <Shield className="w-6 h-6 text-[#ef4444]" />
                Privacy Policy
              </h1>
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Last Updated: June 2026 | Document Reference: AR_PRIV_v1.0
              </p>
            </div>

            {/* Document Body */}
            <div className="font-mono text-xs text-zinc-400 space-y-6 leading-relaxed">
              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  1. Information We Collect
                </h2>
                <p>
                  AkaRouter registers basic authentication metadata provided during OAuth registration (e.g. email, display name) to manage service authentication, keys authorization, and billing tier presets. We collect and log latency metrics, model routing logs, status codes, and input/output token counts to construct live performance matrix analytics.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  2. Use of Data
                </h2>
                <p>
                  Collected telemetry is utilized strictly to provide, maintain, and optimize AkaRouter. Token analytics are evaluated in real-time to compute sliding window budget consumption and enforce tier limits. Detailed latency metrics are rendered on the developer board for traffic statistics.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  3. Request Payload Processing
                </h2>
                <p>
                  Completions request payloads (messages arrays and parameters) are proxy-forwarded directly to authorized upstream models (e.g. Nous Research Hermes). AkaRouter does not inspect, read, or store the contents of completion request prompts or generated output responses once returned.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-white font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
                  4. Telemetry Storage
                </h2>
                <p>
                  System session logs, latency times, and token totals are securely stored in our analytical databases managed by Supabase. Historical trace buffer records are periodically pruned to ensure system efficiency and data hygiene.
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
