'use client'

/**
 * Top-of-page progress bar.
 *
 * Hooks into the App Router (`next/navigation`) and shows an NProgress
 * bar at the top of the page whenever the user navigates client-side.
 * On the FIRST render the pathname/seachParams are stable, so the
 * effect doesn't fire (no flash on hard reloads).
 *
 * The bar color is the same red used throughout the app
 * (`#ef4444`) so it visually matches the rest of the chrome.
 *
 * We DELAY the start by 120ms to avoid flashing the bar on
 * near-instant transitions (e.g. cached pages, prerendered routes).
 *
 * Why not `nextjs-progressbar`? It uses the legacy `next/router`
 * Pages-Router event API which doesn't fire on App-Router route
 * changes. We need a real App-Router listener.
 */

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

// Idempotent configuration — only runs once per process.
NProgress.configure({
  showSpinner: false,
  trickleSpeed: 120,
  minimum: 0.15,
  easing: 'ease',
  speed: 400,
})

const SHOW_DELAY_MS = 120

export function ProgressBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Don't flash on first render — both pathname and searchParams
    // are stable on the first paint, so the effect only fires on
    // SUBSEQUENT changes (i.e. real navigations).
    if (startTimer.current) {
      clearTimeout(startTimer.current)
    }
    if (doneTimer.current) {
      clearTimeout(doneTimer.current)
    }

    startTimer.current = setTimeout(() => {
      NProgress.start()
    }, SHOW_DELAY_MS)

    // After 80% of typical transition (~600ms), force-complete even
    // if a hung route change never fires its completion event.
    doneTimer.current = setTimeout(() => {
      NProgress.done(true)
    }, 1500)

    return () => {
      NProgress.done(true)
    }
  }, [pathname, searchParams])

  return null
}
