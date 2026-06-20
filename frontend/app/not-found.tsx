import Link from 'next/link'

/**
 * Global 404 page. Renders for any unmatched route. We render this from the
 * server (no 'use client' needed) so it ships zero JS and is indexable.
 */

export default function NotFound() {
  return (
    <div className="relative min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-md z-10 text-center">
        <h1 className="text-6xl font-mono font-bold text-[#ef4444] mb-2">404</h1>
        <h2 className="text-sm font-mono tracking-widest text-foreground/80 uppercase mb-6">
          [ROUTE_NOT_FOUND]
        </h2>
        <p className="text-[11px] text-muted-foreground/80 font-mono uppercase tracking-wide mb-8">
          The requested path does not exist.
        </p>
        <Link
          href="/"
          className="inline-block bg-white hover:bg-zinc-200 text-[#09090b] font-mono text-xs font-bold py-3 px-5 transition-all shadow-md"
        >
          ← BACK HOME
        </Link>
      </div>
    </div>
  )
}
