import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Suspense } from 'react'
import './globals.css'
import { AppProvider } from './providers'
import { ThemeProvider } from '@/components/theme-provider'
import { ProgressBar } from '@/components/ProgressBar'
import { env } from '@/lib/env'

export const metadata: Metadata = {
  title: 'AkaRouter — AI Inference Gateway',
  description: 'OpenAI-compatible AI inference gateway. One key, every model.',
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

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <Suspense fallback={null}>
            <ProgressBar />
          </Suspense>
          <AppProvider>
            {children}
          </AppProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
