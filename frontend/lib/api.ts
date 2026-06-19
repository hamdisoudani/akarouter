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
    object: string
    owned_by: string
    display_name?: string
    description?: string
    is_active?: boolean
    capabilities?: string[]
    input_cost_per_million?: number
    output_cost_per_million?: number
    context_length?: number
    pricing_mode?: 'per_token' | 'per_request'
    cost_per_request_cents?: number | null
    points_cost?: number  // per-call point cost (admin-editable, 0-1000)
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
  t1_requests_limit?: number
  t2_requests_limit?: number
  t3_requests_limit?: number
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
  // Per-tier request caps (T1=cheap, T2=mid, T3=premium)
  t1_requests_limit?: number
  t2_requests_limit?: number
  t3_requests_limit?: number
  monthly_requests_limit?: number
  per_request_cost_cents?: number
  pricing_mode?: 'per_token' | 'per_request' | 'mixed'
  price?: string
  billing_period?: string
  description?: string
  badge?: string
  has_trial?: boolean
  trial_days?: number
  created_at: string
  updated_at: string
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
    t1_requests_limit?: number
    t2_requests_limit?: number
    t3_requests_limit?: number
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
  t1RequestsLimit?: number,
  t2RequestsLimit?: number,
  t3RequestsLimit?: number,
  price?: string,
  billingPeriod?: string,
  description?: string,
  badge?: string,
  hasTrial?: boolean,
  trialDays?: number
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
      t1_requests_limit: t1RequestsLimit ?? 0,
      t2_requests_limit: t2RequestsLimit ?? 0,
      t3_requests_limit: t3RequestsLimit ?? 0,
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
    t1_requests_limit?: number;
    t2_requests_limit?: number;
    t3_requests_limit?: number;
    price?: string;
    billing_period?: string;
    description?: string;
    badge?: string;
    has_trial?: boolean;
    trial_days?: number;
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
  upstream_model: string
  display_name: string
  provider_name?: string
  is_free_provider?: boolean
  description: string
  is_active: boolean
  input_cost_per_million: number | null
  output_cost_per_million: number | null
  pricing_mode?: 'per_token' | 'per_request' | null
  cost_per_request_cents?: number | null
  points_cost?: number | null
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
  data: {
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
