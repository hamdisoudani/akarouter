import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'AkaRouter — AI Inference Gateway',
  description: 'OpenAI-compatible AI inference gateway. One key, every model.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#09090b] text-[#e5e1e4] antialiased">
        {children}
        <Script 
          src="https://www.google.com/recaptcha/api.js?render=6LcnqxUtAAAAAO9MYeFNsyL4JA-6PlAHKzoZoRCc" 
          strategy="afterInteractive" 
        />
      </body>
    </html>
  )
}
