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
    <div className="border border-zinc-900 bg-[#0a0a0c] overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-zinc-900 bg-[#0e0e10]">
        <div className="flex">
          {samples.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setActive(i)}
              className={`px-4 py-2 text-[10px] font-mono uppercase tracking-wider border-r border-zinc-900 transition-colors ${
                active === i
                  ? 'bg-[#0a0a0c] text-[#ef4444] border-b-2 border-b-[#ef4444]'
                  : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-b-transparent'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={copyCode}
          className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-200 border-l border-zinc-900 transition-colors"
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
        <pre className="text-[11px] sm:text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre">
          <code>{current.code}</code>
        </pre>
      </div>
    </div>
  )
}