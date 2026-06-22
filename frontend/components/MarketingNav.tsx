/**
 * Marketing navigation (landing page only).
 *
 * Why this exists: the landing page (/) is a single-page marketing site
 * with in-page anchor links (#features, #models, #pricing). The global
 * <TopNav /> links to /models, /dashboard/upgrade, /docs — none of which
 * anchor-link on /. So the landing page needs its own sticky nav with the
 * right link targets.
 *
 * Difference from <TopNav />:
 *   - Center links are anchor links (#features, #models, #pricing), not
 *     route links. They scroll smoothly to the in-page sections.
 *   - Right side has the same ThemeToggle + user chip as the global nav.
 *   - NO "Models" / "Pricing" / "Docs" route links — those exist only on
 *     the global nav and on / itself the anchors are the right behavior.
 *
 * Mounted by app/(marketing)/layout.tsx instead of the global TopNav.
 */

'use client'

import Link from 'next/link'
import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ArrowRight, User, LogOut } from 'lucide-react'
import { ProductHuntBadge } from '@/components/ProductHuntBadge'
import { useApp } from '@/app/providers'
import { ThemeToggle } from '@/components/theme-toggle'

export function MarketingNav() {
  const { user, signOut } = useApp()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
      router.push('/')
    } finally {
      setSigningOut(false)
    }
  }

  const linkClass =
    'hidden sm:block text-[10px] sm:text-xs font-mono uppercase tracking-wider text-muted-foreground dark:text-muted-foreground hover:text-foreground transition-colors'

  return (
    <div className="sticky top-0 w-full z-50">
      {/* Featured-on-Product-Hunt ribbon. Pinned above the nav so the
          social proof is the first thing visitors see. Hidden on
          very small screens because the nav itself is already tight. */}
      <div className="w-full border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-9 flex items-center justify-end">
          <ProductHuntBadge placement="banner" />
        </div>
      </div>
      <nav className="w-full border-b border-border bg-background/80 backdrop-blur-xl micro-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-24 h-10 sm:w-[208px] sm:h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
            <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
          </div>
        </Link>

        <div className="flex items-center gap-3 sm:gap-6">
          <a href="#features" className={linkClass}>Features</a>
          <a href="#models" className={linkClass}>Models</a>
          <a href="#pricing" className={linkClass}>Pricing</a>
          <ThemeToggle />
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="hidden sm:inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-mono uppercase tracking-wider text-foreground/80 hover:text-foreground transition-colors"
                title={user.email}
              >
                <User className="w-3 h-3" />
                {user.email?.split('@')[0] || 'Account'}
              </Link>
              <Link
                href="/dashboard"
                className="relative inline-flex items-center gap-1.5 bg-muted dark:bg-muted border border-border dark:border-border text-foreground font-mono text-[10px] sm:text-xs py-1.5 px-3 sm:py-2 sm:px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all crosshair-corners"
              >
                Dashboard
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                title="Sign out"
                className="hidden sm:inline-flex items-center justify-center w-8 h-8 bg-muted dark:bg-muted border border-border dark:border-border text-muted-foreground dark:text-muted-foreground hover:text-[#ef4444] hover:border-[#ef4444]/40 transition-all disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-foreground/80 hover:text-foreground transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/auth/login"
                className="relative inline-flex items-center gap-1.5 bg-muted dark:bg-muted border border-border dark:border-border text-foreground font-mono text-[10px] sm:text-xs py-1.5 px-3 sm:py-2 sm:px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all crosshair-corners"
              >
                Get Started
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
    </div>
  )
}
