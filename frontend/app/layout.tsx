import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'
import './globals.css'
import { AppProvider } from './providers'
import { ThemeProvider } from '@/components/theme-provider'
import { ProgressBar } from '@/components/ProgressBar'
import { GlobalNav } from '@/components/GlobalNav'
import { env } from '@/lib/env'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getMe, getUsage, type UserInfo, type UsageStats } from '@/lib/api'

export const metadata: Metadata = {
  title: 'AkaRouter — AI Inference Gateway',
  description: 'OpenAI-compatible AI inference gateway. One key, every model.',
}

/**
 * Server-side initial session resolution.
 *
 * Why this exists: the previous layout rendered with no user (the
 * `useApp()` provider started with `user: null` and only hydrated the
 * session on the client, causing a ~1s flash of the "Sign in" UI on
 * every page load). Now we resolve the Supabase session + /user/me +
 * /user/usage ON THE SERVER, pass the result down as initial state to
 * the client provider, and the first paint already shows the right UI.
 *
 * Failure mode is fail-soft: any error here falls through to
 * { user: null, token: '', usage: null } so the client still hydrates
 * and the user can log in. We never want a 500 on the layout just
 * because Supabase had a hiccup.
 */
async function resolveInitialSession(): Promise<{
  user: UserInfo | null
  token: string
  usage: UsageStats | null
}> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { user: null, token: '', usage: null }

    const user = await getMe(session.access_token)
    if (user.status === 'pending') {
      return { user, token: session.access_token, usage: null }
    }
    const usage = await getUsage(session.access_token)
    return { user, token: session.access_token, usage }
  } catch (err) {
    // /user/me or /user/usage can 401 if the token is expired or the
    // backend is briefly unavailable. Treat as "no session" so the
    // client-side provider can re-resolve or show the login prompt.
    console.error('resolveInitialSession failed:', err)
    return { user: null, token: '', usage: null }
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Force dynamic rendering so the per-request CSP nonce from proxy.ts is
  // applied to Next/React inline scripts instead of being blocked. Nonces
  // only work with dynamic rendering; awaiting connection() opts every
  // request into it (see Next.js CSP guide).
  await connection()

  // SECURITY: the reCAPTCHA site key is validated by lib/env.ts and
  // required at build time. We DON'T load the reCAPTCHA v3 invisible
  // script globally here — that approach:
  //   - tracked every page load for every user (privacy)
  //   - ran invisibly without user opt-in
  //   - could fail silently if the script was blocked
  // Instead, reCAPTCHA v2 (interactive "I am not a robot" checkbox) is
  // loaded ON DEMAND by <RecaptchaWidget /> when a protected form is
  // rendered. The user explicitly consents to the challenge on the
  // forms that need it (account activation, key generation, admin
  // actions). See lib/recaptcha.ts and components/RecaptchaWidget.tsx.
  //
  // The siteKey is referenced here to keep env validation working
  // (lib/env.ts will refuse to start if it's missing) but it is not
  // used at the layout level.
  void env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

  // Resolve the user + usage on the server so the first paint is correct.
  // Pass the result to <AppProvider> as initial state — no client-side
  // "resolve session then re-render" flash.
  const { user, token, usage } = await resolveInitialSession()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <Suspense fallback={null}>
            <ProgressBar />
          </Suspense>
          <AppProvider initialUser={user} initialToken={token} initialUsage={usage}>
            <GlobalNav />
            {children}
          </AppProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
