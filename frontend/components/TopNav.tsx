'use client'

/**
 * Shared top navigation bar for the public marketing/legal/model pages.
 *
 * Renders:
 *  - AkaRouter logo (left)
 *  - Center links: Models, Pricing
 *  - Right side: either
 *      - "Sign in" + "Get Started" CTA (anonymous)
 *      - "Dashboard" + user email + sign out (authenticated)
 *
 * Reads auth state from <AppProvider> via useApp(). On public pages
 * (home, models, upgrade, docs, legal), this is the only nav they
 * need — the dashboard / admin pages keep their own richer sidebar.
 *
 * WHY A SHARED COMPONENT:
 *  Each public page used to ship its own ad-hoc <nav>. The result was
 *  inconsistent (different links, different "Sign in" vs "Dashboard"
 *  text per page, no auth awareness). Centralizing here means a
 *  single source of truth for the top chrome and a single point to
 *  wire in future "active route" highlighting.
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Image from 'next/image'
import { LogOut, ArrowRight, User } from 'lucide-react'
import { useApp } from '@/app/providers'
import { useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'

export function TopNav() {
  const { user, signOut } = useApp()
  const router = useRouter()
  const pathname = usePathname()
  const [signingOut, setSigningOut] = useState(false)

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname?.startsWith(href + '/')
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
      router.push('/')
    } finally {
      setSigningOut(false)
    }
  }

  const linkClass = (href: string) =>
    `hidden sm:block text-xs font-mono uppercase tracking-wider transition-colors ${
      isActive(href)
        ? 'text-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <nav className="sticky top-0 w-full z-50 border-b border-border bg-background/80 backdrop-blur-xl micro-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-24 h-10 sm:w-[208px] sm:h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
            <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
          </div>
        </Link>

        {/* Center links */}
        <div className="flex items-center gap-3 sm:gap-6">
          <Link href="/models" className={linkClass('/models')}>
            Models
          </Link>
          <Link href="/dashboard/upgrade" className={linkClass('/upgrade')}>
            Pricing
          </Link>
          <Link href="/docs" className={linkClass('/docs')}>
            Docs
          </Link>
        </div>

        {/* Right side: theme toggle + login CTA OR user chip */}
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="hidden sm:inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                title={user.email}
              >
                <User className="w-3 h-3" />
                {user.email?.split('@')[0] || 'Account'}
              </Link>
              <Link
                href="/dashboard"
                className="relative inline-flex items-center gap-1.5 bg-muted border border-border text-foreground font-mono text-[10px] sm:text-xs py-1.5 px-3 sm:py-2 sm:px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all crosshair-corners"
              >
                Dashboard
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                title="Sign out"
                className="hidden sm:inline-flex items-center justify-center w-8 h-8 bg-muted border border-border text-muted-foreground hover:text-[#ef4444] hover:border-[#ef4444]/40 transition-all disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="hidden sm:block text-[10px] sm:text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/auth/login"
                className="relative inline-flex items-center gap-1.5 bg-muted border border-border text-foreground font-mono text-[10px] sm:text-xs py-1.5 px-3 sm:py-2 sm:px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all crosshair-corners"
              >
                Get Started
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
