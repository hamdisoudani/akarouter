'use client'

/**
 * Per-model admin config card.
 *
 * Lets the admin:
 *   - Toggle is_active (enable/disable the alias)
 *   - Switch pricing_mode between per_token and per_request
 *   - Edit the matching price fields for the selected mode:
 *       per_token     → input_cost_per_million, output_cost_per_million
 *       per_request   → cost_per_request_cents (flat fee in USD cents)
 *
 * Why a separate component:
 *   The original admin page jammed enable/disable + per-token pricing into
 *   one card. The pricing_mode / cost_per_request_cents fields exist on
 *   the backend (PATCH /v1/admin/models/{alias}) but were never exposed
 *   in the admin UI. This component is the new home for that control.
 *
 * All state is local until the admin hits SAVE — we then send ONE PATCH
 * with every dirty field and refetch.
 */

import { useState } from 'react'
import { Save, Power, DollarSign, Coins, Loader2, Trash2 } from 'lucide-react'
import { adminUpdateModel, type AdminModelMapping } from '@/lib/api'

interface Props {
  model: AdminModelMapping
  token: string
  onUpdated: (next: AdminModelMapping) => void
  onError: (msg: string) => void
  onDelete?: () => void
}

type PricingMode = 'per_token' | 'per_request'

export function ModelConfigCard({ model, token, onUpdated, onError, onDelete }: Props) {
  const initialMode: PricingMode = (model.pricing_mode as PricingMode) || 'per_token'
  const [isActive, setIsActive] = useState(model.is_active)
  const [mode, setMode] = useState<PricingMode>(initialMode)
  const [inputCost, setInputCost] = useState<number | null>(model.input_cost_per_million ?? 0.10)
  const [outputCost, setOutputCost] = useState<number | null>(model.output_cost_per_million ?? 0.30)
  const [perReqCents, setPerReqCents] = useState<number>(model.cost_per_request_cents ?? 1)
  const [pointsCost, setPointsCost] = useState<number>(model.points_cost ?? 5)
  const [saving, setSaving] = useState(false)

  const dirty =
    isActive !== model.is_active ||
    mode !== initialMode ||
    (mode === 'per_token' && (inputCost !== (model.input_cost_per_million ?? 0.10) || outputCost !== (model.output_cost_per_million ?? 0.30))) ||
    (mode === 'per_request' && perReqCents !== (model.cost_per_request_cents ?? 1)) ||
    pointsCost !== (model.points_cost ?? 5)

  const handleSave = async () => {
    setSaving(true)
    try {
      const patch: any = { is_active: isActive, pricing_mode: mode }
      if (mode === 'per_token') {
        patch.input_cost_per_million = inputCost
        patch.output_cost_per_million = outputCost
      } else {
        // per_request — backend expects cost_per_request_cents as int
        patch.cost_per_request_cents = Math.max(0, Math.round(perReqCents))
      }
      patch.points_cost = Math.max(0, Math.min(1000, Math.round(pointsCost)))
      await adminUpdateModel(token, model.alias, patch)
      onUpdated({
        ...model,
        is_active: isActive,
        pricing_mode: mode,
        input_cost_per_million: mode === 'per_token' ? inputCost : null,
        output_cost_per_million: mode === 'per_token' ? outputCost : null,
        cost_per_request_cents: mode === 'per_request' ? Math.max(0, Math.round(perReqCents)) : null,
        points_cost: Math.max(0, Math.min(1000, Math.round(pointsCost))),
      })
    } catch (err: any) {
      onError(err?.message || 'Failed to save model config')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async () => {
    const next = !isActive
    setIsActive(next)
    try {
      await adminUpdateModel(token, model.alias, { is_active: next })
      onUpdated({ ...model, is_active: next })
    } catch (err: any) {
      // revert on failure
      setIsActive(!next)
      onError(err?.message || 'Failed to toggle model')
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 bg-muted/40 border border-border hover:border-border transition-all">
      {/* Header row: alias + active toggle */}
      <div className="flex justify-between items-center gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-xs font-bold text-foreground uppercase truncate">{model.alias}</span>
          <span className="font-mono text-[9px] text-muted-foreground/80 uppercase truncate">{model.upstream_model}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={`px-2 py-0.5 font-mono text-[9px] font-bold uppercase border ${
              isActive
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444]'
            }`}
          >
            {isActive ? 'ACTIVE' : 'DISABLED'}
          </span>
          <button
            onClick={handleToggleActive}
            disabled={saving}
            className={`px-3 py-1 font-mono text-[10px] font-bold border transition-all disabled:opacity-50 ${
              isActive
                ? 'border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] hover:bg-[#ef4444]/20'
                : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/20'
            }`}
          >
            <Power className="w-3 h-3 inline mr-1" />
            {isActive ? 'DISABLE' : 'ENABLE'}
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={saving}
              className="px-2 py-1 font-mono text-[10px] font-bold border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
              title="Delete model permanently"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Pricing config row */}
      <div className="border-t border-border/60 pt-4 grid grid-cols-1 md:grid-cols-12 gap-4 font-mono text-[10px]">
        {/* Pricing mode selector */}
        <div className="md:col-span-3 space-y-1">
          <label className="text-muted-foreground/80 uppercase text-[8px] tracking-wider">Billing Mode</label>
          <div className="flex border border-border bg-muted">
            <button
              type="button"
              onClick={() => setMode('per_token')}
              className={`flex-1 px-2 py-1.5 text-[9px] uppercase font-bold tracking-wider transition-all ${
                mode === 'per_token'
                  ? 'bg-emerald-500/10 text-emerald-400 border-r border-border'
                  : 'text-muted-foreground/80 hover:text-foreground/80 border-r border-border'
              }`}
              title="Charge by token count (input + output rates)"
            >
              <Coins className="w-3 h-3 inline mr-1" />
              Per-Token
            </button>
            <button
              type="button"
              onClick={() => setMode('per_request')}
              className={`flex-1 px-2 py-1.5 text-[9px] uppercase font-bold tracking-wider transition-all ${
                mode === 'per_request'
                  ? 'bg-[#ef4444]/10 text-[#ef4444]'
                  : 'text-muted-foreground/80 hover:text-foreground/80'
              }`}
              title="Flat fee per call regardless of token count"
            >
              <DollarSign className="w-3 h-3 inline mr-1" />
              Per-Request
            </button>
          </div>
        </div>

        {/* Conditional price fields */}
        {mode === 'per_token' ? (
          <>
            <div className="md:col-span-4 space-y-1">
              <label className="text-muted-foreground/80 uppercase text-[8px] tracking-wider">Input $/1M tok</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={inputCost ?? 0}
                onChange={(e) => setInputCost(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full bg-muted border border-border px-2 py-1.5 text-foreground text-xs focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="md:col-span-4 space-y-1">
              <label className="text-muted-foreground/80 uppercase text-[8px] tracking-wider">Output $/1M tok</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={outputCost ?? 0}
                onChange={(e) => setOutputCost(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full bg-muted border border-border px-2 py-1.5 text-foreground text-xs focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </>
        ) : (
          <div className="md:col-span-8 space-y-1">
            <label className="text-muted-foreground/80 uppercase text-[8px] tracking-wider">
              Flat fee per call (USD cents)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/80 text-xs">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={perReqCents / 100}
                onChange={(e) => setPerReqCents(Math.max(0, Math.round(Number(e.target.value) * 100)))}
                className="w-32 bg-muted border border-border px-2 py-1.5 text-foreground text-xs focus:outline-none focus:border-[#ef4444]/50"
              />
              <span className="text-muted-foreground/80 text-[10px]">
                = {perReqCents}¢ per call
              </span>
            </div>
            <p className="text-muted-foreground/70 text-[9px] leading-relaxed">
              Flat fee charged per request, regardless of input/output token count.
            </p>
          </div>
        )}

        {/* Save button */}
        <div className="md:col-span-1 flex items-end">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="w-full px-2 py-1.5 bg-muted border border-border text-[#ef4444] font-bold text-[9px] uppercase tracking-wider hover:border-[#ef4444] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : <Save className="w-3 h-3 mx-auto" />}
          </button>
        </div>
      </div>

      {/* Points cost row — independent of pricing_mode */}
      <div className="border-t border-border/60 pt-4 grid grid-cols-1 md:grid-cols-12 gap-4 font-mono text-[10px]">
        <div className="md:col-span-3 space-y-1">
          <label className="text-muted-foreground/80 uppercase text-[8px] tracking-wider">Points per call</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="1"
              min="0"
              max="1000"
              value={pointsCost}
              onChange={(e) => setPointsCost(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))}
              className="w-20 bg-muted border border-border px-2 py-1.5 text-foreground text-xs focus:outline-none focus:border-amber-500/50"
            />
            <span className="text-amber-500 font-bold text-xs">pts</span>
          </div>
        </div>
        <div className="md:col-span-9 text-muted-foreground/80 text-[9px] leading-relaxed">
          <p>
            Charged per call against the user's monthly point balance.
            Adjust per-model to fine-tune margins — cheaper models cost fewer points.
          </p>
          <p className="mt-1 text-muted-foreground/70">
            Suggested: free-tier models = 1pt, cheap (Haiku) = 2pt, mid (Sonnet) = 5pt, premium (Opus/GPT-5.5) = 10–15pt.
          </p>
        </div>
      </div>
    </div>
  )
}
