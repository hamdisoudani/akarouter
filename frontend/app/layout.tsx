import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AkaRouter — AI Inference API',
  description: 'OpenAI-compatible AI inference gateway. One key, every model.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#09090b] text-[#e5e1e4] antialiased">{children}</body>
    </html>
  )
}
