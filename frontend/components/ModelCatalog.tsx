'use client'

import { useState, useMemo } from 'react'
import { Search, Filter, Zap, Coins, Code2, Eye, Brain, Cpu, X, Star } from 'lucide-react'
import { detectProvider } from '@/lib/providers'

interface CatalogModel {
  id: string
  display_name?: string
  provider_name?: string
  is_free_provider?: boolean
  description?: string
  is_active?: boolean
  capabilities?: string[]
  input_cost_per_million?: number
  output_cost_per_million?: number
  context_length?: number
  pricing_mode?: 'per_token' | 'per_request'
  cost_per_request_cents?: number | null
  points_cost?: number
}

interface ModelCatalogProps {
  models: CatalogModel[]
}

type PricingFilter = 'all' | 'per_token' | 'per_request'
type CapabilityFilter = 'all' | 'text' | 'vision' | 'code'

function formatContext(n?: number) {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function formatPerRequestPrice(cents?: number | null) {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}

function formatPerTokenPrice(input?: number, output?: number) {
  const fmt = (v?: number) => (v == null ? '—' : `$${v.toFixed(2)}/M`)
  return `IN ${fmt(input)} · OUT ${fmt(output)}`
}

function getCapabilityIcon(cap: string) {
  if (cap === 'vision') return <Eye className="w-3 h-3" />
  if (cap === 'code' || cap === 'completion') return <Code2 className="w-3 h-3" />
  if (cap === 'chat') return <Brain className="w-3 h-3" />
  return <Cpu className="w-3 h-3" />
}

// Removed: local getProvider() — now uses detectProvider() from lib/providers
// to surface the real upstream vendor (Anthropic, OpenAI, Google, etc.)

export function ModelCatalog({ models }: ModelCatalogProps) {
  const [search, setSearch] = useState('')
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>('all')
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>('all')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return models.filter((m) => {
      if (!m.is_active && m.is_active !== undefined) return false
      if (pricingFilter !== 'all' && (m.pricing_mode || 'per_token') !== pricingFilter) return false
      if (capabilityFilter !== 'all') {
        const caps = m.capabilities || []
        if (!caps.includes(capabilityFilter)) return false
      }
      if (q) {
        const hay = `${m.id} ${m.display_name || ''} ${m.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [models, search, pricingFilter, capabilityFilter])

  const perTokenCount = models.filter((m) => (m.pricing_mode || 'per_token') === 'per_token').length
  const perRequestCount = models.filter((m) => m.pricing_mode === 'per_request').length

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/80" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models by name, ID, or description…"
            className="w-full pl-10 pr-10 py-2.5 bg-background border border-border text-sm text-foreground placeholder-zinc-600 focus:border-[#ef4444] focus:outline-none focus:ring-1 focus:ring-[#ef4444]/30 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/80 hover:text-foreground/80"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Pricing mode filter */}
        <div className="flex border border-border bg-background">
          {(['all', 'per_token', 'per_request'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setPricingFilter(mode)}
              className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                pricingFilter === mode
                  ? 'bg-[#ef4444]/10 text-[#ef4444] border-r border-border last:border-r-0'
                  : 'text-muted-foreground/80 hover:text-foreground/80 border-r border-border last:border-r-0'
              }`}
            >
              {mode === 'all' ? 'All' : mode === 'per_token' ? 'Per-Token' : 'Per-Request'}
            </button>
          ))}
        </div>

        {/* Capability filter */}
        <div className="flex border border-border bg-background">
          {(['all', 'text', 'vision', 'code'] as const).map((cap) => (
            <button
              key={cap}
              onClick={() => setCapabilityFilter(cap)}
              className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                capabilityFilter === cap
                  ? 'bg-[#ef4444]/10 text-[#ef4444] border-r border-border last:border-r-0'
                  : 'text-muted-foreground/80 hover:text-foreground/80 border-r border-border last:border-r-0'
              }`}
            >
              {cap === 'all' ? 'Any' : cap}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-muted-foreground/80 uppercase tracking-wider">
        <span>
          Showing <span className="text-foreground/80 font-bold">{filtered.length}</span> of{' '}
          <span className="text-foreground/80 font-bold">{models.length}</span> models
        </span>
        <span className="text-muted-foreground/60">|</span>
        <span className="inline-flex items-center gap-1.5">
          <Coins className="w-3 h-3 text-emerald-500" />
          <span className="text-emerald-500 font-bold">{perTokenCount}</span> per-token
        </span>
        <span className="text-muted-foreground/60">|</span>
        <span className="inline-flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-[#ef4444]" />
          <span className="text-[#ef4444] font-bold">{perRequestCount}</span> per-request
        </span>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border">
          <Filter className="w-8 h-8 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground/80 font-mono uppercase tracking-wider">No models match your filters</p>
          <button
            onClick={() => {
              setSearch('')
              setPricingFilter('all')
              setCapabilityFilter('all')
            }}
            className="mt-3 text-[10px] font-mono text-[#ef4444] uppercase tracking-wider hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Model grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((m) => {
          const provider = detectProvider(m)
          const isPerRequest = m.pricing_mode === 'per_request'
          const isFree = isPerRequest && (m.cost_per_request_cents ?? 0) === 0
          const accent = isFree ? '#f59e0b' : isPerRequest ? '#ef4444' : '#10b981'
          return (
            <div
              key={m.id}
              className="group relative p-4 bg-background border border-border hover:border-foreground/40 transition-all flex flex-col overflow-hidden"
            >
              {/* Top accent bar — visually distinguishes pricing mode */}
              <div
                className="absolute top-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}80` }}
              />

              <div className="pt-1">
              {/* Header: name + pricing mode badge */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-mono text-xs text-foreground font-bold tracking-wider truncate">
                    {m.display_name || m.id}
                  </h4>
                  <p className="text-[9px] text-muted-foreground/70 font-mono truncate mt-0.5">{m.id}</p>
                </div>
                <span
                  className="shrink-0 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border inline-flex items-center gap-1"
                  style={{ borderColor: `${accent}50`, backgroundColor: `${accent}15`, color: accent }}
                >
                  {isFree ? <Star className="w-2.5 h-2.5" /> : isPerRequest ? <Zap className="w-2.5 h-2.5" /> : <Coins className="w-2.5 h-2.5" />}
                  {isFree ? 'Free' : isPerRequest ? 'Per-Request' : 'Per-Token'}
                </span>
              </div>

              {/* Provider badge + context */}
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border"
                  style={{ borderColor: `${provider.color}50`, backgroundColor: `${provider.color}15`, color: provider.color }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: provider.color }} />
                  {provider.name}
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-border text-muted-foreground/80">
                  <Brain className="w-2.5 h-2.5" />
                  {formatContext(m.context_length)} ctx
                </span>
                {m.capabilities?.slice(0, 3).map((cap) => (
                  <span
                    key={cap}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-border text-muted-foreground/80"
                  >
                    {getCapabilityIcon(cap)}
                    {cap}
                  </span>
                ))}
              </div>

              {/* Description */}
              {m.description && (
                <p className="text-[10px] text-muted-foreground/80 font-mono leading-relaxed mb-3 line-clamp-2">
                  {m.description}
                </p>
              )}

              {/* Pricing footer */}
              <div className="mt-auto pt-3 border-t border-border space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[8px] font-mono text-muted-foreground/70 uppercase tracking-wider">PRICE</span>
                  <span className="text-xs font-mono font-bold" style={{ color: accent }}>
                    {isPerRequest
                      ? formatPerRequestPrice(m.cost_per_request_cents)
                      : formatPerTokenPrice(m.input_cost_per_million, m.output_cost_per_million)}
                  </span>
                </div>
                {isPerRequest && (
                  <div className="text-[8px] font-mono text-muted-foreground/70 text-right">per call · flat fee</div>
                )}
                {!isPerRequest && (
                  <div className="text-[8px] font-mono text-muted-foreground/70 text-right">per 1M tokens</div>
                )}
                <div className="flex items-baseline justify-between pt-1 border-t border-border/50">
                  <span className="text-[8px] font-mono text-muted-foreground/70 uppercase tracking-wider">POINTS</span>
                  <span className="text-[10px] font-mono font-bold text-amber-500">
                    {m.points_cost ?? 5} pts<span className="text-muted-foreground/70 font-normal"> / call</span>
                  </span>
                </div>
                {(m.points_cost ?? 5) <= 1 && (
                  <div className="text-[8px] font-mono text-emerald-500 text-right uppercase">⚡ Free model · 10/day cap</div>
                )}
              </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
