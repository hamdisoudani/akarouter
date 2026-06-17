import { Loader2 } from 'lucide-react'

/**
 * Global loading UI. Renders while server components below it are fetching.
 * Uses the same dark visual style as the rest of the app.
 */

export default function Loading() {
  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex items-center justify-center px-6">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-4" />
        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          Loading…
        </p>
      </div>
    </div>
  )
}
