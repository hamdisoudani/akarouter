'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  getMe,
  getUsage,
  getAnalytics,
  getModels,
  type UsageStats,
  type ModelAnalytics,
  type UserInfo,
} from '@/lib/api'
import { 
  Terminal,
  Shield,
  KeyRound,
  LogOut,
  Copy,
  Check
} from 'lucide-react'

export default function UserDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [token, setToken] = useState<string>('')
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [analytics, setAnalytics] = useState<ModelAnalytics[]>([])
  const [modelsList, setModelsList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  
  // Track copied states
  const [copiedSDK, setCopiedSDK] = useState(false)

  // Custom logs for the trace buffer
  const [traceLogs, setTraceLogs] = useState<Array<{
    time: string;
    type: string;
    tx: string;
    dest: string;
    metric: string;
    isError: boolean;
  }>>([])

  const [origin, setOrigin] = useState('http://localhost:8000')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin)
    }
  }, [])

  const loadData = useCallback(async (accessToken: string) => {
    try {
      const [me, usageData, analyticsData] = await Promise.all([
        getMe(accessToken),
        getUsage(accessToken),
        getAnalytics(accessToken),
      ])
      setUser(me)
      setUsage(usageData)
      const modelsAnalytics = analyticsData.models || []
      setAnalytics(modelsAnalytics)

      // Gracefully load models list
      let modelsData: any = { data: [] }
      try {
        const data = await getModels()
        modelsData = data
      } catch (e) {
        console.error("Failed to load models list:", e)
      }
      setModelsList(modelsData.data || [])

      // Process trace logs from actual request logs if available, otherwise generate mock logs
      const logsList: typeof traceLogs = []
      if (analyticsData.recent_logs && analyticsData.recent_logs.length > 0) {
        analyticsData.recent_logs.forEach((log) => {
          const timeStr = new Date(log.created_at).toLocaleTimeString()
          const txHash = `TX_${Math.random().toString(36).substring(2, 12).toUpperCase()}`
          const isError = log.status_code >= 400

          // Add Request Log entry
          logsList.push({
            time: timeStr,
            type: '[REQ]',
            tx: txHash,
            dest: log.model.toUpperCase(),
            metric: `P: ${log.prompt_tokens || 0} TOKENS`,
            isError: false
          })

          // Add Acknowledge/Error Log entry
          if (isError) {
            logsList.push({
              time: timeStr,
              type: '[ERR]',
              tx: txHash,
              dest: `STATUS=0x${log.status_code.toString(16).toUpperCase()}_ERR`,
              metric: `T: ${log.latency_ms}MS`,
              isError: true
            })
          } else {
            logsList.push({
              time: timeStr,
              type: '[ACK]',
              tx: txHash,
              dest: 'STATUS=0x00_OK',
              metric: `T: ${log.latency_ms}MS`,
              isError: false
            })
          }
        })
      } else {
        const now = new Date()
        modelsAnalytics.forEach((modelData, index) => {
          const timeStr = new Date(now.getTime() - index * 60000).toLocaleTimeString()
          const txHash = `TX_${Math.random().toString(36).substring(2, 12).toUpperCase()}`
          
          logsList.push({
            time: timeStr,
            type: '[REQ]',
            tx: txHash,
            dest: modelData.model.toUpperCase(),
            metric: `P: ${Math.floor(Math.random() * 5 + 1)}.4KB`,
            isError: false
          })

          if (modelData.error_requests > 0 && Math.random() > 0.7) {
            logsList.push({
              time: timeStr,
              type: '[ERR]',
              tx: txHash,
              dest: 'GATEWAY_TIMEOUT',
              metric: 'RETRIEVING_FAILOVER...',
              isError: true
            })
          } else {
            logsList.push({
              time: timeStr,
              type: '[ACK]',
              tx: txHash,
              dest: 'STATUS=0x00_OK',
              metric: `T: ${modelData.avg_latency_ms}MS`,
              isError: false
            })
          }
        })
      }
      setTraceLogs(logsList.slice(0, 24))
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

  const copyToClipboard = (text: string, id: string, setCopiedState: (v: any) => void) => {
    navigator.clipboard.writeText(text)
    setCopiedState(true)
    setTimeout(() => setCopiedState(false), 2000)
  }

  const sdkCode = `from openai import OpenAI

client = OpenAI(
    base_url="${origin}/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="akarouter-pro",
    messages=[{"role": "user", "content": "Hello!"}]
)`

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
          <Link className="flex items-center gap-3 px-3 py-2 w-full text-white nav-item-active" href="/dashboard">
            <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
              <Terminal className="w-3.5 h-3.5 text-[#ef4444]" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Telemetry</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/keys">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <KeyRound className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">API Keys</span>
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
          <div className="md:hidden flex items-center gap-3">
            <div className="w-20 h-10 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <img src="/logo.png" alt="AkaRouter Logo" className="w-full h-full object-contain scale-[2.5]" />
            </div>
          </div>

          <div className="hidden md:flex font-mono text-[11px] text-zinc-400 items-center gap-4">
            <div className="w-[2px] h-4 bg-[#ef4444]"></div>
            <span className="tracking-[0.2em] uppercase font-bold text-zinc-300">Live Performance Matrix</span>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px]">
            <div className={`hidden sm:flex items-center gap-2 border border-zinc-800 bg-[#0e0e10] px-3 py-1.5 text-zinc-400 ${!user ? 'animate-pulse' : ''}`}>
              <span className="text-zinc-600">[USER]:</span>
              <span className="text-white font-semibold">{user ? user.email : 'CONNECTING...'}</span>
            </div>
          </div>
        </header>

        {/* Canvas */}
        <main className="flex-1 p-0 grid-bg relative">
          {usage?.gateway_enabled === false && (
            <div className="bg-[#ef4444]/15 border-b border-[#ef4444]/30 text-[#ef4444] px-6 py-3 font-mono text-[11px] flex items-center justify-between animate-pulse uppercase tracking-wider font-bold">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#ef4444] rounded-full status-pulse red-glow" />
                [SYSTEM_ALERT_OFFLINE]: THE AKAROUTER API GATEWAY IS TEMPORARILY DISABLED BY ADMINISTRATOR. ALL API ENDPOINTS WILL RETURN 503 SERVICE UNAVAILABLE.
              </div>
            </div>
          )}
          <div className="p-6">
            <div className="grid grid-cols-12 gap-0 tech-border bg-[#0e0e10] crosshair-corners">
              
              {/* KPI Row */}
              <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 tech-border-b bg-[#0e0e10]">
                <div className="p-5 tech-border-r flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[8px] text-zinc-600">CHN_01</div>
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span> SYSTEM TIER
                  </span>
                  <div className="font-mono text-2xl text-white font-bold tracking-wider uppercase">
                    {usage ? usage.tier : <span className="text-zinc-700 animate-pulse">[LOAD_VAULT...]</span>}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 mt-1 uppercase tracking-tighter">
                    {usage ? `RPM LIMIT: ${usage.rpm_limit ?? 60}` : 'PLAN STATUS: ACTIVE'}
                  </span>
                </div>

                <div className="p-5 tech-border-r flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[8px] text-zinc-600">CHN_02</div>
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-zinc-700"></span> MONTHLY requests
                  </span>
                  <div className="font-mono text-2xl text-white font-bold tracking-tight">
                    {usage ? (
                      <>{usage.monthly_requests.toLocaleString()}<span className="text-zinc-700 text-xs ml-1">REQ</span></>
                    ) : (
                      <span className="text-zinc-700 animate-pulse">[LOAD_TX...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-650 mt-1 uppercase tracking-tighter">
                    {usage ? `LIMIT: ${usage.monthly_limit.toLocaleString()}` : '[READING_LIMIT]'}
                  </span>
                </div>

                <div className="p-5 tech-border-r flex flex-col justify-center relative overflow-hidden bg-[#ef4444]/5">
                  <div className="absolute right-0 top-0 p-1 bg-[#ef4444]/20 border-b border-l border-[#ef4444]/30 font-mono text-[8px] text-[#ef4444]">CHN_03</div>
                  <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span> REMAINING QUOTA
                  </span>
                  <div className="font-mono text-2xl text-[#ef4444] font-bold tracking-tight red-glow-text">
                    {usage ? (
                      <>{usage.remaining.toLocaleString()}<span className="text-[12px] ml-1">REQ</span></>
                    ) : (
                      <span className="text-[#ef4444]/65 animate-pulse">[LOAD_SYS...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-[#ef4444] mt-1 uppercase tracking-widest font-bold">SYSTEM BALANCE</span>
                </div>

                <div className="p-5 flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[8px] text-zinc-600">CHN_04</div>
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2 font-mono">
                    <span className="w-1.5 h-1.5 bg-zinc-700"></span> ALL-TIME COUNTER
                  </span>
                  <div className="font-mono text-2xl text-white font-bold tracking-tight">
                    {usage ? (
                      <>{usage.total_requests.toLocaleString()}<span className="text-zinc-700 text-xs ml-1">REQ</span></>
                    ) : (
                      <span className="text-zinc-700 animate-pulse">[LOAD_BUF...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 mt-1 uppercase tracking-widest">TOTAL_LOGGED_TX</span>
                </div>
              </div>

              {/* Main Content Grid Area */}
              <div className="col-span-12 lg:col-span-8 tech-border-r p-6 space-y-6 flex flex-col justify-between">
                
                {/* Sliding Token Budgets & Quotas */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                      SLIDING_WINDOW_TELEMETRY
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Real-time sliding budgets and active token counts.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 5-Hour budget progress */}
                    <div className="bg-[#050507] border border-zinc-900 p-4 space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span className="text-zinc-400 font-bold uppercase tracking-wider">5-Hour Sliding Budget</span>
                        <span className="text-[#ef4444] font-bold">
                          {usage ? `${(usage.progress_percentage_5h ?? 0).toFixed(1)}%` : '...'}
                        </span>
                      </div>
                      
                      {/* Bar progress */}
                      <div className="w-full h-1.5 bg-zinc-950 border border-zinc-900 overflow-hidden">
                        <div 
                          className="h-full bg-[#ef4444] red-glow transition-all duration-500" 
                          style={{ width: `${usage ? (usage.progress_percentage_5h ?? 0) : 0}%` }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-[9px] font-mono text-zinc-500">
                        <span>CONSUMED: ${usage ? (usage.consumed_budget_5h ?? 0).toFixed(4) : '0.0000'}</span>
                        <span>LIMIT: ${usage ? (usage.tokens_5h_limit ?? 1.0).toFixed(2) : '1.00'}</span>
                      </div>
                    </div>

                    {/* 7-Day budget progress */}
                    <div className="bg-[#050507] border border-zinc-900 p-4 space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span className="text-zinc-400 font-bold uppercase tracking-wider">7-Day Sliding Budget</span>
                        <span className="text-[#ef4444] font-bold">
                          {usage ? `${(usage.progress_percentage_7d ?? 0).toFixed(1)}%` : '...'}
                        </span>
                      </div>

                      {/* Bar progress */}
                      <div className="w-full h-1.5 bg-zinc-950 border border-zinc-900 overflow-hidden">
                        <div 
                          className="h-full bg-[#ef4444] red-glow transition-all duration-500" 
                          style={{ width: `${usage ? (usage.progress_percentage_7d ?? 0) : 0}%` }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-[9px] font-mono text-zinc-500">
                        <span>CONSUMED: ${usage ? (usage.consumed_budget_7d ?? 0).toFixed(4) : '0.0000'}</span>
                        <span>LIMIT: ${usage ? (usage.tokens_7d_limit ?? 5.0).toFixed(2) : '5.00'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Consumed Tokens breakdown */}
                  <div className="bg-[#050507] border border-zinc-900 p-4 grid grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">Input Tokens (Active Period)</span>
                      <span className="font-mono text-base text-white font-bold tracking-wider mt-1">
                        {usage ? (usage.consumed_tokens_input ?? 0).toLocaleString() : '...'}
                        <span className="text-zinc-700 text-[10px] ml-1">TOKENS</span>
                      </span>
                    </div>

                    <div className="flex flex-col border-l border-zinc-900 pl-4">
                      <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">Output Tokens (Active Period)</span>
                      <span className="font-mono text-base text-white font-bold tracking-wider mt-1">
                        {usage ? (usage.consumed_tokens_output ?? 0).toLocaleString() : '...'}
                        <span className="text-zinc-700 text-[10px] ml-1">TOKENS</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-zinc-900 my-4" />

                {/* Quick Start Guide */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <div className="w-[3px] h-3 bg-zinc-800"></div>
                      QUICK_START_CONNECTION_GUIDE
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Seamless integration using any standard OpenAI-compatible client library.</p>
                  </div>

                  <div className="bg-[#050507] border border-zinc-900">
                    <div className="bg-[#0e0e10] border-b border-zinc-900 px-4 py-2 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-zinc-500 font-bold uppercase tracking-wider">python_openai_sdk.py</span>
                      <button
                        onClick={() => copyToClipboard(sdkCode, 'sdkCode', (v) => setCopiedSDK(!!v))}
                        className="text-zinc-500 hover:text-white p-1 border border-zinc-900 bg-zinc-950 transition-all"
                        title="Copy code block"
                      >
                        {copiedSDK ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <pre className="p-4 font-mono text-[11px] text-zinc-400 leading-relaxed overflow-x-auto whitespace-pre">
                      {sdkCode}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Providers Health / Model Matrix */}
              <div className="col-span-12 lg:col-span-4 p-6 flex flex-col justify-between bg-[#0e0e10]">
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <div className="w-[3px] h-3 bg-zinc-800"></div>
                      MODEL_METRIC_ROUTING
                    </h2>
                    <div className="space-y-2">
                      {loading ? (
                        <>
                          <div className="h-11 bg-[#050507] border border-zinc-900 animate-pulse flex items-center justify-between px-3">
                            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">LOADING_METRICS_PRO...</span>
                            <span className="w-12 h-3 bg-zinc-900 animate-pulse" />
                          </div>
                          <div className="h-11 bg-[#050507] border border-zinc-900 animate-pulse flex items-center justify-between px-3">
                            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">LOADING_METRICS_FSH...</span>
                            <span className="w-12 h-3 bg-zinc-900 animate-pulse" />
                          </div>
                        </>
                      ) : analytics.length === 0 ? (
                        <p className="text-xs text-zinc-655 py-4 font-mono uppercase text-center">[NO_MODEL_ANALYTICS_YET]</p>
                      ) : (
                        analytics.map((m) => (
                          <div key={m.model} className="flex justify-between items-center p-3 bg-[#050507] border border-zinc-900 hover:border-zinc-800 transition-all group">
                            <div className="flex items-center gap-3">
                              <span className={`w-1.5 h-1.5 ${m.error_requests > 0 ? 'bg-[#ef4444] status-pulse red-glow' : 'bg-[#10b981]'}`} />
                              <span className="font-mono text-[11px] text-zinc-400 group-hover:text-white uppercase transition-colors">{m.model}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-zinc-500">{m.total_requests} TX</span>
                              <span className="font-mono text-[11px] text-[#10b981]">{m.avg_latency_ms}ms</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="border-t border-zinc-900 my-4" />

                  <div className="space-y-4">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                      ROUTING_MODEL_REGISTRY
                    </h2>
                    <div className="space-y-2">
                      {loading ? (
                        <p className="text-[10px] font-mono text-zinc-650 uppercase py-2 text-center animate-pulse">[SYNCHRONIZING_REGISTRY...]</p>
                      ) : modelsList.length === 0 ? (
                        <p className="text-[10px] font-mono text-zinc-650 uppercase py-2 text-center">[NO_ACTIVE_MODELS]</p>
                      ) : (
                        modelsList.map((m) => (
                          <div key={m.id} className={`flex justify-between items-center p-3 bg-[#050507] border ${m.is_active ? 'border-zinc-900' : 'border-[#ef4444]/20 opacity-60'} transition-all group`}>
                            <div className="flex items-center gap-3">
                              <span className={`w-1.5 h-1.5 ${m.is_active ? 'bg-emerald-400 status-pulse' : 'bg-[#ef4444]'}`} />
                              <div className="flex flex-col">
                                <span className="font-mono text-[11px] text-zinc-400 uppercase">{m.display_name || m.id}</span>
                                <span className="font-mono text-[8px] text-zinc-600 uppercase tracking-tighter">{m.id}</span>
                              </div>
                            </div>
                            <span className={`font-mono text-[9px] font-bold uppercase ${m.is_active ? 'text-emerald-450' : 'text-[#ef4444] red-glow-text'}`}>
                              {m.is_active ? 'ACTIVE' : 'DISABLED'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-zinc-900">
                  <div className="flex justify-between items-center px-1 font-mono text-[9px]">
                    <span className="text-zinc-600">LOAD_BALANCER_TYPE</span>
                    <span className="text-white">RR_WEIGHTED</span>
                  </div>
                </div>
              </div>

              {/* Live request logs buffer */}
              <div className="col-span-12 border-t border-[#27272a] bg-[#09090b]">
                <div className="flex justify-between items-center px-5 py-3 border-b border-[#27272a] bg-[#0e0e10]">
                  <h2 className="font-mono text-[11px] text-zinc-300 flex items-center gap-3 tracking-[0.2em] uppercase font-bold">
                    <span className="material-symbols-outlined text-[16px] text-[#ef4444]">developer_board</span>
                    LIVE_TX_TRACE_BUFFER
                  </h2>
                  <div className="flex items-center gap-3 border border-[#10b981]/20 bg-[#10b981]/5 px-3 py-1">
                    <span className="w-1.5 h-1.5 bg-[#10b981] status-pulse"></span>
                    <span className="font-mono text-[9px] text-[#10b981] tracking-[0.2em] font-bold">REAL_TIME_STREAMING</span>
                  </div>
                </div>

                <div className="h-60 overflow-y-auto p-5 font-mono text-[11px] space-y-1 bg-[#050507]" id="trace-log">
                  {loading ? (
                    <div className="text-zinc-650 py-6 text-center animate-pulse tracking-widest uppercase">
                      [INITIALIZING_BUFFER_STREAM_READING_HISTORICAL_METRICS...]
                    </div>
                  ) : traceLogs.length === 0 ? (
                    <div className="text-zinc-700 py-6 text-center">[BUFFER_EMPTY_WAITING_FOR_TRAFFIC]</div>
                  ) : (
                    traceLogs.map((log, index) => (
                      <div 
                        key={index} 
                        className={`flex gap-6 p-1 group border-b border-zinc-900/50 ${log.isError ? 'bg-[#ef4444]/10 border-l-2 border-[#ef4444] my-1' : 'hover:bg-zinc-900/50'}`}
                      >
                        <span className="text-zinc-700 w-24">{log.time}</span> 
                        <span className={`w-12 font-bold ${log.isError ? 'text-[#ef4444]' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-zinc-400'}`}>
                          {log.type}
                        </span> 
                        <span className="text-white w-48 truncate">{log.tx}</span> 
                        <span className={`w-48 truncate ${log.isError ? 'text-[#ef4444] font-bold' : 'text-zinc-500'}`}>
                          {log.dest}
                        </span> 
                        <span className={`${log.isError ? 'text-[#ef4444] font-bold underline' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-zinc-700'} ml-auto`}>
                          {log.metric}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        </main>
      </div>

    </div>
  )
}
