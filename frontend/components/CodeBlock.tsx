'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CodeSample {
  label: string
  lang: string
  code: string
}

interface CodeBlockProps {
  samples: CodeSample[]
}

export function CodeBlock({ samples }: CodeBlockProps) {
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)

  const current = samples[active]

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(current.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback: do nothing
    }
  }

  return (
    <div className="border border-border bg-background overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-border bg-card">
        <div className="flex">
          {samples.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setActive(i)}
              className={`px-4 py-2 text-[10px] font-mono uppercase tracking-wider border-r border-border transition-colors ${
                active === i
                  ? 'bg-background text-[#ef4444] border-b-2 border-b-[#ef4444]'
                  : 'text-muted-foreground/80 hover:text-foreground/80 border-b-2 border-b-transparent'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={copyCode}
          className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/80 hover:text-foreground border-l border-border transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code */}
      <div className="p-5 overflow-x-auto">
        <pre className="text-[11px] sm:text-xs font-mono text-foreground/80 leading-relaxed whitespace-pre">
          <code>{current.code}</code>
        </pre>
      </div>
    </div>
  )
}