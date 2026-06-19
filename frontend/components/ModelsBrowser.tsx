'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import Link from 'next/link'
import { Search, Filter, Zap, DollarSign, Code2, Eye, Brain, Cpu, X, ChevronRight, ChevronDown, ArrowUpDown, LayoutGrid, List } from 'lucide-react'

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

interface ModelsBrowserProps {
  models: CatalogModel[]
}

type PricingFilter = 'all' | 'per_token' | 'per_request' | 'free'
type SortMode = 'name' | 'price-asc' | 'price-desc' | 'context-desc' | 'newest'
type ViewMode = 'grid' | 'list'

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

function getProvider(_model: CatalogModel) {
  // All models are AkaRouter-owned — single branding, no upstream leak
  return { name: 'AkaRouter', color: 'text-zinc-300 border-zinc-500/30 bg-zinc-500/10' }
}

function getCapabilityIcon(cap: string) {
  if (cap === 'vision') return <Eye className="w-3 h-3" />
  if (cap === 'code' || cap === 'completion') return <Code2 className="w-3 h-3" />
  if (cap === 'chat') return <Brain className="w-3 h-3" />
  return <Cpu className="w-3 h-3" />
}

export function ModelsBrowser({ models }: ModelsBrowserProps) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>('all')
  const [capabilityFilter, setCapabilityFilter] = useState<string>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [showFilters, setShowFilters] = useState(false)

  // Build provider list from data
  const providers = useMemo(() => {
    const set = new Set<string>()
    models.forEach((m) => set.add(getProvider(m).name))
    return Array.from(set).sort()
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
      if (m.is_active === false) return false
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
      // Provider filter
      if (providerFilter !== 'all' && getProvider(m).name !== providerFilter) return false
      // Search
      if (q) {
        const hay = `${m.id} ${m.display_name || ''} ${m.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    // Sort
    list.sort((a, b) => {
      switch (sortMode) {
        case 'name':
          return (a.display_name || a.id).localeCompare(b.display_name || b.id)
        case 'price-asc': {
          const pa = effectivePricePerCall(a)
          const pb = effectivePricePerCall(b)
          return pa - pb
        }
        case 'price-desc': {
          const pa = effectivePricePerCall(a)
          const pb = effectivePricePerCall(b)
          return pb - pa
        }
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

  return (
    <div className="space-y-6">
      {/* Search + sort/view row */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models, providers, capabilities…"
            className="w-full pl-10 pr-10 py-2.5 bg-[#0a0a0c] border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:border-[#ef4444] focus:outline-none focus:ring-1 focus:ring-[#ef4444]/30 transition-colors font-mono"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500 hidden sm:block" />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-[#0a0a0c] border border-zinc-800 text-[10px] font-mono uppercase tracking-wider text-zinc-300 px-3 py-2.5 focus:border-[#ef4444] focus:outline-none cursor-pointer"
          >
            <option value="name">Name (A-Z)</option>
            <option value="price-asc">Price (Low → High)</option>
            <option value="price-desc">Price (High → Low)</option>
            <option value="context-desc">Context (Largest)</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {/* View toggle */}
        <div className="flex border border-zinc-800 bg-[#0a0a0c]">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2.5 transition-colors ${
              viewMode === 'grid' ? 'bg-[#ef4444]/10 text-[#ef4444]' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            aria-label="Grid view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2.5 transition-colors border-l border-zinc-800 ${
              viewMode === 'list' ? 'bg-[#ef4444]/10 text-[#ef4444]' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            aria-label="List view"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter toggle (mobile) */}
        <button
          onClick={() => setShowFilters((s) => !s)}
          className="md:hidden flex items-center justify-center gap-2 px-3 py-2.5 bg-[#0a0a0c] border border-zinc-800 text-[10px] font-mono uppercase tracking-wider text-zinc-300"
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
              label={
                mode === 'all' ? 'All' :
                mode === 'per_token' ? 'Per-Token' :
                mode === 'per_request' ? 'Per-Request' :
                'Free'
              }
            />
          ))}
        </FilterRow>

        {providers.length > 1 && (
          <FilterRow label="PROVIDER">
            <Chip active={providerFilter === 'all'} onClick={() => setProviderFilter('all')} label="All" />
            {providers.map((p) => (
              <Chip
                key={p}
                active={providerFilter === p}
                onClick={() => setProviderFilter(p)}
                label={p}
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
      <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-y border-zinc-900">
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
          <span>
            <span className="text-zinc-300 font-bold">{filtered.length}</span> / {models.length} models
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={clearAll}
              className="text-[#ef4444] hover:underline inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> clear all
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-20 border border-dashed border-zinc-800">
          <Filter className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 font-mono uppercase tracking-wider mb-3">No models match your filters</p>
          <button
            onClick={clearAll}
            className="text-[10px] font-mono text-[#ef4444] uppercase tracking-wider hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Model list/grid */}
      {viewMode === 'grid' ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      ) : (
        <div className="border border-zinc-900 divide-y divide-zinc-900">
          {filtered.map((m) => (
            <ModelRow key={m.id} model={m} />
          ))}
        </div>
      )}
    </div>
  )
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

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border transition-colors ${
        active
          ? 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/40'
          : 'bg-[#0a0a0c] text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )
}

function ModelCard({ model }: { model: CatalogModel }) {
  const provider = getProvider(model)
  const isPerRequest = model.pricing_mode === 'per_request'
  const isFree = isPerRequest && (model.cost_per_request_cents ?? 0) === 0

  return (
    <Link
      href={`/models/${model.id}`}
      className="group block p-4 bg-[#0a0a0c] border border-zinc-900 hover:border-zinc-700 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-mono text-xs text-white font-bold tracking-wider truncate group-hover:text-[#ef4444] transition-colors">
            {model.display_name || model.id}
          </h4>
          <p className="text-[9px] text-zinc-600 font-mono truncate mt-0.5">{model.id}</p>
        </div>
        <span
          className={`shrink-0 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border ${
            isFree
              ? 'border-zinc-500 bg-zinc-800 text-zinc-300'
              : isPerRequest
              ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          }`}
        >
          {isFree ? 'Free' : isPerRequest ? 'Per-Request' : 'Per-Token'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className={`inline-flex items-center px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border ${provider.color}`}>
          {provider.name}
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-zinc-800 text-zinc-500">
          <Brain className="w-2.5 h-2.5" />
          {formatContext(model.context_length)} ctx
        </span>
        {(model.capabilities || []).slice(0, 2).map((cap) => (
          <span
            key={cap}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border border-zinc-800 text-zinc-500"
          >
            {getCapabilityIcon(cap)}
            {cap}
          </span>
        ))}
      </div>

      {model.description && (
        <p className="text-[10px] text-zinc-500 font-mono leading-relaxed mb-3 line-clamp-2">
          {model.description}
        </p>
      )}

      <div className="pt-3 border-t border-zinc-900 flex items-baseline justify-between">
        <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">PRICE</span>
        <span className={`text-[11px] font-mono font-bold ${isPerRequest ? 'text-[#ef4444]' : 'text-emerald-400'}`}>
          {isPerRequest
            ? formatPerRequestPrice(model.cost_per_request_cents)
            : formatPerTokenPrice(model.input_cost_per_million, model.output_cost_per_million)}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">POINTS</span>
        <span className="text-[10px] font-mono font-bold text-amber-500">
          {model.points_cost ?? 5} pts<span className="text-zinc-600 font-normal"> / call</span>
        </span>
      </div>
      {(model.points_cost ?? 5) <= 1 && (
        <div className="text-[9px] font-mono text-emerald-500 uppercase">⚡ Free model · 10/day</div>
      )}

      <div className="mt-2 flex items-center gap-1 text-[9px] font-mono text-zinc-500 uppercase tracking-wider group-hover:text-[#ef4444] transition-colors">
        <span>View details</span>
        <ChevronRight className="w-3 h-3" />
      </div>
    </Link>
  )
}

function ModelRow({ model }: { model: CatalogModel }) {
  const provider = getProvider(model)
  const isPerRequest = model.pricing_mode === 'per_request'
  const isFree = isPerRequest && (model.cost_per_request_cents ?? 0) === 0

  return (
    <Link
      href={`/models/${model.id}`}
      className="group flex items-center gap-4 p-4 hover:bg-[#0a0a0c] transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-mono text-xs text-white font-bold tracking-wider group-hover:text-[#ef4444] transition-colors">
            {model.display_name || model.id}
          </h4>
          <span className="text-[9px] text-zinc-600 font-mono">{model.id}</span>
          <span
            className={`shrink-0 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border ${
              isFree
                ? 'border-zinc-500 bg-zinc-800 text-zinc-300'
                : isPerRequest
                ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            }`}
          >
            {isFree ? 'Free' : isPerRequest ? 'Per-Request' : 'Per-Token'}
          </span>
        </div>
        <p className="text-[10px] text-zinc-500 font-mono truncate">
          {provider.name} · {formatContext(model.context_length)} ctx · {(model.capabilities || []).join(', ') || 'text'}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-xs font-mono font-bold ${isPerRequest ? 'text-[#ef4444]' : 'text-emerald-400'}`}>
          {isPerRequest
            ? formatPerRequestPrice(model.cost_per_request_cents)
            : formatPerTokenPrice(model.input_cost_per_million, model.output_cost_per_million)}
        </div>
        <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider mt-0.5">
          {isPerRequest ? 'per call' : 'per 1M tok'}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-[#ef4444] transition-colors" />
    </Link>
  )
}