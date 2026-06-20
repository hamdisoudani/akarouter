'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import { getGatewayUrl } from '@/lib/utils'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-json'
import 'prismjs/themes/prism-tomorrow.css'
import {
  LogOut,
  Terminal,
  Copy,
  Check,
  Cpu,
  Sparkles,
  Zap
} from 'lucide-react'

import { DashboardSidebar } from '@/components/DashboardSidebar'
export default function DocsPage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut } = useApp()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [activeCategory, setActiveCategory] = useState<'sdks' | 'agents'>('sdks')
  const [activeSdk, setActiveSdk] = useState<'python' | 'curl' | 'node'>('python')
  const [activeAgent, setActiveAgent] = useState<'claude' | 'cline' | 'cursor'>('claude')

  const [origin, setOrigin] = useState('http://localhost:8000')

  useEffect(() => {
    setOrigin(getGatewayUrl())
  }, [])

  useEffect(() => {
    Prism.highlightAll()
  }, [activeCategory, activeSdk, activeAgent])

  useEffect(() => {
    if (!authLoading) {
      // Docs is PUBLIC — anyone can read the API reference.
      // Only redirect if user is logged in but pending (still needs to pick a plan).
      if (token && user?.status === 'pending') {
        router.push('/dashboard')
        return
      }
    }
  }, [authLoading, token, user, router])

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const pythonCode = `from openai import OpenAI

# Initialize OpenAI-compatible Client mapping to AkaRouter
client = OpenAI(
    base_url="${origin}/v1",
    api_key="YOUR_AKAROUTER_API_KEY"
)

# 1. Text Completion Example
# Browse https://akarouter.dev/models for the current catalog and routing aliases.
response = client.chat.completions.create(
    model="owl-alpha",  # Try: minimax-m3, owl-alpha, step-3-7-flash, claude-opus-4-8
    messages=[{"role": "user", "content": "Hello AkaRouter!"}]
)
print("Text response:", response.choices[0].message.content)

# 2. Vision (Image Analysis) Example - only supported on vision-capable models
vision_response = client.chat.completions.create(
    model="minimax-m3",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image:"},
                {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
            ]
        }
    ]
)
print("Vision response:", vision_response.choices[0].message.content)`

  const curlCode = `# 1. Text Completion Example
curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_AKAROUTER_API_KEY" \\
  -d '{
    "model": "owl-alpha",
    "messages": [{"role": "user", "content": "Hello via curl"}]
  }'

# 2. Vision (Image Analysis) Example - Only supported on step-37-flash
curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_AKAROUTER_API_KEY" \\
  -d '{
    "model": "step-37-flash",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Describe this image:"},
          {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
        ]
      }
    ]
  }'`

  const nodeCode = `import OpenAI from 'openai';

// Initialize OpenAI client pointing to AkaRouter
const openai = new OpenAI({
  baseURL: '${origin}/v1',
  apiKey: 'YOUR_AKAROUTER_API_KEY'
});

async function main() {
  // 1. Text Completion Example
  const textCompletion = await openai.chat.completions.create({
    model: 'owl-alpha',
    messages: [{ role: 'user', content: 'Hello via Node.js!' }],
  });
  console.log('Text:', textCompletion.choices[0].message.content);

  // 2. Vision (Image Analysis) Example - Only supported on step-37-flash
  const visionCompletion = await openai.chat.completions.create({
    model: 'step-37-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image:' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
        ]
      }
    ]
  });
  console.log('Vision:', visionCompletion.choices[0].message.content);
}

main();`

  const claudeCode = `# Run Claude Code agent via CLI pointing to AkaRouter
export CLAUDE_BASE_URL="${origin}/v1"
export CLAUDE_API_KEY="YOUR_AKAROUTER_API_KEY"

# Start the agent using the custom endpoint
claude`

  const clineSettings = `{
  "apiProvider": "openai",
  "openAiBaseUrl": "${origin}/v1",
  "openAiApiKey": "YOUR_AKAROUTER_API_KEY",
  "openAiModelId": "owl-alpha"
}`

  const cursorSettings = `1. Open Cursor Settings -> Models
2. In 'Override OpenAI Base URL', enter:
   ${origin}/v1
3. In 'API Key', enter your AkaRouter Key.
4. Under 'Model Names', add:
   - step-37-flash
   - owl-alpha
   - nemotron-ultra
5. Toggle off other models and enjoy AkaRouter routing!`

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col antialiased selection:bg-[#ef4444]/30 selection:text-foreground">
      
      {/* SideNavBar */}

      <DashboardSidebar />


      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 md:w-[calc(100%-16rem)] w-full relative">
        




        {/* Canvas */}
        <main className="flex-1 p-0 grid-bg relative">
          
          {usage?.gateway_enabled === false && (
            <div className="bg-[#ef4444]/10 border-b border-[#ef4444] p-4 text-center font-mono text-xs text-[#ef4444] tracking-wider uppercase animate-pulse">
              [WARNING_SYSTEM_MAINTENANCE_API_GATEWAY_OFFLINE_BY_ADMINISTRATOR]
            </div>
          )}

          <div className="p-6 space-y-6">
            
            {/* Tab select header */}
            <div className="flex border-b border-border bg-muted/40/40 p-1 overflow-x-auto whitespace-nowrap scrollbar-none">
              <button
                onClick={() => setActiveCategory('sdks')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 flex items-center gap-2 ${
                  activeCategory === 'sdks'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-muted-foreground/80 hover:text-foreground'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                [DIRECT_API_USAGE]
              </button>
              <button
                onClick={() => setActiveCategory('agents')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 flex items-center gap-2 ${
                  activeCategory === 'agents'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-muted-foreground/80 hover:text-foreground'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                [AI_AGENT_INTEGRATIONS]
              </button>
            </div>

            {/* Category: SDKs */}
            {activeCategory === 'sdks' && (
              <section className="bg-card border border-border p-6 crosshair-corners space-y-6 animate-slide-in relative">
                <div className="space-y-1">
                  <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <Terminal className="w-4 h-4 text-[#ef4444]" />
                    DEVELOPER_SDK_INTEGRATIONS
                  </h2>
                  <p className="text-[10px] font-mono text-muted-foreground/80 uppercase">Integrate AkaRouter directly into your app using standard libraries.</p>
                </div>

                {/* Model Capabilities Info Card */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/40 p-4 border border-border text-xs font-mono">
                  {/* Pro Model */}
                  <div className="space-y-2">
                    <div className="text-foreground font-bold uppercase tracking-wider text-[10px] flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5 text-[#ef4444] red-glow" />
                      step-37-flash (Reasoning & Vision)
                    </div>
                    <p className="text-muted-foreground leading-relaxed text-[10px] uppercase">
                      High-intelligence model supporting complex reasoning, coding, and **multimodal vision (text & images)**.
                    </p>
                    <div className="space-y-1 text-muted-foreground/80 text-[9px] pt-1">
                      <div>[CONTEXT]: 256K TOKENS</div>
                      <div>[PRICING]: IN: $0.20/M | OUT: $0.80/M</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap pt-1">
                      <span className="px-1.5 py-0.5 border border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] text-[9px] uppercase font-bold">✓ Text + Vision</span>
                    </div>
                  </div>

                  {/* Large Model */}
                  <div className="space-y-2 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-4">
                    <div className="text-foreground font-bold uppercase tracking-wider text-[10px] flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      owl-alpha (Long-Context)
                    </div>
                    <p className="text-muted-foreground leading-relaxed text-[10px] uppercase">
                      Massive context window optimized for agentic tool use, multi-file editing, and complex workflows.
                    </p>
                    <div className="space-y-1 text-muted-foreground/80 text-[9px] pt-1">
                      <div>[CONTEXT]: 1M TOKENS</div>
                      <div>[PRICING]: IN: $0.10/M | OUT: $0.40/M</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap pt-1">
                      <span className="px-1.5 py-0.5 border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-[9px] uppercase">✓ 1M Context</span>
                    </div>
                  </div>

                  {/* Flash Model */}
                  <div className="space-y-2 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-4">
                    <div className="text-foreground font-bold uppercase tracking-wider text-[10px] flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-muted-foreground/80" />
                      nemotron-ultra (Low-Latency)
                    </div>
                    <p className="text-muted-foreground leading-relaxed text-[10px] uppercase">
                      Ultra-fast completions built for high-concurrency workloads, summarization, and real-time agent responses.
                    </p>
                    <div className="space-y-1 text-muted-foreground/80 text-[9px] pt-1">
                      <div>[CONTEXT]: 1M TOKENS</div>
                      <div>[PRICING]: IN: $0.05/M | OUT: $0.15/M</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap pt-1">
                      <span className="px-1.5 py-0.5 border border-border bg-muted text-muted-foreground text-[9px] uppercase">✓ Text-Only</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 border-b border-border pb-2">
                  <button
                    onClick={() => setActiveSdk('python')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeSdk === 'python'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-border text-muted-foreground/50 hover:text-foreground'
                    }`}
                  >
                    PYTHON SDK
                  </button>
                  <button
                    onClick={() => setActiveSdk('curl')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeSdk === 'curl'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-border text-muted-foreground/50 hover:text-foreground'
                    }`}
                  >
                    CURL HTTP
                  </button>
                  <button
                    onClick={() => setActiveSdk('node')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeSdk === 'node'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-border text-muted-foreground/50 hover:text-foreground'
                    }`}
                  >
                    NODEJS SDK
                  </button>
                </div>

                {activeSdk === 'python' && (
                  <div className="bg-card/80 border border-border">
                    <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-muted-foreground/80 font-bold uppercase tracking-wider">python_openai_sdk.py</span>
                      <button
                        onClick={() => copyToClipboard(pythonCode, 'python')}
                        className="text-muted-foreground/80 hover:text-foreground p-1 border border-border bg-muted/40 transition-all"
                        title="Copy code block"
                      >
                        {copiedId === 'python' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-4 font-mono text-[11px] overflow-x-auto bg-card/80 leading-relaxed">
                      <pre className="language-python !bg-transparent !p-0 !m-0">
                        <code className="language-python">
                          {pythonCode}
                        </code>
                      </pre>
                    </div>
                  </div>
                )}

                {activeSdk === 'curl' && (
                  <div className="bg-card/80 border border-border">
                    <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-muted-foreground/80 font-bold uppercase tracking-wider">curl_request.sh</span>
                      <button
                        onClick={() => copyToClipboard(curlCode, 'curl')}
                        className="text-muted-foreground/80 hover:text-foreground p-1 border border-border bg-muted/40 transition-all"
                        title="Copy code block"
                      >
                        {copiedId === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-4 font-mono text-[11px] overflow-x-auto bg-card/80 leading-relaxed">
                      <pre className="language-bash !bg-transparent !p-0 !m-0">
                        <code className="language-bash">
                          {curlCode}
                        </code>
                      </pre>
                    </div>
                  </div>
                )}

                {activeSdk === 'node' && (
                  <div className="bg-card/80 border border-border">
                    <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-muted-foreground/80 font-bold uppercase tracking-wider">node_sdk.js</span>
                      <button
                        onClick={() => copyToClipboard(nodeCode, 'node')}
                        className="text-muted-foreground/80 hover:text-foreground p-1 border border-border bg-muted/40 transition-all"
                        title="Copy code block"
                      >
                        {copiedId === 'node' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-4 font-mono text-[11px] overflow-x-auto bg-card/80 leading-relaxed">
                      <pre className="language-javascript !bg-transparent !p-0 !m-0">
                        <code className="language-javascript">
                          {nodeCode}
                        </code>
                      </pre>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Category: Agents */}
            {activeCategory === 'agents' && (
              <section className="bg-card border border-border p-6 crosshair-corners space-y-6 animate-slide-in relative">
                <div className="space-y-1">
                  <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <Sparkles className="w-4 h-4 text-[#ef4444]" />
                    AI_AGENT_&_IDE_CONFIGURATIONS
                  </h2>
                  <p className="text-[10px] font-mono text-muted-foreground/80 uppercase">Point your AI coding assistants directly to the AkaRouter routing gateway.</p>
                </div>

                <div className="flex gap-2 border-b border-border pb-2">
                  <button
                    onClick={() => setActiveAgent('claude')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeAgent === 'claude'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-border text-muted-foreground/50 hover:text-foreground'
                    }`}
                  >
                    CLAUDE CODE
                  </button>
                  <button
                    onClick={() => setActiveAgent('cline')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeAgent === 'cline'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-border text-muted-foreground/50 hover:text-foreground'
                    }`}
                  >
                    CLINE (VS CODE)
                  </button>
                  <button
                    onClick={() => setActiveAgent('cursor')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeAgent === 'cursor'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-border text-muted-foreground/50 hover:text-foreground'
                    }`}
                  >
                    CURSOR / CODEX
                  </button>
                </div>

                {activeAgent === 'claude' && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase">Run Claude Code in your CLI using AkaRouter routed endpoints:</p>
                    <div className="bg-card/80 border border-border">
                      <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-muted-foreground/80 font-bold uppercase tracking-wider">claude_code_setup.sh</span>
                        <button
                          onClick={() => copyToClipboard(claudeCode, 'claude')}
                          className="text-muted-foreground/80 hover:text-foreground p-1 border border-border bg-muted/40 transition-all"
                          title="Copy commands"
                        >
                          {copiedId === 'claude' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-4 font-mono text-[11px] overflow-x-auto bg-card/80 leading-relaxed">
                        <pre className="language-bash !bg-transparent !p-0 !m-0">
                          <code className="language-bash">
                            {claudeCode}
                          </code>
                        </pre>
                      </div>
                    </div>
                  </div>
                )}

                {activeAgent === 'cline' && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase">Paste this configuration into your Cline custom OpenAI provider settings:</p>
                    <div className="bg-card/80 border border-border">
                      <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-muted-foreground/80 font-bold uppercase tracking-wider">cline_settings.json</span>
                        <button
                          onClick={() => copyToClipboard(clineSettings, 'cline')}
                          className="text-muted-foreground/80 hover:text-foreground p-1 border border-border bg-muted/40 transition-all"
                          title="Copy JSON configuration"
                        >
                          {copiedId === 'cline' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-4 font-mono text-[11px] overflow-x-auto bg-card/80 leading-relaxed">
                        <pre className="language-json !bg-transparent !p-0 !m-0">
                          <code className="language-json">
                            {clineSettings}
                          </code>
                        </pre>
                      </div>
                    </div>
                  </div>
                )}

                {activeAgent === 'cursor' && (
                  <div className="space-y-3 bg-card/80 border border-border p-5 font-mono text-[11px] leading-relaxed text-foreground/80">
                    <div className="border-b border-border pb-2 mb-3 font-bold text-foreground uppercase">[CURSOR_MANUAL_CONFIGURATION]</div>
                    <pre className="whitespace-pre-wrap">{cursorSettings}</pre>
                  </div>
                )}
              </section>
            )}

          </div>
        </main>
      </div>

    </div>
  )
}
