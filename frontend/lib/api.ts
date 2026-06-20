import { env } from './env'

// On the server: talk to the real backend. On the client: talk to the
// Next.js rewrite at /api/* (which proxies to the backend and hides the
// real backend URL from the browser).
const API_BASE = typeof window !== 'undefined'
  ? '/api'
  : env.NEXT_PUBLIC_API_URL

export interface ModelsResponse {
  object: string
  data: Array<{
    id: string
    slug?: string  // URL-safe identifier generated from display_name (e.g. "claude-opus-48")
    object: string
    owned_by: string
    display_name?: string
    description?: string
    is_active?: boolean
    // is_upcoming: TRUE = shown in catalog with price, but chat returns 403.
    // Use for "Feature Upcoming" / soon-to-launch models. UI should disable
    // the chat button and show a "Coming Soon" badge.
    is_upcoming?: boolean
    capabilities?: string[]
    input_cost_per_million?: number
    output_cost_per_million?: number
    context_length?: number
    pricing_mode?: 'per_token' | 'per_request'
    cost_per_request_cents?: number | null
    points_cost?: number  // per-call point cost (admin-editable, 0-1000)
    // NEW (2026-06-20): Promotional model flag — extra % off on top of tier multiplier.
    // Admin editable. Use for loss leaders / launch promos (e.g. MiniMax-M3).
    is_promotional?: boolean
    promotional_discount_pct?: number  // 0-1, e.g. 0.3 = 30% off
    promotional_admin_note?: string
    // Authoritative model specifications (populated from upstream docs)
    provider_name?: string
    is_free_provider?: boolean
    max_output_tokens?: number
    input_modalities?: string[]
    output_modalities?: string[]
    knowledge_cutoff?: string
    released_date?: string
    supports?: {
      vision?: boolean
      video?: boolean
      audio?: boolean
      tool_use?: boolean
      function_calling?: boolean
      reasoning?: boolean
    }
    specs_source?: string
  }>
}

export interface ChatCompletionRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

export interface ChatCompletionResponse {
  id: string
  object: string
  model: string
  choices: Array<{
    index: number
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ApiKey {
  id: string
  key_prefix: string
  key_name: string
  scopes: string[]
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

export interface UsageStats {
  tier: string
  role: string
  monthly_requests: number
  monthly_limit: number
  total_requests: number
  remaining: number
  rpm_limit?: number
  tokens_5h_limit?: number
  tokens_7d_limit?: number
  consumed_tokens_input?: number
  consumed_tokens_output?: number
  consumed_budget_5h?: number
  consumed_budget_7d?: number
  progress_percentage_5h?: number
  progress_percentage_7d?: number
  consumed_budget_month?: number
  progress_percentage_month?: number
  remaining_percentage_month?: number
  gateway_enabled?: boolean
  next_reset_5h?: number
  full_reset_5h?: number
  next_reset_7d?: number
  full_reset_7d?: number
  is_trialing?: boolean
  // Point system (NEW)
  monthly_points_remaining?: number
  monthly_points_limit?: number
  points_reset_at?: string | null
  daily_free_requests_remaining?: number
  daily_free_requests_reset_at?: string | null
}

export interface PointTransaction {
  id: string
  points: number
  kind: 'charge' | 'refund' | 'grant' | 'adjustment'
  reason: string | null
  model_alias: string | null
  balance_after: number
  created_by: string | null
  metadata: Record<string, any> | null
  created_at: string
}

export interface PointTransactionsResponse {
  transactions: PointTransaction[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  summary: {
    spent: number
    refunded: number
    granted: number
  }
}

export interface ModelAnalytics {
  model: string
  total_requests: number
  successful_requests: number
  error_requests: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
  avg_latency_ms: number
}

export interface RequestLog {
  model: string
  upstream_model?: string
  status_code: number
  latency_ms: number
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  created_at: string
}

export interface AnalyticsResponse {
  models: ModelAnalytics[]
  total_logs: number
  recent_logs?: RequestLog[]
}

export interface UserInfo {
  auth_user_id: string
  account_id: string
  email: string
  role: string
  tier: string
  status: string
  // Point system (NEW)
  monthly_points_remaining?: number
  monthly_points_limit?: number
  points_reset_at?: string | null
  daily_free_requests_remaining?: number
  daily_free_requests_reset_at?: string | null
}

// Helper to get auth token from Supabase
async function getAuthToken(): Promise<string | null> {
  const { supabase } = await import('./supabase')
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

export async function getModels(): Promise<ModelsResponse> {
  const res = await fetch(`${API_BASE}/v1/models`)
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`)
  return res.json()
}

export async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || err.detail || `Chat failed: ${res.status}`)
  }
  return res.json()
}

export async function getMyKeys(token: string): Promise<{ keys: ApiKey[] }> {
  const res = await fetch(`${API_BASE}/user/keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch keys')
  return res.json()
}

export async function createKey(token: string, keyName: string = 'default', recaptchaToken?: string): Promise<{ ok: boolean; api_key: string; key_prefix: string; key_name: string }> {
  const res = await fetch(`${API_BASE}/user/keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key_name: keyName, recaptcha_token: recaptchaToken }),
  })
  if (!res.ok) throw new Error('Failed to create key')
  return res.json()
}

export async function revokeKey(token: string, keyId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/user/keys/${keyId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to revoke key')
}

export async function getUsage(token: string): Promise<UsageStats> {
  const res = await fetch(`${API_BASE}/user/usage`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch usage')
  return res.json()
}

export async function getPointTransactions(
  token: string,
  options: { limit?: number; offset?: number; kind?: 'charge' | 'refund' | 'grant' | 'adjustment' } = {}
): Promise<PointTransactionsResponse> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))
  if (options.kind) params.set('kind', options.kind)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${API_BASE}/user/point-transactions${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch point transactions')
  return res.json()
}

export async function getAnalytics(token: string): Promise<AnalyticsResponse> {
  const res = await fetch(`${API_BASE}/user/analytics`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch analytics')
  return res.json()
}

export async function getPlans(): Promise<{ plans: PlanPreset[] }> {
  const res = await fetch(`${API_BASE}/v1/plans`)
  if (!res.ok) throw new Error('Failed to fetch plans')
  return res.json()
}

export interface PlanPreset {
  id: string
  tier: string
  monthly_limit: number
  rpm_limit: number
  tokens_5h_limit: number
  tokens_7d_limit: number
  monthly_requests_limit?: number
  per_request_cost_cents?: number
  pricing_mode?: 'per_token' | 'per_request' | 'mixed'
  // Point system (NEW) — monthly allowance + daily free-model cap
  monthly_point_allowance?: number
  daily_free_requests_limit?: number
  // NEW (2026-06-20): per-tier discount multiplier on points_cost.
  // 0 < m <= 1.0. Higher tier = lower multiplier = bigger discount.
  // free=1.0, starter=0.9, pro=0.75, ultra=0.6, enterprise=0.5.
  points_cost_multiplier?: number
  /** Model aliases included in this plan. NULL/undefined = all active models. Admin editable. */
  included_model_aliases?: string[] | null
  price?: string
  billing_period?: string
  description?: string
  badge?: string
  has_trial?: boolean
  trial_days?: number
  created_at: string
  updated_at: string
}

// NEW (2026-06-20): billing matrix — effective cost for every model on every tier.
export interface BillingMatrixTier {
  base: number
  effective: number
}

export interface BillingMatrixModel {
  alias: string
  display_name: string
  provider_name: string
  is_upcoming: boolean
  is_promotional: boolean
  promotional_discount_pct: number
  pricing_mode: 'per_token' | 'per_request'
  costs: Record<string, BillingMatrixTier>  // { free: { base, effective }, pro: ..., ... }
}

export interface BillingMatrix {
  tiers: string[]
  plan_multipliers: Record<string, number>  // { free: 1.0, pro: 0.75, ... }
  monthly_allowances: Record<string, number>
  models: BillingMatrixModel[]
}

export async function getBillingMatrix(): Promise<BillingMatrix> {
  const res = await fetch(`${API_BASE}/v1/billing-matrix`)
  if (!res.ok) throw new Error('Failed to fetch billing matrix')
  return res.json()
}

export async function getMe(token: string): Promise<UserInfo> {
  const res = await fetch(`${API_BASE}/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Not authenticated')
  return res.json()
}

export async function createCheckoutSession(
  token: string,
  tier: string,
  redirectUrl?: string
): Promise<{ checkout_url: string }> {
  const res = await fetch(`${API_BASE}/user/checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tier, redirect_url: redirectUrl }),
  })
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(errData.detail || 'Failed to initialize checkout session')
  }
  return res.json()
}

export async function adminGetAccounts(
  token: string, 
  search?: string,
  limit?: number,
  offset?: number
): Promise<{ accounts: UserInfo[] & any[]; total: number }> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (limit !== undefined) params.append('limit', limit.toString())
  if (offset !== undefined) params.append('offset', offset.toString())

  const url = `${API_BASE}/admin/accounts?${params.toString()}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch accounts')
  return res.json()
}

export async function adminUpdateAccount(
  token: string,
  accountId: string,
  data: {
    tier?: string
    monthly_limit?: number
    status?: string
    suspended_reason?: string | null
    role?: string
    display_name?: string
    rpm_limit?: number
    tokens_5h_limit?: number
    tokens_7d_limit?: number
  }
): Promise<{ ok: boolean; account: any }> {
  const res = await fetch(`${API_BASE}/admin/accounts/${accountId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update account')
  }
  return res.json()
}

export async function adminGetPlans(token: string): Promise<{ plans: PlanPreset[] }> {
  const res = await fetch(`${API_BASE}/admin/plans`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch plan presets')
  return res.json()
}

export async function adminCreatePlan(
  token: string,
  tier: string,
  monthlyLimit: number,
  rpmLimit?: number,
  tokens5hLimit?: number,
  tokens7dLimit?: number,
  price?: string,
  billingPeriod?: string,
  description?: string,
  badge?: string,
  hasTrial?: boolean,
  trialDays?: number,
  monthlyPointAllowance?: number,
  dailyFreeRequestsLimit?: number,
  pointsCostMultiplier?: number
): Promise<{ ok: boolean; plan: PlanPreset }> {
  const res = await fetch(`${API_BASE}/admin/plans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tier,
      monthly_limit: monthlyLimit,
      rpm_limit: rpmLimit ?? 60,
      tokens_5h_limit: tokens5hLimit ?? 1.0,
      tokens_7d_limit: tokens7dLimit ?? 5.0,
      monthly_point_allowance: monthlyPointAllowance ?? 0,
      daily_free_requests_limit: dailyFreeRequestsLimit ?? 0,
      points_cost_multiplier: pointsCostMultiplier ?? 1.0,
      price: price ?? '$0',
      billing_period: billingPeriod ?? 'mo',
      description: description ?? '',
      badge: badge ?? '',
      has_trial: hasTrial ?? false,
      trial_days: trialDays ?? 7
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create plan preset')
  }
  return res.json()
}

export async function adminUpdatePlan(
  token: string,
  planId: string,
  data: {
    tier?: string;
    monthly_limit?: number;
    rpm_limit?: number;
    tokens_5h_limit?: number;
    tokens_7d_limit?: number;
    monthly_point_allowance?: number;
    daily_free_requests_limit?: number;
    points_cost_multiplier?: number;
    price?: string;
    billing_period?: string;
    description?: string;
    badge?: string;
    has_trial?: boolean;
    trial_days?: number;
    included_model_aliases?: string[] | null;
  }
): Promise<{ ok: boolean; plan: PlanPreset }> {
  const res = await fetch(`${API_BASE}/admin/plans/${planId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update plan preset')
  }
  return res.json()
}

export async function adminDeletePlan(token: string, planId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/admin/plans/${planId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to delete plan preset')
  return res.json()
}

export interface AdminModelMapping {
  alias: string
  slug?: string
  upstream_model?: string
  display_name: string
  provider_name?: string
  is_free_provider?: boolean
  description?: string
  is_active?: boolean
  is_upcoming?: boolean
  is_promotional?: boolean
  promotional_discount_pct?: number
  promotional_admin_note?: string | null
  capabilities?: string[]
  input_cost_per_million: number | null
  output_cost_per_million: number | null
  pricing_mode?: 'per_token' | 'per_request' | null
  cost_per_request_cents?: number | null
  points_cost?: number | null
  context_window_tokens?: number | null
  max_output_tokens?: number | null
  input_modalities?: string[]
  output_modalities?: string[]
  knowledge_cutoff?: string | null
  released_date?: string | null
  supports_vision?: boolean
  supports_video?: boolean
  supports_audio?: boolean
  supports_tool_use?: boolean
  supports_function_calling?: boolean
  supports_reasoning?: boolean
  [k: string]: unknown
}

/** Body for POST /admin/models — creates a new model. */
export interface CreateModelPayload {
  alias: string
  display_name: string
  upstream_model?: string
  provider_name?: string
  description?: string
  capabilities?: string[]
  pricing_mode: 'per_token' | 'per_request'
  input_cost_per_million?: number
  output_cost_per_million?: number
  cost_per_request_cents?: number | null
  points_cost?: number
  is_free_provider?: boolean
  is_active?: boolean
  is_upcoming?: boolean
  is_promotional?: boolean
  promotional_discount_pct?: number
  promotional_admin_note?: string
  slug?: string
  context_window_tokens?: number
  max_output_tokens?: number
  input_modalities?: string[]
  output_modalities?: string[]
  knowledge_cutoff?: string
  released_date?: string
  supports_vision?: boolean
  supports_video?: boolean
  supports_audio?: boolean
  supports_tool_use?: boolean
  supports_function_calling?: boolean
  supports_reasoning?: boolean
}

/** Body for PATCH /admin/models/{alias} — partial update. */
export interface UpdateModelPayload {
  is_active?: boolean
  is_upcoming?: boolean
  is_promotional?: boolean
  promotional_discount_pct?: number
  promotional_admin_note?: string
  display_name?: string
  slug?: string
  description?: string
  provider_name?: string
  upstream_model?: string
  capabilities?: string[]
  input_cost_per_million?: number
  output_cost_per_million?: number
  pricing_mode?: 'per_token' | 'per_request'
  cost_per_request_cents?: number
  points_cost?: number
  is_free_provider?: boolean
  context_window_tokens?: number
  max_output_tokens?: number
  input_modalities?: string[]
  output_modalities?: string[]
  knowledge_cutoff?: string
  released_date?: string
  supports_vision?: boolean
  supports_video?: boolean
  supports_audio?: boolean
  supports_tool_use?: boolean
  supports_function_calling?: boolean
  supports_reasoning?: boolean
}

export async function adminGetSettings(token: string): Promise<{ settings: Record<string, string> }> {
  const res = await fetch(`${API_BASE}/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch system settings')
  return res.json()
}

export async function adminUpdateSettings(token: string, data: { gateway_enabled?: boolean; require_activation?: boolean }): Promise<{ ok: boolean; gateway_enabled?: boolean; require_activation?: boolean }> {
  const res = await fetch(`${API_BASE}/admin/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update system settings')
  }
  return res.json()
}

export async function adminGetModels(token: string): Promise<{ models: AdminModelMapping[] }> {
  const res = await fetch(`${API_BASE}/admin/models`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch admin models list')
  return res.json()
}

export async function adminUpdateModel(
  token: string,
  alias: string,
  data: UpdateModelPayload | {
    is_active?: boolean;
    input_cost_per_million?: number | null;
    output_cost_per_million?: number | null;
    pricing_mode?: 'per_token' | 'per_request';
    cost_per_request_cents?: number | null;
    points_cost?: number | null;
  }
): Promise<{ ok: boolean; alias: string; updates: any }> {
  const res = await fetch(`${API_BASE}/admin/models/${alias}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update model settings')
  }
  return res.json()
}

export async function adminCreateModel(
  token: string,
  data: CreateModelPayload
): Promise<{ ok: boolean; alias: string; slug: string }> {
  const res = await fetch(`${API_BASE}/admin/models`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create model')
  }
  return res.json()
}

export async function adminDeleteModel(
  token: string,
  alias: string
): Promise<{ ok: boolean; alias: string; deleted: boolean }> {
  const res = await fetch(`${API_BASE}/admin/models/${alias}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete model')
  }
  return res.json()
}

export interface InvitationCode {
  id: string
  code: string
  max_uses: number
  used_count: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export async function activateAccount(
  token: string,
  code: string,
  recaptchaToken: string
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/user/activate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, recaptcha_token: recaptchaToken }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to activate account')
  }
  return res.json()
}

export async function adminGetInvitations(token: string): Promise<{ invitations: InvitationCode[] }> {
  const res = await fetch(`${API_BASE}/admin/invitations`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch invitations')
  return res.json()
}

export async function adminCreateInvitation(
  token: string,
  code?: string,
  maxUses?: number
): Promise<{ ok: boolean; invitation: InvitationCode }> {
  const res = await fetch(`${API_BASE}/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, max_uses: maxUses }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create invitation')
  }
  return res.json()
}

export async function adminUpdateInvitation(
  token: string,
  id: string,
  data: { max_uses?: number; is_active?: boolean }
): Promise<{ ok: boolean; invitation: InvitationCode }> {
  const res = await fetch(`${API_BASE}/admin/invitations/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update invitation')
  }
  return res.json()
}

export async function adminDeleteInvitation(token: string, id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/admin/invitations/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to delete invitation')
  return res.json()
}
