import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchServerModels } from '@/lib/server-api'
import { ModelsBrowser } from '@/components/ModelsBrowser'

export const metadata: Metadata = {
  title: 'Models — AkaRouter',
  description: 'Browse 10+ AI models through one API. Per-token and per-request billing, smart routing, instant failover.',
}

export const revalidate = 60 // refresh catalog every 60s

export default async function ModelsPage() {
  const models = await fetchServerModels()

  // Group by provider for stats
  const perTokenCount = models.filter((m) => (m.pricing_mode || 'per_token') === 'per_token').length
  const perRequestCount = models.filter((m) => m.pricing_mode === 'per_request').length
  const freeCount = models.filter((m) => m.pricing_mode === 'per_request' && m.cost_per_request_cents === 0).length
  const totalContext = models.reduce((sum, m) => sum + (m.context_length || 0), 0)

  return (
    <div className="min-h-screen bg-background text-foreground grid-bg">
      {/* Hero */}
      <section className="border-b border-border py-16 sm:py-20 px-6 bg-background/60">
        <div className="max-w-7xl mx-auto text-center space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted/40 border border-border font-mono text-[9px] tracking-widest text-[#ef4444] uppercase">
            <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
            [MODEL_CATALOG]: {models.length}_MODELS_INDEXED
          </div>
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black font-mono tracking-tighter leading-none uppercase text-foreground">
            ONE API,<br />
            <span className="text-gradient-primary">EVERY MODEL</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xs sm:text-sm text-muted-foreground font-mono uppercase tracking-wide leading-relaxed">
            Access {models.length} production-grade AI models through a single API key.
            Smart load-balancing, automatic failover, transparent per-token & per-request billing.
          </p>

          {/* Stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-muted max-w-3xl mx-auto pt-6">
            <Stat label="Models" value={String(models.length)} accent="text-foreground" />
            <Stat label="Per-Token" value={String(perTokenCount)} accent="text-emerald-400" />
            <Stat label="Per-Request" value={String(perRequestCount)} accent="text-[#ef4444]" />
            <Stat label="Free Tiers" value={String(freeCount)} accent="text-foreground/80" />
          </div>
        </div>
      </section>

      {/* Catalog */}
      <section className="py-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <Suspense fallback={<div className="text-center py-16 text-muted-foreground/70 font-mono text-xs uppercase tracking-widest">[LOADING_CATALOG...]</div>}>
            <ModelsBrowser models={models} />
          </Suspense>
        </div>
      </section>

      {/* CTA footer */}
      <section className="border-t border-border py-16 px-6 bg-background/40">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h3 className="text-xl sm:text-2xl font-bold font-mono uppercase tracking-wider text-foreground">
            READY TO SHIP?
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground font-mono uppercase tracking-wide">
            Pick a plan, get an API key, and start routing requests in under 60 seconds.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard/upgrade"
              className="bg-[#ef4444] text-black font-mono text-xs font-bold py-3 px-6 hover:bg-[#ef4444] transition-all red-glow uppercase tracking-wider"
            >
              [+] View Plans
            </Link>
            <Link
              href="/docs"
              className="bg-muted border border-border text-foreground/80 font-mono text-xs font-bold py-3 px-6 hover:border-muted-foreground hover:text-foreground transition-all uppercase tracking-wider"
            >
              Read Docs
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-background p-4">
      <div className={`text-2xl sm:text-3xl font-black font-mono ${accent}`}>{value}</div>
      <div className="text-[9px] sm:text-[10px] font-mono text-muted-foreground/80 uppercase tracking-widest mt-1">{label}</div>
    </div>
  )
}