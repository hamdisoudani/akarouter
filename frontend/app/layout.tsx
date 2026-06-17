import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import { AppProvider } from './providers'
import { ThemeProvider } from '@/components/theme-provider'
import { env } from '@/lib/env'

export const metadata: Metadata = {
  title: 'AkaRouter — AI Inference Gateway',
  description: 'OpenAI-compatible AI inference gateway. One key, every model.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // SECURITY: use the validated env object. If the var is missing or wrong,
  // the app fails to start with a clear error — no more silent fallback to
  // a hard-coded reCAPTCHA key.
  const siteKey = env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <AppProvider>
            {children}
          </AppProvider>
        </ThemeProvider>
        <Script 
          src={`https://www.google.com/recaptcha/api.js?render=${siteKey}`} 
          strategy="afterInteractive" 
        />
      </body>
    </html>
  )
}
