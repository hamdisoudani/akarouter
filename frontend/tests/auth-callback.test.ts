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

  describe('NEXT_PUBLIC_SITE_URL override (avoids Docker container hostname in redirect)', () => {
    it('uses NEXT_PUBLIC_SITE_URL when set, ignoring Docker-style request origin', async () => {
      // Simulate a request that arrived at the Docker container directly
      // (e.g., http://830635b86b84:8080) — which is the bug we fixed.
      const original = process.env.NEXT_PUBLIC_SITE_URL
      process.env.NEXT_PUBLIC_SITE_URL = 'https://akarouter.dev'
      try {
        mockExchange.mockResolvedValue({ error: null })
        const res = await GET(fakeRequest('http://830635b86b84:8080/auth/callback?code=abc123&next=/dashboard'))
        // The redirect MUST go to the public site, not the container hostname
        expect(getLocation(res)).toBe('https://akarouter.dev/dashboard')
      } finally {
        if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
        else process.env.NEXT_PUBLIC_SITE_URL = original
      }
    })

    it('strips trailing slash from NEXT_PUBLIC_SITE_URL', async () => {
      const original = process.env.NEXT_PUBLIC_SITE_URL
      process.env.NEXT_PUBLIC_SITE_URL = 'https://akarouter.dev/'
      try {
        mockExchange.mockResolvedValue({ error: null })
        const res = await GET(fakeRequest('http://localhost:3000/auth/callback?code=abc'))
        const loc = getLocation(res)
        // No double slash before /dashboard
        expect(loc).toBe('https://akarouter.dev/dashboard')
        expect(loc).not.toContain('akarouter.dev//')
      } finally {
        if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
        else process.env.NEXT_PUBLIC_SITE_URL = original
      }
    })

    it('ignores NEXT_PUBLIC_SITE_URL that is not http(s) and falls back to request origin', async () => {
      const original = process.env.NEXT_PUBLIC_SITE_URL
      process.env.NEXT_PUBLIC_SITE_URL = 'javascript:alert(1)'  // XSS attempt
      try {
        mockExchange.mockResolvedValue({ error: null })
        const res = await GET(fakeRequest('https://example.com/auth/callback?code=abc'))
        // Falls back to request origin (example.com), NOT javascript:
        expect(getLocation(res)).toBe('https://example.com/dashboard')
      } finally {
        if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
        else process.env.NEXT_PUBLIC_SITE_URL = original
      }
    })

    it('falls back to request origin when NEXT_PUBLIC_SITE_URL is unset', async () => {
      const original = process.env.NEXT_PUBLIC_SITE_URL
      delete process.env.NEXT_PUBLIC_SITE_URL
      try {
        mockExchange.mockResolvedValue({ error: null })
        const res = await GET(fakeRequest('https://akarouter.dev/auth/callback?code=abc'))
        expect(getLocation(res)).toBe('https://akarouter.dev/dashboard')
      } finally {
        if (original !== undefined) process.env.NEXT_PUBLIC_SITE_URL = original
      }
    })
  })
})