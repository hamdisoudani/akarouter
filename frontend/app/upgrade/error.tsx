'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[segment error.tsx] digest:', error.digest)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="bg-[#0e0e10] border border-[#27272a] p-6 max-w-md w-full">
        <h2 className="text-sm font-mono tracking-widest text-zinc-300 uppercase mb-2">
          [ERROR]
        </h2>
        <p className="text-[11px] text-zinc-500 font-mono mb-4">
          Something went wrong. Please try again.
        </p>
        <button
          onClick={reset}
          className="w-full bg-white hover:bg-zinc-200 text-[#09090b] font-mono text-xs font-bold py-2.5 px-4 transition-all"
        >
          RETRY
        </button>
      </div>
    </div>
  )
}
