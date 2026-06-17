/**
 * Type-safe environment variable validation.
 *
 * SECURITY: the previous code read `process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
 * directly in `app/layout.tsx` with no validation, no fallback policy, no
 * TypeScript inference. If the var was missing or typo'd, the app would silently
 * send users to Google reCAPTCHA with a bogus site key — failing silently in
 * the browser console but giving the user a broken experience.
 *
 * This module uses zod to validate env vars at server module load. If any
 * required var is missing or malformed, the server refuses to start.
 *
 * - `NEXT_PUBLIC_*` vars are also exposed to the client; everything else is
 *   server-only and must NEVER be referenced from client components.
 * - The schema is the single source of truth: add a new var here once, get
 *   full type inference in your code.
 *
 * Usage:
 *   import { env } from '@/lib/env'
 *   const url = env.NEXT_PUBLIC_API_URL
 */

import { z } from 'zod'

const envSchema = z.object({
  // Public vars (NEXT_PUBLIC_* are inlined at build time and visible in browser).
  NEXT_PUBLIC_API_URL: z
    .string()
    .url('NEXT_PUBLIC_API_URL must be a valid URL')
    .default('http://localhost:8000'),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is too short — did you forget to set it?'),
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: z
    .string()
    .min(20, 'NEXT_PUBLIC_RECAPTCHA_SITE_KEY is too short — get it from the reCAPTCHA admin console'),

  // Node environment — Next.js sets this automatically.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

// Next.js sets process.env at build time for NEXT_PUBLIC_* vars.
// We use a top-level call so the build fails fast on misconfiguration.
const parsed = envSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  NODE_ENV: process.env.NODE_ENV,
})

if (!parsed.success) {
  // Print a clear, actionable error.
  // Use console.error so it shows up in `next build` output.
  console.error(
    '\n❌ Invalid environment variables:\n' +
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2) +
      '\n\nFix the .env file or your CI/CD environment. See .env.example for the full list.\n',
  )
  // In server context, throw to halt boot. In client, we can't throw at module
  // top level without breaking the bundle, so we still throw — Next.js will
  // show the error.
  throw new Error('Invalid environment variables — see console for details')
}

export const env = parsed.data

/**
 * Type of the validated env object. Use this when you want to type a function
 * parameter or return value that depends on env.
 */
export type Env = z.infer<typeof envSchema>
