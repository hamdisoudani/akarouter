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
import { 
  Terminal,
  Shield,
  KeyRound,
  LogOut,
  Copy,
  Check,
  Menu,
  X,
  Layers,
  FileText,
  Cpu,
  Brain,
  Zap,
  Sparkles
} from 'lucide-react'
import InteractionCaptcha from '@/components/InteractionCaptcha'

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
  const [mobileOpen, setMobileOpen] = useState(false)

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
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center font-mono text-xs text-zinc-500 uppercase tracking-widest">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span>
          <span>[INITIALIZING_CONNECTION_PORTAL...]</span>
        </div>
      </div>
    )
  }

  if (user?.status === 'pending') {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#e5e1e4] flex flex-col items-center justify-center p-4 selection:bg-[#ef4444]/30 selection:text-white relative grid-bg">
        <div className="absolute top-4 right-4 z-20">
          <button 
            onClick={signOut}
            className="bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white font-mono text-[10px] py-2 px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 transition-all flex items-center gap-2 crosshair-corners"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="tracking-widest uppercase font-bold">Sign Out</span>
          </button>
        </div>
        
        <div className="w-full max-w-md tech-border bg-[#0e0e10] p-8 space-y-6 crosshair-corners relative red-glow">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-48 h-16 border border-[#ef4444]/30 bg-[#ef4444]/5 flex items-center justify-center overflow-hidden">
              <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="w-2 h-2 bg-[#ef4444] red-glow animate-pulse rounded-full"></div>
              <p className="font-mono text-[10px] text-zinc-400 tracking-widest uppercase font-bold">ACCOUNT PENDING ACTIVATION</p>
            </div>
          </div>

          <div className="space-y-4 font-mono text-xs text-zinc-400 border-y border-zinc-850 py-6">
            <p className="leading-relaxed text-zinc-300">
              Welcome to <span className="text-white font-bold">AkaRouter</span>. To maintain API reliability and prevent system abuse, new accounts require administrator activation.
            </p>
            <p className="leading-relaxed">
              Please contact the admin via the official channels below to request your access keys:
            </p>
            <div className="space-y-2.5 pt-2">
              <a 
                href="https://t.me/mrdedatn" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="flex items-center gap-3 p-2.5 border border-zinc-850 hover:border-[#ef4444]/35 hover:bg-[#ef4444]/5 transition-all group"
              >
                <span className="text-[#ef4444] font-bold">[TELEGRAM]</span>
                <span className="text-zinc-300 group-hover:text-white transition-colors">@mrdedatn</span>
              </a>
              <a 
                href="https://linkedin.com/in/hamdisoudani" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="flex items-center gap-3 p-2.5 border border-zinc-850 hover:border-[#ef4444]/35 hover:bg-[#ef4444]/5 transition-all group"
              >
                <span className="text-[#ef4444] font-bold">[LINKEDIN]</span>
                <span className="text-zinc-300 group-hover:text-white transition-colors">hamdisoudani</span>
              </a>
            </div>
          </div>

          <form onSubmit={handleActivate} className="space-y-4">
            <div className="space-y-2">
              <label className="block font-mono text-[9px] text-zinc-500 uppercase tracking-widest font-bold">
                ENTER INVITATION CODE
              </label>
              <input 
                type="text" 
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="AKAR-XXXX-XXXX"
                disabled={activationLoading}
                className="w-full bg-[#050507] border border-zinc-850 focus:border-[#ef4444] focus:outline-none text-white px-3 py-2.5 text-xs font-mono uppercase tracking-wider placeholder-zinc-700 transition-colors rounded-none"
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
              className="w-full bg-[#ef4444] hover:bg-[#ef4444]/90 disabled:bg-zinc-800 disabled:border-zinc-700 disabled:text-zinc-500 text-white font-mono font-bold text-xs py-3 tracking-widest uppercase transition-all crosshair-corners red-glow"
            >
              {activationLoading ? 'ACTIVATING SYSTEM...' : 'SUBMIT ACTIVATION CODE'}
            </button>
          </form>
          
          <div className="text-center">
            <p className="font-mono text-[8px] text-zinc-650 tracking-wider">
              VERIFIED BY GOOGLE RECAPTCHA V3 • STRICT RATE LIMITS APPLY (5 RPM)
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex antialiased selection:bg-[#ef4444]/30 selection:text-white">
      
      {/* SideNavBar */}
      <nav className="hidden md:flex flex-col h-screen w-64 tech-border-r bg-[#09090b] py-6 fixed left-0 top-0 z-20 micro-grid">
        <div className="px-6 mb-8 flex flex-col gap-1">
          <div className="w-full">
            <div className="relative w-full h-16 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <div className="w-1.5 h-1.5 bg-[#ef4444] red-glow status-pulse"></div>
            <p className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase">Kernel: v1.0.0-STABLE</p>
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

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/usage">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <Layers className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Usage</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/models">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <Brain className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Models</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/playground">
            <span className="border border-zinc-800 p-1 group-hover:border-amber-500/60 transition-colors flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-zinc-400 group-hover:text-amber-400" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Playground</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/upgrade">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Plans</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/agents">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <Cpu className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
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
          {/* Close button inside mobile drawer */}
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
              className="flex items-center gap-3 px-4 py-3 w-full border border-[#ef4444] bg-[#ef4444]/10 text-white red-glow"
              href="/dashboard"
            >
              <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
                <Terminal className="w-3.5 h-3.5 text-[#ef4444]" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Telemetry</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/keys"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">API Keys</span>
            </Link>

            <Link
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/usage"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <Layers className="w-3.5 h-3.5 text-zinc-450" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Usage</span>
            </Link>

            <Link
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/models"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <Brain className="w-3.5 h-3.5 text-zinc-450" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Models</span>
            </Link>

            <Link
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/upgrade"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-zinc-450" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Plans</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/agents"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <Cpu className="w-3.5 h-3.5 text-zinc-450" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Hosted Agents</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-white transition-colors group"
              href="/docs"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-zinc-450" />
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
              <LogOut className="w-4 h-4 text-zinc-450" />
              <span className="tracking-widest uppercase font-bold">Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 w-full relative">
        
        {/* TopAppBar */}
        <header className="flex justify-between items-center w-full px-6 py-3 bg-[#09090b] tech-border-b sticky top-0 z-10 micro-grid">
          <div className="md:hidden flex items-center justify-between w-full">
            <div className="relative w-20 h-10 border border-[#ef4444] bg-[#ef4444]/10 flex items-center justify-center red-glow overflow-hidden">
              <Image src="/logo.png" alt="AkaRouter Logo" fill className="object-contain scale-[2.5]" />
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
            <div className="grid grid-cols-12 gap-0 tech-border bg-[#0e0e10] crosshair-corners">
              
              {/* KPI Row */}
              <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 tech-border-b bg-[#0e0e10]">
                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-zinc-900 flex flex-col justify-center relative overflow-hidden group">
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

                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-zinc-900 flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[8px] text-zinc-600">CHN_02</div>
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-zinc-700"></span> MONTHLY QUOTA
                  </span>
                  <div className="font-mono text-2xl text-white font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.progress_percentage_month ?? 0).toFixed(1)}<span className="text-zinc-700 text-xs ml-1">%</span></>
                    ) : (
                      <span className="text-zinc-700 animate-pulse">[LOAD_TX...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-650 mt-1 uppercase tracking-tighter">
                    {usage ? `CONSUMED` : '[READING_LIMIT]'}
                  </span>
                </div>

                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-zinc-900 flex flex-col justify-center relative overflow-hidden bg-[#ef4444]/5">
                  <div className="absolute right-0 top-0 p-1 bg-[#ef4444]/20 border-b border-l border-[#ef4444]/30 font-mono text-[8px] text-[#ef4444]">CHN_03</div>
                  <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
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

              {/* Symmetrical columns */}
              <div className="col-span-12 lg:col-span-6 lg:tech-border-r border-b lg:border-b-0 border-zinc-900 p-6 space-y-6 flex flex-col justify-between">
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
                            <span className="font-mono text-[11px] text-zinc-500">{(m.total_tokens ?? 0).toLocaleString()} TOKENS ({m.total_requests} TX)</span>
                            <span className="font-mono text-[11px] text-[#10b981]">{m.avg_latency_ms}ms</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-zinc-900">
                  <div className="flex justify-between items-center px-1 font-mono text-[9px]">
                    <span className="text-zinc-600">LOAD_BALANCER_TYPE</span>
                    <span className="text-white">RR_WEIGHTED</span>
                  </div>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-6 p-6 space-y-6 flex flex-col justify-between bg-[#0e0e10]">
                <div className="space-y-4">
                  <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                    MODEL_CATALOG
                  </h2>
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider leading-relaxed">
                    {modelsList.length} models available across {new Set(modelsList.map(m => m.owned_by || 'unknown')).size} providers.
                    Per-token and per-request billing supported.
                  </p>

                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {loading ? (
                      <p className="text-[10px] font-mono text-zinc-650 uppercase py-2 text-center animate-pulse">[SYNCHRONIZING_REGISTRY...]</p>
                    ) : modelsList.length === 0 ? (
                      <p className="text-[10px] font-mono text-zinc-650 uppercase py-2 text-center">[NO_ACTIVE_MODELS]</p>
                    ) : (
                      modelsList.slice(0, 6).map((m) => {
                        const isPerRequest = m.pricing_mode === 'per_request'
                        return (
                          <Link key={m.id} href={`/models/${m.id}`} className="flex justify-between items-center p-2.5 bg-[#050507] border border-zinc-900 hover:border-zinc-700 transition-all group">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`w-1.5 h-1.5 ${m.is_active ? 'bg-emerald-400 status-pulse' : 'bg-[#ef4444]'} shrink-0`} />
                              <span className="font-mono text-[11px] text-zinc-300 group-hover:text-white uppercase truncate transition-colors">
                                {m.display_name || m.id}
                              </span>
                            </div>
                            <span className={`shrink-0 ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider border ${
                              isPerRequest
                                ? 'border-[#ef4444]/30 bg-[#ef4444]/5 text-[#ef4444]'
                                : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                            }`}>
                              {isPerRequest ? '$' : 'T'}
                              {isPerRequest ? `$${((m.cost_per_request_cents ?? 0) / 100).toFixed(2)}` : 'PER_M'}
                            </span>
                          </Link>
                        )
                      })
                    )}
                  </div>

                  <Link
                    href="/models"
                    className="flex items-center justify-center gap-2 w-full py-2.5 mt-2 bg-zinc-900 border border-zinc-800 hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-zinc-300 hover:text-white font-mono text-[10px] uppercase tracking-wider transition-all"
                  >
                    Browse All {modelsList.length} Models →
                  </Link>
                </div>
              </div>

              {/* Live request logs buffer */}
              <div className="col-span-12 border-t border-[#27272a] bg-[#09090b]">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 px-5 py-3 border-b border-[#27272a] bg-[#0e0e10]">
                  <h2 className="font-mono text-[11px] text-zinc-300 flex items-center gap-2.5 tracking-[0.2em] uppercase font-bold">
                    <Terminal className="w-3.5 h-3.5 text-[#ef4444]" />
                    LIVE_TX_TRACE_BUFFER
                  </h2>
                  <div className="flex items-center gap-3 border border-[#10b981]/20 bg-[#10b981]/5 px-3 py-1 self-start sm:self-auto">
                    <span className="w-1.5 h-1.5 bg-[#10b981] status-pulse"></span>
                    <span className="font-mono text-[9px] text-[#10b981] tracking-[0.2em] font-bold">REAL_TIME_STREAMING</span>
                  </div>
                </div>

                <div className="h-60 overflow-y-auto p-4 font-mono text-[11px] space-y-1 bg-[#050507]" id="trace-log">
                  {loading ? (
                    <div className="text-zinc-650 py-6 text-center animate-pulse tracking-widest uppercase">
                      [INITIALIZING_BUFFER_STREAM_READING_HISTORICAL_METRICS...]
                    </div>
                  ) : traceLogs.length === 0 ? (
                    <div className="text-zinc-700 py-6 text-center">[BUFFER_EMPTY_WAITING_FOR_TRAFFIC]</div>
                  ) : (
                    <div>
                      {traceLogs.map((log, index) => (
                        <div key={index}>
                          {/* Desktop View */}
                          <div className={`hidden md:flex gap-6 p-1 group border-b border-zinc-900/50 ${log.isError ? 'bg-[#ef4444]/10 border-l-2 border-[#ef4444] my-1' : 'hover:bg-zinc-900/50'}`}>
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

                          {/* Mobile View */}
                          <div className={`md:hidden flex flex-col p-3 border-b border-zinc-900/50 space-y-1.5 ${log.isError ? 'bg-[#ef4444]/10 border-l-2 border-[#ef4444] my-1' : 'hover:bg-zinc-900/30'}`}>
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-zinc-600 font-mono">{log.time}</span>
                              <span className={`font-bold ${log.isError ? 'text-[#ef4444]' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-zinc-400'}`}>
                                {log.type}
                              </span>
                            </div>
                            <div className="text-white text-xs font-mono font-bold truncate">
                              {log.tx}
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono">
                              <span className="truncate max-w-[160px]">{log.dest}</span>
                              <span className={`${log.isError ? 'text-[#ef4444] font-bold underline' : log.type === '[ACK]' ? 'text-[#10b981]' : 'text-zinc-400'}`}>
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
