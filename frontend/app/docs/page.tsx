'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  getMe,
  getUsage,
  type UsageStats,
  type UserInfo,
} from '@/lib/api'
import { 
  LogOut, 
  KeyRound, 
  Terminal,
  Shield,
  Layers,
  Menu,
  X,
  Copy,
  Check,
  FileText,
  Activity,
  Cpu,
  Sparkles
} from 'lucide-react'

export default function DocsPage() {
  const router = useRouter()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [token, setToken] = useState<string>('')
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [activeCategory, setActiveCategory] = useState<'sdks' | 'agents'>('sdks')
  const [activeSdk, setActiveSdk] = useState<'python' | 'curl' | 'node'>('python')
  const [activeAgent, setActiveAgent] = useState<'claude' | 'cline' | 'cursor'>('claude')

  const [origin, setOrigin] = useState('http://localhost:8000')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin)
    }
  }, [])

  const loadData = useCallback(async (accessToken: string) => {
    try {
      const [me, usageData] = await Promise.all([
        getMe(accessToken),
        getUsage(accessToken),
      ])
      setUser(me)
      setUsage(usageData)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/auth/login')
        return
      }
      setToken(session.access_token)
      await loadData(session.access_token)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        router.push('/auth/login')
      } else {
        setToken(session.access_token)
        await loadData(session.access_token)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadData, router])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

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

response = client.chat.completions.create(
    model="akarouter-pro", # Options: akarouter-pro, akarouter-flash
    messages=[{"role": "user", "content": "Hello AkaRouter!"}]
)

print(response.choices[0].message.content)`

  const curlCode = `curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_AKAROUTER_API_KEY" \\
  -d '{
    "model": "akarouter-pro",
    "messages": [{"role": "user", "content": "Hello via curl"}]
  }'`

  const nodeCode = `import OpenAI from 'openai';

// Initialize OpenAI client pointing to AkaRouter
const openai = new OpenAI({
  baseURL: '${origin}/v1',
  apiKey: 'YOUR_AKAROUTER_API_KEY'
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'akarouter-pro',
    messages: [{ role: 'user', content: 'Hello via Node.js!' }],
  });

  console.log(completion.choices[0].message.content);
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
  "openAiModelId": "akarouter-pro"
}`

  const cursorSettings = `1. Open Cursor Settings -> Models
2. In 'Override OpenAI Base URL', enter:
   ${origin}/v1
3. In 'API Key', enter your AkaRouter Key.
4. Under 'Model Names', add:
   - akarouter-pro
   - akarouter-flash
5. Toggle off other models and enjoy AkaRouter routing!`

  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex antialiased selection:bg-[#ef4444]/30 selection:text-white">
      
      {/* SideNavBar */}
      <nav className="hidden md:flex flex-col h-screen w-64 tech-border-r bg-[#09090b] py-6 fixed left-0 top-0 z-20 micro-grid">
        <div className="px-6 mb-8 flex flex-col gap-1">
          <div className="w-full">
            <div className="w-full h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <img src="/logo.png" alt="AkaRouter Logo" className="w-full h-full object-contain scale-[2.5]" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <div className="w-1.5 h-1.5 bg-[#ef4444] red-glow status-pulse"></div>
            <p className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase">Kernel: v4.2.0-STABLE</p>
          </div>
        </div>

        <div className="flex-1 px-2 space-y-1">
          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/dashboard">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <Terminal className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Telemetry</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/keys">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <KeyRound className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">API Keys</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/usage">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <Layers className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Usage</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-white nav-item-active" href="/docs">
            <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
              <FileText className="w-3.5 h-3.5 text-[#ef4444]" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Docs</span>
          </Link>

          {user?.role === 'admin' && (
            <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/admin">
              <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
                <Shield className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
              </span>
              <span className="tracking-widest font-mono uppercase text-[11px]">Admin Panel</span>
            </Link>
          )}
        </div>

        <div className="px-6 mt-auto">
          <div className="font-mono text-[9px] text-zinc-600 mb-2 flex justify-between tracking-tighter">
            <span>[SYS_SESSION]</span>
            <span className={`text-emerald-500 uppercase ${!usage ? 'animate-pulse' : ''}`}>{usage?.tier || '...'}</span>
          </div>
          <button 
            onClick={signOut}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px] py-3 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white transition-all flex items-center justify-center gap-2 group crosshair-corners"
          >
            <LogOut className="w-3.5 h-3.5 group-hover:text-[#ef4444] transition-colors" />
            <span className="tracking-widest uppercase font-bold">Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 w-full relative">
        
        {/* TopAppBar */}
        <header className="flex justify-between items-center w-full px-6 py-3 bg-[#09090b] tech-border-b sticky top-0 z-10 micro-grid">
          <div className="md:hidden flex items-center justify-between w-full">
            <div className="w-20 h-10 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <img src="/logo.png" alt="AkaRouter Logo" className="w-full h-full object-contain scale-[2.5]" />
            </div>
            <button 
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 border border-zinc-800 bg-[#0e0e10] text-zinc-400 hover:text-white transition-colors"
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>

          <div className="hidden md:flex font-mono text-[11px] text-zinc-400 items-center gap-4">
            <div className="w-[2px] h-4 bg-[#ef4444]"></div>
            <span className="tracking-[0.2em] uppercase font-bold text-zinc-300">INTEGRATION MANUALS & API DOCS</span>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px]">
            <div className="hidden sm:flex items-center gap-2 border border-zinc-800 bg-[#0e0e10] px-3 py-1.5 text-zinc-400">
              <span className="text-zinc-600">[USER]:</span>
              <span className="text-white font-semibold">{user ? user.email : 'CONNECTING...'}</span>
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-45 bg-[#09090b]/98 backdrop-blur-md flex flex-col justify-between py-24 px-6 border-b border-zinc-900 animate-fade-in">
            <div className="space-y-4">
              <Link 
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
                href="/dashboard"
              >
                <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                  <Terminal className="w-3.5 h-3.5 text-zinc-455" />
                </span>
                <span className="tracking-widest font-mono uppercase text-xs">Telemetry</span>
              </Link>

              <Link 
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
                href="/keys"
              >
                <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                  <KeyRound className="w-3.5 h-3.5 text-zinc-455" />
                </span>
                <span className="tracking-widest font-mono uppercase text-xs">API Keys</span>
              </Link>

              <Link 
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
                href="/usage"
              >
                <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                  <Layers className="w-3.5 h-3.5 text-zinc-455" />
                </span>
                <span className="tracking-widest font-mono uppercase text-xs">Usage</span>
              </Link>

              <Link 
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-4 py-3 w-full border border-[#ef4444] bg-[#ef4444]/10 text-white red-glow"
                href="/docs"
              >
                <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
                  <FileText className="w-3.5 h-3.5 text-[#ef4444]" />
                </span>
                <span className="tracking-widest font-mono uppercase text-xs">Docs</span>
              </Link>

              {user?.role === 'admin' && (
                <Link 
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
                  href="/admin"
                >
                  <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                    <Shield className="w-3.5 h-3.5 text-zinc-450" />
                  </span>
                  <span className="tracking-widest font-mono uppercase text-xs">Admin Panel</span>
                </Link>
              )}
            </div>

            <div>
              <button 
                onClick={() => { setMobileOpen(false); signOut(); }}
                className="w-full bg-zinc-950 border border-zinc-900 text-zinc-300 font-mono text-[11px] py-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white transition-all flex items-center justify-center gap-2 crosshair-corners"
              >
                <LogOut className="w-4 h-4 text-zinc-455" />
                <span className="tracking-widest uppercase font-bold">Sign Out</span>
              </button>
            </div>
          </div>
        )}

        {/* Canvas */}
        <main className="flex-1 p-0 grid-bg relative">
          
          {usage?.gateway_enabled === false && (
            <div className="bg-[#ef4444]/10 border-b border-[#ef4444] p-4 text-center font-mono text-xs text-[#ef4444] tracking-wider uppercase animate-pulse">
              [WARNING_SYSTEM_MAINTENANCE_API_GATEWAY_OFFLINE_BY_ADMINISTRATOR]
            </div>
          )}

          <div className="p-6 space-y-6">
            
            {/* Tab select header */}
            <div className="flex border-b border-zinc-900 bg-zinc-950/40 p-1 overflow-x-auto whitespace-nowrap scrollbar-none">
              <button
                onClick={() => setActiveCategory('sdks')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 flex items-center gap-2 ${
                  activeCategory === 'sdks'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-zinc-500 hover:text-white'
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
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                [AI_AGENT_INTEGRATIONS]
              </button>
            </div>

            {/* Category: SDKs */}
            {activeCategory === 'sdks' && (
              <section className="bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6 animate-slide-in relative">
                <div className="space-y-1">
                  <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <Terminal className="w-4 h-4 text-[#ef4444]" />
                    DEVELOPER_SDK_INTEGRATIONS
                  </h2>
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">Integrate AkaRouter directly into your app using standard libraries.</p>
                </div>

                <div className="flex gap-2 border-b border-zinc-900 pb-2">
                  <button
                    onClick={() => setActiveSdk('python')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeSdk === 'python'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-zinc-900 text-zinc-550 hover:text-white'
                    }`}
                  >
                    PYTHON SDK
                  </button>
                  <button
                    onClick={() => setActiveSdk('curl')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeSdk === 'curl'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-zinc-900 text-zinc-550 hover:text-white'
                    }`}
                  >
                    CURL HTTP
                  </button>
                  <button
                    onClick={() => setActiveSdk('node')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeSdk === 'node'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-zinc-900 text-zinc-550 hover:text-white'
                    }`}
                  >
                    NODEJS SDK
                  </button>
                </div>

                {activeSdk === 'python' && (
                  <div className="bg-[#050507] border border-zinc-900">
                    <div className="bg-[#0e0e10] border-b border-zinc-900 px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-zinc-500 font-bold uppercase tracking-wider">python_openai_sdk.py</span>
                      <button
                        onClick={() => copyToClipboard(pythonCode, 'python')}
                        className="text-zinc-500 hover:text-white p-1 border border-zinc-900 bg-zinc-950 transition-all"
                        title="Copy code block"
                      >
                        {copiedId === 'python' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-4 font-mono text-[11px] text-zinc-300 overflow-x-auto bg-[#050507] leading-relaxed">
                      <pre>{pythonCode}</pre>
                    </div>
                  </div>
                )}

                {activeSdk === 'curl' && (
                  <div className="bg-[#050507] border border-zinc-900">
                    <div className="bg-[#0e0e10] border-b border-zinc-900 px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-zinc-500 font-bold uppercase tracking-wider">curl_request.sh</span>
                      <button
                        onClick={() => copyToClipboard(curlCode, 'curl')}
                        className="text-zinc-500 hover:text-white p-1 border border-zinc-900 bg-zinc-950 transition-all"
                        title="Copy code block"
                      >
                        {copiedId === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-4 font-mono text-[11px] text-zinc-300 overflow-x-auto bg-[#050507] leading-relaxed">
                      <pre>{curlCode}</pre>
                    </div>
                  </div>
                )}

                {activeSdk === 'node' && (
                  <div className="bg-[#050507] border border-zinc-900">
                    <div className="bg-[#0e0e10] border-b border-[#27272a] px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-zinc-500 font-bold uppercase tracking-wider">node_sdk.js</span>
                      <button
                        onClick={() => copyToClipboard(nodeCode, 'node')}
                        className="text-zinc-500 hover:text-white p-1 border border-zinc-900 bg-zinc-950 transition-all"
                        title="Copy code block"
                      >
                        {copiedId === 'node' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-4 font-mono text-[11px] text-zinc-300 overflow-x-auto bg-[#050507] leading-relaxed">
                      <pre>{nodeCode}</pre>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Category: Agents */}
            {activeCategory === 'agents' && (
              <section className="bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6 animate-slide-in relative">
                <div className="space-y-1">
                  <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <Sparkles className="w-4 h-4 text-[#ef4444]" />
                    AI_AGENT_&_IDE_CONFIGURATIONS
                  </h2>
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">Point your AI coding assistants directly to the AkaRouter routing gateway.</p>
                </div>

                <div className="flex gap-2 border-b border-zinc-900 pb-2">
                  <button
                    onClick={() => setActiveAgent('claude')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeAgent === 'claude'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-zinc-900 text-zinc-550 hover:text-white'
                    }`}
                  >
                    CLAUDE CODE
                  </button>
                  <button
                    onClick={() => setActiveAgent('cline')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeAgent === 'cline'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-zinc-900 text-zinc-550 hover:text-white'
                    }`}
                  >
                    CLINE (VS CODE)
                  </button>
                  <button
                    onClick={() => setActiveAgent('cursor')}
                    className={`px-3 py-1 font-mono text-[10px] uppercase border transition-colors ${
                      activeAgent === 'cursor'
                        ? 'border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]'
                        : 'border-zinc-900 text-zinc-550 hover:text-white'
                    }`}
                  >
                    CURSOR / CODEX
                  </button>
                </div>

                {activeAgent === 'claude' && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-mono text-zinc-400 uppercase">Run Claude Code in your CLI using AkaRouter routed endpoints:</p>
                    <div className="bg-[#050507] border border-zinc-900">
                      <div className="bg-[#0e0e10] border-b border-zinc-900 px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-zinc-500 font-bold uppercase tracking-wider">claude_code_setup.sh</span>
                        <button
                          onClick={() => copyToClipboard(claudeCode, 'claude')}
                          className="text-zinc-500 hover:text-white p-1 border border-zinc-900 bg-zinc-950 transition-all"
                          title="Copy commands"
                        >
                          {copiedId === 'claude' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-4 font-mono text-[11px] text-zinc-300 overflow-x-auto bg-[#050507] leading-relaxed">
                        <pre>{claudeCode}</pre>
                      </div>
                    </div>
                  </div>
                )}

                {activeAgent === 'cline' && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-mono text-zinc-400 uppercase">Paste this configuration into your Cline custom OpenAI provider settings:</p>
                    <div className="bg-[#050507] border border-zinc-900">
                      <div className="bg-[#0e0e10] border-b border-zinc-900 px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-zinc-500 font-bold uppercase tracking-wider">cline_settings.json</span>
                        <button
                          onClick={() => copyToClipboard(clineSettings, 'cline')}
                          className="text-zinc-500 hover:text-white p-1 border border-zinc-900 bg-zinc-950 transition-all"
                          title="Copy JSON configuration"
                        >
                          {copiedId === 'cline' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-4 font-mono text-[11px] text-zinc-300 overflow-x-auto bg-[#050507] leading-relaxed">
                        <pre>{clineSettings}</pre>
                      </div>
                    </div>
                  </div>
                )}

                {activeAgent === 'cursor' && (
                  <div className="space-y-3 bg-[#050507] border border-zinc-900 p-5 font-mono text-[11px] leading-relaxed text-zinc-300">
                    <div className="border-b border-zinc-900 pb-2 mb-3 font-bold text-white uppercase">[CURSOR_MANUAL_CONFIGURATION]</div>
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
