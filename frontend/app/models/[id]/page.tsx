import { notFound } from 'next/navigation'
import Link from 'next/link'
import { fetchServerModels } from '@/lib/server-api'
import { ChevronLeft, Brain, Code2, Eye, Cpu, Zap, DollarSign, Globe, Copy } from 'lucide-react'
import { CodeBlock } from '@/components/CodeBlock'
import { TopNav } from '@/components/TopNav'

export const revalidate = 60

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateStaticParams() {
  const models = await fetchServerModels()
  return models.map((m) => ({ id: m.id }))
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const models = await fetchServerModels()
  const m = models.find((x) => x.id === id)
  if (!m) return { title: 'Model not found — AkaRouter' }
  return {
    title: `${m.display_name || m.id} — AkaRouter`,
    description: m.description || `${m.display_name || m.id} on AkaRouter`,
  }
}

export default async function ModelDetailPage({ params }: PageProps) {
  const { id } = await params
  const models = await fetchServerModels()
  const m = models.find((x) => x.id === id)
  if (!m) notFound()

  const isPerRequest = m.pricing_mode === 'per_request'
  const isFree = isPerRequest && (m.cost_per_request_cents ?? 0) === 0
  const ctxK = m.context_length ? Math.round(m.context_length / 1000) : 0
  const ctxDisplay = m.context_length
    ? m.context_length >= 1_000_000
      ? `${(m.context_length / 1_000_000).toFixed(m.context_length % 1_000_000 === 0 ? 0 : 1)}M`
      : `${Math.round(m.context_length / 1000)}K`
    : '—'

  // Build a sample code block
  const codeSamples: { label: string; lang: string; code: string }[] = [
    {
      label: 'cURL',
      lang: 'bash',
      code: `curl https://api.akarouter.dev/v1/chat/completions \\
  -H "Authorization: Bearer $AKAROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${m.id}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
    },
    {
      label: 'Python',
      lang: 'python',
      code: `from openai import OpenAI

client = OpenAI(
  base_url="https://api.akarouter.dev/v1",
  api_key="akar_your_key_here",
)

response = client.chat.completions.create(
  model="${m.id}",
  messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
    },
    {
      label: 'Node.js',
      lang: 'javascript',
      code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.akarouter.dev/v1",
  apiKey: process.env.AKAROUTER_API_KEY,
});

const response = await client.chat.completions.create({
  model: "${m.id}",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);`,
    },
  ]

  return (
    <div className="min-h-screen bg-[#09090b] text-[#e5e1e4] grid-bg">
      {/* Top nav */}
      <TopNav />

      {/* Back link + breadcrumb */}
      <div className="border-b border-[#27272a] bg-[#0a0a0c]/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center">
          <Link href="/models" className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-[10px] sm:text-xs font-mono uppercase tracking-wider">
            <ChevronLeft className="w-4 h-4" />
            All models
          </Link>
        </div>
      </div>

      {/* Hero */}
      <section className="border-b border-[#27272a] py-10 sm:py-14 px-6 bg-[#0a0a0c]/60">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border ${
                isFree
                  ? 'border-zinc-500 bg-zinc-800 text-zinc-300'
                  : isPerRequest
                  ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              }`}
            >
              {isFree ? 'Free' : isPerRequest ? 'Per-Request Billing' : 'Per-Token Billing'}
            </span>
            <span className="inline-flex items-center px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-zinc-800 bg-zinc-900 text-zinc-400">
              {m.provider_name || providerFromId(m.id)}
            </span>
            {m.capabilities?.map((cap) => (
              <span key={cap} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-zinc-800 text-zinc-400">
                {capIcon(cap)}
                {cap}
              </span>
            ))}
          </div>

          <div>
            <h1 className="text-3xl sm:text-5xl font-black font-mono tracking-tight text-white leading-none">
              {m.display_name || m.id}
            </h1>
            <p className="text-[11px] sm:text-xs text-zinc-500 font-mono mt-2">
              {m.provider_name ? `Based on ${m.provider_name}` : m.id}
            </p>
            {m.description && (
              <p className="text-sm text-zinc-400 mt-4 max-w-3xl font-mono leading-relaxed">{m.description}</p>
            )}
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 border border-zinc-800">
            <Stat label="Context" value={ctxDisplay} sub={ctxK ? `${ctxK}K tokens` : ''} />
            <Stat
              label="Price"
              value={isPerRequest ? `$${((m.cost_per_request_cents ?? 0) / 100).toFixed(2)}` : `$${(m.input_cost_per_million ?? 0).toFixed(3)}`}
              sub={isPerRequest ? 'per call' : 'in / 1M tok'}
            />
            <Stat
              label={isPerRequest ? 'Output' : 'Output cost'}
              value={isPerRequest ? '—' : `$${(m.output_cost_per_million ?? 0).toFixed(3)}`}
              sub={isPerRequest ? '' : 'per 1M tok'}
            />
            <Stat label="Capabilities" value={String(m.capabilities?.length || 1)} sub={m.capabilities?.[0] || 'text'} />
          </div>
        </div>
      </section>

      {/* Pricing section */}
      <section className="py-12 px-6">
        <div className="max-w-6xl mx-auto space-y-8">
          <div>
            <h2 className="text-lg sm:text-xl font-bold font-mono uppercase tracking-wider text-white mb-4">
              PRICING
            </h2>
            <div className="border border-zinc-900 bg-[#0a0a0c] p-5 sm:p-6">
              {isPerRequest ? (
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Per-request</span>
                    <span className="text-2xl font-black font-mono text-[#ef4444]">
                      {formatPerRequestPrice(m.cost_per_request_cents)}
                      <span className="text-xs text-zinc-500 font-normal ml-1">/ call</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
                    Flat fee per API call. Token usage is still logged for visibility but not billed separately. Plan request limits apply.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Input</div>
                      <div className="text-2xl font-black font-mono text-emerald-400">
                        ${(m.input_cost_per_million ?? 0).toFixed(3)}
                        <span className="text-xs text-zinc-500 font-normal ml-1">/ 1M tok</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Output</div>
                      <div className="text-2xl font-black font-mono text-emerald-400">
                        ${(m.output_cost_per_million ?? 0).toFixed(3)}
                        <span className="text-xs text-zinc-500 font-normal ml-1">/ 1M tok</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono leading-relaxed pt-3 border-t border-zinc-900">
                    Per-token billing. Charges accumulate based on actual input + output tokens processed.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Code examples */}
          <div>
            <h2 className="text-lg sm:text-xl font-bold font-mono uppercase tracking-wider text-white mb-4">
              USAGE
            </h2>
            <CodeBlock samples={codeSamples} />
          </div>

          {/* Specs */}
          <div>
            <h2 className="text-lg sm:text-xl font-bold font-mono uppercase tracking-wider text-white mb-4">
              SPECS
            </h2>
            <div className="border border-zinc-900 bg-[#0a0a0c] divide-y divide-zinc-900">
              <SpecRow label="Model ID" value={m.id} mono />
              <SpecRow label="Display Name" value={m.display_name || '—'} />
              <SpecRow label="Provider" value={m.provider_name || providerFromId(m.id)} />
              <SpecRow label="Pricing Mode" value={m.pricing_mode || 'per_token'} />
              <SpecRow label="Context Length" value={`${m.context_length?.toLocaleString() || '—'} tokens`} mono />
              <SpecRow label="Capabilities" value={(m.capabilities || []).join(', ') || 'text'} />
              <SpecRow label="Status" value={m.is_active === false ? 'Deprecated' : 'Active'} />
            </div>
          </div>

          {/* CTA */}
          <div className="border border-zinc-900 bg-[#0a0a0c] p-6 sm:p-8 text-center space-y-4">
            <h3 className="text-lg font-bold font-mono uppercase tracking-wider text-white">
              READY TO USE {m.display_name || m.id}?
            </h3>
            <p className="text-xs text-zinc-500 font-mono">
              Pick a plan, get an API key, and start sending requests in seconds.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/upgrade"
                className="bg-[#ef4444] text-black font-mono text-xs font-bold py-3 px-6 hover:bg-[#ff5451] transition-all red-glow uppercase tracking-wider"
              >
                [+] Choose a plan
              </Link>
              <Link
                href="/models"
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold py-3 px-6 hover:border-zinc-500 hover:text-white transition-all uppercase tracking-wider"
              >
                ← Browse all models
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#09090b] p-4">
      <div className="text-lg sm:text-xl font-black font-mono text-white">{value}</div>
      <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase tracking-widest mt-1">
        {label}{sub && <span className="text-zinc-700"> · {sub}</span>}
      </div>
    </div>
  )
}

function SpecRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 sm:p-4 text-xs">
      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className={`text-zinc-200 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function providerFromId(id: string): string {
  const lower = id.toLowerCase()
  if (lower.includes('claude')) return 'Anthropic'
  if (lower.includes('gpt') || lower.includes('codex')) return 'OpenAI'
  if (lower.includes('gemini')) return 'Google'
  if (lower.includes('minimax')) return 'MiniMax'
  if (lower.includes('nemotron') || lower.includes('step') || lower.includes('owl')) return 'Open Source'
  return 'AkaRouter'
}

function capIcon(cap: string) {
  if (cap === 'vision') return <Eye className="w-3 h-3" />
  if (cap === 'code' || cap === 'completion') return <Code2 className="w-3 h-3" />
  if (cap === 'chat') return <Brain className="w-3 h-3" />
  return <Cpu className="w-3 h-3" />
}

function formatPerRequestPrice(cents?: number | null) {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}