import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests for the type-safe env validation in lib/env.ts.
 *
 * Verifies:
 *  1. Valid env produces a typed env object.
 *  2. Missing required vars throw on import.
 *  3. Malformed URLs throw.
 *  4. The reCAPTCHA key length check catches "set to empty string".
 *  5. Default values fire when a var is missing.
 */

const VALID_ENV = {
  NEXT_PUBLIC_API_URL: 'https://akarouter-production.up.railway.app',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '***'.repeat(40),
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: '***'.repeat(40),
  NODE_ENV: 'production' as const,
}

const ENV_KEYS = Object.keys(VALID_ENV)

function setEnv(overrides: Partial<typeof VALID_ENV> = {}) {
  // Clear any keys we manage, then set baseline + overrides.
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, VALID_ENV)
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
}

describe('env', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
  })

  it('parses a valid env', async () => {
    setEnv()
    const { env } = await import('../lib/env')
    expect(env.NEXT_PUBLIC_API_URL).toBe('https://akarouter-production.up.railway.app')
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co')
    expect(env.NODE_ENV).toBe('production')
  })

  it('throws when SUPABASE_URL is missing', async () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined as unknown as string })
    await expect(import('../lib/env')).rejects.toThrow(/Invalid environment variables/)
  })

  it('throws when SUPABASE_URL is malformed', async () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' })
    await expect(import('../lib/env')).rejects.toThrow(/Invalid environment variables/)
  })

  it('throws when SUPABASE_ANON_KEY is too short', async () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: '***' })
    await expect(import('../lib/env')).rejects.toThrow(/Invalid environment variables/)
  })

  it('throws when reCAPTCHA site key is too short', async () => {
    setEnv({ NEXT_PUBLIC_RECAPTCHA_SITE_KEY: '***' })
    await expect(import('../lib/env')).rejects.toThrow(/Invalid environment variables/)
  })

  it('uses default API_URL when not provided', async () => {
    setEnv({ NEXT_PUBLIC_API_URL: undefined as unknown as string })
    const { env } = await import('../lib/env')
    expect(env.NEXT_PUBLIC_API_URL).toBe('http://localhost:8000')
  })

  it('accepts development NODE_ENV', async () => {
    setEnv({ NODE_ENV: 'development' as 'production' })
    const { env } = await import('../lib/env')
    expect(env.NODE_ENV).toBe('development')
  })

  it('rejects unknown NODE_ENV', async () => {
    setEnv({ NODE_ENV: 'staging' as 'production' })
    await expect(import('../lib/env')).rejects.toThrow(/Invalid environment variables/)
  })
})
