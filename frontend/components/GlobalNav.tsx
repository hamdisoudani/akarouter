/**
 * Conditional wrapper for the global <TopNav />.
 *
 * Why this exists: the landing page (/) has its own <MarketingNav />
 * with in-page anchor links (#features, #models, #pricing) that don't
 * make sense as separate routes, so the global TopNav is suppressed
 * there. We ALSO suppress the global TopNav on /dashboard/* and /docs
 * because those pages render their own <DashboardSidebar /> — a fixed
 * vertical sidebar that already carries the logo, nav links, theme
 * toggle, and sign-out button. Rendering both the global TopNav and
 * the DashboardSidebar would stack two top app bars (the user-visible
 * "navbar repeated twice" bug) and put a "Go to dashboard" button on
 * the page you are literally already on.
 *
 * Hidden on:
 *   - /                       (MarketingNav owns chrome)
 *   - /dashboard, /dashboard/* (DashboardSidebar owns chrome)
 *   - /docs                   (DashboardSidebar owns chrome)
 *
 * Renders on every other route: /, /models, /models/:id, /auth/*,
 * and the public legal pages.
 *
 * It's a tiny client component (uses usePathname) so the hydration
 * cost is one path check per render.
 */

'use client'

import { usePathname } from 'next/navigation'
import { TopNav } from '@/components/TopNav'

// Routes where the page already ships its own sidebar/topbar and the
// global TopNav would create a duplicate chrome. Centralized so the
// "where does the global nav render" question has one source of truth.
function isSidebarRoute(pathname: string | null): boolean {
  if (!pathname) return false
  if (pathname === '/dashboard' || pathname === '/dashboard/') return true
  if (pathname.startsWith('/dashboard/')) return true
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return true
  return false
}

export function GlobalNav() {
  const pathname = usePathname()

  // Landing page owns its own nav (MarketingNav).
  if (pathname === '/') return null
  // Dashboard + Docs pages own their own sidebar (DashboardSidebar).
  if (isSidebarRoute(pathname)) return null

  return <TopNav />
}