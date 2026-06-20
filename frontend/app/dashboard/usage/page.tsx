'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import { createCheckoutSession, getPlans, type PlanPreset, getPointTransactions, type PointTransaction } from '@/lib/api'
import { 
  LogOut, 
  KeyRound, 
  Terminal,
  Shield,
  Layers,
  Menu,
  X,
  Activity,
  FileText,
  Cpu
} from 'lucide-react'


export default function UsagePage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut, refetchUsage } = useApp()
  const [mobileOpen, setMobileOpen] = useState(false)

  const [secondsLeft5h, setSecondsLeft5h] = useState<number | null>(null)
  const [fullSecondsLeft5h, setFullSecondsLeft5h] = useState<number | null>(null)
  const [secondsLeft7d, setSecondsLeft7d] = useState<number | null>(null)
  const [fullSecondsLeft7d, setFullSecondsLeft7d] = useState<number | null>(null)

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [dbPlans, setDbPlans] = useState<PlanPreset[]>([])

  // Point transaction history
  const [pointTx, setPointTx] = useState<PointTransaction[]>([])
  const [pointTxSummary, setPointTxSummary] = useState<{ spent: number; refunded: number; granted: number }>({ spent: 0, refunded: 0, granted: 0 })
  const [pointTxLoading, setPointTxLoading] = useState(false)
  const [pointTxKind, setPointTxKind] = useState<'all' | 'charge' | 'refund' | 'grant'>('all')
  const [pointTxTotal, setPointTxTotal] = useState(0)

  const refetchPointTx = async () => {
    if (!token) return
    setPointTxLoading(true)
    try {
      const opts = pointTxKind === 'all' ? { limit: 50 } : { limit: 50, kind: pointTxKind as any }
      const data = await getPointTransactions(token, opts)
      setPointTx(data.transactions)
      setPointTxSummary(data.summary)
      setPointTxTotal(data.total)
    } catch (err) {
      console.warn('Failed to fetch point transactions:', err)
    } finally {
      setPointTxLoading(false)
    }
  }

  useEffect(() => {
    if (token && usage) {
      refetchPointTx()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pointTxKind])

  // Aliases used in DB → display name lookup (matches /models page logic)
  const aliasToDisplay: Record<string, string> = {
    'akarouter-mini': 'MiniMax M3',
    'akarouter-flash': 'Nemotron Ultra',
    'akarouter-pro': 'Step 3.7 Flash',
    'akarouter-large': 'Owl Alpha',
    'akarouter-haiku': 'Claude Haiku 4.5',
    'akarouter-sonnet': 'Claude Sonnet 4.6',
    'akarouter-opus': 'Claude Opus 4.8',
    'akarouter-gpt54': 'GPT-5.4',
    'akarouter-gpt55': 'GPT-5.5',
    'akarouter-gpt53-codex': 'GPT-5.3 Codex Spark',
    'akarouter-gemini31': 'Gemini 3.1 Pro',
  }

  const formatPointDelta = (kind: string, points: number) => {
    if (kind === 'charge') return `-${points}`
    if (kind === 'refund') return `+${points}`
    if (kind === 'grant') return `+${points}`
    return `${points}`
  }

  const kindColor = (kind: string) => {
    if (kind === 'charge') return 'text-red-400'
    if (kind === 'refund') return 'text-emerald-400'
    if (kind === 'grant') return 'text-amber-400'
    return 'text-zinc-400'
  }

  const kindLabel = (kind: string) => {
    if (kind === 'charge') return 'CALL'
    if (kind === 'refund') return 'REFUND'
    if (kind === 'grant') return 'GRANT'
    return kind.toUpperCase()
  }

  useEffect(() => {
    if (usage) {
      setSecondsLeft5h(usage.next_reset_5h ?? null)
      setFullSecondsLeft5h(usage.full_reset_5h ?? null)
      setSecondsLeft7d(usage.next_reset_7d ?? null)
      setFullSecondsLeft7d(usage.full_reset_7d ?? null)
    }
  }, [usage])

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft5h(prev => (prev !== null && prev > 0 ? prev - 1 : prev))
      setFullSecondsLeft5h(prev => (prev !== null && prev > 0 ? prev - 1 : prev))
      setSecondsLeft7d(prev => (prev !== null && prev > 0 ? prev - 1 : prev))
      setFullSecondsLeft7d(prev => (prev !== null && prev > 0 ? prev - 1 : prev))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const formatRemainingTime = (seconds: number | null | undefined): string => {
    if (seconds === null || seconds === undefined || seconds <= 0) return '0s'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) {
      const remainingSecs = seconds % 60
      return `${minutes}m ${remainingSecs}s`
    }
    const hours = Math.floor(minutes / 60)
    const remainingMins = minutes % 60
    if (hours < 24) {
      return `${hours}h ${remainingMins}m`
    }
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return `${days}d ${remainingHours}h`
  }

  const handleCheckout = async (tier: string) => {
    if (!token) return
    setCheckoutLoading(tier)
    setCheckoutError(null)
    try {
      const redirectUrl = window.location.origin + '/dashboard/usage'
      const data = await createCheckoutSession(token, tier, redirectUrl)
      if (data && data.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch (err: any) {
      console.error(err)
      setCheckoutError(err.message || 'Failed to initialize checkout')
      setCheckoutLoading(null)
    }
  }

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await getPlans()
        if (res && res.plans) {
          const filtered = res.plans.filter(p => p.tier !== 'free' && p.tier !== 'enterprise')
          setDbPlans(filtered)
        }
      } catch (err) {
        console.error('Failed to load plans from backend:', err)
      }
    }
    loadPlans()
  }, [])

  const getDisplayPlans = () => {
    const fallbackPlans = [
      {
        name: 'Starter Plan',
        key: 'starter',
        price: '$4.99',
        billing: 'monthly',
        desc: 'Essential API limits for developers starting out.',
        badge: null,
        limits: [
          'Monthly Budget: $10.00',
          'RPM Limit: 60 RPM',
          '5-Hour Limit: $1.00',
          '7-Day Limit: $5.00',
        ]
      },
      {
        name: 'Pro Plan',
        key: 'pro',
        price: '$19.99',
        billing: 'monthly',
        desc: 'Perfect for production apps and agent deployments.',
        badge: 'Popular • 7-Day Free Trial',
        limits: [
          'Monthly Budget: $100.00',
          'RPM Limit: 300 RPM',
          '5-Hour Limit: $10.00',
          '7-Day Limit: $50.00',
        ]
      },
      {
        name: 'Ultra Plan',
        key: 'ultra',
        price: '$99.99',
        billing: 'monthly',
        desc: 'Ultimate capacity for high-scale agent networks.',
        badge: 'Elite Performance',
        limits: [
          'Monthly Budget: $1,000.00',
          'RPM Limit: 1,000 RPM',
          '5-Hour Limit: $100.00',
          '7-Day Limit: $500.00',
        ]
      }
    ]

    if (dbPlans.length === 0) {
      return fallbackPlans
    }

    return dbPlans.map(plan => {
      const matchingFallback = fallbackPlans.find(fp => fp.key === plan.tier)
      return {
        name: matchingFallback?.name || `${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan`,
        key: plan.tier,
        price: matchingFallback?.price || '$0.00',
        billing: matchingFallback?.billing || 'monthly',
        desc: matchingFallback?.desc || 'Custom limits tier.',
        badge: matchingFallback?.badge || null,
        limits: [
          `Monthly Budget: $${plan.monthly_limit.toFixed(2)}`,
          `RPM Limit: ${plan.rpm_limit} RPM`,
          `5-Hour Limit: $${plan.tokens_5h_limit.toFixed(2)}`,
          `7-Day Limit: $${plan.tokens_7d_limit.toFixed(2)}`
        ]
      }
    })
  }

  useEffect(() => {
    if (!authLoading) {
      if (!token) {
        router.push('/auth/login')
        return
      }
      if (user?.status === 'pending') {
        router.push('/dashboard')
        return
      }
      
      // Load latest usage data in the background to ensure it is fresh
      refetchUsage()
    }
  }, [authLoading, token, user, router, refetchUsage])

  // Removed fullscreen loading block to show proper page shell first

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
          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/dashboard">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <Terminal className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Telemetry</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/dashboard/keys">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <KeyRound className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">API Keys</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-white nav-item-active" href="/dashboard/usage">
            <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
              <Layers className="w-3.5 h-3.5 text-[#ef4444]" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Usage</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/docs">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <FileText className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Docs</span>
          </Link>


          {user?.role === 'admin' && (
            <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/dashboard/admin">
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
              href="/dashboard/keys"
            >
              <span className="border border-zinc-850 p-1 bg-zinc-900 text-zinc-400 flex items-center justify-center">
                <KeyRound className="w-3.5 h-3.5 text-zinc-455" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">API Keys</span>
            </Link>

            <Link 
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 w-full border border-[#ef4444] bg-[#ef4444]/10 text-white red-glow"
              href="/dashboard/usage"
            >
              <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
                <Layers className="w-3.5 h-3.5 text-[#ef4444]" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Usage</span>
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
                href="/dashboard/admin"
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
            <span className="tracking-[0.2em] uppercase font-bold text-zinc-300">USAGE TELEMETRY MATRIX</span>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px]">
            <div className="hidden sm:flex items-center gap-2 border border-zinc-800 bg-[#0e0e10] px-3 py-1.5 text-zinc-400">
              <span className="text-zinc-600">[USER]:</span>
              <span className="text-white font-semibold">{user ? user.email : 'CONNECTING...'}</span>
            </div>
          </div>
        </header>



        {/* Canvas */}
        <main className="flex-1 p-0 grid-bg relative">
          
          {usage?.tier === 'free' && (
            <div className="bg-[#ef4444]/15 border-b border-[#ef4444]/35 text-[#ef4444] p-4 font-mono text-xs uppercase flex items-center justify-center gap-3 red-glow animate-pulse font-bold">
              <span className="w-2 h-2 bg-[#ef4444] rounded-full status-pulse red-glow" />
              <span>[BILLING_ALERT]: SUBSCRIPTION REQUIRED. GATEWAY ACCESS AND AGENT PROVISIONING ARE RESTRICTED. CHOOSE A PLAN BELOW TO ACTIVATE YOUR SERVICE.</span>
            </div>
          )}

          {usage?.is_trialing && (
            <div className="bg-[#ef4444]/10 border-b border-[#ef4444]/25 text-[#ef4444] p-4 font-mono text-xs uppercase flex items-center justify-center gap-3 font-bold">
              <span className="w-2 h-2 bg-[#ef4444] rounded-full status-pulse red-glow" />
              <span>[BILLING_NOTICE]: FREE TRIAL ACTIVE. YOU ARE CURRENTLY TRIALING THE PRO PLAN. SUBSCRIBED VIA WHOP.</span>
            </div>
          )}

          {usage?.gateway_enabled === false && (
            <div className="bg-[#ef4444]/10 border-b border-[#ef4444] p-4 text-center font-mono text-xs text-[#ef4444] tracking-wider uppercase animate-pulse">
              [WARNING_SYSTEM_MAINTENANCE_API_GATEWAY_OFFLINE_BY_ADMINISTRATOR]
            </div>
          )}

          <div className="p-6 space-y-6">
            
            {/* KPI Row */}
            <div className="grid grid-cols-12 gap-0 tech-border bg-[#0e0e10] crosshair-corners">
              <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 bg-[#0e0e10]">
                <div className="p-5 md:tech-border-r border-b md:border-b-0 border-zinc-900 flex flex-col justify-center relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[8px] text-zinc-600">CHN_01</div>
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow"></span> SYSTEM TIER
                  </span>
                  <div className="font-mono text-2xl text-white font-bold tracking-wider uppercase">
                    {usage ? usage.tier : <span className="text-zinc-700 animate-pulse">[LOAD_VAULT...]</span>}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 mt-1 uppercase tracking-tighter font-mono">
                    {usage ? `RPM LIMIT: ${usage.rpm_limit ?? 60}` : '[RPM_LIMIT: ...]'}
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
                  <span className="font-mono text-[9px] text-zinc-650 mt-1 uppercase tracking-tighter font-mono">
                    {usage ? `CONSUMED` : '[LIMIT: ...]'}
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
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-zinc-700"></span> ALL-TIME COUNTER
                  </span>
                  <div className="font-mono text-2xl text-white font-bold tracking-tight">
                    {usage ? (
                      <>{usage.total_requests.toLocaleString()}<span className="text-zinc-700 text-xs ml-1">REQ</span></>
                    ) : (
                      <span className="text-zinc-700 animate-pulse">[LOAD_BUF...]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 mt-1 uppercase tracking-widest font-mono">TOTAL_LOGGED_TX</span>
                </div>
              </div>
            </div>

            {/* Points meter (point-based pricing) */}
            <div className="bg-[#0e0e10] border border-amber-500/30 p-6 crosshair-corners space-y-4">
              <div className="space-y-1">
                <h2 className="font-mono text-xs text-amber-400 flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                  <div className="w-[3px] h-3 bg-amber-500 red-glow"></div>
                  POINT_BALANCE
                </h2>
                <p className="text-[10px] font-mono text-zinc-500 uppercase">Every model call costs points. Free models (1pt) are capped daily. Resets monthly.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Remaining */}
                <div className="bg-[#050507] border border-amber-500/20 p-4 space-y-2">
                  <span className="font-mono text-[9px] text-amber-400 uppercase tracking-widest">REMAINING</span>
                  <div className="font-mono text-3xl text-amber-300 font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.monthly_points_remaining ?? 0).toLocaleString()}<span className="text-amber-700 text-sm ml-1">PTS</span></>
                    ) : (
                      <span className="text-amber-700 animate-pulse">[—]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 uppercase">
                    {usage?.points_reset_at ? `RESET ${new Date(usage.points_reset_at).toLocaleDateString()}` : 'THIS MONTH'}
                  </span>
                </div>

                {/* Monthly allowance */}
                <div className="bg-[#050507] border border-zinc-900 p-4 space-y-2">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">MONTHLY ALLOWANCE</span>
                  <div className="font-mono text-3xl text-white font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.monthly_points_limit ?? 0).toLocaleString()}<span className="text-zinc-700 text-sm ml-1">PTS</span></>
                    ) : (
                      <span className="text-zinc-700 animate-pulse">[—]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 uppercase">PLAN CAP</span>
                </div>

                {/* Daily free cap */}
                <div className="bg-[#050507] border border-zinc-900 p-4 space-y-2">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">DAILY FREE REQ</span>
                  <div className="font-mono text-3xl text-white font-bold tracking-tight">
                    {usage ? (
                      <>{(usage.daily_free_requests_remaining ?? 0).toLocaleString()}<span className="text-zinc-700 text-sm ml-1">LEFT</span></>
                    ) : (
                      <span className="text-zinc-700 animate-pulse">[—]</span>
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-zinc-600 uppercase">
                    {usage?.daily_free_requests_reset_at ? `RESET ${new Date(usage.daily_free_requests_reset_at).toLocaleDateString()}` : 'ROLLS DAILY'}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="bg-[#050507] border border-zinc-900 p-4 space-y-2 flex flex-col justify-between">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">CONSUMED</span>
                  {(() => {
                    const remaining = usage?.monthly_points_remaining ?? 0
                    const limit = usage?.monthly_points_limit ?? 0
                    const pct = limit > 0 ? Math.min(100, Math.round(((limit - remaining) / limit) * 100)) : 0
                    return (
                      <>
                        <div className="font-mono text-3xl text-white font-bold tracking-tight">
                          {limit > 0 ? <>{pct}<span className="text-zinc-700 text-sm ml-1">%</span></> : <span className="text-zinc-700">N/A</span>}
                        </div>
                        <div className="w-full h-2 bg-zinc-950 border border-zinc-900 overflow-hidden">
                          <div
                            className="h-full bg-amber-500 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* Point transaction history */}
            <div className="bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-4">
              <div className="space-y-1">
                <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                  <div className="w-[3px] h-3 bg-amber-500" style={{ boxShadow: '0 0 8px rgba(245,158,11,0.6)' }}></div>
                  POINT_MOVEMENT_LEDGER
                </h2>
                <p className="text-[10px] font-mono text-zinc-500 uppercase">Every charge, refund, and monthly grant. Most recent first.</p>
              </div>

              {/* Summary strip */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#050507] border border-zinc-900 py-2">
                  <div className="font-mono text-base text-red-400 font-bold">{pointTxSummary.spent.toLocaleString()}</div>
                  <div className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">SPENT (SHOWN)</div>
                </div>
                <div className="bg-[#050507] border border-zinc-900 py-2">
                  <div className="font-mono text-base text-emerald-400 font-bold">{pointTxSummary.refunded.toLocaleString()}</div>
                  <div className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">REFUNDED</div>
                </div>
                <div className="bg-[#050507] border border-zinc-900 py-2">
                  <div className="font-mono text-base text-amber-400 font-bold">{pointTxSummary.granted.toLocaleString()}</div>
                  <div className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">GRANTED</div>
                </div>
              </div>

              {/* Filter */}
              <div className="flex items-center gap-1 text-[10px] font-mono uppercase">
                {(['all', 'charge', 'refund', 'grant'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setPointTxKind(k)}
                    className={`px-2.5 py-1 border tracking-wider transition-colors ${
                      pointTxKind === k
                        ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                        : 'border-zinc-900 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    {k === 'all' ? 'ALL' : kindLabel(k)}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  onClick={refetchPointTx}
                  className="px-2.5 py-1 border border-zinc-900 text-zinc-500 hover:text-amber-400 hover:border-amber-500/40 tracking-wider"
                  title="Refresh"
                >
                  {pointTxLoading ? '...' : 'REFRESH'}
                </button>
              </div>

              {/* Table */}
              {pointTxLoading && pointTx.length === 0 ? (
                <div className="font-mono text-[10px] text-zinc-500 text-center py-6 uppercase animate-pulse">LOADING LEDGER...</div>
              ) : pointTx.length === 0 ? (
                <div className="font-mono text-[10px] text-zinc-500 text-center py-6 uppercase border border-dashed border-zinc-900">
                  NO {pointTxKind === 'all' ? '' : pointTxKind.toUpperCase() + ' '}TRANSACTIONS YET
                </div>
              ) : (
                <div className="border border-zinc-900 divide-y divide-zinc-900 max-h-[400px] overflow-y-auto">
                  {pointTx.map(tx => {
                    const modelLabel = tx.model_alias ? (aliasToDisplay[tx.model_alias] || tx.model_alias) : null
                    return (
                      <div key={tx.id} className="grid grid-cols-[80px_1fr_auto_auto] gap-3 items-center px-3 py-2 hover:bg-zinc-950/50 transition-colors font-mono text-[11px]">
                        <span className={`font-bold tracking-wider ${kindColor(tx.kind)}`}>{kindLabel(tx.kind)}</span>
                        <div className="min-w-0">
                          <div className="text-zinc-300 truncate">
                            {tx.reason || (modelLabel ? `Call: ${modelLabel}` : '—')}
                          </div>
                          <div className="text-[9px] text-zinc-600 uppercase tracking-wider">
                            {new Date(tx.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {tx.created_by && tx.created_by !== 'system' && <span className="ml-2">· {tx.created_by}</span>}
                          </div>
                        </div>
                        <span className={`font-bold tabular-nums ${kindColor(tx.kind)}`}>
                          {formatPointDelta(tx.kind, tx.points)}
                        </span>
                        <span className="text-[10px] text-zinc-500 tabular-nums whitespace-nowrap">
                          BAL: {tx.balance_after.toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex justify-between text-[9px] font-mono text-zinc-600 uppercase tracking-wider pt-1">
                <span>SHOWING {pointTx.length} OF {pointTxTotal.toLocaleString()}</span>
                {pointTxTotal > pointTx.length && (
                  <span className="text-zinc-500">PAGINATION COMING SOON</span>
                )}
              </div>
            </div>

            {/* Sliding budgets card layout */}
            <div className="bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
              <div className="space-y-1">
                <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                  <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                  FIXED_CYCLE_WINDOW_TELEMETRY
                </h2>
                <p className="text-[10px] font-mono text-zinc-500 uppercase">Real-time fixed cycle token budgets reset automatically on system grids.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 5-Hour budget progress */}
                <div className="bg-[#050507] border border-zinc-900 p-5 space-y-4">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-zinc-400 font-bold uppercase tracking-wider">5-Hour Strict Fixed Cycle</span>
                    <span className="text-[#ef4444] font-bold">
                      {usage ? `${(usage.progress_percentage_5h ?? 0).toFixed(1)}%` : <span className="animate-pulse">0.0%</span>}
                    </span>
                  </div>
                  
                  {/* Bar progress */}
                  <div className="w-full h-2.5 bg-zinc-950 border border-zinc-900 overflow-hidden">
                    <div 
                      className={`h-full bg-[#ef4444] red-glow transition-all duration-500 ${!usage ? 'animate-pulse bg-zinc-800' : ''}`}
                      style={{ width: `${usage ? (usage.progress_percentage_5h ?? 0) : 0}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 uppercase">
                    <span>QUOTA CONSUMED</span>
                    <span>LIMIT: 100%</span>
                  </div>

                  {usage && (secondsLeft5h !== null && secondsLeft5h > 0) ? (
                    <div className="border-t border-zinc-900 pt-3 flex justify-between items-center text-[9px] font-mono">
                      <span className="text-zinc-500 uppercase tracking-wide">[TIME_UNTIL_RESET]</span>
                      <span className="text-[#ef4444] font-bold tracking-wider">{formatRemainingTime(secondsLeft5h)}</span>
                    </div>
                  ) : (
                    usage && (
                      <div className="border-t border-zinc-900 pt-3 flex justify-between items-center text-[9px] font-mono">
                        <span className="text-zinc-650 uppercase tracking-wide">[STATUS]</span>
                        <span className="text-emerald-500 font-bold uppercase tracking-widest">[WINDOW_IDLE_CLEAN]</span>
                      </div>
                    )
                  )}
                </div>

                {/* 7-Day budget progress */}
                <div className="bg-[#050507] border border-zinc-900 p-5 space-y-4">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-zinc-400 font-bold uppercase tracking-wider">7-Day Strict Fixed Cycle</span>
                    <span className="text-[#ef4444] font-bold">
                      {usage ? `${(usage.progress_percentage_7d ?? 0).toFixed(1)}%` : <span className="animate-pulse">0.0%</span>}
                    </span>
                  </div>

                  {/* Bar progress */}
                  <div className="w-full h-2.5 bg-zinc-950 border border-zinc-900 overflow-hidden">
                    <div 
                      className={`h-full bg-[#ef4444] red-glow transition-all duration-500 ${!usage ? 'animate-pulse bg-zinc-800' : ''}`}
                      style={{ width: `${usage ? (usage.progress_percentage_7d ?? 0) : 0}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 uppercase">
                    <span>QUOTA CONSUMED</span>
                    <span>LIMIT: 100%</span>
                  </div>

                  {usage && (secondsLeft7d !== null && secondsLeft7d > 0) ? (
                    <div className="border-t border-zinc-900 pt-3 flex justify-between items-center text-[9px] font-mono">
                      <span className="text-zinc-500 uppercase tracking-wide">[TIME_UNTIL_RESET]</span>
                      <span className="text-[#ef4444] font-bold tracking-wider">{formatRemainingTime(secondsLeft7d)}</span>
                    </div>
                  ) : (
                    usage && (
                      <div className="border-t border-zinc-900 pt-3 flex justify-between items-center text-[9px] font-mono">
                        <span className="text-zinc-650 uppercase tracking-wide">[STATUS]</span>
                        <span className="text-emerald-500 font-bold uppercase tracking-widest">[WINDOW_IDLE_CLEAN]</span>
                      </div>
                    )
                  )}
                </div>

              </div>

              {/* Token Accumulations breakdown */}
              <div className="border-t border-zinc-900 pt-6 space-y-4">
                <div className="space-y-1">
                  <h3 className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider font-bold">ACTIVE_PERIOD_TOKEN_ACCUMULATIONS</h3>
                  <p className="text-[9px] text-zinc-600 font-mono uppercase">Raw token telemetry counts accumulated since the last budget reset.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-[#050507] border border-zinc-900 p-5 flex flex-col justify-center">
                    <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">Input Tokens Count</span>
                    <span className="font-mono text-xl text-white font-bold tracking-wider mt-1">
                      {usage ? (usage.consumed_tokens_input ?? 0).toLocaleString() : <span className="text-zinc-700 animate-pulse">[LOAD_TOKENS...]</span>}
                      {usage && <span className="text-zinc-700 text-[11px] ml-1.5">TOKENS</span>}
                    </span>
                  </div>

                  <div className="bg-[#050507] border border-zinc-900 p-5 flex flex-col justify-center">
                    <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">Output Tokens Count</span>
                    <span className="font-mono text-xl text-white font-bold tracking-wider mt-1">
                      {usage ? (usage.consumed_tokens_output ?? 0).toLocaleString() : <span className="text-zinc-700 animate-pulse">[LOAD_TOKENS...]</span>}
                      {usage && <span className="text-zinc-700 text-[11px] ml-1.5">TOKENS</span>}
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {usage?.tier === 'free' && (
              <div className="bg-[#ef4444]/10 border border-[#ef4444] p-5 font-mono text-xs text-[#ef4444] tracking-wider uppercase animate-pulse flex flex-col gap-2">
                <div>[WARNING: ACCOUNT_INACTIVE_FREE_TIER_ENFORCES_0_LIMITS]</div>
                <div className="text-[10px] text-zinc-500 lowercase font-normal">[API completions are currently disabled. Please select a billing profile below to activate your account.]</div>
              </div>
            )}

            {/* Subscription Plans Section */}
            <div className="bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-900 pb-4">
                <div className="space-y-1">
                  <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                    <div className="w-[3px] h-3 bg-[#ef4444] red-glow"></div>
                    SYSTEM_SUBSCRIPTION_PROFILES
                  </h2>
                  <p className="text-[10px] font-mono text-zinc-500 uppercase font-medium">
                    Select a plan via Whop Secure Checkout to adjust your system limits.
                  </p>
                </div>
                {usage?.tier && usage.tier !== 'free' && (
                  <a 
                    href="https://whop.com/hub/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[9px] text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-500 px-3 py-1.5 bg-zinc-950 transition-colors uppercase tracking-widest font-bold"
                  >
                    Manage Subscription ↗
                  </a>
                )}
              </div>

              {checkoutError && (
                <div className="bg-[#ef4444]/10 border border-[#ef4444] p-3 font-mono text-[10px] text-[#ef4444] uppercase tracking-wider">
                  [CHECKOUT_ERROR]: {checkoutError}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
                {getDisplayPlans().map((plan) => {
                  const isCurrent = usage?.tier === plan.key;
                  const isLoading = checkoutLoading === plan.key;

                  return (
                    <div 
                      key={plan.key} 
                      className={`relative bg-[#050507] border ${isCurrent ? 'border-[#ef4444] red-glow' : 'border-zinc-900'} p-6 flex flex-col justify-between transition-all hover:border-zinc-700`}
                    >
                      {plan.badge && (
                        <div className="absolute top-0 right-6 -translate-y-1/2 bg-[#ef4444] text-white font-mono text-[8px] font-bold px-2 py-0.5 tracking-widest uppercase red-glow">
                          {plan.badge}
                        </div>
                      )}

                      <div className="space-y-4">
                        <div className="space-y-1">
                          <h3 className="font-mono text-xs text-white font-bold uppercase tracking-wider">{plan.name}</h3>
                          <p className="text-[9px] font-mono text-zinc-500 min-h-[30px] uppercase font-medium">{plan.desc}</p>
                        </div>

                        <div className="flex items-baseline gap-1 py-2 border-y border-zinc-900">
                          <span className="font-mono text-2xl text-white font-bold tracking-tighter">{plan.price}</span>
                          <span className="font-mono text-[9px] text-zinc-500 uppercase">/ {plan.billing}</span>
                        </div>

                        <ul className="space-y-2 font-mono text-[9px] text-zinc-400">
                          {plan.limits.map((limit, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <span className="w-1 h-1 bg-[#ef4444] red-glow"></span>
                              <span className="uppercase">{limit}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="pt-6 mt-auto">
                        <button
                          disabled={isCurrent || isLoading}
                          onClick={() => handleCheckout(plan.key)}
                          className={`w-full font-mono text-[9px] py-3 transition-all tracking-widest uppercase font-bold border ${
                            isCurrent 
                              ? 'bg-zinc-950 border-zinc-800 text-zinc-500 cursor-not-allowed'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white'
                          }`}
                        >
                          {isCurrent 
                            ? 'CURRENT_PLAN' 
                            : isLoading 
                              ? 'INITIALIZING...' 
                              : plan.key === 'pro' 
                                ? 'START FREE TRIAL' 
                                : 'SUBSCRIBE NOW'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 text-center border-t border-zinc-900">
                <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest leading-relaxed">
                  * Need custom limits or an enterprise setup? Please contact support at <a href="mailto:support@akarouter.com" className="text-[#ef4444] hover:underline font-bold">support@akarouter.com</a> to custom configure your plan.
                </p>
              </div>
            </div>

          </div>
        </main>
      </div>

    </div>
  )
}
