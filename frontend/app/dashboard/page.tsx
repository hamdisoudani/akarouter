'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import {
  getAnalytics,
  getModels,
  activateAccount,
  type ModelAnalytics,
} from '@/lib/api'
import { z } from 'zod'
import { Terminal, LogOut } from 'lucide-react'
import InteractionCaptcha from '@/components/InteractionCaptcha'
import { DashboardSidebar } from '@/components/DashboardSidebar'
import { modelPath } from '@/lib/providers'

const ActivateAccountSchema = z.object({
  code: z.string().min(1, 'Invitation code is required').max(100),
  captchaToken: z.string().min(1, 'Human verification is required'),
})


export default function UserDashboard() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut, refetchAll } = useApp()
  const [analytics, setAnalytics] = useState<ModelAnalytics[]>([])
  const [modelsList, setModelsList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Activation states
  const [activationCode, setActivationCode] = useState('')
  const [activationLoading, setActivationLoading] = useState(false)
  const [activationError, setActivationError] = useState('')
  const [activationSuccess, setActivationSuccess] = useState('')
  const [activationCaptcha, setActivationCaptcha] = useState<string | null>(null)

  const executeRecaptcha = (action: string): Promise<string> => {
    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '6LcnqxUtAAAAAO9MYeFNsyL4JA-6PlAHKzoZoRCc'
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !(window as any).grecaptcha) {
        reject(new Error('reCAPTCHA script not loaded yet. Please wait a moment.'))
        return
      }
      const grecaptcha = (window as any).grecaptcha
      grecaptcha.ready(() => {
        grecaptcha
          .execute(siteKey, { action })
          .then((token: string) => resolve(token))
          .catch((err: any) => reject(err))
      })
    })
  }

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = ActivateAccountSchema.safeParse({ code: activationCode, captchaToken: activationCaptcha ?? '' })
    if (!parsed.success) {
      setActivationError(parsed.error.issues[0]?.message || 'Invalid submission')
      return
    }
    setActivationLoading(true)
    setActivationError('')
    setActivationSuccess('')
    
    try {
      const res = await activateAccount(token, parsed.data.code.trim(), parsed.data.captchaToken)
      if (res.ok) {
        setActivationSuccess('Account activated successfully! Reloading...')
        setTimeout(async () => {
          await refetchAll()
        }, 1500)
      } else {
        setActivationError('Failed to activate account')
      }
    } catch (err: any) {
      setActivationError(err.message || 'An error occurred during activation')
    } finally {
      setActivationLoading(false)
    }
  }

  // Custom logs for the trace buffer
  const [traceLogs, setTraceLogs] = useState<Array<{
    time: string;
    type: string;
    tx: string;
    dest: string;
    metric: string;
    isError: boolean;
  }>>([])

  const loadData = useCallback(async (accessToken: string) => {
    try {
      if (user?.status === 'pending') {
        setLoading(false)
        return
      }

      const [analyticsData, modelsData] = await Promise.allSettled([
        getAnalytics(accessToken),
        getModels()
      ])

      if (analyticsData.status === 'fulfilled') {
        const modelsAnalytics = analyticsData.value.models || []
        setAnalytics(modelsAnalytics)

        // Process trace logs from actual request logs if available, otherwise generate mock logs
        const logsList: typeof traceLogs = []
        if (analyticsData.value.recent_logs && analyticsData.value.recent_logs.length > 0) {
          analyticsData.value.recent_logs.forEach((log) => {
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
      }

      if (modelsData.status === 'fulfilled') {
        setModelsList(modelsData.value.data || [])
      }

    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!authLoading) {
      if (!token) {
        router.push('/auth/login')
        return
      }
      loadData(token)
    }
  }, [authLoading, token, loadData, router])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center font-mono text-xs text-muted-foreground/80 uppercase tracking-widest">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span>
          <span>[INITIALIZING_CONNECTION_PORTAL...]</span>
        </div>
      </div>
    )
  }

  if (user?.status === 'pending') {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4 selection:bg-[#ef4444]/30 selection:text-foreground relative grid-bg">
        <div className="absolute top-4 right-4 z-20">
          <button 
            onClick={signOut}
            className="bg-muted border border-border text-foreground/80 hover:text-foreground font-mono text-[10px] py-2 px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all flex items-center gap-2 crosshair-corners"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="tracking-widest uppercase font-bold">Sign Out</span>
          </button>
        </div>
        
        <div className="w-full max-w-md tech-border bg-card p-8 space-y-6 crosshair-corners relative red-glow">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-48 h-16 border border-[#ef4444]/30 bg-[#ef4444]/5 flex items-center justify-center overflow-hidden">
              <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="w-2 h-2 bg-[#ef4444] red-glow animate-pulse rounded-full"></div>
              <p className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase font-bold">ACCOUNT PENDING ACTIVATION</p>
            </div>
          </div>

          <div className="space-y-4 font-mono text-xs text-muted-foreground border-y border-border py-6">
            <p className="leading-relaxed text-foreground/80">
              Welcome to <span className="text-foreground font-bold">AkaRouter</span>. To maintain API reliability and prevent system abuse, new accounts require administrator activation.
            </p>
            <p className="leading-relaxed">
              Please contact the admin via the official channels below to request your access keys:
            </p>
            <div className="space-y-2.5 pt-2">
              <a 
                href="https://t.me/mrdedatn" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="flex items-center gap-3 p-2.5 border border-border hover:border-[#ef4444]/35 hover:bg-[#ef4444]/5 transition-all group"
              >
                <span className="text-[#ef4444] font-bold">[TELEGRAM]</span>
                <span className="text-foreground/80 group-hover:text-foreground transition-colors">@mrdedatn</span>
              </a>
              <a 
                href="https://linkedin.com/in/hamdisoudani" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="flex items-center gap-3 p-2.5 border border-border hover:border-[#ef4444]/35 hover:bg-[#ef4444]/5 transition-all group"
              >
                <span className="text-[#ef4444] font-bold">[LINKEDIN]</span>
                <span className="text-foreground/80 group-hover:text-foreground transition-colors">hamdisoudani</span>
              </a>
            </div>
          </div>

          <form onSubmit={handleActivate} className="space-y-4">
            <div className="space-y-2">
              <label className="block font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest font-bold">
                ENTER INVITATION CODE
              </label>
              <input 
                type="text" 
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="AKAR-XXXX-XXXX"
                disabled={activationLoading}
                className="w-full bg-card/80 border border-border focus:border-[#ef4444] focus:outline-none text-foreground px-3 py-2.5 text-xs font-mono uppercase tracking-wider placeholder-zinc-700 transition-colors rounded-none"
              />
            </div>

            {activationError && (
              <div className="p-3 border border-red-900/40 bg-red-950/15 text-[#ef4444] font-mono text-[10px] uppercase tracking-wide">
                [ERROR]: {activationError}
              </div>
            )}

            {activationSuccess && (
              <div className="p-3 border border-emerald-900/40 bg-emerald-950/15 text-emerald-450 font-mono text-[10px] uppercase tracking-wide">
                [SUCCESS]: {activationSuccess}
              </div>
            )}

            <InteractionCaptcha
              action="activate"
              boxed
              onVerified={(token) => setActivationCaptcha(token)}
            />

            <button 
              type="submit"
              disabled={activationLoading || !activationCaptcha}
              className="w-full bg-[#ef4444] hover:bg-[#ef4444]/90 disabled:bg-muted disabled:border-border disabled:text-muted-foreground/80 text-foreground font-mono font-bold text-xs py-3 tracking-widest uppercase transition-all crosshair-corners red-glow"
            >
              {activationLoading ? 'ACTIVATING SYSTEM...' : 'SUBMIT ACTIVATION CODE'}
            </button>
          </form>
          
          <div className="text-center">
            <p className="font-mono text-[8px] text-muted-foreground/60 tracking-wider">
              VERIFIED BY GOOGLE RECAPTCHA V3 • STRICT RATE LIMITS APPLY (5 RPM)
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col antialiased selection:bg-[#ef4444]/30 selection:text-foreground">
      
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 md:w-[calc(100%-16rem)] w-full relative">
        
        
        {/* Canvas */}
        <main className="flex-1 p-0 grid-bg relative">
          {usage?.is_trialing && (
            <div className="bg-[#ef4444]/10 border-b border-[#ef4444]/25 text-[#ef4444] px-6 py-3 font-mono text-[11px] flex items-center justify-between uppercase tracking-wider font-bold">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#ef4444] rounded-full status-pulse red-glow" />
                [BILLING_NOTICE]: FREE TRIAL ACTIVE. YOU ARE CURRENTLY TRIALING THE PRO PLAN.
              </div>
            </div>
          )}
          {usage?.gateway_enabled === false && (
            <div className="bg-[#ef4444]/15 border-b border-[#ef4444]/30 text-[#ef4444] px-6 py-3 font-mono text-[11px] flex items-center justify-between animate-pulse uppercase tracking-wider font-bold">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#ef4444] rounded-full status-pulse red-glow" />
                [SYSTEM_ALERT_OFFLINE]: THE AKAROUTER API GATEWAY IS TEMPORARILY DISABLED BY ADMINISTRATOR. ALL API ENDPOINTS WILL RETURN 503 SERVICE UNAVAILABLE.
              </div>
            </div>
          )}
          <div className="p-6">
            <div className="grid grid-cols-12 gap-0 tech-border bg-card crosshair-corners">
              
              {/* KPI Row */}
              <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 tech-border-b bg-card">
                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-border flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-muted border-b border-l border-border font-mono text-[8px] text-muted-foreground/70">CHN_01</div>
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span> SYSTEM TIER
                  </span>
                  <div className="font-mono text-2xl text-foreground font-bold tracking-wider uppercase">
                    {usage ? usage.tier : <span className="text-muted-foreground/60 animate-pulse">[LOAD_VAULT...]</span>}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/70 mt-1 uppercase tracking-tighter">
                    {usage ? `RPM LIMIT: ${usage.rpm_limit ?? 60}` : 'PLAN STATUS: ACTIVE'}
                  </span>
                </div>

                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-border flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-muted border-b border-l border-border font-mono text-[8px] text-muted-foreground/70">CHN_02</div>
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-muted"></span> MONTHLY QUOTA
                  </span>
                  <div className="font-mono text-2xl text-foreground font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.progress_percentage_month ?? 0).toFixed(1)}<span className="text-muted-foreground/60 text-xs ml-1">%</span></>
                    ) : (
                      <span className="text-muted-foreground/60 animate-pulse">[LOAD_TX...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/60 mt-1 uppercase tracking-tighter">
                    {usage ? `CONSUMED` : '[READING_LIMIT]'}
                  </span>
                </div>

                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-border flex flex-col justify-center relative overflow-hidden bg-[#ef4444]/5">
                  <div className="absolute right-0 top-0 p-1 bg-[#ef4444]/20 border-b border-l border-[#ef4444]/30 font-mono text-[8px] text-[#ef4444]">CHN_03</div>
                  <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span> CONSUMED TOKENS
                  </span>
                  <div className="font-mono text-2xl text-[#ef4444] font-bold tracking-tight red-glow-text">
                    {usage ? (
                      <>{((usage.consumed_tokens_input ?? 0) + (usage.consumed_tokens_output ?? 0)).toLocaleString()}<span className="text-[12px] ml-1">TOKENS</span></>
                    ) : (
                      <span className="text-[#ef4444]/65 animate-pulse">[LOAD_SYS...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-[#ef4444] mt-1 uppercase tracking-wider font-bold">
                    {usage ? `IN: ${(usage.consumed_tokens_input ?? 0).toLocaleString()} | OUT: ${(usage.consumed_tokens_output ?? 0).toLocaleString()}` : 'ACTIVE PERIOD'}
                  </span>
                </div>

                <div className="p-5 flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-muted border-b border-l border-border font-mono text-[8px] text-muted-foreground/70">CHN_04</div>
                  <span className="font-mono text-[9px] text-muted-foreground/80 uppercase tracking-widest mb-2 flex items-center gap-2 font-mono">
                    <span className="w-1.5 h-1.5 bg-muted"></span> ALL-TIME COUNTER
                  </span>
                  <div className="font-mono text-2xl text-foreground font-bold tracking-tight">
                    {usage ? (
                      <>{usage.total_requests.toLocaleString()}<span className="text-muted-foreground/60 text-xs ml-1">REQ</span></>
                    ) : (
                      <span className="text-muted-foreground/60 animate-pulse">[LOAD_BUF...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground/70 mt-1 uppercase tracking-widest">TOTAL_LOGGED_TX</span>
                </div>
              </div>

              {/* Symmetrical columns */}
              <div className="col-span-12 lg:col-span-6 lg:tech-border-r border-b lg:border-b-0 border-border p-6 space-y-6 flex flex-col justify-between">
                <div className="space-y-4">
                  <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <div className="w-[3px] h-3 bg-muted"></div>
                    MODEL_METRIC_ROUTING
                  </h2>
                  <div className="space-y-2">
                    {loading ? (
                      <>
                        <div className="h-11 bg-card/80 border border-border animate-pulse flex items-center justify-between px-3">
                          <span className="text-[10px] text-muted-foreground/80 font-mono uppercase tracking-wider">LOADING_METRICS_PRO...</span>
                          <span className="w-12 h-3 bg-muted animate-pulse" />
                        </div>
                        <div className="h-11 bg-card/80 border border-border animate-pulse flex items-center justify-between px-3">
                          <span className="text-[10px] text-muted-foreground/80 font-mono uppercase tracking-wider">LOADING_METRICS_FSH...</span>
                          <span className="w-12 h-3 bg-muted animate-pulse" />
                        </div>
                      </>
                    ) : analytics.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-4 font-mono uppercase text-center">[NO_MODEL_ANALYTICS_YET]</p>
                    ) : (
                      analytics.map((m) => (
                        <div key={m.model} className="flex justify-between items-center p-3 bg-card/80 border border-border hover:border-border transition-all group">
                          <div className="flex items-center gap-3">
                            <span className={`w-1.5 h-1.5 ${m.error_requests > 0 ? 'bg-[#ef4444] status-pulse red-glow' : 'bg-[#10b981]'}`} />
                            <span className="font-mono text-[11px] text-muted-foreground group-hover:text-foreground uppercase transition-colors">{m.model}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-muted-foreground/80">{(m.total_tokens ?? 0).toLocaleString()} TOKENS ({m.total_requests} TX)</span>
                            <span className="font-mono text-[11px] text-[#10b981]">{m.avg_latency_ms}ms</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-border">
                  <div className="flex justify-between items-center px-1 font-mono text-[9px]">
                    <span className="text-muted-foreground/70">LOAD_BALANCER_TYPE</span>
                    <span className="text-foreground">RR_WEIGHTED</span>
                  </div>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-6 p-6 space-y-6 flex flex-col justify-between bg-card">
                <div className="space-y-4">
                  <h2 className="font-mono text-xs text-foreground flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                    MODEL_CATALOG
                  </h2>
                  <p className="text-[10px] font-mono text-muted-foreground/80 uppercase tracking-wider leading-relaxed">
                    {modelsList.length} models available across {new Set(modelsList.map(m => m.owned_by || 'unknown')).size} providers.
                    Per-token and per-request billing supported.
                  </p>

                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {loading ? (
                      <p className="text-[10px] font-mono text-muted-foreground/60 uppercase py-2 text-center animate-pulse">[SYNCHRONIZING_REGISTRY...]</p>
                    ) : modelsList.length === 0 ? (
                      <p className="text-[10px] font-mono text-muted-foreground/60 uppercase py-2 text-center">[NO_ACTIVE_MODELS]</p>
                    ) : (
                      modelsList.slice(0, 6).map((m) => {
                        const isPerRequest = m.pricing_mode === 'per_request'
                        return (
                          <Link key={m.id} href={modelPath(m)} className={`flex justify-between items-center p-2.5 bg-card/80 border border-border hover:border-border transition-all group ${m.is_upcoming ? 'opacity-60' : ''}`}>
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`w-1.5 h-1.5 ${m.is_upcoming ? 'bg-amber-400' : m.is_active ? 'bg-emerald-400 status-pulse' : 'bg-[#ef4444]'} shrink-0`} />
                              <span className="font-mono text-[11px] text-foreground/80 group-hover:text-foreground uppercase truncate transition-colors">
                                {m.display_name || m.id}
                              </span>
                              {m.is_upcoming && (
                                <span className="text-[8px] font-mono uppercase tracking-wider text-amber-400 border border-amber-500/40 px-1">soon</span>
                              )}
                            </div>
                            <span className={`shrink-0 ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border ${
                              isPerRequest
                                ? 'border-[#ef4444]/30 bg-[#ef4444]/5 text-[#ef4444]'
                                : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                            }`}>
                              {isPerRequest ? '$' : 'T'}
                              {isPerRequest ? `${((m.cost_per_request_cents ?? 0) / 100).toFixed(2)}` : 'PER_M'}
                            </span>
                          </Link>
                        )
                      })
                    )}
                  </div>

                  <Link
                    href="/models"
                    className="flex items-center justify-center gap-2 w-full py-2.5 mt-2 bg-muted border border-border hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-foreground/80 hover:text-foreground font-mono text-[10px] uppercase tracking-wider transition-all"
                  >
                    Browse All {modelsList.length} Models →
                  </Link>
                </div>
              </div>

              {/* Live request logs buffer */}
              <div className="col-span-12 border-t border-border bg-background">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 px-5 py-3 border-b border-border bg-card">
                  <h2 className="font-mono text-[11px] text-foreground/80 flex items-center gap-2.5 tracking-[0.2em] uppercase font-bold">
                    <Terminal className="w-3.5 h-3.5 text-[#ef4444]" />
                    LIVE_TX_TRACE_BUFFER
                  </h2>
                  <div className="flex items-center gap-3 border border-[#10b981]/20 bg-[#10b981]/5 px-3 py-1 self-start sm:self-auto">
                    <span className="w-1.5 h-1.5 bg-[#10b981] status-pulse"></span>
                    <span className="font-mono text-[9px] text-[#10b981] tracking-[0.2em] font-bold">REAL_TIME_STREAMING</span>
                  </div>
                </div>

                <div className="h-60 overflow-y-auto p-4 font-mono text-[11px] space-y-1 bg-card/80" id="trace-log">
                  {loading ? (
                    <div className="text-muted-foreground/60 py-6 text-center animate-pulse tracking-widest uppercase">
                      [INITIALIZING_BUFFER_STREAM_READING_HISTORICAL_METRICS...]
                    </div>
                  ) : traceLogs.length === 0 ? (
                    <div className="text-muted-foreground/60 py-6 text-center">[BUFFER_EMPTY_WAITING_FOR_TRAFFIC]</div>
                  ) : (
                    <div>
                      {traceLogs.map((log, index) => (
                        <div key={index}>
                          {/* Desktop View */}
                          <div className={`hidden md:flex gap-6 p-1 group border-b border-border/50 ${log.isError ? 'bg-[#ef4444]/10 border-l-2 border-[#ef4444] my-1' : 'hover:bg-muted/50'}`}>
                            <span className="text-muted-foreground/60 w-24">{log.time}</span> 
                            <span className={`w-12 font-bold ${log.isError ? 'text-[#ef4444]' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-muted-foreground'}`}>
                              {log.type}
                            </span> 
                            <span className="text-foreground w-48 truncate">{log.tx}</span> 
                            <span className={`w-48 truncate ${log.isError ? 'text-[#ef4444] font-bold' : 'text-muted-foreground/80'}`}>
                              {log.dest}
                            </span> 
                            <span className={`${log.isError ? 'text-[#ef4444] font-bold underline' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-muted-foreground/60'} ml-auto`}>
                              {log.metric}
                            </span>
                          </div>

                          {/* Mobile View */}
                          <div className={`md:hidden flex flex-col p-3 border-b border-border/50 space-y-1.5 ${log.isError ? 'bg-[#ef4444]/10 border-l-2 border-[#ef4444] my-1' : 'hover:bg-muted/30'}`}>
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-muted-foreground/70 font-mono">{log.time}</span>
                              <span className={`font-bold ${log.isError ? 'text-[#ef4444]' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-muted-foreground'}`}>
                                {log.type}
                              </span>
                            </div>
                            <div className="text-foreground text-xs font-mono font-bold truncate">
                              {log.tx}
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground/80 font-mono">
                              <span className="truncate max-w-[160px]">{log.dest}</span>
                              <span className={`${log.isError ? 'text-[#ef4444] font-bold underline' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-muted-foreground'}`}>
                                {log.metric}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
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
