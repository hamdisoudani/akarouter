/**
 * Conditional wrapper for the global <TopNav />.
 *
 * Why: the landing page (/) has its own <MarketingNav /> with in-page
 * anchor links (#features, #models, #pricing) that don't make sense
 * as separate routes. We don't want the global TopNav AND the
 * marketing nav stacking on top of each other on / — that would be
 * ~128px of nav at the top.
 *
 * This component returns null on / and renders <TopNav /> everywhere
 * else. It's a tiny client component (uses usePathname) so it's not
 * free of hydration cost, but the cost is one path check per render.
 */

'use client'

import { usePathname } from 'next/navigation'
import { TopNav } from '@/components/TopNav'

export function GlobalNav() {
  const pathname = usePathname()

  // Landing page owns its own nav (MarketingNav).
  if (pathname === '/') return null

  return <TopNav />
}