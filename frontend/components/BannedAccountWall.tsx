'use client'

/**
 * BannedAccountWall
 *
 * Renders an unmissable wall for users whose accounts have been banned
 * (permanent ToS violation, distinct from 'suspended' which is temporary).
 *
 * UX rules:
 *   - Banner-bg-error red, all-caps brutalist typography
 *   - ONLY shows: ban reason + "Contact Support" button + "Sign Out" button
 *   - No nav, no models, no dashboard, no docs — banned users are locked out
 *     of everything except leaving or contacting support.
 *   - Bypasses marketing chrome (TopNav etc.) by being rendered at the
 *     AppProvider level, ABOVE all child routes.
 *   - Sign out uses the same signOut() from useApp() so the Supabase
 *     session is fully cleared.
 *
 * Server-side enforcement already exists: the backend rejects every
 * /v1/* request from a banned account with 403 "Account is banned", and
 * auto-revokes all their API keys on first hit. This wall is purely the
 * UI mirror of that — the API is the real protection.
 */

import { useApp } from '@/app/providers'
import { ShieldAlert, Mail, LogOut } from 'lucide-react'

export function BannedAccountWall() {
  const { user, signOut } = useApp()
  const banReason =
    (user?.ban_reason && user.ban_reason.trim()) ||
    'Violation of terms of service'

  const supportEmail = 'support@akarouter.dev'
  const subject = encodeURIComponent('Account ban review request')
  const body = encodeURIComponent(
    `Hi AkaRouter support,\n\nMy account (${user?.email ?? 'unknown'}) has been banned. ` +
    `I would like to request a review of this decision.\n\nReason shown on the wall:\n${banReason}\n\nThank you.`
  )
  const mailto = `mailto:${supportEmail}?subject=${subject}&body=${body}`

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="banned-wall-title"
      aria-describedby="banned-wall-reason"
      data-testid="banned-account-wall"
    >
      <div className="w-full max-w-2xl border-4 border-red-500 bg-black shadow-[8px_8px_0_0_rgba(239,68,68,0.6)]">
        {/* Header bar */}
        <div className="flex items-center gap-3 border-b-4 border-red-500 bg-red-500 px-6 py-4 text-black">
          <ShieldAlert className="h-7 w-7 shrink-0" strokeWidth={2.5} />
          <h1
            id="banned-wall-title"
            className="font-mono text-2xl font-black uppercase tracking-widest"
          >
            Account Banned
          </h1>
        </div>

        {/* Body */}
        <div className="space-y-6 px-6 py-8">
          <div className="space-y-2">
            <p className="font-mono text-sm uppercase tracking-widest text-red-400">
              Permanent enforcement action
            </p>
            <p className="font-mono text-base leading-relaxed text-gray-200">
              Your account has been permanently suspended due to a violation of our
              terms of service. All API keys associated with this account have been
              revoked, and all requests from this account are blocked.
            </p>
          </div>

          {/* Ban reason */}
          <div className="border-2 border-red-500/40 bg-red-950/30 p-4">
            <div className="mb-2 font-mono text-xs uppercase tracking-widest text-red-400">
              Reason on file
            </div>
            <p
              id="banned-wall-reason"
              className="font-mono text-sm leading-relaxed text-red-100"
            >
              {banReason}
            </p>
          </div>

          {/* Account info */}
          {user?.email && (
            <div className="font-mono text-xs uppercase tracking-widest text-gray-500">
              Account: <span className="text-gray-300">{user.email}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={mailto}
              className="flex flex-1 items-center justify-center gap-2 border-2 border-white bg-white px-6 py-3 font-mono text-sm font-bold uppercase tracking-widest text-black transition hover:bg-red-500 hover:text-white"
              data-testid="banned-contact-support"
            >
              <Mail className="h-4 w-4" strokeWidth={2.5} />
              Contact Support
            </a>
            <button
              onClick={() => {
                void signOut()
              }}
              className="flex flex-1 items-center justify-center gap-2 border-2 border-red-500 bg-black px-6 py-3 font-mono text-sm font-bold uppercase tracking-widest text-red-400 transition hover:bg-red-500 hover:text-black"
              data-testid="banned-sign-out"
            >
              <LogOut className="h-4 w-4" strokeWidth={2.5} />
              Sign Out
            </button>
          </div>

          <p className="font-mono text-[10px] uppercase tracking-widest text-gray-600">
            Appeals are reviewed within 72 hours. If your issue is resolved, your
            account will be restored.
          </p>
        </div>
      </div>
    </div>
  )
}