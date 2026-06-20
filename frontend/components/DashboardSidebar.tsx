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
 * The sidebar shows:
 *   - Logo + kernel version (matches the AkaRouter tech aesthetic)
 *   - Nav links: Telemetry, API Keys, Usage, Models, Plans, Docs
 *   - Admin Panel (visible only if user.role === 'admin')
 *   - Footer: [SYS_SESSION] tier badge + Sign Out
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
} from 'lucide-react'
import { useApp } from '@/app/providers'

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

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  // Highlight /dashboard/keys for /dashboard/keys, /dashboard/keys/new, etc.
  return pathname === item.href || pathname.startsWith(item.href + '/')
}

export function DashboardSidebar() {
  const { user, usage, signOut } = useApp()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navItems = [...NAV_ITEMS]
  if (user?.role === 'admin') navItems.push(ADMIN_NAV_ITEM)

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
          <p className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase">
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
                  ? 'text-white nav-item-active'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <span
                className={`border p-1 flex items-center justify-center transition-colors ${
                  active
                    ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'border-zinc-800 group-hover:border-zinc-500'
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

      {/* Footer: tier badge + sign out */}
      <div className="px-6 mt-auto">
        <div className="font-mono text-[9px] text-zinc-600 mb-2 flex justify-between tracking-tighter">
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
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px] py-3 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white transition-all flex items-center justify-center gap-2 group crosshair-corners"
        >
          <LogOut className="w-3.5 h-3.5 group-hover:text-[#ef4444] transition-colors" />
          <span className="tracking-widest uppercase font-bold">Sign Out</span>
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar (md+) */}
      <nav className="hidden md:flex flex-col h-screen w-64 tech-border-r bg-[#09090b] py-6 fixed left-0 top-0 z-20 micro-grid">
        {sidebarBody}
      </nav>

      {/* Mobile floating hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed bottom-6 right-6 z-40 p-3 border border-[#ef4444] bg-[#09090b]/95 backdrop-blur text-[#ef4444] hover:bg-[#ef4444] hover:text-white transition-all crosshair-corners red-glow shadow-lg"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile drawer (slides over content) */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer body */}
          <nav className="md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-[#09090b] flex flex-col py-6 border-r border-zinc-900 animate-fade-in shadow-2xl">
            {/* Close button */}
            <div className="absolute top-4 right-4">
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 border border-zinc-800 bg-[#0e0e10] text-zinc-400 hover:text-white transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {sidebarBody}
          </nav>
        </>
      )}
    </>
  )
}
