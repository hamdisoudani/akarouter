/**
 * PointsTable — renders the "Full Pricing Transparency" table on the
 * landing page. Pulls every number from the billing matrix API, so
 * the points/call and "X calls/mo on Pro" cells always reflect what
 * the endpoint actually charges.
 *
 * Previously this table was hardcoded with stale point costs that
 * didn't match the endpoint. User-reported 2026-06-21 ("minimax point
 * is 1 while in the section under it it mentions that it costs 2
 * points" — the inconsistency was actually across the whole table,
 * not just MiniMax M3).
 *
 * CAVEAT: the matrix is cached server-side (revalidate: 300) via
 * `fetchServerBillingMatrix()`. Admin-side model edits appear within
 * 5 minutes of the save. That's fine for a marketing page — the
 * authoritative source of truth is the /dashboard/upgrade page,
 * which is authed and renders per-user live data.
 */

import type { BillingMatrixResponse } from '@/lib/server-api'

// Marketing copy. The backend returns model slugs in the form
// "claude-haiku-4-5" / "gpt-5-3-codex-spark" / etc. — we keep
// kebab-case keys here so the lookup is a single map.get().
const BEST_FOR: Record<string, string> = {
  'minimax-m3': 'frontier reasoning, daily driver',
  'claude-haiku-4-5': 'lightweight tasks, quick Q&A',
  'nemotron-ultra': 'high-volume free tier',
  'claude-sonnet-4-6': 'coding, mid-complex reasoning',
  'gpt-5-4': 'vision + reasoning + tools',
  'gemini-3-1-pro': 'huge context, video, audio',
  'claude-opus-4-8': 'deepest reasoning, hard problems',
  'gpt-5-5': 'agentic workflows, code gen',
  'gpt-5-3-codex-spark': 'large code refactors',
  'step-3-7-flash': 'instant answers, free daily pool',
  'owl-alpha': 'experimental frontier preview',
}

const SUBTITLE: Record<string, string> = {
  'minimax-m3': 'frontier, free to us',
  'claude-haiku-4-5': 'fast + cheap',
  'nemotron-ultra': 'free-tier alternative',
  'claude-sonnet-4-6': 'workhorse',
  'gpt-5-4': 'multimodal',
  'gemini-3-1-pro': '1M context, multimodal',
  'claude-opus-4-8': 'the best reasoning',
  'gpt-5-5': 'flagship OpenAI',
  'gpt-5-3-codex-spark': 'coding specialist',
  'step-3-7-flash': 'instant answers',
  'owl-alpha': 'experimental preview',
}

// Tier badge + color for the points/call cost. The display threshold
// comes from the effective cost on the FREE plan (which is what
// visitors landing on the page would actually pay):
//   1 pt/call  -> "free"  (green)  — promo models on the free tier
//   1-2 pt     -> "T1"    (zinc)   — cheap and fast
//   2-3 pt     -> "T2"    (blue)   — mid-tier workhorse
//   5+ pt      -> "T3"    (red)    — premium / frontier
function tierBadge(cost: number): { label: string; className: string } {
  if (cost <= 1) {
    return {
      label: 'free',
      className: 'px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] uppercase',
    }
  }
  if (cost <= 2) {
    return {
      label: 'T1',
      className: 'px-2 py-0.5 bg-muted border border-border text-foreground/80 text-[10px] uppercase',
    }
  }
  if (cost <= 3) {
    return {
      label: 'T2',
      className: 'px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] uppercase',
    }
  }
  return {
    label: 'T3',
    className: 'px-2 py-0.5 bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] text-[10px] uppercase font-bold',
  }
}

// Cost color: cheap (amber for the "T1" hot cost), mid (amber),
// premium (red). We use red only for >=5pt/call to signal "this is
// going to cost you real points" — visitors should see the cost
// going up visibly.
function costColor(cost: number, isPromotional: boolean): string {
  if (isPromotional) return 'text-amber-400 font-black text-base'
  if (cost >= 5) return 'text-[#ef4444] font-black text-base'
  if (cost >= 3) return 'text-amber-400 font-bold'
  return 'text-amber-400 font-bold'
}

function formatCalls(allowance: number, cost: number): string {
  if (!allowance || !cost) return '—'
  const n = Math.floor(allowance / cost)
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k calls`
  return `${n.toLocaleString()} calls`
}

export function PointsTable({ matrix }: { matrix: BillingMatrixResponse | null }) {
  if (!matrix || !matrix.models || matrix.models.length === 0) {
    return (
      <div className="border border-border bg-background p-8 text-center">
        <p className="text-[10px] font-mono text-muted-foreground/80 uppercase tracking-widest">
          [PRICING_MATRIX_UNAVAILABLE]
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/60 mt-2">
          The live billing matrix did not return. See /dashboard/upgrade for current prices.
        </p>
      </div>
    )
  }

  const proAllowance = matrix.monthly_allowances?.pro ?? 2500
  const ultraAllowance = matrix.monthly_allowances?.ultra ?? 7500

  // Sort models so promo/free-tier cheap models come first, then by
  // ascending free-tier effective cost. This is the order that
  // makes sense for a visitor scanning the page.
  const sorted = [...matrix.models]
    .filter((m) => !m.is_upcoming)
    .sort((a, b) => {
      const aCost = a.costs.free?.effective ?? 999
      const bCost = b.costs.free?.effective ?? 999
      // Promotional items first
      if (a.is_promotional && !b.is_promotional) return -1
      if (!a.is_promotional && b.is_promotional) return 1
      return aCost - bCost
    })

  return (
    <div className="border border-border bg-background overflow-x-auto">
      <table className="w-full font-mono text-[11px] sm:text-xs">
        <thead>
          <tr className="border-b border-border bg-card">
            <th className="text-left p-3 sm:p-4 text-muted-foreground/80 uppercase tracking-wider font-bold">Model</th>
            <th className="p-3 sm:p-4 text-center text-muted-foreground/80 uppercase tracking-wider font-bold">Tier</th>
            <th className="p-3 sm:p-4 text-center text-muted-foreground/80 uppercase tracking-wider font-bold">Points/call</th>
            <th className="p-3 sm:p-4 text-center text-muted-foreground/80 uppercase tracking-wider font-bold">Pro $19.99/mo</th>
            <th className="p-3 sm:p-4 text-center text-muted-foreground/80 uppercase tracking-wider font-bold">Ultra $99.99/mo</th>
            <th className="p-3 sm:p-4 text-center text-muted-foreground/80 uppercase tracking-wider font-bold hidden md:table-cell">Best for</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900">
          {sorted.map((m) => {
            const cost = m.costs.free?.effective ?? 1
            const base = m.costs.free?.base ?? cost
            const isPromo = !!m.is_promotional
            const badge = tierBadge(cost)
            const subtitle = SUBTITLE[m.slug] ?? ''
            const bestFor = BEST_FOR[m.slug] ?? 'general purpose'
            // Use the API's per-tier value if present, otherwise
            // fall back to the free value.
            const proCost = m.costs.pro?.effective ?? cost
            const ultraCost = m.costs.ultra?.effective ?? proCost
            return (
              <tr key={m.id} className="hover:bg-muted/40/50">
                <td className="p-3 sm:p-4">
                  <div className="text-foreground font-bold flex items-center gap-2 flex-wrap">
                    <span>{m.display_name}</span>
                    {isPromo && (
                      <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[8px] uppercase font-bold">
                        50% off
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <div className="text-[9px] text-muted-foreground/80">{subtitle}</div>
                  )}
                </td>
                <td className="p-3 sm:p-4 text-center">
                  <span className={badge.className}>{badge.label}</span>
                </td>
                <td className="p-3 sm:p-4 text-center">
                  <div className={costColor(cost, isPromo)}>{cost}</div>
                  {isPromo && cost !== base && (
                    <div className="text-[9px] text-muted-foreground/60 line-through">{base}</div>
                  )}
                </td>
                <td className="p-3 sm:p-4 text-center text-foreground font-bold">
                  {formatCalls(proAllowance, proCost)}
                </td>
                <td className="p-3 sm:p-4 text-center text-foreground font-bold">
                  {formatCalls(ultraAllowance, ultraCost)}
                </td>
                <td className="p-3 sm:p-4 text-muted-foreground text-[10px] hidden md:table-cell">
                  {bestFor}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
