const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'

export interface ChatRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  stream?: boolean
}

export interface Model {
  id: string
  object: string
}

export interface ModelsResponse {
  object: string
  data: Model[]
}

export async function getModels(): Promise<ModelsResponse> {
  const res = await fetch(`${API_URL}/v1/models`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error('Failed to fetch models')
  return res.json()
}

export async function chatCompletion(request: ChatRequest): Promise<any> {
  const res = await fetch(`${API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(err.detail || 'Chat completion failed')
  }
  return res.json()
}

export async function checkHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/healthz`)
  return res.json()
}
