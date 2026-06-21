/**
 * DocsView — interactive client component for /docs.
 *
 * Receives fully-rendered, server-highlighted code blocks as
 * pre-built HTML (via dangerouslySetInnerHTML) plus the featured
 * model list. Owns the only client-side state on the page: which
 * SDK tab is active (python/curl/node), which agent tab is active
 * (claude/cline/cursor), and which code-block copy button was
 * last clicked.
 *
 * The static layout (sidebar + main) is intentionally minimal here
 * because DashboardSidebar already provides the auth-aware chrome.
 * This component only renders the content area.
 *
 * Color treatment (added 2026-06-21):
 *   Code blocks always render on a dark surface (bg-zinc-950 in
 *   light mode, slightly lighter in dark mode) regardless of the
 *   active theme. This is the standard pattern (GitHub, VS Code):
 *   syntax tokens are tuned for dark backgrounds and a code block
 *   that flips to "light code on white" in light mode ends up
 *   unreadable. The block gets a thin red-tinted border to stay
 *   on-theme with the rest of the AkaRouter UI.
 */

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Cpu, Sparkles, Zap, Terminal, Copy, Check, Brain, Layers } from 'lucide-react'
import { DashboardSidebar } from '@/components/DashboardSidebar'

export type PricingMode = 'per_request' | 'per_token' | string

export interface FeaturedModel {
  id: string
  displayName: string
  tagline: string
  contextLength: number
  pointsCost: number
  pricingMode: PricingMode
  supportsVision: boolean
}

export interface CodeBlock {
  lang: 'python' | 'bash' | 'javascript' | 'json'
  /** Server-highlighted HTML, safe to inject (Prism output is escaped). */
  html: string
  /** Plain-text source for the "Copy" button. */
  source: string
}

interface DocsViewProps {
  featured: FeaturedModel[]
  code: Record<'python' | 'curl' | 'node' | 'claude' | 'cline', CodeBlock>
  cursorSteps: string
}

const SLOT_ICONS = [Cpu, Sparkles, Zap]
const SLOT_LABELS = ['REASONING & VISION', 'LONG-CONTEXT', 'LOW-LATENCY']
const SLOT_KEYS = ['vision', 'context', 'speed'] as const

export function DocsView({ featured, code, cursorSteps }: DocsViewProps) {
  const [activeCategory, setActiveCategory] = useState<'sdks' | 'agents'>('sdks')
  const [activeSdk, setActiveSdk] = useState<'python' | 'curl' | 'node'>('python')
  const [activeAgent, setActiveAgent] = useState<'claude' | 'cline' | 'cursor'>('claude')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <>
      <DashboardSidebar />

      <div className="flex-1 flex flex-col md:ml-64 md:w-[calc(100%-16rem)] w-full relative">
        <main className="flex-1 p-0 grid-bg relative">
          <div className="p-6 space-y-6">
            {/* Top-level tab strip: SDKs vs Agents */}
            <div className="flex border-b border-border bg-muted/40 p-1 overflow-x-auto whitespace-nowrap scrollbar-none">
              <TabButton
                active={activeCategory === 'sdks'}
                onClick={() => setActiveCategory('sdks')}
                icon={<Cpu className="w-3.5 h-3.5" />}
                label="[DIRECT_API_USAGE]"
              />
              <TabButton
                active={activeCategory === 'agents'}
                onClick={() => setActiveCategory('agents')}
                icon={<Sparkles className="w-3.5 h-3.5" />}
                label="[AI_AGENT_INTEGRATIONS]"
              />
            </div>

            {activeCategory === 'sdks' && (
              <section className="bg-card border border-border p-6 crosshair-corners space-y-6 animate-slide-in relative">
                <Header
                  icon={<Terminal className="w-4 h-4 text-[#ef4444]" />}
                  title="DEVELOPER_SDK_INTEGRATIONS"
                  subtitle="Integrate AkaRouter directly into your app using standard OpenAI-compatible libraries."
                />

                {/* Live model cards — pulled from /v1/models at request time. */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/40 p-4 border border-border text-xs font-mono">
                  {featured.length === 0 && (
                    <div className="col-span-3 text-muted-foreground uppercase text-[10px] py-4 text-center">
                      [MODEL_CATALOG_UNAVAILABLE]
                    </div>
                  )}
                  {featured.map((m, i) => (
                    <ModelCard
                      key={m.id}
                      model={m}
                      icon={SLOT_ICONS[i] ?? Cpu}
                      slotLabel={SLOT_LABELS[i] ?? 'MODEL'}
                    />
                  ))}
                </div>

                {/* SDK tab strip */}
                <div className="flex gap-2 border-b border-border pb-2">
                  {(['python', 'curl', 'node'] as const).map((sdk) => (
                    <button
                      key={sdk}
                      onClick={() => setActiveSdk(sdk)}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                        activeSdk === sdk
                          ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                          : 'border-border text-muted-foreground/50 hover:text-foreground'
                      }`}
                    >
                      {sdk === 'python' ? 'PYTHON SDK' : sdk === 'curl' ? 'CURL HTTP' : 'NODEJS SDK'}
                    </button>
                  ))}
                </div>

                {activeSdk === 'python' && (
                  <CodePanel
                    id="python"
                    label="python_openai_sdk.py"
                    block={code.python}
                    copied={copiedId === 'python'}
                    onCopy={() => copy(code.python.source, 'python')}
                  />
                )}
                {activeSdk === 'curl' && (
                  <CodePanel
                    id="curl"
                    label="curl_request.sh"
                    block={code.curl}
                    copied={copiedId === 'curl'}
                    onCopy={() => copy(code.curl.source, 'curl')}
                  />
                )}
                {activeSdk === 'node' && (
                  <CodePanel
                    id="node"
                    label="node_sdk.js"
                    block={code.node}
                    copied={copiedId === 'node'}
                    onCopy={() => copy(code.node.source, 'node')}
                  />
                )}
              </section>
            )}

            {activeCategory === 'agents' && (
              <section className="bg-card border border-border p-6 crosshair-corners space-y-6 animate-slide-in relative">
                <Header
                  icon={<Sparkles className="w-4 h-4 text-[#ef4444]" />}
                  title="AI_AGENT_&_IDE_CONFIGURATIONS"
                  subtitle="Point your AI coding assistants at the AkaRouter routing gateway."
                />

                <div className="flex gap-2 border-b border-border pb-2">
                  {(['claude', 'cline', 'cursor'] as const).map((agent) => (
                    <button
                      key={agent}
                      onClick={() => setActiveAgent(agent)}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                        activeAgent === agent
                          ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                          : 'border-border text-muted-foreground/50 hover:text-foreground'
                      }`}
                    >
                      {agent === 'claude' ? 'CLAUDE CODE' : agent === 'cline' ? 'CLINE (VS CODE)' : 'CURSOR / CODEX'}
                    </button>
                  ))}
                </div>

                {activeAgent === 'claude' && (
                  <CodePanel
                    id="claude"
                    label="claude_code_setup.sh"
                    block={code.claude}
                    copied={copiedId === 'claude'}
                    onCopy={() => copy(code.claude.source, 'claude')}
                    description="Run Claude Code in your CLI using AkaRouter-routed endpoints:"
                  />
                )}
                {activeAgent === 'cline' && (
                  <CodePanel
                    id="cline"
                    label="cline_settings.json"
                    block={code.cline}
                    copied={copiedId === 'cline'}
                    onCopy={() => copy(code.cline.source, 'cline')}
                    description="Paste this into your Cline custom OpenAI provider settings:"
                  />
                )}
                {activeAgent === 'cursor' && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase">
                      Configure Cursor to route through AkaRouter:
                    </p>
                    <div className="rounded-md border border-[#ef4444]/30 bg-zinc-950 text-zinc-100 overflow-hidden">
                      <div className="border-b border-white/10 px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-zinc-400 font-bold uppercase tracking-wider">
                          cursor_setup.md
                        </span>
                        <button
                          onClick={() => copy(cursorSteps, 'cursor')}
                          className="text-zinc-400 hover:text-zinc-100 p-1 border border-white/10 bg-white/5 transition-all"
                          title="Copy steps"
                        >
                          {copiedId === 'cursor' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-100">
                        {cursorSteps}
                      </pre>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 flex items-center gap-2 ${
        active
          ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
          : 'text-muted-foreground/80 hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Header({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
        {icon}
        {title}
      </h2>
      <p className="text-[10px] font-mono text-muted-foreground/80 uppercase">{subtitle}</p>
    </div>
  )
}

function ModelCard({
  model,
  icon: Icon,
  slotLabel,
}: {
  model: FeaturedModel
  icon: React.ComponentType<{ className?: string }>
  slotLabel: string
}) {
  // Per-model badge styling: red for vision-capable flagship, emerald
  // for long-context, neutral for the cheap/fast one. Picks the first
  // card style if we somehow have more than 3.
  const idx = ['REASONING & VISION', 'LONG-CONTEXT', 'LOW-LATENCY'].indexOf(slotLabel)
  const styles = [
    { badge: 'border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444]', accent: 'text-[#ef4444]' },
    { badge: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400', accent: 'text-emerald-400' },
    { badge: 'border-border bg-muted text-muted-foreground', accent: 'text-muted-foreground' },
  ]
  const style = styles[idx] ?? styles[0]

  return (
    <div className="space-y-2">
      <div className="text-foreground font-bold uppercase tracking-wider text-[10px] flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${style.accent}`} />
        {model.displayName} ({slotLabel})
      </div>
      <p className="text-muted-foreground leading-relaxed text-[10px]">{model.tagline}</p>
      <div className="space-y-1 text-muted-foreground/80 text-[9px] pt-1">
        <div>[CONTEXT]: {formatContext(model.contextLength)}</div>
        <div>[PRICING]: {formatPrice(model)}</div>
      </div>
      <div className="flex gap-1.5 flex-wrap pt-1">
        {model.supportsVision ? (
          <span
            className={`px-1.5 py-0.5 border ${style.badge} text-[9px] uppercase font-bold`}
          >
            ✓ Vision
          </span>
        ) : (
          <span className="px-1.5 py-0.5 border border-border bg-muted text-muted-foreground text-[9px] uppercase">
            Text-Only
          </span>
        )}
      </div>
    </div>
  )
}

function CodePanel({
  id,
  label,
  block,
  copied,
  onCopy,
  description,
}: {
  id: string
  label: string
  block: CodeBlock
  copied: boolean
  onCopy: () => void
  description?: string
}) {
  return (
    <div className="space-y-3">
      {description && (
        <p className="text-[10px] font-mono text-muted-foreground uppercase">{description}</p>
      )}
      <div className="rounded-md border border-[#ef4444]/30 bg-zinc-950 text-zinc-100 overflow-hidden shadow-[0_0_30px_-15px_rgba(239,68,68,0.5)]">
        <div className="border-b border-white/10 px-4 py-2 flex items-center justify-between text-[10px] font-mono">
          <span className="text-zinc-400 font-bold uppercase tracking-wider">{label}</span>
          <button
            onClick={onCopy}
            className="text-zinc-400 hover:text-zinc-100 p-1 border border-white/10 bg-white/5 transition-all"
            title="Copy code block"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <pre className={`language-${block.lang} !bg-transparent !p-0 !m-0`}>
          <code
            id={id}
            className={`language-${block.lang} block p-4 font-mono text-[11px] leading-relaxed overflow-x-auto`}
            // Server-rendered Prism output: HTML is escaped, so this is safe.
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        </pre>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
//  Formatters
// ─────────────────────────────────────────────────────────────────────

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M TOKENS`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K TOKENS`
  return `${n} TOKENS`
}

function formatPrice(m: FeaturedModel): string {
  if (m.pricingMode === 'per_request') {
    return `${m.pointsCost} ${m.pointsCost === 1 ? 'POINT' : 'POINTS'} / REQUEST`
  }
  // Per-token fallback (legacy models; current catalog is all
  // per_request so this branch is mostly defensive).
  return 'PER-TOKEN (SEE /v1/models)'
}
