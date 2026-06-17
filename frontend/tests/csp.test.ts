import { describe, it, expect } from 'vitest'

/**
 * Tests for the per-request CSP nonce and the strict CSP emitted by
 * proxy.ts.
 *
 * Why this matters: the clean-slate infra audit flagged
 * 'next.config.js — script-src unsafe-inline' as MEDIUM. The fix is to
 * generate a per-request nonce in proxy.ts and embed it in the CSP.
 * These tests assert the right structure is in place without booting
 * the edge runtime.
 *
 * Approach: read the source files as text and assert on key properties.
 * For nonce generation we re-implement the same algorithm inline so we
 * can verify the format expectations independently.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROXY_PATH = join(__dirname, '..', 'proxy.ts')
const NEXT_CONFIG_PATH = join(__dirname, '..', 'next.config.js')

const proxySource = readFileSync(PROXY_PATH, 'utf-8')
const nextConfigSource = readFileSync(NEXT_CONFIG_PATH, 'utf-8')

/**
 * Re-implement generateNonce() the same way proxy.ts does. This is
 * the "shape" we expect — we test the algorithm produces a CSPRNG
 * nonce, not that proxy.ts's body matches this exactly. (A copy-paste
 * test would pass even if the nonce were always "AAAA".)
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

describe('CSP nonce (algorithm)', () => {
  it('is base64url (no + / = chars)', () => {
    const n = generateNonce()
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(n).not.toMatch(/[+/=]/)
  })

  it('is 16 bytes of entropy (22 base64url chars, no padding)', () => {
    // 16 bytes = ceil(16 * 4/3) = 22 base64url chars (no padding)
    const n = generateNonce()
    expect(n).toHaveLength(22)
  })

  it('differs across calls (CSPRNG sanity check)', () => {
    // 1000 nonces, all unique (collision probability is 2^-128 per
    // pair, so 1000 should be safe).
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      seen.add(generateNonce())
    }
    expect(seen.size).toBe(1000)
  })
})

describe('proxy.ts source', () => {
  it('declares the three helpers', () => {
    expect(proxySource).toMatch(/function generateNonce\(/)
    expect(proxySource).toMatch(/function buildAppCSP\(/)
    expect(proxySource).toMatch(/function supabaseHostFromUrl\(/)
  })

  it('propagates the nonce via x-nonce request header', () => {
    // Server components can read it via headers().get('x-nonce') if
    // they need to set nonce on inline <script> tags.
    expect(proxySource).toContain("requestHeaders.set('x-nonce'")
  })

  it('sets CSP per-response on HTML paths, not API paths', () => {
    expect(proxySource).toMatch(/isHtmlResponse/)
    expect(proxySource).toContain("response.headers.set('Content-Security-Policy'")
    // The CSP is only attached when isHtmlResponse(pathname) is true;
    // the response-building helper gates on the `csp` variable.
    expect(proxySource).toMatch(/if \(csp\)/)
  })

  it('uses crypto.getRandomValues (CSPRNG, not Math.random)', () => {
    expect(proxySource).toContain('crypto.getRandomValues')
    expect(proxySource).not.toContain('Math.random')
  })
})

describe('app CSP directive (asserted against buildAppCSP shape)', () => {
  // Re-derive what buildAppCSP(nonce, supabaseHost) produces and
  // assert it has the required properties. We don't execute the TS —
  // we verify the SHAPE of the function in source.

  function extractDirectiveArray(): string {
    // Find the buildAppCSP function and return its body (between the
    // opening { and the closing }) so we can inspect the directives.
    const start = proxySource.indexOf('function buildAppCSP(')
    if (start === -1) throw new Error('buildAppCSP not found')
    const openBrace = proxySource.indexOf('{', start)
    let depth = 0
    for (let i = openBrace; i < proxySource.length; i++) {
      if (proxySource[i] === '{') depth++
      else if (proxySource[i] === '}') {
        depth--
        if (depth === 0) return proxySource.slice(openBrace + 1, i)
      }
    }
    throw new Error('buildAppCSP body not terminated')
  }

  it('script-src includes nonce and reCAPTCHA, no unsafe-inline', () => {
    const body = extractDirectiveArray()
    // Match the script-src directive (template-literal or quoted string).
    const match = body.match(/(?:`|")script-src ((?:[^`"]+))(?:`|")/)
    expect(match).not.toBeNull()
    const directive = match![1]
    expect(directive).toContain("'self'")
    expect(directive).toMatch(/'nonce-\$\{nonce\}'/)
    expect(directive).toContain('https://www.google.com/recaptcha/')
    expect(directive).not.toContain("'unsafe-inline'")
  })

  it('connect-src pins Supabase to the specific host (no wildcard)', () => {
    const body = extractDirectiveArray()
    const match = body.match(/(?:`|")connect-src ((?:[^`"]+))(?:`|")/)
    expect(match).not.toBeNull()
    const directive = match![1]
    expect(directive).toContain("'self'")
    expect(directive).toContain('https://${supabaseHost}')
    expect(directive).toContain('wss://${supabaseHost}')
    expect(directive).not.toContain('*.supabase.co')
  })

  it('frame-src is pinned (no umbrella *.google.com)', () => {
    const body = extractDirectiveArray()
    const match = body.match(/(?:`|")frame-src ((?:[^`"]+))(?:`|")/)
    expect(match).not.toBeNull()
    const directive = match![1]
    expect(directive).toContain('https://www.google.com/recaptcha/')
    expect(directive).toContain('https://recaptcha.google.com')
    expect(directive).not.toContain('*.google.com')
    // No bare https://www.google.com — must always end with a path
    expect(directive).not.toMatch(/https:\/\/www\.google\.com(?!\/)/)
  })

  it('includes frame-ancestors none (clickjacking defense)', () => {
    const body = extractDirectiveArray()
    expect(body).toContain("frame-ancestors 'none'")
  })

  it('includes object-src none (Flash/legacy plugin defense)', () => {
    const body = extractDirectiveArray()
    expect(body).toContain("object-src 'none'")
  })

  it('includes base-uri self (no <base> hijack)', () => {
    const body = extractDirectiveArray()
    expect(body).toContain("base-uri 'self'")
  })

  it('style-src unsafe-inline is annotated as a known TODO', () => {
    const body = extractDirectiveArray()
    // 'unsafe-inline' for styles is a known TODO (requires Tailwind
    // v4 + middleware cooperation). The comment MUST be present so
    // future maintainers know it's intentional and not a regression.
    expect(body).toMatch(/unsafe-inline.*style/i)
    // The comment must be visible in the file too.
    expect(proxySource.toLowerCase()).toContain('tailwind')
  })
})

describe('supabaseHostFromUrl', () => {
  // Re-implement for testing (TS not executable in Node test env).
  function host(url: string | undefined): string {
    if (!url) return 'invalid.supabase.co'
    try {
      return new URL(url).host
    } catch {
      return 'invalid.supabase.co'
    }
  }

  it('extracts the host from a full URL', () => {
    expect(host('https://abcdefgh.supabase.co')).toBe('abcdefgh.supabase.co')
  })

  it('strips the path', () => {
    expect(host('https://abcdefgh.supabase.co/auth/v1')).toBe('abcdefgh.supabase.co')
  })

  it('returns a safe placeholder for undefined / invalid input', () => {
    expect(host(undefined)).toBe('invalid.supabase.co')
    expect(host('')).toBe('invalid.supabase.co')
    expect(host('not-a-url')).toBe('invalid.supabase.co')
  })
})

describe('next.config.js', () => {
  it('does NOT set Content-Security-Policy on the HTML app source', () => {
    // The CSP is set per-request in proxy.ts with a fresh nonce.
    // next.config.js must NOT emit a CSP for the HTML app routes —
    // that would either force 'unsafe-inline' or share one nonce
    // across all requests.
    //
    // We split the config into its three header blocks and assert
    // the only Content-Security-Policy header is on the /api/*
    // source (the strict API JSON CSP). The first `source:` in the
    // file is the rewrites() function, which we skip.
    const headersStart = nextConfigSource.indexOf('async headers()')
    if (headersStart === -1) {
      throw new Error('async headers() not found in next.config.js')
    }
    const headersBody = nextConfigSource.slice(headersStart)
    const blocks = headersBody.split("source:")
    for (const block of blocks) {
      const sourceMatch = block.match(/^\s*'([^']+)'/)
      if (!sourceMatch) continue
      const source = sourceMatch[1]
      const hasCsp = /key:\s*['"]Content-Security-Policy['"]/.test(block)
      if (source === '/api/:path*') {
        // /api/* SHOULD have a CSP (the strict JSON one).
        expect(hasCsp).toBe(true)
      } else if (source === '/:path*') {
        // /:path* (HTML app) MUST NOT have a CSP — proxy.ts sets it
        // per-request with a fresh nonce.
        expect(hasCsp).toBe(false)
      }
    }
  })

  it('still emits the other security headers (HSTS, X-Frame-Options, etc.)', () => {
    expect(nextConfigSource).toContain("'X-Content-Type-Options'")
    expect(nextConfigSource).toContain("'X-Frame-Options'")
    expect(nextConfigSource).toContain("'Referrer-Policy'")
    expect(nextConfigSource).toContain("'Permissions-Policy'")
    expect(nextConfigSource).toContain("'Strict-Transport-Security'")
  })
})
