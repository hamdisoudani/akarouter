'use client'

/**
 * DashboardSidebar — shared vertical sidebar + mobile drawer for all
 * /dashboard/* and /docs pages.
 *
 * Why this exists as a single component:
 *   Before, every page in /dashboard/* (and /docs) carried its own
 *   vertical sidebar, mobile drawer, AND top app bar. With the global
 *   <TopNav /> now rendering from app/layout.tsx, the page-level top
 *   app bar was duplicating the global nav (user-visible "navbar
 *   repeated twice" bug). This component consolidates the sidebar +
 *   drawer so each page only needs to render <DashboardSidebar /> +
 *   its main content.
 *
 * Props:
 *   - activeHref: which sidebar item to highlight (matches Link href)
 *
 * Architecture:
 *   - Client Component (uses useState for mobile drawer toggle)
 *   - Reads user + signOut + usage from useApp() context
 *   - On md+ screens: fixed vertical sidebar (w-64), drawer hidden
 *   - On <md screens: drawer slides in from the right; sidebar hidden
 *   - Floating mobile hamburger button (bottom-right) opens the drawer
 *
 * Auth-aware rendering (added 2026-06-21):
 *   The sidebar is reused on /docs (a PUBLIC page). Previously it
 *   always showed the logged-in nav (Telemetry / API Keys / Usage /
 *   Plans / Admin) and a "Sign Out" button — meaningless for a
 *   visitor who never signed in. Now we branch on `user`:
 *     - Authenticated: dashboard nav links + [SYS_SESSION] tier badge
 *       + Sign Out (the original behavior).
 *     - Anonymous: public nav links (Home / Models / Pricing / Docs)
 *       + a "Get Started" CTA pointing at /auth/login. No tier badge,
 *       no sign-out button — both would be wrong for a visitor.
 *
 * Theme tokens (2026-06-20):
 *   This component uses semantic Tailwind tokens (bg-background,
 *   bg-card, bg-muted, text-foreground, text-muted-foreground,
 *   border-border) instead of hardcoded zinc/hex values. That makes
 *   the sidebar actually flip colors when the user toggles light/
 *   dark/system theme — previously the dark `#09090b` background
 *   stayed even in light mode (visible bug reported by user 2026-06-20).
 *
 * The sidebar shows:
 *   - Authenticated: Logo + kernel version, dashboard nav links,
 *     Admin Panel (if user.role === 'admin'), [SYS_SESSION] tier
 *     badge + Sign Out footer.
 *   - Anonymous: Logo + kernel version, public nav links, "Get
 *     Started" CTA footer.
 */

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Terminal,
  KeyRound,
  Layers,
  Brain,
  Zap,
  FileText,
  Shield,
  LogOut,
  Menu,
  X,
  Home,
  ArrowRight,
} from 'lucide-react'
import { useApp } from '@/app/providers'
import { ThemeToggle } from '@/components/theme-toggle'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  exact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Telemetry', href: '/dashboard', icon: <Terminal className="w-3.5 h-3.5" />, exact: true },
  { label: 'API Keys', href: '/dashboard/keys', icon: <KeyRound className="w-3.5 h-3.5" /> },
  { label: 'Usage', href: '/dashboard/usage', icon: <Layers className="w-3.5 h-3.5" /> },
  { label: 'Models', href: '/models', icon: <Brain className="w-3.5 h-3.5" /> },
  { label: 'Plans', href: '/dashboard/upgrade', icon: <Zap className="w-3.5 h-3.5" /> },
  { label: 'Docs', href: '/docs', icon: <FileText className="w-3.5 h-3.5" /> },
]

const ADMIN_NAV_ITEM: NavItem = {
  label: 'Admin Panel',
  href: '/dashboard/admin',
  icon: <Shield className="w-3.5 h-3.5" />,
}

// Public nav shown when no user is signed in. Used on /docs and any
// future public page that opts into the DashboardSidebar layout. Note:
// Docs is intentionally in the list even though we're rendering this
// from /docs — it acts as the "current page" indicator and stays
// active-highlighted for anonymous visitors too.
const PUBLIC_NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', icon: <Home className="w-3.5 h-3.5" />, exact: true },
  { label: 'Models', href: '/models', icon: <Brain className="w-3.5 h-3.5" /> },
  { label: 'Pricing', href: '/dashboard/upgrade', icon: <Zap className="w-3.5 h-3.5" /> },
  { label: 'Docs', href: '/docs', icon: <FileText className="w-3.5 h-3.5" /> },
]

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  // Highlight /dashboard/keys for /dashboard/keys, /dashboard/keys/new, etc.
  return pathname === item.href || pathname.startsWith(item.href + '/')
}

export function DashboardSidebar({ headerLabel }: { headerLabel?: string } = {}) {
  const { user, usage, signOut } = useApp()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Derive a sensible default label from the current route.
  // e.g. /dashboard/usage → [USAGE], /dashboard/keys → [API KEYS].
  // Pages can override via the headerLabel prop (e.g. /dashboard/upgrade → [UPGRADE]).
  // Anonymous visitors on /docs see [DOCS] instead of the default
  // [DASHBOARD] fallback.
  const derivedLabel = (() => {
    if (pathname === '/dashboard' || pathname === '/dashboard/') return 'DASHBOARD'
    if (pathname.startsWith('/dashboard/usage')) return 'USAGE'
    if (pathname.startsWith('/dashboard/keys')) return 'API KEYS'
    if (pathname.startsWith('/dashboard/admin')) return 'ADMIN'
    if (pathname.startsWith('/dashboard/upgrade')) return 'UPGRADE'
    if (pathname === '/docs' || pathname?.startsWith('/docs/')) return 'DOCS'
    return 'DASHBOARD'
  })()
  const label = (headerLabel || derivedLabel).toUpperCase()

  // Pick the nav list + any role-gated items based on auth state.
  const navItems = user
    ? [...NAV_ITEMS, ...(user.role === 'admin' ? [ADMIN_NAV_ITEM] : [])]
    : PUBLIC_NAV_ITEMS

  const sidebarBody = (
    <>
      {/* Logo + kernel version */}
      <div className="px-6 mb-8 flex flex-col gap-1">
        <div className="w-full">
          <div className="relative w-full h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
            <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="w-1.5 h-1.5 bg-[#ef4444] red-glow status-pulse" />
          <p className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase">
            Kernel: v1.0.0-STABLE
          </p>
        </div>
      </div>

      {/* Nav links */}
      <div className="flex-1 px-2 space-y-1">
        {navItems.map((item) => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 w-full transition-colors group ${
                active
                  ? 'text-foreground nav-item-active'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <span
                className={`border p-1 flex items-center justify-center transition-colors ${
                  active
                    ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'border-border group-hover:border-muted-foreground'
                }`}
              >
                {item.icon}
              </span>
              <span className="tracking-widest font-mono uppercase text-[11px]">
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>

      {/* Footer: tier badge + sign out (authenticated) OR
          Get Started CTA (anonymous). The anonymous branch is what
          /docs (a public page) renders — there's no session to show
          and no account to sign out of. */}
      <div className="px-6 mt-auto">
        {user ? (
          <>
            <div className="font-mono text-[9px] text-muted-foreground mb-2 flex justify-between tracking-tighter">
              <span>[SYS_SESSION]</span>
              <span
                className={`text-emerald-500 uppercase ${
                  !usage ? 'animate-pulse' : ''
                }`}
              >
                {usage?.tier || '...'}
              </span>
            </div>
            <button
              onClick={() => {
                setMobileOpen(false)
                signOut()
              }}
              className="w-full bg-muted border border-border text-foreground/80 font-mono text-[10px] py-3 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-foreground transition-all flex items-center justify-center gap-2 group crosshair-corners"
            >
              <LogOut className="w-3.5 h-3.5 group-hover:text-[#ef4444] transition-colors" />
              <span className="tracking-widest uppercase font-bold">Sign Out</span>
            </button>
          </>
        ) : (
          <>
            <div className="font-mono text-[9px] text-muted-foreground mb-2 flex justify-between tracking-tighter">
              <span>[VISITOR_MODE]</span>
              <span className="text-muted-foreground/60 uppercase">GUEST</span>
            </div>
            <Link
              href="/auth/login"
              onClick={() => setMobileOpen(false)}
              className="w-full bg-muted border border-border text-foreground font-mono text-[10px] py-3 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-foreground transition-all flex items-center justify-center gap-2 group crosshair-corners"
            >
              <span className="tracking-widest uppercase font-bold">Get Started</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:text-[#ef4444] transition-colors" />
            </Link>
          </>
        )}
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar (md+) — fixed vertical rail on the left. */}
      <nav className="hidden md:flex flex-col h-screen w-64 tech-border-r bg-background py-6 fixed left-0 top-0 z-20 micro-grid">
        {sidebarBody}
      </nav>

      {/* Top app bar — sticky horizontal bar shown on EVERY screen size
          (mobile AND desktop). On mobile it's full-width above the
          content; on desktop it sits to the right of the fixed vertical
          sidebar (md:ml-64 offsets the sidebar's w-64). Layout:
            MOBILE:  [logo]                  [theme] [hamburger]
            DESKTOP: [DASHBOARD label]       [theme] [hamburger]
          The logo is mobile-only (md:hidden) — on desktop the vertical
          sidebar already carries the logo, so showing it again in the
          top bar would be a duplicate. The hamburger opens the same
          fullscreen overlay on both breakpoints. The bar lives at z-30
          (sidebar is z-20, overlay is z-50). */}
      <header className="sticky top-0 z-30 flex justify-between items-center w-full md:ml-64 md:w-[calc(100%-16rem)] px-4 py-2.5 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center gap-2">
          <div className="md:hidden relative w-20 h-9 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
            <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
          </div>
          <span className="hidden md:inline font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            [{label}]
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Fullscreen overlay (preserves the original pre-refactor
          behaviour). When the hamburger is tapped, this overlay takes
          over the viewport with the same nav links as the desktop
          sidebar. Tapping a link or the close button dismisses it.
          The overlay is shown on BOTH mobile and desktop — desktop
          users get a focused nav view that sits on top of (not
          behind) the dashboard content, complementing the always-
          visible vertical sidebar. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-background/98 backdrop-blur-md flex flex-col justify-between py-24 px-6 border-b border-border animate-fade-in">
          <div className="absolute top-4 right-6">
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close navigation menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {sidebarBody}
        </div>
      )}
    </>
  )
}