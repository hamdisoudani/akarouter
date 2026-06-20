import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Shared layout for legal pages (privacy, terms, cookies).
 *
 * Server Component. Renders with zero JS, fully indexable by Google, no
 * hydration cost. Previous versions were 'use client' for no reason —
 * these pages have no interactivity.
 *
 * Note: <TopNav /> is rendered globally by app/layout.tsx since the
 * routing restructure. Don't render it here or it'll appear twice.
 */

export function LegalLayout({
  icon,
  title,
  documentRef,
  children,
}: {
  icon: ReactNode
  title: string
  documentRef: string
  children: ReactNode
}) {
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col antialiased selection:bg-[#ef4444]/30 selection:text-foreground grid-bg">
      {/* Content Canvas */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-6 md:py-16 space-y-8 z-10">
        <div className="border border-border bg-card p-8 md:p-12 crosshair-corners relative">
          <div className="absolute inset-0 opacity-[0.03] micro-grid pointer-events-none" />

          <div className="space-y-6">
            {/* Header info */}
            <div className="border-b border-border pb-6 space-y-2">
              <h1 className="font-mono text-xl md:text-2xl text-foreground font-bold tracking-wider flex items-center gap-3 uppercase">
                {icon}
                {title}
              </h1>
              <p className="text-[10px] font-mono text-muted-foreground/80 uppercase tracking-widest">
                Last Updated: June 2026 | Document Reference: {documentRef}
              </p>
            </div>

            {/* Document Body */}
            <div className="font-mono text-xs text-muted-foreground space-y-6 leading-relaxed">
              {children}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground/60 bg-background micro-grid mt-auto">
        <p className="font-mono text-[9px] uppercase tracking-widest">
          © 2026 AkaRouter by HAMDI. Kernel: v1.0.0-STABLE.
        </p>
      </footer>
    </div>
  )
}

export function LegalSection({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-foreground font-bold uppercase tracking-wider text-[11px] flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse"></span>
        {index}. {title}
      </h2>
      <p>{children}</p>
    </section>
  )
}