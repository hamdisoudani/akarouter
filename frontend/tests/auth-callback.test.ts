import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock 'next/headers' before the route handler is imported
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('next/server', async () => {
  return {
    NextResponse: {
      redirect: vi.fn((url: URL) => ({
        status: 302,
        headers: { location: url.toString() },
      })),
    },
  }
})

import { GET } from '@/app/auth/callback/route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Helper: build a fake NextRequest-like object
function fakeRequest(url: string): Parameters<typeof GET>[0] {
  return { url } as unknown as Parameters<typeof GET>[0]
}

function getLocation(res: { headers: Headers | { location?: string } }): string {
  if (res.headers instanceof Headers) {
    return res.headers.get('location') ?? ''
  }
  return res.headers.location ?? ''
}

describe('GET /auth/callback', () => {
  const mockExchange = vi.fn()
  const mockSupabase = { auth: { exchangeCodeForSession: mockExchange } }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(createServerSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase)
    ;(NextResponse.redirect as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: URL) => ({
      status: 302,
      headers: { location: url.toString() },
    }))
  })

  afterEach(() => {
    mockExchange.mockReset()
  })

  it('redirects to login when no code is present', async () => {
    const res = await GET(fakeRequest('https://example.com/auth/callback'))
    expect(res).toMatchObject({ status: 302 })
    expect(getLocation(res)).toContain('/auth/login?error=auth_missing_code')
  })

  it('exchanges the code and redirects to the intended destination', async () => {
    mockExchange.mockResolvedValue({ error: null })
    const res = await GET(fakeRequest('https://example.com/auth/callback?code=abc123&next=/dashboard'))

    expect(mockExchange).toHaveBeenCalledWith('abc123')
    expect(getLocation(res)).toBe('https://example.com/dashboard')
  })

  it('falls back to /dashboard when next is not provided', async () => {
    mockExchange.mockResolvedValue({ error: null })
    const res = await GET(fakeRequest('https://example.com/auth/callback?code=abc123'))
    expect(getLocation(res)).toBe('https://example.com/dashboard')
  })

  it('rejects open-redirect attempts (protocol-relative next)', async () => {
    mockExchange.mockResolvedValue({ error: null })
    const res = await GET(fakeRequest('https://example.com/auth/callback?code=abc123&next=//evil.com/path'))
    // next should be sanitized to /dashboard (default)
    expect(getLocation(res)).toBe('https://example.com/dashboard')
  })

  it('rejects absolute-URL next parameter', async () => {
    mockExchange.mockResolvedValue({ error: null })
    const res = await GET(fakeRequest('https://example.com/auth/callback?code=abc123&next=https://evil.com/path'))
    expect(getLocation(res)).toBe('https://example.com/dashboard')
  })

  it('redirects to login with auth_failed when exchangeCodeForSession returns an error', async () => {
    mockExchange.mockResolvedValue({ error: { message: 'invalid_grant' } })
    const res = await GET(fakeRequest('https://example.com/auth/callback?code=bad'))
    const loc = getLocation(res)
    expect(loc).toContain('/auth/login?error=auth_failed')
    // SECURITY: ensure the error message is not echoed back in the URL
    expect(loc).not.toContain('invalid_grant')
  })

  it('redirects to login when exchangeCodeForSession throws', async () => {
    mockExchange.mockRejectedValue(new Error('network exploded'))
    const res = await GET(fakeRequest('https://example.com/auth/callback?code=bad'))
    const loc = getLocation(res)
    expect(loc).toContain('/auth/login?error=auth_failed')
    expect(loc).not.toContain('network')
  })
})