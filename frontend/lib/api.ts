const API_BASE = typeof window !== 'undefined'
  ? '/api'
  : (process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app')

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
  max_agents?: number
  openclaw_enabled?: boolean
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
  openclaw_enabled?: boolean
  max_agents?: number
  agent_cpu?: number
  agent_ram?: number
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
  openclaw_enabled?: boolean
  max_agents?: number
  agent_cpu?: number
  agent_ram?: number
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
    openclaw_enabled?: boolean
    max_agents?: number
    agent_cpu?: number
    agent_ram?: number
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
  openclawEnabled?: boolean,
  maxAgents?: number,
  agentCpu?: number,
  agentRam?: number
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
      openclaw_enabled: openclawEnabled ?? false,
      max_agents: maxAgents ?? 0,
      agent_cpu: agentCpu ?? 1,
      agent_ram: agentRam ?? 1
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
    openclaw_enabled?: boolean;
    max_agents?: number;
    agent_cpu?: number;
    agent_ram?: number;
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
  description: string
  is_active: boolean
  input_cost_per_million: number | null
  output_cost_per_million: number | null
}

export async function adminGetSettings(token: string): Promise<{ settings: Record<string, string> }> {
  const res = await fetch(`${API_BASE}/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch system settings')
  return res.json()
}

export async function adminUpdateSettings(token: string, data: { gateway_enabled?: boolean; require_activation?: boolean; max_agents_per_user?: number }): Promise<{ ok: boolean; gateway_enabled?: boolean; require_activation?: boolean; max_agents_per_user?: number }> {
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

// ---------------------------------------------------------------------------
// Hosted Agents Lifecycle
// ---------------------------------------------------------------------------

export interface HostedAgent {
  id: string
  agent_name: string
  sandbox_id: string | null
  status: 'provisioning' | 'installing' | 'running' | 'stopped' | 'failed' | 'destroying'
  model_name: string
  telegram_enabled: boolean
  telegram_allow_from: string | null
  discord_enabled: boolean
  error_message: string | null
  created_at: string
  updated_at: string
  daytona_key_id?: string | null
  progress_step?: number
  progress_message?: string
  agent_cpu?: number
  agent_ram?: number
}

export async function getHostedAgents(token: string): Promise<{ agents: HostedAgent[] }> {
  const res = await fetch(`${API_BASE}/user/hosted-agents`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch hosted agents')
  return res.json()
}

export async function deployHostedAgent(
  token: string,
  agentName: string,
  modelName: string = 'akarouter-pro',
  apiKeyRaw?: string
): Promise<{ ok: boolean; agent_id: string; status: string; message: string }> {
  const res = await fetch(`${API_BASE}/user/hosted-agents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_name: agentName,
      model_name: modelName,
      api_key_raw: apiKeyRaw || undefined
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to deploy hosted agent')
  }
  return res.json()
}

export async function configureAgentChannels(
  token: string,
  agentId: string,
  channels: {
    telegram_enabled?: boolean
    telegram_bot_token?: string
    telegram_allow_from?: string
    discord_enabled?: boolean
    discord_bot_token?: string
    discord_guilds?: Record<string, any>
  }
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/user/hosted-agents/${agentId}/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(channels),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to configure agent channels')
  }
  return res.json()
}

export async function destroyHostedAgent(token: string, agentId: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/user/hosted-agents/${agentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to destroy hosted agent')
  }
  return res.json()
}

export async function getAgentLogs(token: string, agentId: string, lines: number = 100): Promise<{ logs: string }> {
  const res = await fetch(`${API_BASE}/user/hosted-agents/${agentId}/logs?lines=${lines}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch agent logs')
  return res.json()
}

// ---------------------------------------------------------------------------
// Daytona API Keys Management (Admin Only)
// ---------------------------------------------------------------------------

export interface DaytonaKey {
  id: string
  key_label: string
  api_url: string
  is_active: boolean
  created_at: string
  updated_at: string
  api_key_preview: string
  active_vms: number
}

export async function adminGetDaytonaKeys(token: string): Promise<{ keys: DaytonaKey[] }> {
  const res = await fetch(`${API_BASE}/admin/daytona-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch Daytona keys')
  return res.json()
}

export async function adminCreateDaytonaKey(
  token: string,
  keyLabel: string,
  apiKey: string,
  apiUrl: string = 'https://app.daytona.io/api'
): Promise<{ ok: boolean; key: DaytonaKey }> {
  const res = await fetch(`${API_BASE}/admin/daytona-keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key_label: keyLabel, api_key: apiKey, api_url: apiUrl }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create Daytona key')
  }
  return res.json()
}

export async function adminUpdateDaytonaKey(
  token: string,
  keyId: string,
  updates: { key_label?: string; api_url?: string; is_active?: boolean }
): Promise<{ ok: boolean; key: DaytonaKey }> {
  const res = await fetch(`${API_BASE}/admin/daytona-keys/${keyId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update Daytona key')
  }
  return res.json()
}

export async function adminDeleteDaytonaKey(token: string, keyId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/admin/daytona-keys/${keyId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete Daytona key')
  }
  return res.json()
}

export async function adminTestDaytonaKey(token: string, keyId: string): Promise<{ ok: boolean; status: string; message: string }> {
  const res = await fetch(`${API_BASE}/admin/daytona-keys/${keyId}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to test Daytona key')
  }
  return res.json()
}

