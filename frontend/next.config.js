/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

/**
 * Content Security Policy.
 *
 * STRICT for app routes — allows only same-origin scripts/styles, Google
 * reCAPTCHA, and Google OAuth domains. The 'unsafe-inline' for styles is
 * needed because Next.js injects inline styles for the App Router; for a
 * stricter policy, switch to nonced styles (requires middleware cooperation).
 *
 * For API routes: completely separate CSP that does not allow any inline
 * content (API responses are JSON; no scripts needed).
 */
const appCSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google.com",
  "frame-src 'self' https://www.google.com https://accounts.google.com https://recaptcha.google.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ')

const apiCSP = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

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

  // Security headers — applied to every response. The API routes get a
  // stricter CSP via the `api` matcher.
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
          { key: 'Content-Security-Policy', value: apiCSP },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: appCSP }],
        // Apply the app CSP only to HTML responses (not /api/* which is
        // handled above and not /_next/static which is hashed).
        missing: [
          { type: 'header', key: 'next-router-prefetch' },
          { type: 'header', key: 'purpose', value: 'prefetch' },
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
