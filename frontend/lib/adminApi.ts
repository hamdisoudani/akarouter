'use client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || ''

async function adminFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  }
  if (ADMIN_TOKEN) headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`
  return fetch(`${API_URL}${path}`, { ...options, headers })
}

export interface Provider {
  id: string
  account_label: string
  health_status: string
  weight: number
  total_requests: number
  total_errors: number
  in_flight: number
  max_concurrent: number
  last_used_at: string | null
  last_error_at: string | null
  last_error_msg: string | null
  created_at: string
  updated_at: string
  access_token_preview: string
  refresh_token_preview: string
  seconds_until_expiry: number | null
  is_expired: boolean
  refresh_lock_acquired_at: string | null
}

export interface AdminStats {
  providers: { total: number; active: number; total_requests: number; total_errors: number }
  accounts: { total: number; active: number; by_tier: Record<string, number> }
}

export async function listProviders(): Promise<Provider[]> {
  const res = await adminFetch('/admin/providers')
  if (!res.ok) throw new Error('Failed to fetch providers')
  const data = await res.json()
  return data.providers
}

export async function initiateOAuth(accountLabel: string): Promise<{ ok: boolean; flow_id: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number }> {
  const res = await adminFetch('/admin/providers/oauth/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_label: accountLabel }),
  })
  if (!res.ok) throw new Error('Failed to initiate OAuth')
  return res.json()
}

export async function startOAuthPoll(flowId: string): Promise<{ ok: boolean; status: string }> {
  const res = await adminFetch(`/admin/providers/oauth/poll/${flowId}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to start poll')
  return res.json()
}

export async function getOAuthStatus(flowId: string): Promise<{ ok: boolean; status: string; result?: any; error?: string; verification_uri?: string; user_code?: string }> {
  const res = await adminFetch(`/admin/providers/oauth/status/${flowId}`)
  if (!res.ok) throw new Error('Failed to get OAuth status')
  return res.json()
}

export async function refreshProvider(providerId: string): Promise<any> {
  const res = await adminFetch(`/admin/providers/${providerId}/refresh`, { method: 'POST' })
  if (!res.ok) throw new Error('Refresh failed')
  return res.json()
}

export async function refreshAllProviders(): Promise<{ ok: boolean; refreshed: any[] }> {
  const res = await adminFetch('/admin/providers/refresh-all', { method: 'POST' })
  if (!res.ok) throw new Error('Bulk refresh failed')
  return res.json()
}

export async function deleteProvider(providerId: string): Promise<{ ok: boolean }> {
  const res = await adminFetch(`/admin/providers/${providerId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Delete failed')
  return res.json()
}

export async function getAdminStats(): Promise<AdminStats> {
  const res = await adminFetch('/admin/stats')
  if (!res.ok) throw new Error('Stats fetch failed')
  return res.json()
}
