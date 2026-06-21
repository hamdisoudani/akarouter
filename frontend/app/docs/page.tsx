/**
 * /docs — AkaRouter API reference (server component).
 *
 * Why this is a server component (was client before, 2026-06-21):
 *   We need to fetch the live model catalog from the backend so the
 *   "featured models" cards show real, current names + point pricing
 *   instead of the stale hardcoded values the page used to ship
 *   ("step-37-flash / owl-alpha / nemotron-ultra" with $0.20/M
 *   per-token prices — all wrong: every model is now per_request /
 *   points-based, and the model names are not the routing aliases).
 *
 *   We also pre-highlight every code block on the server using
 *   Prism.highlight() so syntax colors appear on first paint. The
 *   old client-side Prism.highlightAll() in a useEffect was being
 *   tree-shaken out of the production bundle (Prism imports didn't
 *   appear in the page chunk), so the DOM never got token spans and
 *   code was rendering as flat monochrome text.
 *
 *   The interactive bits (tab toggling, copy buttons) live in the
 *   child <DocsView /> client component, which receives fully-
 *   rendered highlighted HTML as props.
 */

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-json'
import { fetchServerModels } from '@/lib/server-api'
import { getGatewayUrl } from '@/lib/utils'
import { DocsView, type FeaturedModel, type CodeBlock } from '@/components/DocsView'

/**
 * Three featured model slots rendered as cards above the SDK snippets.
 * We pick one vision-capable flagship, one long-context heavyweight,
 * and one fast/cheap model. These are pulled from the live catalog so
 * the cards always show the real `id` (routing alias) and current
 * points cost.
 */
const FEATURED_PICKS = {
  vision: 'minimax-m3',
  context: 'owl-alpha',
  speed: 'nemotron-ultra',
}

export default async function DocsPage() {
  // Redirect logic mirrors the old client effect: docs is public,
  // but a logged-in user still on the "pending" plan-pick step gets
  // bumped to the dashboard. We hit our own /api/me route (which
  // validates the Supabase JWT via the server supabase client) so
  // the docs page itself stays a pure server component.
  let userStatus: string | null = null
  try {
    const h = await headers()
    // Re-use the same headers/cookie the inbound request carried so
    // the internal /api/me call resolves to the same session.
    const proto = h.get('x-forwarded-proto') ?? 'http'
    const host = h.get('host') ?? 'localhost:3000'
    const cookie = h.get('cookie') ?? ''
    const meRes = await fetch(`${proto}://${host}/api/me`, {
      headers: { cookie },
      cache: 'no-store',
    })
    if (meRes.ok) {
      const me = (await meRes.json()) as { status?: string }
      userStatus = me?.status ?? null
    }
  } catch {
    // anonymous visitor or backend hiccup — let them read the docs
  }
  if (userStatus === 'pending') {
    redirect('/dashboard')
  }

  // Live model catalog for the featured cards.
  const allModels = await fetchServerModels()
  const byId = new Map(allModels.map((m) => [m.id, m]))
  const featuredRaw: (FeaturedModel | null)[] = ([
    FEATURED_PICKS.vision,
    FEATURED_PICKS.context,
    FEATURED_PICKS.speed,
  ] as const).map((id) => {
    const m = byId.get(id)
    if (!m) return null
    return {
      id: m.id,
      displayName: m.display_name ?? m.id,
      tagline: pickTagline(m),
      contextLength: m.context_length ?? 0,
      pointsCost: m.points_cost ?? 0,
      pricingMode: m.pricing_mode ?? 'per_request',
      supportsVision: m.supports?.vision ?? false,
    } satisfies FeaturedModel
  })
  const featured: FeaturedModel[] = featuredRaw.filter(
    (m): m is FeaturedModel => m !== null,
  )

  // Origin for the API endpoints embedded in the code samples.
  // getGatewayUrl() is a client util that returns the public URL
  // with no /api suffix; we strip it here so the code samples read
  // `<origin>/v1/chat/completions`.
  const origin = getGatewayUrl().replace(/\/api\/?$/, '')

  // Pre-build the highlighted HTML for every code sample. Doing this
  // on the server guarantees the token spans are in the SSR output
  // and visible on first paint, no client hydration race.
  const code: Record<'python' | 'curl' | 'node' | 'claude' | 'cline', CodeBlock> = {
    python: highlight('python', buildPython(origin)),
    curl: highlight('bash', buildCurl(origin)),
    node: highlight('javascript', buildNode(origin)),
    claude: highlight('bash', buildClaude(origin)),
    cline: highlight('json', buildCline(origin)),
  }
  const cursor = buildCursor(origin) // prose, no syntax

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col antialiased selection:bg-[#ef4444]/30 selection:text-foreground">
      {/* Sidebar handles its own auth-aware rendering (see commit 50cb4cc). */}
      <DocsView
        featured={featured}
        code={code}
        cursorSteps={cursor}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
//  Code samples
// ─────────────────────────────────────────────────────────────────────

function buildPython(origin: string) {
  return `from openai import OpenAI

# Initialize OpenAI-compatible client pointed at the AkaRouter gateway.
client = OpenAI(
    base_url="${origin}/v1",
    api_key="YOUR_AKAROUTER_API_KEY"
)

# 1. Text completion — try any alias from the /models catalog.
response = client.chat.completions.create(
    model="akarouter-mini",  # See https://akarouter.dev/models for the full list.
    messages=[{"role": "user", "content": "Hello AkaRouter!"}]
)
print("Text response:", response.choices[0].message.content)

# 2. Vision (image analysis) — only works on vision-capable models.
#    Check the "supports" field in /v1/models, or use the docs cards below.
vision = client.chat.completions.create(
    model="akarouter-mini",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image:"},
                {"type": "image_url", "image_url": {"url": "https://example.com/cat.jpg"}},
            ],
        }
    ],
)
print("Vision response:", vision.choices[0].message.content)
`
}

function buildCurl(origin: string) {
  return `# 1. Text completion
curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_AKAROUTER_API_KEY" \\
  -d '{
    "model": "akarouter-mini",
    "messages": [{"role": "user", "content": "Hello via curl"}]
  }'

# 2. Vision (image analysis) — requires a vision-capable model
curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_AKAROUTER_API_KEY" \\
  -d '{
    "model": "akarouter-mini",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Describe this image:"},
          {"type": "image_url", "image_url": {"url": "https://example.com/cat.jpg"}}
        ]
      }
    ]
  }'
`
}

function buildNode(origin: string) {
  return `import OpenAI from 'openai';

// Initialize the OpenAI client pointed at the AkaRouter gateway.
const openai = new OpenAI({
  baseURL: '${origin}/v1',
  apiKey: 'YOUR_AKAROUTER_API_KEY',
});

async function main() {
  // 1. Text completion — pick any alias from the /models catalog.
  const text = await openai.chat.completions.create({
    model: 'akarouter-mini',
    messages: [{ role: 'user', content: 'Hello via Node.js!' }],
  });
  console.log('Text:', text.choices[0].message.content);

  // 2. Vision (image analysis) — requires a vision-capable model.
  const vision = await openai.chat.completions.create({
    model: 'akarouter-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image:' },
          { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
        ],
      },
    ],
  });
  console.log('Vision:', vision.choices[0].message.content);
}

main();
`
}

function buildClaude(origin: string) {
  return `# Point Claude Code at the AkaRouter gateway.
export ANTHROPIC_BASE_URL="${origin}/v1"
export ANTHROPIC_API_KEY="YOUR_AKAROUTER_API_KEY"

# Optional: pin a specific model alias.
export ANTHROPIC_MODEL="akarouter-sonnet"

# Launch the agent.
claude
`
}

function buildCline(origin: string) {
  return `{
  "apiProvider": "openai",
  "openAiBaseUrl": "${origin}/v1",
  "openAiApiKey": "YOUR_AKAROUTER_API_KEY",
  "openAiModelId": "akarouter-mini"
}
`
}

function buildCursor(origin: string) {
  return `1. Open Cursor Settings -> Models
2. In 'Override OpenAI Base URL', enter:
   ${origin}/v1
3. In 'OpenAI API Key', enter your AkaRouter key.
4. Under 'Custom OpenAI Models', add the aliases you want:
   - akarouter-mini
   - akarouter-sonnet
   - akarouter-flash
5. Toggle off the other models and ship through AkaRouter.`
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

/** Run Prism against a code sample on the server, returning safe HTML. */
function highlight(lang: 'python' | 'bash' | 'javascript' | 'json', source: string): CodeBlock {
  const grammar = Prism.languages[lang]
  const html = Prism.highlight(source, grammar, lang)
  return { lang, html, source }
}

/** Map a model to a one-line marketing tagline based on its profile. */
function pickTagline(m: {
  id: string
  display_name?: string
  description?: string
  context_length?: number
  supports?: { vision?: boolean; reasoning?: boolean }
}): string {
  const ctx = m.context_length ?? 0
  if (m.supports?.vision && ctx >= 500_000) {
    return 'Frontier vision + reasoning model with massive context.'
  }
  if (ctx >= 500_000) {
    return 'Long-context heavyweight tuned for agentic tool use and multi-file editing.'
  }
  if (m.supports?.reasoning) {
    return 'Reasoning model for complex code, math, and chain-of-thought tasks.'
  }
  return 'Low-latency model for high-concurrency chat and real-time workloads.'
}
