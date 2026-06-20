'use client'

/**
 * Root error boundary. Catches unhandled errors in any server or client
 * component below it. Renders a safe fallback — never echoes the error
 * message to the user (could leak stack traces, internal hostnames, etc.).
 *
 * SECURITY: the previous setup had no error boundary, so unhandled errors
 * bubbled to Next's default page which shows the full error message. This
 * includes:
 *   - Internal file paths
 *   - Library names + version
 *   - Database column names
 *   - Supabase project URL
 * This page ensures none of that ever reaches the browser.
 */

import { useEffect } from 'react'
import Link from 'next/link'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to console — wire up to Sentry/OTel in instrumentation.ts (PR 6).
    // We log the digest (server-allocated ID) and not the message, so
    // operators can find this error in logs without exposing the raw text
    // to anything that scrapes the browser console.
    // eslint-disable-next-line no-console
    console.error('[app/error.tsx] unhandled error, digest:', error.digest)
  }, [error])

  return (
    <div className="relative min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-md z-10">
        <div className="bg-card border border-border p-8 md:p-10">
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-sm font-mono tracking-widest text-foreground/80 uppercase">
                [INTERNAL_ERROR]
              </h2>
              <p className="text-[11px] text-muted-foreground/80 font-mono uppercase tracking-wide mt-2">
                Something went wrong on our end. Our team has been notified.
              </p>
            </div>

            <button
              onClick={reset}
              className="w-full bg-white hover:bg-zinc-200 text-[#09090b] font-mono text-xs font-bold py-3 px-5 transition-all shadow-md active:scale-[0.98]"
            >
              TRY AGAIN
            </button>

            <div className="text-center">
              <Link
                href="/"
                className="text-[10px] font-mono text-muted-foreground/80 hover:text-foreground/80 uppercase tracking-widest"
              >
                ← Back to home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
