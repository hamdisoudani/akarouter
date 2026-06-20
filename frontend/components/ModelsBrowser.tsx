'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import Link from 'next/link'
import {
  Search, Filter, Zap, Coins, Code2, Eye, Brain, Cpu, X, ChevronRight,
  ArrowUpDown, LayoutGrid, List, Layers, Sparkles, Star, Clock,
} from 'lucide-react'
import { detectProvider, groupByProvider, modelPath, type ProviderInfo } from '@/lib/providers'

interface CatalogModel {
  id: string
  display_name?: string
  provider_name?: string
  is_free_provider?: boolean
  description?: string
  is_active?: boolean
  is_upcoming?: boolean
  // NEW (2026-06-20): promotional model flag — extra % off.
  is_promotional?: boolean
  promotional_discount_pct?: number
  capabilities?: string[]
  input_cost_per_million?: number
  output_cost_per_million?: number
  context_length?: number
  pricing_mode?: 'per_token' | 'per_request'
  cost_per_request_cents?: number | null
  points_cost?: number
}

interface ModelsBrowserProps {
  models: CatalogModel[]
}

type PricingFilter = 'all' | 'per_token' | 'per_request' | 'free'
type SortMode = 'name' | 'price-asc' | 'price-desc' | 'context-desc' | 'newest'
type ViewMode = 'grid' | 'list'
type GroupMode = 'flat' | 'by-provider'

function formatContext(n?: number) {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function formatPerRequestPrice(cents?: number | null) {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}

function formatPerTokenPrice(input?: number, output?: number) {
  const fmt = (v?: number) => (v == null ? '—' : `$${v.toFixed(3)}`)
  return `${fmt(input)} in · ${fmt(output)} out / 1M tok`
}

function getCapabilityIcon(cap: string) {
  if (cap === 'vision') return <Eye className="w-3 h-3" />
  if (cap === 'code' || cap === 'completion') return <Code2 className="w-3 h-3" />
  if (cap === 'chat') return <Brain className="w-3 h-3" />
  return <Cpu className="w-3 h-3" />
}

function effectivePricePerCall(m: CatalogModel): number {
  // Rough order-of-magnitude price per call (used for sorting only)
  if (m.pricing_mode === 'per_request') {
    return (m.cost_per_request_cents ?? 0) / 100
  }
  // Assume 1k input + 500 output avg
  const input = m.input_cost_per_million ?? 0
  const output = m.output_cost_per_million ?? 0
  return (input * 1 + output * 0.5) / 1000
}

export function ModelsBrowser({ models }: ModelsBrowserProps) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>('all')
  const [capabilityFilter, setCapabilityFilter] = useState<string>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [groupMode, setGroupMode] = useState<GroupMode>('by-provider')
  const [showFilters, setShowFilters] = useState(false)

  // Build provider list from data (using real upstream detection)
  const providers = useMemo(() => {
    const set = new Map<string, ProviderInfo>()
    models.forEach((m) => {
      const p = detectProvider(m)
      set.set(p.id, p)
    })
    return Array.from(set.values()).sort((a, b) => a.order - b.order)
  }, [models])

  // Capability set
  const capabilities = useMemo(() => {
    const set = new Set<string>()
    models.forEach((m) => (m.capabilities || []).forEach((c) => set.add(c)))
    return Array.from(set).sort()
  }, [models])

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim()
    const list = models.filter((m) => {
      // Show model if it's active OR if it's marked upcoming (still shown with price + badge)
      if (m.is_active === false && !m.is_upcoming) return false
      const pricingMode = m.pricing_mode || 'per_token'
      // Pricing filter
      if (pricingFilter === 'per_token' && pricingMode !== 'per_token') return false
      if (pricingFilter === 'per_request' && pricingMode !== 'per_request') return false
      if (pricingFilter === 'free') {
        if (pricingMode !== 'per_request') return false
        if ((m.cost_per_request_cents ?? 0) > 0) return false
      }
      // Capability filter
      if (capabilityFilter !== 'all' && !(m.capabilities || []).includes(capabilityFilter)) return false
      // Provider filter (real upstream detection)
      if (providerFilter !== 'all' && detectProvider(m).id !== providerFilter) return false
      // Search
      if (q) {
        const hay = `${m.id} ${m.display_name || ''} ${m.description || ''} ${detectProvider(m).name}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    // Sort
    list.sort((a, b) => {
      switch (sortMode) {
        case 'name':
          return (a.display_name || a.id).localeCompare(b.display_name || b.id)
        case 'price-asc':
          return effectivePricePerCall(a) - effectivePricePerCall(b)
        case 'price-desc':
          return effectivePricePerCall(b) - effectivePricePerCall(a)
        case 'context-desc':
          return (b.context_length || 0) - (a.context_length || 0)
        case 'newest':
          return b.id.localeCompare(a.id)
        default:
          return 0
      }
    })

    return list
  }, [models, deferredSearch, pricingFilter, capabilityFilter, providerFilter, sortMode])

  const activeFilterCount =
    (pricingFilter !== 'all' ? 1 : 0) +
    (capabilityFilter !== 'all' ? 1 : 0) +
    (providerFilter !== 'all' ? 1 : 0) +
    (deferredSearch ? 1 : 0)

  function clearAll() {
    setSearch('')
    setPricingFilter('all')
    setCapabilityFilter('all')
    setProviderFilter('all')
  }

  // Group for rendering
  const groups = useMemo(() => {
    if (groupMode === 'flat') return [{ provider: null as ProviderInfo | null, models: filtered }]
    return groupByProvider(filtered)
  }, [filtered, groupMode])

  return (
    <div className="space-y-6">
      {/* Search + sort/view row */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/80" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models, providers, capabilities…"
            className="w-full pl-10 pr-10 py-2.5 bg-background border border-border text-sm text-foreground placeholder-muted-foreground/60 focus:border-[#ef4444] focus:outline-none focus:ring-1 focus:ring-[#ef4444]/30 transition-colors font-mono"
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

        {/* Sort */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/80 hidden sm:block" />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-background border border-border text-[10px] font-mono uppercase tracking-wider text-foreground/80 px-3 py-2.5 focus:border-[#ef4444] focus:outline-none cursor-pointer"
          >
            <option value="name">Name (A-Z)</option>
            <option value="price-asc">Price (Low → High)</option>
            <option value="price-desc">Price (High → Low)</option>
            <option value="context-desc">Context (Largest)</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {/* Group toggle */}
        <div className="flex border border-border bg-background">
          <button
            onClick={() => setGroupMode('by-provider')}
            className={`px-3 py-2.5 text-[10px] font-mono uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 ${
              groupMode === 'by-provider'
                ? 'bg-[#ef4444]/10 text-[#ef4444]'
                : 'text-muted-foreground/80 hover:text-foreground/80'
            }`}
            aria-label="Group by provider"
            title="Group by upstream provider (Claude, GPT, Gemini, etc.)"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">By Provider</span>
          </button>
          <button
            onClick={() => setGroupMode('flat')}
            className={`px-3 py-2.5 text-[10px] font-mono uppercase tracking-wider transition-colors border-l border-border ${
              groupMode === 'flat'
                ? 'bg-[#ef4444]/10 text-[#ef4444]'
                : 'text-muted-foreground/80 hover:text-foreground/80'
            }`}
            aria-label="Flat list"
            title="Flat alphabetical list"
          >
            <List className="w-3.5 h-3.5 inline sm:mr-1.5" />
            <span className="hidden sm:inline">Flat</span>
          </button>
        </div>

        {/* View toggle */}
        <div className="flex border border-border bg-background">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2.5 transition-colors ${
              viewMode === 'grid' ? 'bg-[#ef4444]/10 text-[#ef4444]' : 'text-muted-foreground/80 hover:text-foreground/80'
            }`}
            aria-label="Grid view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2.5 transition-colors border-l border-border ${
              viewMode === 'list' ? 'bg-[#ef4444]/10 text-[#ef4444]' : 'text-muted-foreground/80 hover:text-foreground/80'
            }`}
            aria-label="List view"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter toggle (mobile) */}
        <button
          onClick={() => setShowFilters((s) => !s)}
          className="md:hidden flex items-center justify-center gap-2 px-3 py-2.5 bg-background border border-border text-[10px] font-mono uppercase tracking-wider text-foreground/80"
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-[#ef4444] text-black font-bold text-[9px] px-1.5 rounded-full">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {/* Filter chips — collapsible on mobile */}
      <div className={`space-y-3 ${showFilters ? 'block' : 'hidden md:block'}`}>
        <FilterRow label="BILLING">
          {(['all', 'per_token', 'per_request', 'free'] as const).map((mode) => (
            <Chip
              key={mode}
              active={pricingFilter === mode}
              onClick={() => setPricingFilter(mode)}
              icon={
                mode === 'per_token' ? <Coins className="w-3 h-3" /> :
                mode === 'per_request' ? <Zap className="w-3 h-3" /> :
                mode === 'free' ? <Star className="w-3 h-3" /> :
                undefined
              }
              label={
                mode === 'all' ? 'All' :
                mode === 'per_token' ? 'Per-Token' :
                mode === 'per_request' ? 'Per-Request' :
                'Free'
              }
              accent={
                mode === 'per_token' ? 'emerald' :
                mode === 'per_request' ? 'red' :
                mode === 'free' ? 'amber' :
                undefined
              }
            />
          ))}
        </FilterRow>

        {providers.length > 1 && (
          <FilterRow label="UPSTREAM PROVIDER">
            <Chip active={providerFilter === 'all'} onClick={() => setProviderFilter('all')} label="All" />
            {providers.map((p) => (
              <Chip
                key={p.id}
                active={providerFilter === p.id}
                onClick={() => setProviderFilter(p.id)}
                label={p.name}
                dotColor={p.color}
              />
            ))}
          </FilterRow>
        )}

        {capabilities.length > 1 && (
          <FilterRow label="CAPABILITY">
            <Chip active={capabilityFilter === 'all'} onClick={() => setCapabilityFilter('all')} label="All" />
            {capabilities.map((c) => (
              <Chip
                key={c}
                active={capabilityFilter === c}
                onClick={() => setCapabilityFilter(c)}
                label={c}
              />
            ))}
          </FilterRow>
        )}
      </div>

      {/* Stats + active filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-y border-border">
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-muted-foreground/80 uppercase tracking-wider">
          <span>
            <span className="text-foreground/80 font-bold">{filtered.length}</span> / {models.length} models
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="inline-flex items-center gap-1">
            <Coins className="w-3 h-3 text-emerald-500" />
            <span className="text-emerald-500 font-bold">
              {filtered.filter(m => (m.pricing_mode || 'per_token') === 'per_token').length}
            </span> per-token
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="inline-flex items-center gap-1">
            <Zap className="w-3 h-3 text-[#ef4444]" />
            <span className="text-[#ef4444] font-bold">
              {filtered.filter(m => m.pricing_mode === 'per_request' && (m.cost_per_request_cents ?? 0) > 0).length}
            </span> per-request
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="inline-flex items-center gap-1">
            <Star className="w-3 h-3 text-amber-500" />
            <span className="text-amber-500 font-bold">
              {filtered.filter(m => m.pricing_mode === 'per_request' && (m.cost_per_request_cents ?? 0) === 0).length}
            </span> free
          </span>
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={clearAll}
            className="text-[#ef4444] hover:underline inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider"
          >
            <X className="w-3 h-3" /> clear all
          </button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-20 border border-dashed border-border">
          <Filter className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground/80 font-mono uppercase tracking-wider mb-3">No models match your filters</p>
          <button
            onClick={clearAll}
            className="text-[10px] font-mono text-[#ef4444] uppercase tracking-wider hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Model list/grid — grouped by provider or flat */}
      <div className="space-y-8">
        {groups.map((group, gIdx) => (
          <div key={group.provider?.id ?? 'all'} className="space-y-3">
            {/* Section header — only when grouped */}
            {groupMode === 'by-provider' && group.provider && (
              <div className="flex items-center gap-3 pb-2 border-b border-border">
                <span
                  className="w-2.5 h-2.5 shrink-0"
                  style={{ backgroundColor: group.provider.color, boxShadow: `0 0 8px ${group.provider.color}80` }}
                />
                <h3 className="font-mono text-xs font-bold text-foreground uppercase tracking-wider">
                  {group.provider.name}
                </h3>
                <span className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider">
                  {group.provider.family} family
                </span>
                <span className="ml-auto text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider">
                  {group.models.length} model{group.models.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {viewMode === 'grid' ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.models.map((m) => (
                  <ModelCard key={m.id} model={m} />
                ))}
              </div>
            ) : (
              <div className="border border-border divide-y divide-border">
                {group.models.map((m) => (
                  <ModelRow key={m.id} model={m} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[9px] font-mono text-muted-foreground/70 uppercase tracking-widest shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

type ChipAccent = 'red' | 'emerald' | 'amber' | undefined

function Chip({
  active, onClick, label, icon, dotColor, accent,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
  dotColor?: string
  accent?: ChipAccent
}) {
  // Active state color depends on accent + presence of dot
  let activeClass = 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/40'
  if (active && accent === 'emerald') {
    activeClass = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/50'
  } else if (active && accent === 'amber') {
    activeClass = 'bg-amber-500/15 text-amber-400 border-amber-500/50'
  }

  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border transition-colors inline-flex items-center gap-1.5 ${
        active
          ? activeClass
          : 'bg-background text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground'
      }`}
    >
      {dotColor && (
        <span
          className="w-1.5 h-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor, boxShadow: `0 0 4px ${dotColor}80` }}
        />
      )}
      {icon}
      {label}
    </button>
  )
}

// ============ Model card with distinct pricing treatment ============
function ModelCard({ model }: { model: CatalogModel }) {
  const provider = detectProvider(model)
  const isPerRequest = model.pricing_mode === 'per_request'
  const isFree = isPerRequest && (model.cost_per_request_cents ?? 0) === 0
  const isUpcoming = model.is_upcoming === true

  // Pricing-mode-specific visuals
  const pricingMeta = isFree
    ? {
        icon: <Star className="w-3 h-3" />,
        label: 'FREE TIER',
        accent: 'amber',
        borderClass: 'border-amber-500/40',
        bgClass: 'bg-amber-500/5',
        barColor: '#f59e0b',
        badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
        explainer: 'Free daily allowance · no charge per call',
      }
    : isPerRequest
    ? {
        icon: <Zap className="w-3 h-3" />,
        label: 'PER-CALL',
        accent: 'red',
        borderClass: 'border-[#ef4444]/30',
        bgClass: 'bg-[#ef4444]/[0.02]',
        barColor: '#ef4444',
        badgeClass: 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#ef4444]',
        explainer: 'Fixed price per request · predictable cost',
      }
    : {
        icon: <Coins className="w-3 h-3" />,
        label: 'PER-TOKEN',
        accent: 'emerald',
        borderClass: 'border-emerald-500/30',
        bgClass: 'bg-emerald-500/[0.02]',
        barColor: '#10b981',
        badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
        explainer: 'Pay only for tokens used · scales with length',
      }

  return (
    <Link
      href={modelPath(model)}
      className={`group relative block bg-background border ${pricingMeta.borderClass} ${isUpcoming ? 'opacity-60 cursor-not-allowed' : 'hover:border-foreground/40'} transition-all overflow-hidden`}
      onClick={(e) => { if (isUpcoming) e.preventDefault(); }}
      aria-disabled={isUpcoming || undefined}
    >
      {/* Top accent bar — the most distinctive visual cue */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ backgroundColor: pricingMeta.barColor, boxShadow: `0 0 12px ${pricingMeta.barColor}80` }}
      />

      <div className="p-4 pt-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-mono text-xs text-foreground font-bold tracking-wider truncate group-hover:text-[#ef4444] transition-colors">
              {model.display_name || model.id}
            </h4>
            <p className="text-[9px] text-muted-foreground/70 font-mono truncate mt-0.5">{model.id}</p>
          </div>
          <span
            className={`shrink-0 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border inline-flex items-center gap-1 ${pricingMeta.badgeClass}`}
          >
            {pricingMeta.icon}
            {pricingMeta.label}
          </span>
          {isUpcoming && (
            <span
              className="shrink-0 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-amber-500/60 bg-amber-500/15 text-amber-400 inline-flex items-center gap-1"
              title="This model is shown for preview only. Chat is not yet available."
            >
              <Clock className="w-2.5 h-2.5" />
              Coming Soon
            </span>
          )}
          {!isUpcoming && model.is_promotional && (
            <span
              className="shrink-0 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-pink-500/60 bg-pink-500/15 text-pink-400 inline-flex items-center gap-1"
              title={`Promotional: ${Math.round((model.promotional_discount_pct || 0) * 100)}% off — limited time`}
            >
              <Sparkles className="w-2.5 h-2.5" />
              {Math.round((model.promotional_discount_pct || 0) * 100)}% Off
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border"
            style={{ borderColor: `${provider.color}50`, backgroundColor: `${provider.color}15`, color: provider.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: provider.color, boxShadow: `0 0 4px ${provider.color}80` }} />
            {provider.name}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-border text-muted-foreground/80">
            <Brain className="w-2.5 h-2.5" />
            {formatContext(model.context_length)} ctx
          </span>
          {(model.capabilities || []).slice(0, 2).map((cap) => (
            <span
              key={cap}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-border text-muted-foreground/80"
            >
              {getCapabilityIcon(cap)}
              {cap}
            </span>
          ))}
        </div>

        {model.description && (
          <p className="text-[10px] text-muted-foreground/80 font-mono leading-relaxed mb-3 line-clamp-2">
            {model.description}
          </p>
        )}

        {/* Pricing explainer strip */}
        <div className={`text-[9px] font-mono uppercase tracking-wider px-2 py-1 mb-3 border ${pricingMeta.badgeClass} inline-block`}>
          {pricingMeta.explainer}
        </div>

        <div className="pt-3 border-t border-border flex items-baseline justify-between">
          <span className="text-[8px] font-mono text-muted-foreground/70 uppercase tracking-wider">PRICE</span>
          <span
            className="text-[11px] font-mono font-bold"
            style={{ color: pricingMeta.barColor }}
          >
            {isPerRequest
              ? formatPerRequestPrice(model.cost_per_request_cents)
              : formatPerTokenPrice(model.input_cost_per_million, model.output_cost_per_million)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[8px] font-mono text-muted-foreground/70 uppercase tracking-wider">POINTS</span>
          <span className="text-[10px] font-mono font-bold text-amber-500">
            {model.points_cost ?? 5} pts<span className="text-muted-foreground/70 font-normal"> / call</span>
          </span>
        </div>
        {(model.points_cost ?? 5) <= 1 && (
          <div className="text-[9px] font-mono text-emerald-500 uppercase">⚡ Free model · 10/day</div>
        )}

        <div className="mt-2 flex items-center gap-1 text-[9px] font-mono text-muted-foreground/80 uppercase tracking-wider group-hover:text-[#ef4444] transition-colors">
          <span>View details</span>
          <ChevronRight className="w-3 h-3" />
        </div>
      </div>
    </Link>
  )
}

function ModelRow({ model }: { model: CatalogModel }) {
  const provider = detectProvider(model)
  const isPerRequest = model.pricing_mode === 'per_request'
  const isFree = isPerRequest && (model.cost_per_request_cents ?? 0) === 0
  const isUpcoming = model.is_upcoming === true

  const barColor = isFree ? '#f59e0b' : isPerRequest ? '#ef4444' : '#10b981'

  return (
    <Link
      href={modelPath(model)}
      className={`group flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors relative ${isUpcoming ? 'opacity-60 cursor-not-allowed' : ''}`}
      onClick={(e) => { if (isUpcoming) e.preventDefault(); }}
      aria-disabled={isUpcoming || undefined}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: barColor }}
      />

      <div className="flex-1 min-w-0 pl-2">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-mono text-xs text-foreground font-bold tracking-wider group-hover:text-[#ef4444] transition-colors">
            {model.display_name || model.id}
          </h4>
          <span className="text-[9px] text-muted-foreground/70 font-mono">{model.id}</span>
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border"
            style={{ borderColor: `${provider.color}50`, backgroundColor: `${provider.color}15`, color: provider.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: provider.color }} />
            {provider.name}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground/80 font-mono truncate">
          {formatContext(model.context_length)} ctx · {(model.capabilities || []).join(', ') || 'text'}
        </p>
      </div>
      <div className="text-right shrink-0 flex items-center gap-3">
        {isFree ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-400">
            <Star className="w-2.5 h-2.5" /> FREE
          </span>
        ) : isPerRequest ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-[#ef4444]/40 bg-[#ef4444]/10 text-[#ef4444]">
            <Zap className="w-2.5 h-2.5" /> PER-CALL
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
            <Coins className="w-2.5 h-2.5" /> PER-TOKEN
          </span>
        )}
        {isUpcoming && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-amber-500/60 bg-amber-500/15 text-amber-400" title="Shown for preview only. Chat is not yet available.">
            <Clock className="w-2.5 h-2.5" /> COMING SOON
          </span>
        )}
        <div>
          <div
            className="text-xs font-mono font-bold"
            style={{ color: barColor }}
          >
            {isPerRequest
              ? formatPerRequestPrice(model.cost_per_request_cents)
              : formatPerTokenPrice(model.input_cost_per_million, model.output_cost_per_million)}
          </div>
          <div className="text-[8px] font-mono text-muted-foreground/70 uppercase tracking-wider mt-0.5">
            {isPerRequest ? 'per call' : 'per 1M tok'}
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-[#ef4444] transition-colors" />
    </Link>
  )
}