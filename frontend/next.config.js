/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

/**
 * Content Security Policy.
 *
 * We DO NOT set the CSP here. CSP is set per-request in proxy.ts where
 * a per-request nonce can be embedded into script-src. Setting CSP
 * here would either:
 *   1. force 'unsafe-inline' (regressing security)
 *   2. force a static nonce (defeating the purpose — every response
 *      would share the same nonce, which is just as bad as
 *      'unsafe-inline')
 *
 * Static security headers (HSTS, X-Frame-Options, etc.) are still set
 * here because they don't need a nonce.
 */

const securityHeaders = [
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Referrer policy: only send the origin on cross-origin requests
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable dangerous browser features
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  },
  // Cross-origin isolation (defense in depth against Spectre-style side channels)
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  // HSTS — only meaningful over HTTPS, but harmless over HTTP
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
]

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  // We proxy /api/* through the Next server to the backend, hiding the real
  // backend URL from the browser. This is also a CORS-free setup.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/:path*`,
      },
    ]
  },

  // Image optimization configuration. Empty for now — add remotePatterns when
  // you start serving remote images.
  images: {
    remotePatterns: [],
  },

  // Static security headers — applied to every response. The CSP is set
  // per-request in proxy.ts so it can include a fresh nonce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/api/:path*',
        headers: [
          ...securityHeaders,
          // API routes get a strict CSP — they never serve HTML, only
          // JSON, so no script/style/frame sources are needed.
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ]
  },

  // Reduce info disclosure — don't expose framework version in errors
  poweredByHeader: false,

  // Tighten the default X-Powered-By behavior
  experimental: {
    // In Next 16, large-route-error has been stabilized; opt-in to better
    // error reporting without leaking stack traces to clients.
    largePageDataBytes: 128 * 1024,
  },
}

module.exports = nextConfig
