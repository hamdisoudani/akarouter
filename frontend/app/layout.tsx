import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AKAROUTER — Multi-Account AI Inference Proxy',
  description: 'Route requests across your Hermes/NOUS accounts with automatic token refresh, health-weighted routing, and OpenAI-compatible API.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
