'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useApp } from '@/app/providers'
import {
  createCheckoutSession,
  getPlans,
  getBillingMatrix,
  type PlanPreset,
  type BillingMatrix,
  type BillingMatrixModel,
} from '@/lib/api'
import {
  RefreshCw,
  Zap,
  Sparkles,
  TrendingDown,
  Check,
  Star,
} from 'lucide-react'

import { DashboardSidebar } from '@/components/DashboardSidebar'

export default function UpgradePage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut, refetchUsage } = useApp()

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [dbPlans, setDbPlans] = useState<PlanPreset[]>([])
  const [billingMatrix, setBillingMatrix] = useState<BillingMatrix | null>(null)
  const [matrixLoading, setMatrixLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setMatrixLoading(true)
      try {
        const [plansRes, matrix] = await Promise.all([
          getPlans().catch(() => ({ plans: [] })),
          getBillingMatrix().catch(() => null),
        ])
        if (plansRes && plansRes.plans) {
          // Show all tiers except enterprise by default (enterprise is custom)
          setDbPlans(plansRes.plans)
        }
        if (matrix) setBillingMatrix(matrix)
      } finally {
        setMatrixLoading(false)
      }
    }
    load()
  }, [])

  const handleCheckout = async (tier: string) => {
    if (!token) {
      router.push('/auth/login?next=/dashboard/upgrade')
      return
    }
    setCheckoutLoading(tier)
    setCheckoutError(null)

    try {
      const redirectUrl = window.location.origin + '/dashboard'
      const data = await createCheckoutSession(token, tier, redirectUrl)
      if (data && data.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch (err: any) {
      console.error(err)
      setCheckoutError(err.message || 'Failed to initialize checkout')
      setCheckoutLoading(null)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center font-mono text-xs uppercase tracking-widest gap-3 grid-bg">
        <RefreshCw className="w-5 h-5 animate-spin text-[#ef4444]" />
        [VERIFYING_VAULT_SESSION...]
      </div>
    )
  }

  // The page is now public-readable — free users see the plan catalog
  // without being force-redirected. The "Choose plan" button still requires
  // authentication and routes through the standard login flow.
  const isFreeTier = !usage || usage.tier === 'free' || !user
  const currentTier = usage?.tier ?? 'free'

  // Filter plans: show all admin-configured plans except enterprise (custom)
  const displayPlans = dbPlans
    .filter(p => p.tier !== 'enterprise')
    .sort((a, b) => (a.monthly_limit || 0) - (b.monthly_limit || 0))

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <DashboardSidebar />

      <main className="flex-1 md:ml-64 overflow-x-hidden">
          <div className="p-6 max-w-7xl mx-auto w-full space-y-6">

            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-lg uppercase tracking-[0.15em] text-foreground font-bold">
                  {isFreeTier ? 'Choose Your Plan' : 'Manage Your Subscription'}
                </h1>
                {!isFreeTier && (
                  <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5">
                    Current: {currentTier}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl">
                Every plan uses <span className="text-foreground font-mono">points</span> to meter usage.
                Higher plans get more points and a bigger per-call discount on every model.
                <span className="text-muted-foreground/70"> Promotional models like MiniMax-M3 are loss-leadered for early adopters.</span>
              </p>
            </div>

            {/* Tier discount explainer */}
            {billingMatrix && !matrixLoading && (
              <div className="bg-muted/30 border border-border p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                {billingMatrix.tiers.filter(t => t !== 'enterprise').map(tier => {
                  const mult = billingMatrix.plan_multipliers?.[tier] ?? 1.0
                  const allowance = billingMatrix.monthly_allowances?.[tier] ?? 0
                  const discount = Math.round((1 - mult) * 100)
                  return (
                    <div key={tier} className="space-y-0.5">
                      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{tier}</div>
                      <div className="font-mono text-sm text-foreground font-bold">
                        {discount > 0 ? `${discount}% off` : 'Base price'}
                      </div>
                      <div className="font-mono text-[9px] text-muted-foreground/70">
                        {allowance > 0 ? `${allowance.toLocaleString()} pts/mo` : 'Pay as you go'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Checkout error banner */}
            {checkoutError && (
              <div className="bg-[#ef4444]/10 border border-[#ef4444] p-3 font-mono text-[10px] text-[#ef4444] uppercase tracking-wider">
                [CHECKOUT_ERROR]: {checkoutError}
              </div>
            )}

            {/* Plans grid */}
            {displayPlans.length === 0 ? (
              <div className="bg-card border border-border p-12 text-center font-mono text-xs text-muted-foreground">
                {matrixLoading ? (
                  <RefreshCw className="w-5 h-5 animate-spin text-[#ef4444] mx-auto mb-2" />
                ) : null}
                Loading plans from backend...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {displayPlans.map(plan => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    matrix={billingMatrix}
                    isCurrent={currentTier === plan.tier}
                    isLoading={checkoutLoading === plan.tier}
                    onCheckout={() => handleCheckout(plan.tier)}
                  />
                ))}
              </div>
            )}

            {/* Billing matrix preview */}
            {billingMatrix && billingMatrix.models.length > 0 && (
              <BillingMatrixPreview matrix={billingMatrix} currentTier={currentTier} />
            )}

            {/* Footer / help */}
            <div className="text-center pt-4 border-t border-border">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest leading-relaxed">
                Need custom limits or an enterprise setup? Contact{' '}
                <a href="mailto:support@akarouter.com" className="text-[#ef4444] hover:underline font-bold">support@akarouter.com</a>
              </p>
            </div>
          </div>
        </main>
    </div>
  )
}

// ============================================
// PlanCard
// ============================================

interface PlanCardProps {
  plan: PlanPreset
  matrix: BillingMatrix | null
  isCurrent: boolean
  isLoading: boolean
  onCheckout: () => void
}

function PlanCard({ plan, matrix, isCurrent, isLoading, onCheckout }: PlanCardProps) {
  const mult = matrix?.plan_multipliers?.[plan.tier] ?? 1.0
  const allowance = matrix?.monthly_allowances?.[plan.tier] ?? plan.monthly_point_allowance ?? 0
  const discount = Math.round((1 - mult) * 100)
  const isPopular = plan.tier === 'pro'

  return (
    <div
      className={`relative bg-card border ${isPopular ? 'border-[#ef4444]/60' : 'border-border'} p-5 flex flex-col transition-all hover:border-border`}
    >
      {plan.badge && (
        <div className="absolute top-0 right-4 -translate-y-1/2 bg-[#ef4444] text-foreground font-mono text-[8px] font-bold px-2 py-0.5 tracking-widest uppercase">
          {plan.badge}
        </div>
      )}
      {isCurrent && (
        <div className="absolute top-0 left-4 -translate-y-1/2 bg-emerald-500 text-white font-mono text-[8px] font-bold px-2 py-0.5 tracking-widest uppercase inline-flex items-center gap-1">
          <Check className="w-2 h-2" /> Current
        </div>
      )}

      <div className="space-y-3">
        {/* Name + tier indicator */}
        <div className="space-y-1">
          <h3 className="font-mono text-xs text-foreground font-bold uppercase tracking-wider">
            {plan.tier}
          </h3>
          {plan.description && (
            <p className="text-[9px] font-mono text-muted-foreground/80 uppercase font-medium leading-relaxed min-h-[28px]">
              {plan.description}
            </p>
          )}
        </div>

        {/* Price + headline points */}
        <div className="space-y-0.5 py-2 border-y border-border">
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-2xl text-foreground font-bold tracking-tighter">
              {plan.price || '$0'}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground uppercase">
              / {plan.billing_period || 'mo'}
            </span>
          </div>
          {allowance > 0 && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {allowance.toLocaleString()} points/mo
              {mult < 1.0 && (
                <span className="text-emerald-400 ml-2">· save {discount}%</span>
              )}
            </div>
          )}
        </div>

        {/* Limits list */}
        <ul className="space-y-1 font-mono text-[9px] text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="w-1 h-1 bg-[#ef4444] shrink-0" />
            <span>Monthly: ${plan.monthly_limit.toFixed(2)} budget</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-1 h-1 bg-[#ef4444] shrink-0" />
            <span>{plan.rpm_limit} requests/min</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-1 h-1 bg-[#ef4444] shrink-0" />
            <span>5h cap: ${plan.tokens_5h_limit.toFixed(2)}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-1 h-1 bg-[#ef4444] shrink-0" />
            <span>7d cap: ${plan.tokens_7d_limit.toFixed(2)}</span>
          </li>
          {plan.has_trial && plan.trial_days && (
            <li className="flex items-center gap-1.5 text-emerald-400">
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              <span>{plan.trial_days}-day free trial</span>
            </li>
          )}
        </ul>

        {/* Included models hint */}
        {Array.isArray(plan.included_model_aliases) && plan.included_model_aliases.length > 0 && plan.included_model_aliases.length <= 12 && (
          <div className="pt-2 border-t border-border">
            <div className="text-[8px] font-mono text-muted-foreground/80 uppercase tracking-wider mb-1">
              {plan.included_model_aliases.length} models included
            </div>
            <div className="flex flex-wrap gap-1">
              {plan.included_model_aliases.slice(0, 5).map(id => (
                <span key={id} className="px-1.5 py-0.5 text-[8px] font-mono border border-border bg-muted/40 text-muted-foreground">
                  {id.replace('akarouter-', '')}
                </span>
              ))}
              {plan.included_model_aliases.length > 5 && (
                <span className="text-[8px] font-mono text-muted-foreground/70 self-center">
                  +{plan.included_model_aliases.length - 5}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="pt-5 mt-auto">
        {isCurrent ? (
          <button
            disabled
            className="w-full bg-muted/40 border border-border text-muted-foreground font-mono text-[9px] py-3 tracking-widest uppercase font-bold cursor-default"
          >
            Current Plan
          </button>
        ) : (
          <button
            disabled={isLoading}
            onClick={onCheckout}
            className="w-full bg-muted border border-border text-foreground/80 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-foreground font-mono text-[9px] py-3 transition-all tracking-widest uppercase font-bold disabled:opacity-50"
          >
            {isLoading
              ? 'INITIALIZING...'
              : plan.has_trial
                ? 'START FREE TRIAL'
                : 'SUBSCRIBE NOW'}
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================
// BillingMatrixPreview
// ============================================

function BillingMatrixPreview({ matrix, currentTier }: { matrix: BillingMatrix; currentTier: string }) {
  const [filterTier, setFilterTier] = useState<string>(currentTier || 'free')
  const visibleTiers = matrix.tiers.filter(t => t !== 'enterprise')

  // Pick the models to show: top 8 by base cost, then promotional first
  const visibleModels = [...matrix.models]
    .sort((a, b) => {
      // Promotional first
      if (a.is_promotional && !b.is_promotional) return -1
      if (!a.is_promotional && b.is_promotional) return 1
      // Then by base cost (highest first = most expensive first)
      const aBase = a.costs?.free?.base ?? 0
      const bBase = b.costs?.free?.base ?? 0
      return bBase - aBase
    })
    .slice(0, 8)

  return (
    <div className="bg-card border border-border p-5 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-border pb-3">
        <div className="space-y-1">
          <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
            <div className="w-[3px] h-3 bg-[#ef4444]" />
            EFFECTIVE_COST_MATRIX
          </h2>
          <p className="text-[10px] font-mono text-muted-foreground/80 uppercase font-medium">
            Effective points per request on each tier — already factors in plan discount + promotional discount.
          </p>
        </div>
        {/* Tier filter chips */}
        <div className="flex items-center gap-1">
          {visibleTiers.map(tier => (
            <button
              key={tier}
              onClick={() => setFilterTier(tier)}
              className={`font-mono text-[9px] uppercase tracking-wider px-2.5 py-1 border transition-colors ${
                filterTier === tier
                  ? 'border-[#ef4444] bg-[#ef4444]/15 text-[#ef4444]'
                  : 'border-border bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[10px]">
          <thead>
            <tr className="text-muted-foreground uppercase tracking-wider text-[9px]">
              <th className="text-left py-2 pr-3 font-bold">Model</th>
              <th className="text-left py-2 pr-3 font-bold">Provider</th>
              <th className="text-right py-2 pr-3 font-bold">Base</th>
              {visibleTiers.map(tier => (
                <th key={tier} className="text-right py-2 px-2 font-bold">
                  {tier === filterTier ? <span className="text-[#ef4444]">{tier} →</span> : tier}
                </th>
              ))}
              <th className="text-right py-2 pl-3 font-bold">Mode</th>
            </tr>
          </thead>
          <tbody>
            {visibleModels.map(model => {
              const effectiveCost = model.costs?.[filterTier]?.effective ?? model.costs?.free?.base ?? 0
              const baseCost = model.costs?.free?.base ?? 0
              const saved = baseCost - effectiveCost
              return (
                <tr key={model.alias} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="py-2 pr-3 text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{model.display_name}</span>
                      {model.is_promotional && (
                        <span className="px-1 py-0 text-[7px] uppercase border border-pink-500/50 bg-pink-500/10 text-pink-400 inline-flex items-center gap-0.5">
                          <Sparkles className="w-2 h-2" />
                          {Math.round(model.promotional_discount_pct * 100)}% off
                        </span>
                      )}
                      {model.is_upcoming && (
                        <span className="px-1 py-0 text-[7px] uppercase border border-amber-500/50 bg-amber-500/10 text-amber-400">
                          soon
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground/80">
                    {model.provider_name}
                  </td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">
                    {baseCost}pt
                  </td>
                  {visibleTiers.map(tier => {
                    const cost = model.costs?.[tier]?.effective ?? 0
                    const tBase = model.costs?.[tier]?.base ?? 0
                    const tSaved = tBase - cost
                    const isCurrent = tier === filterTier
                    return (
                      <td
                        key={tier}
                        className={`py-2 px-2 text-right ${
                          isCurrent ? 'text-[#ef4444] font-bold' : 'text-foreground'
                        }`}
                      >
                        {cost}pt
                        {tSaved > 0 && (
                          <span className="text-emerald-400 text-[8px] ml-1">
                            <TrendingDown className="w-2 h-2 inline" />
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="py-2 pl-3 text-right text-muted-foreground/70">
                    {model.pricing_mode === 'per_token' ? 'token' : 'req'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="pt-2 border-t border-border text-[9px] font-mono text-muted-foreground/70 flex items-center justify-between">
        <span>
          <span className="text-emerald-400">↓</span> = saves points vs base price
        </span>
        <Link href="/models" className="text-[#ef4444] hover:underline uppercase tracking-wider">
          Browse all models →
        </Link>
      </div>
    </div>
  )
}
