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
  getMyKeys,
  type HostedAgent,
  type ApiKey
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
  EyeOff,
  ArrowRight,
  Lock,
  Bot,
  Sparkles,
  Wifi,
  CheckCircle,
  Play
} from 'lucide-react'

// Suspense Skeleton Loader Component for Initial Load
function HostedAgentsSkeleton() {
  return (
    <div className="w-full space-y-8 animate-pulse font-mono">
      {/* Stepper Skeleton or Top header */}
      <div className="flex justify-between items-center border border-zinc-900 bg-[#0e0e10]/60 p-4 rounded-sm">
        <div className="h-4 w-48 bg-zinc-800/50 rounded-sm"></div>
        <div className="h-3 w-24 bg-zinc-900/50 rounded-sm"></div>
      </div>
      
      {/* Grid Content Skeleton */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <div className="border border-zinc-900 bg-[#0e0e10]/60 p-6 space-y-6 rounded-sm">
            <div className="flex justify-between items-center border-b border-zinc-900 pb-4">
              <div className="space-y-2">
                <div className="h-5 w-40 bg-zinc-800/50 rounded-sm"></div>
                <div className="h-3 w-64 bg-zinc-900/50 rounded-sm"></div>
              </div>
              <div className="h-6 w-24 bg-zinc-900/50 rounded-sm border border-zinc-800/50"></div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="h-24 bg-[#050507] border border-zinc-900 rounded-sm"></div>
              <div className="h-24 bg-[#050507] border border-zinc-900 rounded-sm"></div>
            </div>
            
            <div className="h-10 bg-zinc-900/50 border border-zinc-800/50 rounded-sm"></div>
          </div>
        </div>
        
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="border border-zinc-900 bg-[#0e0e10]/60 p-6 space-y-4 rounded-sm">
            <div className="h-4 w-36 bg-zinc-800/50 rounded-sm"></div>
            <div className="h-3 w-48 bg-zinc-900/50 rounded-sm"></div>
            <div className="space-y-2 pt-2">
              <div className="h-10 bg-[#050507] border border-zinc-900 rounded-sm"></div>
              <div className="h-10 bg-[#050507] border border-zinc-900 rounded-sm"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function HostedAgentsPage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut } = useApp()
  
  // Hosted agents state
  const [agents, setAgents] = useState<HostedAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  
  // Wizard flow state: 'details' | 'provisioning' | 'channels' | null
  const [wizardStep, setWizardStep] = useState<'details' | 'provisioning' | 'channels' | null>(null)
  
  // Deploy forms state
  const [newAgentName, setNewAgentName] = useState('')
  const [selectedModel, setSelectedModel] = useState('akarouter-pro')
  const [deploying, setDeploying] = useState(false)
  
  // API Keys state for picker
  const [userKeys, setUserKeys] = useState<ApiKey[]>([])
  const [loadingKeys, setLoadingKeys] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState<string>('new') // 'new' or api key ID
  const [rawKeyInput, setRawKeyInput] = useState<string>('')
  const [showRawKeyInput, setShowRawKeyInput] = useState(false)
  
  // Telemetry provisioning states
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
  
  // Terminal logs state
  const [activeLogsAgentId, setActiveLogsAgentId] = useState<string | null>(null)
  const [logsText, setLogsText] = useState<string>('Initializing telemetry listener...')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const logTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [copiedLogs, setCopiedLogs] = useState(false)

  // Collapsible guides
  const [openGuide, setOpenGuide] = useState<'telegram' | 'discord' | null>(null)

  // Fetch available API keys
  const loadUserKeys = useCallback(async () => {
    if (!token) return
    setLoadingKeys(true)
    try {
      const data = await getMyKeys(token)
      setUserKeys(data.keys || [])
    } catch (err: any) {
      console.error("Failed to load user keys:", err)
    } finally {
      setLoadingKeys(false)
    }
  }, [token])

  // Load initial hosted agents
  const loadData = useCallback(async (accessToken: string) => {
    try {
      if (user?.status === 'pending') {
        router.push('/dashboard')
        return
      }
      const data = await getHostedAgents(accessToken)
      setAgents(data.agents)
      
      // If no agents are running/configured, start in the details step of the wizard
      if (data.agents.length === 0) {
        setWizardStep('details')
      } else {
        setWizardStep(null)
      }
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

  // Fetch user keys when details step is active
  useEffect(() => {
    if (wizardStep === 'details') {
      loadUserKeys()
    }
  }, [wizardStep, loadUserKeys])

  // Poll agents list updates when something is provisioning/installing/destroying
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

  // Poll VM console logs when active logs terminal is open
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
    logTimerRef.current = setInterval(fetchLogs, 4500)

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
            setProgressLogs(prev => [...prev, "✓ VM SANDBOX ACTIVE", "✓ OPENCLAW INSTALLED & DEPLOYED"])
            setProgressStep(5)
            clearInterval(interval)
            
            // Advance to step 3: Channels configuration wizard
            setTimeout(() => {
              setWizardStep('channels')
              setConfiguringAgentId(deployingAgentId)
              setDeployingAgentId(null)
              setDeploying(false)
              // Reset channel form inputs
              setTgEnabled(false)
              setTgToken('')
              setTgAllowFrom('')
              setDiscordEnabled(false)
              setDiscordToken('')
              setDiscordGuildsJson('{}')
            }, 1500)
          } else if (currentAgent.status === 'failed') {
            setProgressLogs(prev => [
              ...prev,
              `✗ DEPLOYMENT FAILED: ${currentAgent.error_message || 'Unknown error during VM configuration'}`
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

  // Trigger agent deployment
  const handleDeploy = async () => {
    if (!token) return
    if (!newAgentName.trim()) {
      setError("Please specify an agent name")
      return
    }
    if (selectedKeyId !== 'new' && !rawKeyInput.trim()) {
      setError("Please paste the raw API key corresponding to the selected key")
      return
    }
    setError('')
    setDeploying(true)
    setWizardStep('provisioning')
    setProgressLogs(["REQUEST RECEIVED: INITIALIZING VM SANDBOX PIPELINE..."])
    setProgressStep(0)

    try {
      const apiKeyVal = selectedKeyId === 'new' ? undefined : rawKeyInput.trim()
      const res = await deployHostedAgent(token, newAgentName.trim(), selectedModel, apiKeyVal)
      setNewAgentName('')
      setDeployingAgentId(res.agent_id)
    } catch (err: any) {
      setError(err.message)
      setDeploying(false)
      setWizardStep('details')
    }
  }

  // Handle agent destruction
  const handleDestroy = async (agentId: string) => {
    if (!token) return
    if (!confirm("Are you sure you want to completely destroy this hosted agent and release the VM?")) return
    setError('')
    try {
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'destroying' } : a))
      await destroyHostedAgent(token, agentId)
      
      const data = await getHostedAgents(token)
      setAgents(data.agents)
      
      if (activeLogsAgentId === agentId) {
        setActiveLogsAgentId(null)
      }
      
      // If all agents are gone, go back to creation details wizard
      if (data.agents.length === 0) {
        setWizardStep('details')
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Open channel config editor
  const startConfiguring = (agent: HostedAgent) => {
    setConfiguringAgentId(agent.id)
    setTgEnabled(agent.telegram_enabled)
    setTgToken('')
    setTgAllowFrom(agent.telegram_allow_from || '')
    setDiscordEnabled(agent.discord_enabled)
    setDiscordToken('')
    setDiscordGuildsJson('{}')
    setError('')
    setWizardStep('channels')
  }

  // Save Telegram / Discord channels
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

      // Complete wizard and reload dashboard
      const data = await getHostedAgents(token)
      setAgents(data.agents)
      setConfiguringAgentId(null)
      setWizardStep(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setConfiguring(false)
    }
  }

  // Check if we are currently editing an active agent from the dashboard
  const isEditingChannels = configuringAgentId && agents.some(a => a.id === configuringAgentId && a.status === 'running')

  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex antialiased selection:bg-[#ef4444]/30 selection:text-white">
      
      {/* Left Sidebar Menu */}
      <nav className="hidden md:flex flex-col h-screen w-64 tech-border-r bg-[#09090b] py-6 fixed left-0 top-0 z-20 micro-grid">
        <div className="px-6 mb-8 flex flex-col gap-1">
          <div className="w-full">
            <div className="w-full h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <img src="/logo.png" alt="AkaRouter Logo" className="w-full h-full object-contain scale-[2.5]" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <div className="w-1.5 h-1.5 bg-[#ef4444] red-glow status-pulse"></div>
            <p className="font-mono text-[9px] text-zinc-650 tracking-widest uppercase">Kernel: v1.1.0-STABLE</p>
          </div>
        </div>

        <div className="flex-1 px-2 space-y-1">
          <Link className="flex items-center gap-3 px-3 py-2.5 w-full text-zinc-400 hover:text-white hover:bg-zinc-900/50 transition-all group rounded-sm" href="/dashboard">
            <span className="border border-zinc-900 p-1 group-hover:border-zinc-700 transition-colors flex items-center justify-center bg-zinc-950">
              <Terminal className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[10px]">Telemetry</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2.5 w-full text-zinc-400 hover:text-white hover:bg-zinc-900/50 transition-all group rounded-sm" href="/keys">
            <span className="border border-zinc-900 p-1 group-hover:border-zinc-700 transition-colors flex items-center justify-center bg-zinc-950">
              <KeyRound className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[10px]">API Keys</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2.5 w-full text-zinc-400 hover:text-white hover:bg-zinc-900/50 transition-all group rounded-sm" href="/usage">
            <span className="border border-zinc-900 p-1 group-hover:border-zinc-700 transition-colors flex items-center justify-center bg-zinc-950">
              <Layers className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[10px]">Usage</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2.5 w-full text-white bg-zinc-900/30 border-l border-[#ef4444] rounded-r-sm" href="/agents">
            <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
              <Cpu className="w-3.5 h-3.5 text-[#ef4444]" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[10px] font-bold">Hosted Agents</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2.5 w-full text-zinc-400 hover:text-white hover:bg-zinc-900/50 transition-all group rounded-sm" href="/docs">
            <span className="border border-zinc-900 p-1 group-hover:border-zinc-700 transition-colors flex items-center justify-center bg-zinc-950">
              <FileText className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[10px]">Docs</span>
          </Link>

          {user?.role === 'admin' && (
            <Link className="flex items-center gap-3 px-3 py-2.5 w-full text-zinc-400 hover:text-white hover:bg-zinc-900/50 transition-all group rounded-sm" href="/admin">
              <span className="border border-zinc-900 p-1 group-hover:border-zinc-700 transition-colors flex items-center justify-center bg-zinc-950">
                <Shield className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white" />
              </span>
              <span className="tracking-widest font-mono uppercase text-[10px]">Admin Panel</span>
            </Link>
          )}
        </div>

        <div className="px-6 mt-auto">
          <div className="font-mono text-[9px] text-zinc-600 mb-2 flex justify-between tracking-tighter border-b border-zinc-900 pb-2">
            <span>[SYS_SESSION]</span>
            <span className="text-emerald-500 uppercase font-bold">{usage?.tier || 'FREE'}</span>
          </div>
          <button 
            onClick={signOut}
            className="w-full bg-zinc-950 border border-zinc-900 text-zinc-400 font-mono text-[10px] py-3 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white transition-all flex items-center justify-center gap-2 group crosshair-corners"
          >
            <LogOut className="w-3.5 h-3.5 group-hover:text-[#ef4444] transition-colors" />
            <span className="tracking-widest uppercase font-bold">Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Mobile Drawer Menu */}
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
                <Terminal className="w-3.5 h-3.5 text-zinc-500" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Telemetry</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/keys"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <KeyRound className="w-3.5 h-3.5 text-zinc-500" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">API Keys</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/usage"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <Layers className="w-3.5 h-3.5 text-zinc-500" />
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
              <span className="tracking-widest font-mono uppercase text-xs font-bold">Hosted Agents</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/docs"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-zinc-500" />
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
                  <Shield className="w-3.5 h-3.5 text-zinc-500" />
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
              <LogOut className="w-4 h-4 text-zinc-500" />
              <span className="tracking-widest uppercase font-bold">Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 w-full relative animate-fade-in">
        
        {/* Top Header App Bar */}
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
            <div className={`hidden sm:flex items-center gap-2 border border-zinc-900 bg-[#0e0e10] px-3 py-1.5 text-zinc-400 ${!user ? 'animate-pulse' : ''}`}>
              <span className="text-zinc-600">[USER]:</span>
              <span className="text-white font-semibold">{user ? user.email : 'CONNECTING...'}</span>
            </div>
          </div>
        </header>

        {/* Canvas Body */}
        <main className="flex-1 p-6 grid-bg relative">
          
          {error && (
            <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] text-[11px] font-mono text-[#ef4444] flex items-center gap-2 rounded-sm border-l-2">
              <AlertCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
              <span className="uppercase">{error}</span>
            </div>
          )}

          {/* SKELETON SUSPENSE LOADER (Initial fetch loader) */}
          {loading ? (
            <HostedAgentsSkeleton />
          ) : user && !user.openclaw_enabled ? (
            <div className="col-span-12 max-w-2xl mx-auto my-12 tech-border bg-[#0e0e10]/90 p-8 border-t-2 border-t-[#ef4444] crosshair-corners space-y-6 text-center animate-fade-in red-glow">
              <div className="w-16 h-16 border border-[#ef4444]/40 bg-[#ef4444]/5 flex items-center justify-center red-glow mx-auto mb-6 rounded-sm">
                <Shield className="w-8 h-8 text-[#ef4444]" />
              </div>
              
              <div className="space-y-2">
                <h2 className="font-mono text-base text-white tracking-[0.2em] uppercase font-bold">
                  Hosted Agents Feature Locked
                </h2>
                <p className="text-[10px] font-mono text-zinc-550 uppercase">
                  Subscription Tier: <span className="text-[#ef4444] font-bold">{user.tier || 'FREE'}</span>
                </p>
              </div>

              <p className="text-xs font-mono text-zinc-400 max-w-md mx-auto leading-relaxed uppercase">
                Daytona VM sandbox provisioning, autonomous agent hosting, and platform channel integrations are restricted to upgraded subscribers. Upgrading unlocks dedicated virtualization resources, custom VM specs, and multiple agent instances.
              </p>

              <div className="pt-4 border-t border-zinc-900 max-w-md mx-auto space-y-4">
                <div className="grid grid-cols-2 gap-4 font-mono text-[10px]">
                  <div className="border border-zinc-900 bg-[#050507] p-3 rounded-sm text-left">
                    <span className="text-zinc-550 block mb-1">PRO FEATURES</span>
                    <span className="text-white font-bold block">1 ACTIVE VM AGENT</span>
                    <span className="text-zinc-400">1 CPU · 2GB RAM</span>
                  </div>
                  <div className="border border-zinc-900 bg-[#050507] p-3 rounded-sm text-left">
                    <span className="text-zinc-550 block mb-1">ENTERPRISE FEATURES</span>
                    <span className="text-white font-bold block">5 ACTIVE VM AGENTS</span>
                    <span className="text-zinc-400">2 CPU · 4GB RAM</span>
                  </div>
                </div>

                <Link
                  href="/usage"
                  className="w-full bg-[#ef4444] text-white font-mono text-xs font-bold py-3 hover:bg-[#d83f3f] transition-all flex items-center justify-center gap-2 red-glow rounded-sm border border-[#ef4444]/40 flex items-center justify-center"
                >
                  <Sparkles className="w-4 h-4 text-white" />
                  <span>UPGRADE ACCOUNT SUBSCRIPTION</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-6">
              
              {/* Left Column: Creator Wizard OR Running Dashboard */}
              <div className="col-span-12 lg:col-span-8 space-y-6">
                
                {/* DEPLOY WIZARD STEPPER */}
                {wizardStep !== null && !isEditingChannels && (
                  <div className="border border-zinc-900 bg-[#0e0e10]/60 p-4 rounded-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono text-[10px]">
                    <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                      <div className={`flex items-center gap-2 transition-all ${wizardStep === 'details' ? 'text-[#ef4444] font-bold scale-[1.02]' : 'text-zinc-650'}`}>
                        <span className={`w-5 h-5 border flex items-center justify-center rounded-full text-[9px] transition-colors ${wizardStep === 'details' ? 'border-[#ef4444] bg-[#ef4444]/10 text-white red-glow' : 'border-zinc-800'}`}>1</span>
                        <span className="uppercase tracking-widest">Instance Details</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-800 hidden sm:block" />
                      <div className={`flex items-center gap-2 transition-all ${wizardStep === 'provisioning' ? 'text-[#ef4444] font-bold scale-[1.02]' : 'text-zinc-650'}`}>
                        <span className={`w-5 h-5 border flex items-center justify-center rounded-full text-[9px] transition-colors ${wizardStep === 'provisioning' ? 'border-[#ef4444] bg-[#ef4444]/10 text-white red-glow' : 'border-zinc-800'}`}>2</span>
                        <span className="uppercase tracking-widest">VM Provisioning</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-800 hidden sm:block" />
                      <div className={`flex items-center gap-2 transition-all ${wizardStep === 'channels' ? 'text-[#ef4444] font-bold scale-[1.02]' : 'text-zinc-650'}`}>
                        <span className={`w-5 h-5 border flex items-center justify-center rounded-full text-[9px] transition-colors ${wizardStep === 'channels' ? 'border-[#ef4444] bg-[#ef4444]/10 text-white red-glow' : 'border-zinc-800'}`}>3</span>
                        <span className="uppercase tracking-widest">Platform Bindings</span>
                      </div>
                    </div>
                    <div className="text-zinc-650 uppercase text-[9px] border-t border-zinc-900 pt-2 sm:border-0 sm:pt-0">
                      DEPLOY_PIPELINE_v1.2
                    </div>
                  </div>
                )}

                {/* STEP 1: Creator Wizard - Instance Details */}
                {wizardStep === 'details' && (
                  <div className="tech-border bg-[#0e0e10] p-6 sm:p-8 border-t-2 border-t-[#ef4444]/60 crosshair-corners space-y-6 animate-fade-in">
                    <div className="space-y-2 text-center max-w-lg mx-auto">
                      <div className="w-12 h-12 border border-[#ef4444]/40 bg-[#ef4444]/5 flex items-center justify-center red-glow mx-auto mb-4 rounded-sm">
                        <Cpu className="w-6 h-6 text-[#ef4444]" />
                      </div>
                      <h2 className="font-mono text-sm text-white tracking-[0.2em] uppercase font-bold">
                        Deploy Hosted OpenClaw Agent
                      </h2>
                      <p className="text-[10px] font-mono text-zinc-550 uppercase">
                        Provision a dedicated Daytona sandbox ({user?.agent_cpu || 1} CPU, {user?.agent_ram || 1}GB RAM, 3GB Disk) to host your autonomous model gateway.
                      </p>
                    </div>

                    <div className="max-w-md mx-auto pt-6 border-t border-zinc-900/60 space-y-4">
                      
                      {/* Name Input */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Agent Instance Name</label>
                        <input
                          type="text"
                          value={newAgentName}
                          onChange={(e) => setNewAgentName(e.target.value)}
                          placeholder="e.g. MyOpenClaw"
                          className="w-full border border-zinc-800 bg-[#050507] px-4 py-2.5 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                        />
                      </div>

                      {/* Model Selector */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Gateway Model Target</label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="w-full border border-zinc-800 bg-[#050507] px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                        >
                          <option value="akarouter-pro">akarouter-pro (Step-3.7-Flash)</option>
                          <option value="akarouter-flash">akarouter-flash (Nemotron-3-Ultra)</option>
                          <option value="akarouter-large">akarouter-large (Owl-Alpha)</option>
                        </select>
                      </div>

                      {/* API Key Selector */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">AkaRouter API Key Binding</label>
                        <select
                          value={selectedKeyId}
                          onChange={(e) => {
                            setSelectedKeyId(e.target.value)
                            if (e.target.value !== 'new') {
                              setShowRawKeyInput(true)
                            } else {
                              setShowRawKeyInput(false)
                              setRawKeyInput('')
                            }
                          }}
                          className="w-full border border-zinc-800 bg-[#050507] px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                        >
                          <option value="new">[+] GENERATE & USE DEDICATED API KEY (RECOMMENDED)</option>
                          {loadingKeys ? (
                            <option disabled>LOADING_KEYS...</option>
                          ) : (
                            userKeys.map((key) => (
                              <option key={key.id} value={key.id}>
                                {key.key_name} ({key.key_prefix}...)
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      {/* Raw API Key Input Password Field */}
                      {showRawKeyInput && (
                        <div className="space-y-1.5 p-4 border border-zinc-900 bg-[#050507] rounded-sm animate-fade-in">
                          <label className="text-[9px] font-mono text-[#ef4444] uppercase flex items-center gap-1.5 font-bold">
                            <Lock className="w-3.5 h-3.5 text-[#ef4444]" />
                            <span>Paste Raw API Key String</span>
                          </label>
                          <input
                            type="password"
                            value={rawKeyInput}
                            onChange={(e) => setRawKeyInput(e.target.value)}
                            placeholder="akar_..."
                            className="w-full border border-zinc-850 bg-[#09090b] px-4 py-2 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                          />
                          <p className="text-[8px] font-mono text-zinc-600 uppercase leading-relaxed">
                            Required: Since AkaRouter keys are stored as cryptographically secure hashes, we require you to paste the raw key to link it to the VM.
                          </p>
                        </div>
                      )}

                      {/* Trigger Button */}
                      <button
                        onClick={handleDeploy}
                        disabled={deploying}
                        className="w-full bg-[#ef4444] text-white font-mono text-xs font-bold py-3 hover:bg-[#d83f3f] transition-all flex items-center justify-center gap-2 red-glow rounded-sm mt-4 border border-[#ef4444]/40"
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

                      {agents.length > 0 && (
                        <button
                          onClick={() => setWizardStep(null)}
                          className="w-full bg-transparent border border-zinc-800 text-zinc-400 hover:text-white font-mono text-[10px] py-2 transition-colors uppercase rounded-sm"
                        >
                          Cancel and Go to Dashboard
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* STEP 2: Creator Wizard - Provisioning Terminal */}
                {wizardStep === 'provisioning' && (
                  <div className="tech-border bg-[#050507] p-6 font-mono text-[11px] space-y-4 crosshair-corners border-[#ef4444]/30 red-glow animate-fade-in">
                    <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-[#ef4444] status-pulse red-glow"></div>
                        <span className="text-white uppercase font-bold tracking-wider">VM_PROVISIONING_PIPELINE</span>
                      </div>
                      <span className="text-zinc-600">STEP_{progressStep + 1}/5</span>
                    </div>
                    
                    {/* Simulated loading bar */}
                    <div className="w-full h-1 bg-zinc-900 rounded-sm overflow-hidden">
                      <div 
                        className="h-full bg-[#ef4444] red-glow transition-all duration-500"
                        style={{ width: `${(progressStep + 1) * 20}%` }}
                      ></div>
                    </div>
                    
                    <div className="bg-[#09090b] border border-zinc-900 p-4 rounded-sm space-y-1.5 h-64 overflow-y-auto custom-scrollbar text-zinc-400">
                      {progressLogs.map((log, idx) => (
                        <div key={idx} className="flex gap-4">
                          <span className="text-zinc-650 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                          <span className={idx === progressLogs.length - 1 ? "text-[#ef4444] font-bold" : "text-zinc-300"}>{log}</span>
                        </div>
                      ))}
                      <div className="animate-pulse text-zinc-600 mt-2 font-bold flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin text-[#ef4444]" />
                        <span>PIPELINE_ACTIVE_STREAMING_LOGS...</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-zinc-600 border-t border-zinc-900 pt-3 uppercase">
                      <span>HOST: Daytona Client v1.2</span>
                      <span className="animate-spin text-zinc-550"><RefreshCw className="w-3 h-3" /></span>
                    </div>
                  </div>
                )}

                {/* STEP 3: Creator Wizard / Channel Editor - Platforms */}
                {wizardStep === 'channels' && configuringAgentId && (
                  <div className="tech-border bg-[#0e0e10] p-6 sm:p-8 crosshair-corners border-t-2 border-t-[#ef4444]/60 space-y-6 animate-fade-in">
                    <div className="space-y-1 border-b border-zinc-900 pb-3 flex justify-between items-center">
                      <div>
                        <h2 className="font-mono text-xs text-white tracking-[0.2em] uppercase font-bold flex items-center gap-2">
                          <Bot className="w-4 h-4 text-[#ef4444]" />
                          {isEditingChannels ? 'CONFIGURE PLATFORM BINDINGS' : 'STEP 3: PLATFORM BINDINGS'}
                        </h2>
                        <p className="text-[9px] font-mono text-zinc-500 uppercase">Bind external chat providers to your running agent VM daemon.</p>
                      </div>
                      {isEditingChannels && (
                        <button 
                          onClick={() => {
                            setConfiguringAgentId(null)
                            setWizardStep(null)
                          }}
                          className="p-1 border border-zinc-800 text-zinc-500 hover:text-white bg-zinc-950 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-5">
                      
                      {/* Telegram Configuration Card */}
                      <div className="border border-zinc-900 bg-[#050507]/60 p-4 rounded-sm space-y-3 hover:border-zinc-800 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Enable Telegram Bot Integration</span>
                          </div>
                          <input 
                            type="checkbox" 
                            checked={tgEnabled}
                            onChange={(e) => setTgEnabled(e.target.checked)}
                            className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] focus:ring-0 cursor-pointer accent-[#ef4444]"
                          />
                        </div>

                        {tgEnabled && (
                          <div className="space-y-3 pt-3 border-t border-zinc-900 animate-fade-in">
                            <div className="space-y-1">
                              <label className="text-[9px] font-mono text-zinc-550 uppercase">Bot API Token</label>
                              <div className="relative">
                                <input
                                  type={showTgToken ? "text" : "password"}
                                  value={tgToken}
                                  onChange={(e) => setTgToken(e.target.value)}
                                  placeholder={isEditingChannels ? "••••••••••••••••••••••••••••••••" : "Paste token from Telegram BotFather"}
                                  className="w-full border border-zinc-800 bg-[#050507] pl-4 pr-10 py-2 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                                />
                                <button 
                                  type="button"
                                  onClick={() => setShowTgToken(!showTgToken)}
                                  className="absolute right-3 top-2.5 text-zinc-550 hover:text-white transition-colors"
                                >
                                  {showTgToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] font-mono text-zinc-550 uppercase">Allowed User IDs (Optional)</label>
                              <input
                                  type="text"
                                  value={tgAllowFrom}
                                  onChange={(e) => setTgAllowFrom(e.target.value)}
                                  placeholder="Comma-separated IDs e.g. 123456,78910"
                                  className="w-full border border-zinc-800 bg-[#050507] px-4 py-2 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                              />
                              <p className="text-[8px] font-mono text-zinc-600 leading-relaxed uppercase">
                                Highly Recommended: Restricts agent control to your specific numeric user ID.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Discord Configuration Card */}
                      <div className="border border-zinc-900 bg-[#050507]/60 p-4 rounded-sm space-y-3 hover:border-zinc-800 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Enable Discord Bot Integration</span>
                          <input 
                            type="checkbox" 
                            checked={discordEnabled}
                            onChange={(e) => setDiscordEnabled(e.target.checked)}
                            className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] focus:ring-0 cursor-pointer accent-[#ef4444]"
                          />
                        </div>

                        {discordEnabled && (
                          <div className="space-y-3 pt-3 border-t border-zinc-900 animate-fade-in">
                            <div className="space-y-1">
                              <label className="text-[9px] font-mono text-zinc-550 uppercase">Bot Token</label>
                              <div className="relative">
                                <input
                                  type={showDiscordToken ? "text" : "password"}
                                  value={discordToken}
                                  onChange={(e) => setDiscordToken(e.target.value)}
                                  placeholder={isEditingChannels ? "••••••••••••••••••••••••••••••••" : "Paste token from Discord developer portal"}
                                  className="w-full border border-zinc-800 bg-[#050507] pl-4 pr-10 py-2 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                                />
                                <button 
                                  type="button"
                                  onClick={() => setShowDiscordToken(!showDiscordToken)}
                                  className="absolute right-3 top-2.5 text-zinc-550 hover:text-white transition-colors"
                                >
                                  {showDiscordToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] font-mono text-zinc-550 uppercase">Guild Allowed channels JSON (Optional)</label>
                              <textarea
                                value={discordGuildsJson}
                                onChange={(e) => setDiscordGuildsJson(e.target.value)}
                                rows={3}
                                className="w-full border border-zinc-800 bg-[#050507] p-3 text-xs text-zinc-300 focus:outline-none focus:border-[#ef4444]/50 transition-colors font-mono rounded-sm"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-zinc-900/60">
                        <button
                          onClick={() => {
                            setWizardStep(null)
                            setConfiguringAgentId(null)
                          }}
                          className="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white font-mono text-xs font-bold py-3 transition-colors uppercase rounded-sm"
                        >
                          {isEditingChannels ? 'Cancel' : 'Skip & Finish'}
                        </button>
                        
                        <button
                          onClick={handleSaveChannels}
                          disabled={configuring}
                          className="flex-1 bg-[#ef4444] text-white font-mono text-xs font-bold py-3 hover:bg-[#d83f3f] transition-all flex items-center justify-center gap-2 red-glow rounded-sm border border-[#ef4444]/40"
                        >
                          {configuring ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>APPLYING_Platform_Bindings...</span>
                            </>
                          ) : (
                            <span>{isEditingChannels ? 'Apply Changes' : 'Apply & Finish'}</span>
                          )}
                        </button>
                      </div>

                    </div>
                  </div>
                )}

                {/* RUNNING AGENTS DASHBOARD */}
                {wizardStep === null && agents.length > 0 && (
                  <div className="space-y-6">
                    
                    <div className="flex justify-between items-center">
                      <h2 className="font-mono text-xs text-zinc-400 flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                        <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                        ACTIVE_AGENTS_TELEMETRY ({agents.length})
                      </h2>
                      
                      <button
                        onClick={() => {
                          setNewAgentName('')
                          setSelectedModel('akarouter-pro')
                          setSelectedKeyId('new')
                          setRawKeyInput('')
                          setShowRawKeyInput(false)
                          setWizardStep('details')
                        }}
                        className="border border-zinc-800 bg-[#0e0e10] hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-white font-mono text-[10px] py-2 px-4 transition-all uppercase rounded-sm crosshair-corners"
                      >
                        [+] Deploy New Agent
                      </button>
                    </div>

                    {agents.map((agent) => (
                      <div key={agent.id} className="tech-border bg-[#0e0e10]/80 p-6 crosshair-corners space-y-6 relative hover:bg-[#0e0e10] transition-colors">
                        
                        {/* Agent Summary Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-3">
                              <h3 className="font-mono text-sm font-bold text-white uppercase tracking-wider">{agent.agent_name}</h3>
                              <span className={`text-[9px] px-2.5 py-0.5 font-mono border uppercase tracking-widest rounded-sm ${
                                agent.status === 'running' 
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 red-glow status-pulse'
                                  : agent.status === 'failed'
                                  ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]'
                                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400 animate-pulse'
                              }`}>
                                {agent.status}
                              </span>
                            </div>
                            <p className="text-[10px] font-mono text-zinc-550">
                              SANDBOX_ID: <code className="text-zinc-400 font-bold">{agent.sandbox_id || 'RESOLVING_VM...'}</code>
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono border border-zinc-900 bg-[#050507] px-3 py-1.5 text-zinc-500 rounded-sm">
                              {agent.agent_cpu || 1} CPU · {agent.agent_ram || 1}GB RAM · 3GB Disk
                            </span>
                            <span className="text-[10px] font-mono border border-zinc-900 bg-[#050507] px-3 py-1.5 text-zinc-400 uppercase font-bold rounded-sm">
                              {agent.model_name}
                            </span>
                          </div>
                        </div>

                        {/* Configured Integrations Overview */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          
                          {/* Telegram panel status */}
                          <div className="border border-zinc-900 bg-[#050507]/50 p-4 space-y-3 rounded-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest font-bold">Telegram channel</span>
                              <span className={`w-2 h-2 rounded-full ${agent.telegram_enabled ? 'bg-emerald-500 red-glow status-pulse' : 'bg-zinc-850'}`}></span>
                            </div>
                            <div className="space-y-1 font-mono text-[10px] text-zinc-550 uppercase">
                              <div>STATUS: <span className={agent.telegram_enabled ? "text-emerald-450 font-bold" : "text-zinc-650"}>{agent.telegram_enabled ? "CONNECTED" : "DISABLED"}</span></div>
                              {agent.telegram_enabled && (
                                <div>ALLOW_FROM: <span className="text-zinc-400 font-bold">{agent.telegram_allow_from || "ANYONE"}</span></div>
                              )}
                            </div>
                          </div>

                          {/* Discord panel status */}
                          <div className="border border-zinc-900 bg-[#050507]/50 p-4 space-y-3 rounded-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest font-bold">Discord channel</span>
                              <span className={`w-2 h-2 rounded-full ${agent.discord_enabled ? 'bg-emerald-500 red-glow status-pulse' : 'bg-zinc-850'}`}></span>
                            </div>
                            <div className="space-y-1 font-mono text-[10px] text-zinc-550 uppercase">
                              <div>STATUS: <span className={agent.discord_enabled ? "text-emerald-450 font-bold" : "text-zinc-650"}>{agent.discord_enabled ? "CONNECTED" : "DISABLED"}</span></div>
                            </div>
                          </div>

                        </div>

                        {/* Agent Fail banner */}
                        {agent.status === 'failed' && agent.error_message && (
                          <div className="p-4 bg-[#ef4444]/5 border border-[#ef4444]/20 text-[10px] font-mono text-[#ef4444] space-y-1.5 rounded-sm border-l-2">
                            <div className="font-bold uppercase flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> CRITICAL_SANDBOX_FAILURE:</div>
                            <div className="break-all font-bold">{agent.error_message}</div>
                          </div>
                        )}

                        {/* Action buttons footer */}
                        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-900 pt-4">
                          
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => startConfiguring(agent)}
                              disabled={agent.status !== 'running'}
                              className="bg-zinc-950 border border-zinc-850 hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-white font-mono text-[10px] py-2 px-4 transition-all uppercase flex items-center gap-1.5 rounded-sm"
                            >
                              <Settings className="w-3.5 h-3.5 text-zinc-400" />
                              <span>Configure Channels</span>
                            </button>

                            <button
                              onClick={() => setActiveLogsAgentId(activeLogsAgentId === agent.id ? null : agent.id)}
                              disabled={agent.status !== 'running'}
                              className={`border font-mono text-[10px] py-2 px-4 transition-all uppercase flex items-center gap-1.5 rounded-sm ${
                                activeLogsAgentId === agent.id
                                  ? 'border-[#ef4444] bg-[#ef4444]/10 text-white red-glow font-bold'
                                  : 'bg-zinc-950 border-zinc-850 hover:border-zinc-500 text-zinc-400'
                              }`}
                            >
                              <Terminal className="w-3.5 h-3.5" />
                              <span>Telemetry Log</span>
                            </button>
                          </div>

                          <button
                            onClick={() => handleDestroy(agent.id)}
                            disabled={agent.status === 'destroying'}
                            className="bg-zinc-950 border border-zinc-900 hover:border-[#ef4444] hover:bg-[#ef4444]/10 text-zinc-550 hover:text-white font-mono text-[10px] py-2 px-4 transition-all uppercase flex items-center gap-1.5 rounded-sm"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-zinc-650" />
                            <span>{agent.status === 'destroying' ? 'Destroying...' : 'Destroy VM'}</span>
                          </button>

                        </div>

                        {/* Realtime Terminal Console Output */}
                        {activeLogsAgentId === agent.id && (
                          <div className="tech-border bg-[#050507] p-4 font-mono text-[10px] space-y-2 border-zinc-850 rounded-sm animate-fade-in">
                            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                              <span className="text-zinc-550 uppercase tracking-widest font-bold flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5 text-emerald-500" /> OpenClaw Console Logs</span>
                              
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(logsText)
                                    setCopiedLogs(true)
                                    setTimeout(() => setCopiedLogs(false), 2000)
                                  }}
                                  className="text-zinc-550 hover:text-white uppercase text-[9px] underline transition-colors"
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
                                  className="text-zinc-550 hover:text-white transition-colors"
                                  title="Force refresh logs"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                                </button>
                              </div>
                            </div>
                            <pre className="p-3.5 bg-[#09090b] border border-zinc-900 text-zinc-400 overflow-x-auto whitespace-pre h-56 custom-scrollbar text-[9px] leading-relaxed rounded-sm font-bold">
                              {logsText}
                            </pre>
                          </div>
                        )}

                      </div>
                    ))}

                  </div>
                )}

              </div>

              {/* Right Column: Platform Integration Guides */}
              <div className="col-span-12 lg:col-span-4 space-y-6">
                
                <div className="tech-border bg-[#0e0e10]/60 p-6 crosshair-corners space-y-6 hover:bg-[#0e0e10] transition-all">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white tracking-[0.2em] uppercase font-bold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#ef4444]" />
                      INTEGRATION_GUIDES
                    </h2>
                    <p className="text-[9px] font-mono text-zinc-500 uppercase">Step-by-step connection tutorials.</p>
                  </div>

                  <div className="space-y-3">
                    
                    {/* Telegram collapsible guide */}
                    <div className="border border-zinc-900/80 bg-zinc-950/20 rounded-sm">
                      <button
                        onClick={() => setOpenGuide(openGuide === 'telegram' ? null : 'telegram')}
                        className="w-full flex items-center justify-between p-4 font-mono text-[10px] text-zinc-400 uppercase tracking-widest bg-[#050507]/50 hover:text-white transition-colors"
                      >
                        <span>Telegram Bot Onboarding</span>
                        {openGuide === 'telegram' ? <ChevronUp className="w-3.5 h-3.5 text-[#ef4444]" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      
                      {openGuide === 'telegram' && (
                        <div className="p-4 border-t border-zinc-900 font-mono text-[9px] text-zinc-400 space-y-3.5 leading-relaxed animate-fade-in uppercase">
                          <p>1. Open Telegram and search for <strong className="text-white">@BotFather</strong>.</p>
                          <p>2. Send the command <code className="text-[#ef4444]">/newbot</code> and choose a name and username.</p>
                          <p>3. Copy the generated <strong className="text-white">API Token</strong> (e.g. <code className="text-zinc-350 select-all font-bold">12345678:AAF...</code>).</p>
                          <p>4. To lock access to yourself, find your personal ID using <strong className="text-white">@UserInfoBot</strong>.</p>
                          <p>5. Click "Configure Channels" on your agent, turn on Telegram, and paste your Bot Token and User ID.</p>
                        </div>
                      )}
                    </div>

                    {/* Discord collapsible guide */}
                    <div className="border border-zinc-900/80 bg-zinc-950/20 rounded-sm">
                      <button
                        onClick={() => setOpenGuide(openGuide === 'discord' ? null : 'discord')}
                        className="w-full flex items-center justify-between p-4 font-mono text-[10px] text-zinc-400 uppercase tracking-widest bg-[#050507]/50 hover:text-white transition-colors"
                      >
                        <span>Discord Bot Onboarding</span>
                        {openGuide === 'discord' ? <ChevronUp className="w-3.5 h-3.5 text-[#ef4444]" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      
                      {openGuide === 'discord' && (
                        <div className="p-4 border-t border-zinc-900 font-mono text-[9px] text-zinc-400 space-y-3.5 leading-relaxed animate-fade-in uppercase">
                          <p>1. Open <strong className="text-white">Discord Developer Portal</strong> and create an Application.</p>
                          <p>2. Under "Bot" tab, click "Add Bot" and copy the <strong className="text-white">Bot Token</strong>.</p>
                          <p>3. Turn on "Privileged Gateway Intents" (specifically <strong className="text-white">Message Content Intent</strong>).</p>
                          <p>4. Go to "OAuth2" &rarr; "URL Generator", select <code className="text-[#ef4444]">bot</code> scope, check <code className="text-[#ef4444]">Send Messages</code> and invite it to your guild.</p>
                          <p>5. Configure Discord bindings on your agent with this token.</p>
                        </div>
                      )}
                    </div>

                  </div>
                </div>

              </div>

            </div>
          )}

        </main>
      </div>

    </div>
  )
}
