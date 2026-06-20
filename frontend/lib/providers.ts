/**
 * Provider detection from model data.
 *
 * Why this exists: the backend's `provider_name` field is "AkaRouter" for every
 * model (since AkaRouter is the unified gateway). To group models by their
 * actual upstream vendor (Claude, GPT, Gemini, etc.), we derive the upstream
 * from `display_name` and `id`.
 *
 * Mapping (add new ones here when new model families ship):
 *   "Claude *"        → Anthropic
 *   "GPT-*"           → OpenAI
 *   "Gemini *"        → Google
 *   "MiniMax *"       → MiniMax
 *   "Nemotron *"      → NVIDIA
 *   "Step-*" / "Step3" → Stepfun
 *   "DeepSeek *"      → DeepSeek
 *   "Qwen *"          → Alibaba
 *   "Llama *"         → Meta
 *   "Mistral *"       → Mistral
 *   "Kimi *"          → Moonshot
 *   "Grok *"          → xAI
 */

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'MiniMax'
  | 'nvidia'
  | 'stepfun'
  | 'deepseek'
  | 'alibaba'
  | 'meta'
  | 'mistral'
  | 'moonshot'
  | 'xai'
  | 'other'

export interface ProviderInfo {
  id: ProviderId
  /** Display name (e.g. "Anthropic") */
  name: string
  /** Short label for badges (e.g. "Claude" — what the upstream family is) */
  family: string
  /** Hex color for the brand dot / accent */
  color: string
  /** Tailwind classes for badges & section dividers */
  badgeClass: string
  /** Order for sorting providers (lower first) */
  order: number
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: { id: 'anthropic', name: 'Anthropic', family: 'Claude', color: '#d97757', badgeClass: 'border-orange-500/30 bg-orange-500/10 text-orange-400', order: 1 },
  openai: { id: 'openai', name: 'OpenAI', family: 'GPT', color: '#10a37f', badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', order: 2 },
  google: { id: 'google', name: 'Google', family: 'Gemini', color: '#4285f4', badgeClass: 'border-blue-500/30 bg-blue-500/10 text-blue-400', order: 3 },
  MiniMax: { id: 'MiniMax', name: 'MiniMax', family: 'MiniMax', color: '#ef4444', badgeClass: 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]', order: 4 },
  nvidia: { id: 'nvidia', name: 'NVIDIA', family: 'Nemotron', color: '#76b900', badgeClass: 'border-lime-500/30 bg-lime-500/10 text-lime-400', order: 5 },
  stepfun: { id: 'stepfun', name: 'Stepfun', family: 'Step', color: '#a855f7', badgeClass: 'border-purple-500/30 bg-purple-500/10 text-purple-400', order: 6 },
  deepseek: { id: 'deepseek', name: 'DeepSeek', family: 'DeepSeek', color: '#3b82f6', badgeClass: 'border-blue-400/30 bg-blue-400/10 text-blue-300', order: 7 },
  alibaba: { id: 'alibaba', name: 'Alibaba', family: 'Qwen', color: '#f97316', badgeClass: 'border-orange-400/30 bg-orange-400/10 text-orange-300', order: 8 },
  meta: { id: 'meta', name: 'Meta', family: 'Llama', color: '#1877f2', badgeClass: 'border-blue-600/30 bg-blue-600/10 text-blue-400', order: 9 },
  mistral: { id: 'mistral', name: 'Mistral', family: 'Mistral', color: '#ff7000', badgeClass: 'border-orange-600/30 bg-orange-600/10 text-orange-400', order: 10 },
  moonshot: { id: 'moonshot', name: 'Moonshot', family: 'Kimi', color: '#06b6d4', badgeClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400', order: 11 },
  xai: { id: 'xai', name: 'xAI', family: 'Grok', color: '#e5e5e5', badgeClass: 'border-zinc-400/30 bg-zinc-400/10 text-foreground', order: 12 },
  other: { id: 'other', name: 'Other', family: 'Other', color: '#71717a', badgeClass: 'border-zinc-500/30 bg-zinc-500/10 text-foreground/80', order: 99 },
}

/**
 * Detect upstream provider from a model id / display_name.
 * The backend's provider_name field is "AkaRouter" for everything
 * (since AkaRouter is the gateway), so we use the display string.
 */
export function detectProvider(model: { id: string; display_name?: string; provider_name?: string }): ProviderInfo {
  const text = `${model.display_name || ''} ${model.id}`.toLowerCase()

  if (text.includes('claude') || text.includes('opus') || text.includes('haiku') || text.includes('sonnet')) {
    return PROVIDERS.anthropic
  }
  if (text.includes('gpt') || text.includes('o1') || text.includes('o3') || text.includes('o4')) {
    return PROVIDERS.openai
  }
  if (text.includes('gemini')) {
    return PROVIDERS.google
  }
  if (text.includes('MiniMax') || text.includes('MiniMax') || text.includes('owl')) {
    return PROVIDERS.MiniMax
  }
  if (text.includes('nemotron') || text.includes('nvidia')) {
    return PROVIDERS.nvidia
  }
  if (text.includes('step-') || text.includes('step3') || text.includes('step 3') || text.includes('stepfun')) {
    return PROVIDERS.stepfun
  }
  if (text.includes('deepseek')) {
    return PROVIDERS.deepseek
  }
  if (text.includes('qwen') || text.includes('alibaba')) {
    return PROVIDERS.alibaba
  }
  if (text.includes('llama')) {
    return PROVIDERS.meta
  }
  if (text.includes('mistral')) {
    return PROVIDERS.mistral
  }
  if (text.includes('kimi')) {
    return PROVIDERS.moonshot
  }
  if (text.includes('grok')) {
    return PROVIDERS.xai
  }
  return PROVIDERS.other
}

/**
 * Group models by their detected upstream provider.
 * Returns providers in display order with their models.
 */
export function groupByProvider<T extends { id: string; display_name?: string; provider_name?: string }>(
  models: T[]
): Array<{ provider: ProviderInfo; models: T[] }> {
  const buckets = new Map<ProviderId, T[]>()
  for (const m of models) {
    const p = detectProvider(m)
    if (!buckets.has(p.id)) buckets.set(p.id, [])
    buckets.get(p.id)!.push(m)
  }
  return Array.from(buckets.entries())
    .map(([id, ms]) => ({ provider: PROVIDERS[id], models: ms }))
    .sort((a, b) => a.provider.order - b.provider.order)
}
