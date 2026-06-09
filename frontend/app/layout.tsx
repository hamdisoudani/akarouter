import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import { AppProvider } from './providers'

export const metadata: Metadata = {
  title: 'AkaRouter — AI Inference Gateway',
  description: 'OpenAI-compatible AI inference gateway. One key, every model.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '6LcnqxUtAAAAAO9MYeFNsyL4JA-6PlAHKzoZoRCc'

  return (
    <html lang="en" className="dark">
      <body className="bg-[#09090b] text-[#e5e1e4] antialiased">
        <AppProvider>
          {children}
        </AppProvider>
        <Script 
          src={`https://www.google.com/recaptcha/api.js?render=${siteKey}`} 
          strategy="afterInteractive" 
        />
      </body>
    </html>
  )
}
