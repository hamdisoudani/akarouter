'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

/**
 * Small client-only copy-to-clipboard button.
 *
 * Lives separately from the landing page so the rest of the page can be a
 * Server Component. Server Components ship zero JS, which is the whole
 * point of the refactor.
 */

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback for non-secure-context browsers (rare)
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silent fail — copy button UX is best-effort
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 border border-border bg-muted text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all"
      title="Copy code"
      aria-label={copied ? 'Copied' : 'Copy code'}
    >
      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
    </button>
  )
}