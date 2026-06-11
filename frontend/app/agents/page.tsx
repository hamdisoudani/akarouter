'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useApp } from '@/app/providers'
import {
  getHostedAgents,
  deployHostedAgent,
  configureAgentChannels,
  destroyHostedAgent,
  getAgentLogs,
  type HostedAgent
} from '@/lib/api'
import {
  User,
  LogOut,
  KeyRound,
  Copy,
  Check,
  Trash2,
  Terminal,
  Shield,
  Layers,
  Menu,
  X,
  FileText,
  Cpu,
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Settings,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react'

export default function HostedAgentsPage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut } = useApp()
  const [agents, setAgents] = useState<HostedAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [selectedModel, setSelectedModel] = useState('akarouter-pro')
  const [error, setError] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  
  // Terminal logs state
  const [activeLogsAgentId, setActiveLogsAgentId] = useState<string | null>(null)
  const [logsText, setLogsText] = useState<string>('Initializing telemetry listener...')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const logTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  // Wizard deploy log simulation
  const [showProgressTerminal, setShowProgressTerminal] = useState(false)
  const [progressLogs, setProgressLogs] = useState<string[]>([])
  const [progressStep, setProgressStep] = useState(0)
  const [deployingAgentId, setDeployingAgentId] = useState<string | null>(null)

  // Channel configuration form state
  const [configuringAgentId, setConfiguringAgentId] = useState<string | null>(null)
  const [tgEnabled, setTgEnabled] = useState(false)
  const [tgToken, setTgToken] = useState('')
  const [tgAllowFrom, setTgAllowFrom] = useState('')
  const [showTgToken, setShowTgToken] = useState(false)
  const [discordEnabled, setDiscordEnabled] = useState(false)
  const [discordToken, setDiscordToken] = useState('')
  const [showDiscordToken, setShowDiscordToken] = useState(false)
  const [discordGuildsJson, setDiscordGuildsJson] = useState('{}')
  
  const [configuring, setConfiguring] = useState(false)
  const [copiedLogs, setCopiedLogs] = useState(false)

  // Collapsible channel guides
  const [openGuide, setOpenGuide] = useState<'telegram' | 'discord' | null>(null)

  const loadData = useCallback(async (accessToken: string) => {
    try {
      if (user?.status === 'pending') {
        router.push('/dashboard')
        return
      }
      const data = await getHostedAgents(accessToken)
      setAgents(data.agents)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user, router])

  useEffect(() => {
    if (!authLoading) {
      if (!token) {
        router.push('/auth/login')
        return
      }
      loadData(token)
    }
  }, [authLoading, token, loadData, router])

  // Poll agents list when something is provisioning/installing/destroying
  useEffect(() => {
    if (!token) return
    const needsPolling = agents.some(a => ['provisioning', 'installing', 'destroying'].includes(a.status))
    if (!needsPolling) return

    const interval = setInterval(async () => {
      try {
        const data = await getHostedAgents(token)
        setAgents(data.agents)
      } catch (err) {
        console.error("Failed to poll agent updates:", err)
      }
    }, 4000)

    return () => clearInterval(interval)
  }, [agents, token])

  // Poll logs when terminal is open
  useEffect(() => {
    if (!token || !activeLogsAgentId) {
      if (logTimerRef.current) clearInterval(logTimerRef.current)
      return
    }

    const fetchLogs = async () => {
      try {
        const data = await getAgentLogs(token, activeLogsAgentId, 50)
        setLogsText(data.logs || 'No log output returned from VM.')
      } catch (err: any) {
        setLogsText(`Failed to fetch logs: ${err.message}`)
      }
    }

    fetchLogs()
    logTimerRef.current = setInterval(fetchLogs, 4000)

    return () => {
      if (logTimerRef.current) clearInterval(logTimerRef.current)
    }
  }, [activeLogsAgentId, token])

  // Poll active deployment telemetry in real-time
  useEffect(() => {
    if (!token || !deployingAgentId) return

    const interval = setInterval(async () => {
      try {
        const data = await getHostedAgents(token)
        setAgents(data.agents)
        
        const currentAgent = data.agents.find(a => a.id === deployingAgentId)
        if (currentAgent) {
          const msg = currentAgent.progress_message || 'Initializing deployment pipeline...'
          setProgressLogs(prev => {
            if (prev.length === 0 || prev[prev.length - 1] !== msg) {
              return [...prev, msg]
            }
            return prev
          })
          
          if (currentAgent.progress_step !== undefined) {
            setProgressStep(currentAgent.progress_step)
          }
          
          if (currentAgent.status === 'running') {
            setProgressLogs(prev => [...prev, "✓ AGENT IS ONLINE AND CONNECTED"])
            setProgressStep(5)
            clearInterval(interval)
            
            // Clean up terminal after success
            setTimeout(() => {
              setShowProgressTerminal(false)
              setDeployingAgentId(null)
              setDeploying(false)
            }, 2000)
          } else if (currentAgent.status === 'failed') {
            setProgressLogs(prev => [
              ...prev,
              `✗ DEPLOYMENT FAILED: ${currentAgent.error_message || 'Unknown error during VM setup'}`
            ])
            clearInterval(interval)
            setDeploying(false)
          }
        }
      } catch (err) {
        console.error("Failed to poll deployment telemetry:", err)
      }
    }, 1500)

    return () => clearInterval(interval)
  }, [deployingAgentId, token])

  const handleDeploy = async () => {
    if (!token) return
    if (!newAgentName.trim()) {
      setError("Please specify an agent name")
      return
    }
    setError('')
    setDeploying(true)
    setShowProgressTerminal(true)
    setProgressLogs(["REQUEST RECEIVED: INITIALIZING DEPLOYMENT PIPELINE..."])
    setProgressStep(0)

    try {
      const res = await deployHostedAgent(token, newAgentName, selectedModel)
      setNewAgentName('')
      setDeployingAgentId(res.agent_id)
    } catch (err: any) {
      setError(err.message)
      setDeploying(false)
      setShowProgressTerminal(false)
    }
  }

  const handleDestroy = async (agentId: string) => {
    if (!token) return
    if (!confirm("Are you sure you want to completely destroy this hosted agent and release the VM?")) return
    setError('')
    try {
      // Optimistically update status to destroying
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'destroying' } : a))
      await destroyHostedAgent(token, agentId)
      // Refresh list
      const data = await getHostedAgents(token)
      setAgents(data.agents)
      if (activeLogsAgentId === agentId) {
        setActiveLogsAgentId(null)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const startConfiguring = (agent: HostedAgent) => {
    setConfiguringAgentId(agent.id)
    setTgEnabled(agent.telegram_enabled)
    setTgToken('')
    setTgAllowFrom(agent.telegram_allow_from || '')
    setDiscordEnabled(agent.discord_enabled)
    setDiscordToken('')
    setDiscordGuildsJson('{}')
    setError('')
  }

  const handleSaveChannels = async () => {
    if (!token || !configuringAgentId) return
    setConfiguring(true)
    setError('')
    try {
      let guilds = {}
      if (discordEnabled && discordGuildsJson.trim()) {
        try {
          guilds = JSON.parse(discordGuildsJson)
        } catch (e) {
          throw new Error("Invalid Discord Guilds JSON format. Must be a valid JSON object.")
        }
      }

      await configureAgentChannels(token, configuringAgentId, {
        telegram_enabled: tgEnabled,
        telegram_bot_token: tgToken.trim() || undefined,
        telegram_allow_from: tgAllowFrom.trim() || undefined,
        discord_enabled: discordEnabled,
        discord_bot_token: discordToken.trim() || undefined,
        discord_guilds: discordEnabled ? guilds : undefined
      })

      // Refresh
      const data = await getHostedAgents(token)
      setAgents(data.agents)
      setConfiguringAgentId(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setConfiguring(false)
    }
  }

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
            <p className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase">Kernel: v1.0.0-STABLE</p>
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

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-white nav-item-active" href="/agents">
            <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
              <Cpu className="w-3.5 h-3.5 text-[#ef4444]" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Hosted Agents</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/docs">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <FileText className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
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

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-[#09090b]/98 backdrop-blur-md flex flex-col justify-between py-24 px-6 border-b border-zinc-900 animate-fade-in">
          <div className="absolute top-4 right-6 md:hidden">
            <button 
              onClick={() => setMobileOpen(false)}
              className="p-2 border border-zinc-800 bg-[#0e0e10] text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

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
              href="/agents"
            >
              <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
                <Cpu className="w-3.5 h-3.5 text-[#ef4444]" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Hosted Agents</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/docs"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-zinc-455" />
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
                  <Shield className="w-3.5 h-3.5 text-zinc-455" />
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 w-full relative animate-fade-in">
        
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
            <span className="tracking-[0.2em] uppercase font-bold text-zinc-300">Hosted Agent Deployer</span>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px]">
            <div className={`hidden sm:flex items-center gap-2 border border-zinc-800 bg-[#0e0e10] px-3 py-1.5 text-zinc-400 ${!user ? 'animate-pulse' : ''}`}>
              <span className="text-zinc-600">[USER]:</span>
              <span className="text-white font-semibold">{user ? user.email : 'CONNECTING...'}</span>
            </div>
          </div>
        </header>

        {/* Canvas */}
        <main className="flex-1 p-6 grid-bg relative">
          
          {error && (
            <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] text-[11px] font-mono text-[#ef4444] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#ef4444]" />
              {error.toUpperCase()}
            </div>
          )}

          <div className="grid grid-cols-12 gap-6">
            
            {/* Left Column: Sandbox Creator / Dashboard */}
            <div className="col-span-12 lg:col-span-8 space-y-6">
              
              {/* Creator Card */}
              {agents.length === 0 && !showProgressTerminal && (
                <div className="tech-border bg-[#0e0e10] p-8 crosshair-corners space-y-6">
                  <div className="space-y-2 text-center max-w-lg mx-auto">
                    <div className="w-12 h-12 border border-[#ef4444]/40 bg-[#ef4444]/5 flex items-center justify-center red-glow mx-auto mb-4">
                      <Cpu className="w-6 h-6 text-[#ef4444]" />
                    </div>
                    <h2 className="font-mono text-sm text-white tracking-[0.2em] uppercase font-bold">
                      Deploy Your First Hosted Agent
                    </h2>
                    <p className="text-xs font-mono text-zinc-500 uppercase">
                      Spin up a managed Daytona VM (1 CPU, 1GB RAM, 3GB Disk) to run OpenClaw gateway automatically connected to AkaRouter.
                    </p>
                  </div>

                  <div className="max-w-md mx-auto pt-4 border-t border-zinc-900 space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-zinc-500 uppercase">Agent Instance Name</label>
                      <input
                        type="text"
                        value={newAgentName}
                        onChange={(e) => setNewAgentName(e.target.value)}
                        placeholder="e.g. MyOpenClaw"
                        className="w-full border border-zinc-800 bg-[#050507] px-4 py-2.5 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-zinc-500 uppercase">Gateway Model Target</label>
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="w-full border border-zinc-800 bg-[#050507] px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono"
                      >
                        <option value="akarouter-pro">akarouter-pro (Step-3.7-Flash)</option>
                        <option value="akarouter-flash">akarouter-flash (Nemotron-3-Ultra)</option>
                        <option value="akarouter-large">akarouter-large (Owl-Alpha)</option>
                      </select>
                    </div>

                    <button
                      onClick={handleDeploy}
                      disabled={deploying}
                      className="w-full bg-[#ef4444] text-white font-mono text-xs font-bold py-3 hover:bg-[#d83f3f] transition-all flex items-center justify-center gap-2 red-glow"
                    >
                      {deploying ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>DEPLOYING_VM...</span>
                        </>
                      ) : (
                        <>
                          <Cpu className="w-4 h-4" />
                          <span>DEPLOY INSTANT AGENT</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Progress Terminal (Wizard UI) */}
              {showProgressTerminal && (
                <div className="tech-border bg-[#050507] p-6 font-mono text-[11px] space-y-4 crosshair-corners border-[#ef4444]/30 red-glow">
                  <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-[#ef4444] status-pulse red-glow"></div>
                      <span className="text-white uppercase font-bold tracking-wider">VM_PROVISIONING_PIPELINE</span>
                    </div>
                    <span className="text-zinc-650">STEP_{progressStep + 1}/6</span>
                  </div>
                  
                  <div className="bg-[#09090b] border border-zinc-900 p-4 rounded-sm space-y-1.5 h-64 overflow-y-auto custom-scrollbar text-zinc-400">
                    {progressLogs.map((log, idx) => (
                      <div key={idx} className="flex gap-4">
                        <span className="text-zinc-600 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                        <span className={idx === progressStep ? "text-[#ef4444] font-bold" : "text-zinc-300"}>{log}</span>
                      </div>
                    ))}
                    <div className="animate-pulse text-[#ef4444] mt-2 font-bold">LOG_LISTENER_ACTIVE...</div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-zinc-550 border-t border-zinc-900 pt-3">
                    <span>HOST: Daytona API v0.186</span>
                    <span className="animate-spin text-zinc-500"><RefreshCw className="w-3.5 h-3.5" /></span>
                  </div>
                </div>
              )}

              {/* Running Agents Dashboard */}
              {agents.length > 0 && !showProgressTerminal && (
                <div className="space-y-6">
                  
                  <div className="flex justify-between items-center">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <div className="w-[3px] h-3 bg-[#ef4444]"></div>
                      HOSTED_AGENTS_TELEMETRY ({agents.length})
                    </h2>
                    
                    {/* Add Agent Button if below limit */}
                    <button
                      onClick={() => setAgents([])} // Trigger empty state view to show deploy form
                      className="border border-zinc-800 bg-[#0e0e10] hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-white font-mono text-[10px] py-1.5 px-3 transition-colors uppercase"
                    >
                      [+] Deploy New Agent
                    </button>
                  </div>

                  {agents.map((agent) => (
                    <div key={agent.id} className="tech-border bg-[#0e0e10] p-6 crosshair-corners space-y-6 relative">
                      
                      {/* Agent Header Info */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <h3 className="font-mono text-sm font-bold text-white uppercase">{agent.agent_name}</h3>
                            <span className={`text-[9px] px-2 py-0.5 font-mono border uppercase tracking-wider ${
                              agent.status === 'running' 
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : agent.status === 'failed'
                                ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-400 animate-pulse'
                            }`}>
                              {agent.status}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-zinc-500">
                            VM ID: <code className="text-zinc-400">{agent.sandbox_id || 'PROVISIONING...'}</code>
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono border border-zinc-800 bg-[#050507] px-3 py-1 text-zinc-400">
                            1 CPU · 1GB RAM · 3GB Disk
                          </span>
                          <span className="text-[10px] font-mono border border-zinc-800 bg-[#050507] px-3 py-1 text-zinc-400 uppercase">
                            {agent.model_name}
                          </span>
                        </div>
                      </div>

                      {/* Configured Integrations Overview */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        
                        {/* Telegram Panel */}
                        <div className="border border-zinc-900 bg-[#050507] p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider font-bold">Telegram Channel</span>
                            <span className={`w-2 h-2 rounded-full ${agent.telegram_enabled ? 'bg-emerald-500 red-glow status-pulse' : 'bg-zinc-800'}`}></span>
                          </div>
                          <div className="space-y-1 font-mono text-[10px] text-zinc-500">
                            <div>STATUS: <span className={agent.telegram_enabled ? "text-emerald-400" : "text-zinc-550"}>{agent.telegram_enabled ? "ACTIVE" : "DISABLED"}</span></div>
                            {agent.telegram_enabled && (
                              <div>ALLOW_FROM: <span className="text-zinc-300">{agent.telegram_allow_from || "ALL_USERS"}</span></div>
                            )}
                          </div>
                        </div>

                        {/* Discord Panel */}
                        <div className="border border-zinc-900 bg-[#050507] p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider font-bold">Discord Channel</span>
                            <span className={`w-2 h-2 rounded-full ${agent.discord_enabled ? 'bg-emerald-500 red-glow status-pulse' : 'bg-zinc-800'}`}></span>
                          </div>
                          <div className="space-y-1 font-mono text-[10px] text-zinc-500">
                            <div>STATUS: <span className={agent.discord_enabled ? "text-emerald-400" : "text-zinc-550"}>{agent.discord_enabled ? "ACTIVE" : "DISABLED"}</span></div>
                          </div>
                        </div>

                      </div>

                      {/* Agent Fail Error Banner */}
                      {agent.status === 'failed' && agent.error_message && (
                        <div className="p-4 bg-[#ef4444]/5 border border-[#ef4444]/20 text-[10px] font-mono text-[#ef4444] space-y-1">
                          <div className="font-bold">CRITICAL_SANDBOX_FAILURE:</div>
                          <div className="break-all">{agent.error_message}</div>
                        </div>
                      )}

                      {/* Action Triggers */}
                      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-900 pt-4">
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => startConfiguring(agent)}
                            disabled={agent.status !== 'running'}
                            className="bg-zinc-900 border border-zinc-850 hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-white font-mono text-[10px] py-2 px-4 transition-all uppercase flex items-center gap-1.5"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>Configure Channels</span>
                          </button>

                          <button
                            onClick={() => setActiveLogsAgentId(activeLogsAgentId === agent.id ? null : agent.id)}
                            disabled={agent.status !== 'running'}
                            className={`border font-mono text-[10px] py-2 px-4 transition-all uppercase flex items-center gap-1.5 ${
                              activeLogsAgentId === agent.id
                                ? 'border-[#ef4444] bg-[#ef4444]/10 text-white red-glow'
                                : 'bg-zinc-900 border-zinc-850 hover:border-zinc-500 text-zinc-300'
                            }`}
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Telemetry Log</span>
                          </button>
                        </div>

                        <button
                          onClick={() => handleDestroy(agent.id)}
                          disabled={agent.status === 'destroying'}
                          className="bg-zinc-950 border border-zinc-900 hover:border-[#ef4444] hover:bg-[#ef4444]/10 text-zinc-500 hover:text-white font-mono text-[10px] py-2 px-4 transition-all uppercase flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{agent.status === 'destroying' ? 'Destroying...' : 'Destroy VM'}</span>
                        </button>

                      </div>

                      {/* Realtime Terminal Console Logs */}
                      {activeLogsAgentId === agent.id && (
                        <div className="tech-border bg-[#050507] p-4 font-mono text-[10px] space-y-2 border-zinc-800 animate-fade-in">
                          <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                            <span className="text-zinc-500 uppercase tracking-widest font-bold">OpenClaw Service Logs (VM Console)</span>
                            
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(logsText)
                                  setCopiedLogs(true)
                                  setTimeout(() => setCopiedLogs(false), 2000)
                                }}
                                className="text-zinc-550 hover:text-white uppercase text-[9px] underline"
                              >
                                {copiedLogs ? 'Copied!' : 'Copy Logs'}
                              </button>
                              <button 
                                onClick={async () => {
                                  setLoadingLogs(true)
                                  try {
                                    const data = await getAgentLogs(token!, agent.id, 50)
                                    setLogsText(data.logs)
                                  } catch (e: any) {
                                    setLogsText(`Error: ${e.message}`)
                                  } finally {
                                    setLoadingLogs(false)
                                  }
                                }}
                                className="text-zinc-550 hover:text-white"
                                title="Force refresh"
                              >
                                <RefreshCw className={`w-3 h-3 ${loadingLogs ? 'animate-spin' : ''}`} />
                              </button>
                            </div>
                          </div>
                          <pre className="p-3 bg-[#09090b] border border-zinc-900 text-zinc-400 overflow-x-auto whitespace-pre h-48 custom-scrollbar">
                            {logsText}
                          </pre>
                        </div>
                      )}

                    </div>
                  ))}

                </div>
              )}

            </div>

            {/* Right Column: Dynamic Configurations Guides & Channels Form */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              
              {/* Channel Config Form */}
              {configuringAgentId ? (
                <div className="tech-border bg-[#0e0e10] p-6 crosshair-corners space-y-6 animate-fade-in">
                  <div className="space-y-1 border-b border-zinc-900 pb-3 flex justify-between items-center">
                    <div>
                      <h2 className="font-mono text-xs text-white tracking-[0.2em] uppercase font-bold">
                        CHANNEL_MUTATOR
                      </h2>
                      <p className="text-[9px] font-mono text-zinc-500 uppercase">Configure external chat platform bindings.</p>
                    </div>
                    <button 
                      onClick={() => setConfiguringAgentId(null)}
                      className="p-1 border border-zinc-900 text-zinc-500 hover:text-white bg-zinc-950"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    
                    {/* Telegram Section */}
                    <div className="border border-zinc-900 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-mono font-bold text-zinc-300 uppercase tracking-wider">Enable Telegram Bot</label>
                        <input 
                          type="checkbox" 
                          checked={tgEnabled}
                          onChange={(e) => setTgEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] focus:ring-0 cursor-pointer"
                        />
                      </div>

                      {tgEnabled && (
                        <div className="space-y-3 pt-2 border-t border-zinc-900 animate-fade-in">
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono text-zinc-500 uppercase">Bot API Token</label>
                            <div className="relative">
                              <input
                                type={showTgToken ? "text" : "password"}
                                value={tgToken}
                                onChange={(e) => setTgToken(e.target.value)}
                                placeholder="Paste token from @BotFather"
                                className="w-full border border-zinc-800 bg-[#050507] pl-4 pr-10 py-1.5 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono"
                              />
                              <button 
                                type="button"
                                onClick={() => setShowTgToken(!showTgToken)}
                                className="absolute right-3 top-2 text-zinc-550 hover:text-white"
                              >
                                {showTgToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] font-mono text-zinc-500 uppercase">Allow Telegram User IDs</label>
                            <input
                              type="text"
                              value={tgAllowFrom}
                              onChange={(e) => setTgAllowFrom(e.target.value)}
                              placeholder="Comma-separated IDs e.g. 123456,78910"
                              className="w-full border border-zinc-800 bg-[#050507] px-4 py-1.5 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono"
                            />
                            <p className="text-[8px] font-mono text-zinc-600">Restrict access to specific numeric user accounts.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Discord Section */}
                    <div className="border border-zinc-900 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-mono font-bold text-zinc-300 uppercase tracking-wider">Enable Discord Bot</label>
                        <input 
                          type="checkbox" 
                          checked={discordEnabled}
                          onChange={(e) => setDiscordEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] focus:ring-0 cursor-pointer"
                        />
                      </div>

                      {discordEnabled && (
                        <div className="space-y-3 pt-2 border-t border-zinc-900 animate-fade-in">
                          <div className="space-y-1">
                            <label className="text-[9px] font-mono text-zinc-500 uppercase">Bot Token</label>
                            <div className="relative">
                              <input
                                type={showDiscordToken ? "text" : "password"}
                                value={discordToken}
                                onChange={(e) => setDiscordToken(e.target.value)}
                                placeholder="Paste token from Developer Portal"
                                className="w-full border border-zinc-800 bg-[#050507] pl-4 pr-10 py-1.5 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono"
                              />
                              <button 
                                type="button"
                                onClick={() => setShowDiscordToken(!showDiscordToken)}
                                className="absolute right-3 top-2 text-zinc-550 hover:text-white"
                              >
                                {showDiscordToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] font-mono text-zinc-500 uppercase">Guild Allowed channels JSON (Optional)</label>
                            <textarea
                              value={discordGuildsJson}
                              onChange={(e) => setDiscordGuildsJson(e.target.value)}
                              rows={3}
                              className="w-full border border-zinc-800 bg-[#050507] p-3 text-xs text-zinc-300 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono"
                            />
                            <p className="text-[8px] font-mono text-zinc-600">JSON object mapping guild ID to channel constraints.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleSaveChannels}
                      disabled={configuring}
                      className="w-full bg-zinc-900 border border-zinc-850 hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-white font-mono text-xs font-bold py-3 transition-all flex items-center justify-center gap-2"
                    >
                      {configuring ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>SAVING_CONFIG...</span>
                        </>
                      ) : (
                        <span>APPLY CONFIG TO VM</span>
                      )}
                    </button>

                  </div>
                </div>
              ) : (
                /* Dynamic Guide Column */
                <div className="tech-border bg-[#0e0e10] p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white tracking-[0.2em] uppercase font-bold">
                      INTEGRATION_GUIDES
                    </h2>
                    <p className="text-[9px] font-mono text-zinc-500 uppercase">Step-by-step connection tutorials.</p>
                  </div>

                  <div className="space-y-3">
                    
                    {/* Telegram Collapsible Guide */}
                    <div className="border border-zinc-900">
                      <button
                        onClick={() => setOpenGuide(openGuide === 'telegram' ? null : 'telegram')}
                        className="w-full flex items-center justify-between p-3.5 font-mono text-[10px] text-zinc-300 uppercase tracking-wider bg-[#050507] hover:text-white transition-colors"
                      >
                        <span>Telegram Bot Onboarding</span>
                        {openGuide === 'telegram' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      
                      {openGuide === 'telegram' && (
                        <div className="p-4 border-t border-zinc-900 font-mono text-[10px] text-zinc-400 space-y-3 leading-relaxed animate-fade-in">
                          <p>1. Open Telegram and search for <strong className="text-white">@BotFather</strong>.</p>
                          <p>2. Send the command <code className="text-[#ef4444]">/newbot</code> and follow the instructions to choose a name and username.</p>
                          <p>3. Copy the generated <strong className="text-white">API Token</strong> (looks like <code className="text-zinc-300 select-all">123456789:ABCdefGhI...</code>).</p>
                          <p>4. To restrict the bot access to yourself (Highly Recommended), find your Telegram ID using <strong className="text-white">@UserInfoBot</strong>.</p>
                          <p>5. Click "Configure Channels" on your agent, turn on Telegram, and paste your Bot Token and User ID.</p>
                        </div>
                      )}
                    </div>

                    {/* Discord Collapsible Guide */}
                    <div className="border border-zinc-900">
                      <button
                        onClick={() => setOpenGuide(openGuide === 'discord' ? null : 'discord')}
                        className="w-full flex items-center justify-between p-3.5 font-mono text-[10px] text-zinc-300 uppercase tracking-wider bg-[#050507] hover:text-white transition-colors"
                      >
                        <span>Discord Bot Onboarding</span>
                        {openGuide === 'discord' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      
                      {openGuide === 'discord' && (
                        <div className="p-4 border-t border-zinc-900 font-mono text-[10px] text-zinc-400 space-y-3 leading-relaxed animate-fade-in">
                          <p>1. Visit the <strong className="text-white">Discord Developer Portal</strong> and create a new Application.</p>
                          <p>2. Go to the "Bot" tab, click "Add Bot", and reset/copy the <strong className="text-white">Bot Token</strong>.</p>
                          <p>3. Scroll down to "Privileged Gateway Intents" and enable <strong className="text-white">Message Content Intent</strong> and <strong className="text-white">Guild Messages</strong>.</p>
                          <p>4. Go to the "OAuth2" &rarr; "URL Generator" tab, select scope <code className="text-[#ef4444]">bot</code> and permissions <code className="text-[#ef4444]">Send Messages</code>, and open the generated link to invite the bot to your server.</p>
                          <p>5. Paste the Bot Token in your Agent Channel configuration.</p>
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}

            </div>

          </div>

        </main>
      </div>

    </div>
  )
}
