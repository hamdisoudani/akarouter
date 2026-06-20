'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { loadRecaptchaScriptV3 } from '@/lib/recaptcha'

interface InteractionCaptchaProps {
  /** reCAPTCHA action. Defaults to 'submit'. */
  action?: string
  /** Called only after a successful user-initiated token refresh. */
  onVerified: (token: string) => void
  /** Optional: show a custom loading message while solving. */
  loadingLabel?: string
  /** Show a box around the trigger instead of inline text. */
  boxed?: boolean
}

/**
 * Strictly interactive reCAPTCHA v3 wrapper.
 *
 * Rule: `onVerified` is only called after a real `grecaptcha.execute()`
 * triggered by a user gesture (click, keypress inside the widget).
 * We never auto-execute on mount.
 */
export function InteractionCaptcha({
  action = 'submit',
  onVerified,
  loadingLabel = 'VERIFYING...',
  boxed = false,
}: InteractionCaptchaProps) {
  const [status, setStatus] = useState<'idle' | 'solving' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const bounceRef = useRef(false)

  const verify = useCallback(async () => {
    if (status === 'solving' || status === 'done') return
    setStatus('solving')
    setError(null)

    try {
      const siteKey =
        process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ||
        '6LcnqxUtAAAAAO9MYeFNsyL4JA-6PlAHKzoZoRCc'

      // v3 script MUST be loaded with render=siteKey BEFORE execute()
      // is called, otherwise Google rejects the token. We lazy-load on
      // the first click so we don't track users who never interact.
      await loadRecaptchaScriptV3(siteKey)

      if (typeof window === 'undefined' || !(window as any).grecaptcha) {
        throw new Error('reCAPTCHA is still loading. Please try again in a moment.')
      }
      const grecaptcha = (window as any).grecaptcha

      // This execute() is called only from this click handler (user gesture).
      // reCAPTCHA v3 establishes a session on explicit user interaction.
      const token: string = await new Promise((resolve, reject) => {
        grecaptcha.ready(() => {
          grecaptcha
            .execute(siteKey, { action })
            .then(resolve)
            .catch((err: any) => reject(err))
        })
      })

      setStatus('done')
      onVerified(token)
    } catch (err: any) {
      setStatus('error')
      setError(err?.message ?? 'Verification failed. Please try again.')
    }
  }, [action, onVerified, status])

  // Reset when parent re-mounts (e.g. dialog closes / step changes)
  useEffect(() => {
    setStatus('idle')
    setError(null)
  }, [action])

  const trigger = (
    <button
      type="button"
      onClick={verify}
      disabled={status === 'solving' || status === 'done'}
      className={[
        'font-mono uppercase tracking-widest transition-all select-none cursor-pointer',
        boxed
          ? 'w-full border border-border bg-card/80 px-4 py-3 text-xs text-foreground/80 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-foreground disabled:opacity-60 disabled:cursor-not-allowed'
          : 'text-[10px] text-foreground/80 hover:text-foreground disabled:opacity-60 disabled:cursor-not-allowed underline underline-offset-4 decoration-zinc-700 hover:decoration-[#ef4444]',
        status === 'done' && 'text-emerald-400 decoration-emerald-800 hover:decoration-emerald-800 cursor-default',
      ].join(' ')}
    >
      {status === 'solving' && (
        <span className="inline-flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
          {loadingLabel}
        </span>
      )}
      {status === 'idle' && (boxed ? '[+] VERIFY & CONTINUE' : 'CLICK TO VERIFY YOU ARE HUMAN')}
      {status === 'done' && '✓ VERIFIED'}
      {status === 'error' && 'RETRY VERIFICATION'}
    </button>
  )

  return (
    <span className="inline-flex flex-col gap-1">
      {trigger}
      {error && (
        <span className="text-[9px] font-mono text-[#ef4444] uppercase tracking-wider">
          {error}
        </span>
      )}
    </span>
  )
}

export default InteractionCaptcha
