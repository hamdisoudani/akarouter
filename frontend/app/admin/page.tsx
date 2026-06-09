'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  getMe,
  adminGetAccounts,
  adminUpdateAccount,
  adminGetPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminDeletePlan,
  adminGetSettings,
  adminUpdateSettings,
  adminGetModels,
  adminUpdateModel,
  type PlanPreset,
  type AdminModelMapping
} from '@/lib/api'
import { 
  Shield, 
  ArrowLeft, 
  Plus, 
  RefreshCw, 
  Activity, 
  ExternalLink,
  Cpu,
  BarChart3,
  ServerCrash,
  Users,
  Copy,
  Check,
  Terminal,
  LogOut,
  KeyRound,
  Search,
  Ban,
  Edit,
  Trash2,
  Menu,
  X,
  Layers,
  FileText
} from 'lucide-react'

interface ProviderAccount {
  id: string
  account_label: string | null
  health_status: string
  weight: number
  total_requests: number
  total_errors: number
  in_flight: number
  max_concurrent: number
  last_used_at: string | null
  last_error_msg: string | null
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-400 shadow-emerald-500/50', 
    healthy: 'bg-emerald-400 shadow-emerald-500/50', 
    refreshing: 'bg-sky-400 shadow-sky-500/50',
    degraded: 'bg-amber-400 shadow-amber-500/50', 
    dead: 'bg-[#ef4444] shadow-[#ef4444]/50', 
    pending: 'bg-zinc-500 shadow-zinc-500/50',
  }
  return (
    <span className="flex items-center gap-2 font-mono">
      <span className={`w-1.5 h-1.5 rounded-full status-pulse ${colors[status] || 'bg-zinc-550'}`} />
      <span className="text-zinc-400 capitalize text-[10px] tracking-wider">{status}</span>
    </span>
  )
}

export default function AdminDashboard() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [providers, setProviders] = useState<ProviderAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [addingAccount, setAddingAccount] = useState(false)
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{
    flow_id: string; verification_uri: string; verification_uri_complete: string; user_code: string
  } | null>(null)
  const [pollStatus, setPollStatus] = useState('')
  const [pollResult, setPollResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<any>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  
  // Track copied and refresh state
  const [copiedUserCode, setCopiedUserCode] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'providers' | 'users' | 'plans' | 'settings'>('providers')

  // Settings & Models state
  const [systemSettings, setSystemSettings] = useState<any>({ gateway_enabled: 'true' })
  const [adminModels, setAdminModels] = useState<AdminModelMapping[]>([])
  const [loadingSettings, setLoadingSettings] = useState(false)

  // Plans state
  const [plans, setPlans] = useState<PlanPreset[]>([])
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [newPlanTier, setNewPlanTier] = useState('')
  const [newPlanLimit, setNewPlanLimit] = useState(10.0)
  const [newPlanRpm, setNewPlanRpm] = useState(60)
  const [newPlan5h, setNewPlan5h] = useState(1.0)
  const [newPlan7d, setNewPlan7d] = useState(5.0)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editingPlanLimit, setEditingPlanLimit] = useState<number>(10.0)
  const [editingPlanRpm, setEditingPlanRpm] = useState<number>(60)
  const [editingPlan5h, setEditingPlan5h] = useState<number>(1.0)
  const [editingPlan7d, setEditingPlan7d] = useState<number>(5.0)

  // Users state
  const [accounts, setAccounts] = useState<any[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [editingDisplayName, setEditingDisplayName] = useState('')
  const [editingTier, setEditingTier] = useState('')
  const [editingLimit, setEditingLimit] = useState(10.0)
  const [editingRpmLimit, setEditingRpmLimit] = useState<number>(60)
  const [editingTokens5hLimit, setEditingTokens5hLimit] = useState<number>(1.0)
  const [editingTokens7dLimit, setEditingTokens7dLimit] = useState<number>(5.0)
  const [editingRole, setEditingRole] = useState('user')
  const [editingStatus, setEditingStatus] = useState('active')
  const [editingSuspendedReason, setEditingSuspendedReason] = useState('')
  const [updatingAccount, setUpdatingAccount] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/auth/login'); return }
      setToken(session.access_token)
      try {
        const me = await getMe(session.access_token)
        if (me.role !== 'admin') { router.push('/dashboard'); return }
        setIsAdmin(true)
        setUser(me)
      } catch {
        const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY
        if (adminKey) {
          setToken(adminKey)
          setIsAdmin(true)
          setUser({ email: 'ADMIN_BYPASS', role: 'admin' })
        }
        else { router.push('/dashboard'); return }
      }
      setAuthChecked(true)
    })
  }, [router])

  const loadProviders = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/admin/providers`, { headers: authHeaders() })
      if (res.ok) { const data = await res.json(); setProviders(data.providers || []) }
    } catch {}
    setLoading(false)
  }, [API_URL, token, authHeaders])

  const loadStats = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/admin/stats`, { headers: authHeaders() })
      if (res.ok) setStats(await res.json())
    } catch {}
  }, [API_URL, token, authHeaders])

  const loadPlans = useCallback(async () => {
    if (!token) return
    setLoadingPlans(true)
    try {
      const data = await adminGetPlans(token)
      setPlans(data.plans || [])
    } catch {}
    setLoadingPlans(false)
  }, [token])

  const loadAccounts = useCallback(async (search?: string) => {
    if (!token) return
    setLoadingAccounts(true)
    try {
      const data = await adminGetAccounts(token, search)
      setAccounts(data.accounts || [])
    } catch {}
    setLoadingAccounts(false)
  }, [token])

  const loadSettings = useCallback(async () => {
    if (!token) return
    setLoadingSettings(true)
    try {
      const data = await adminGetSettings(token)
      setSystemSettings(data.settings)
    } catch {}
    setLoadingSettings(false)
  }, [token])

  const loadAdminModels = useCallback(async () => {
    if (!token) return
    try {
      const data = await adminGetModels(token)
      setAdminModels(data.models || [])
    } catch {}
  }, [token])

  useEffect(() => {
    if (!authChecked || !isAdmin) return
    loadProviders(); loadStats(); loadPlans(); loadAccounts(); loadSettings(); loadAdminModels()
    const channel = supabase
      .channel('admin-providers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'providers' }, (payload: any) => {
        setProviders(prev => {
          const next = [...prev]
          const idx = next.findIndex(a => a.id === (payload.new?.id || payload.old?.id))
          if (payload.eventType === 'INSERT' && payload.new && idx === -1) next.push(payload.new as ProviderAccount)
          else if (payload.eventType === 'UPDATE' && payload.new && idx >= 0) next[idx] = payload.new as ProviderAccount
          else if (payload.eventType === 'DELETE' && payload.old && idx >= 0) next.splice(idx, 1)
          return next
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [authChecked, isAdmin, loadProviders, loadStats, loadPlans, loadAccounts, loadSettings, loadAdminModels])

  // Plan Preset Handlers
  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPlanTier) return
    try {
      await adminCreatePlan(token, newPlanTier.toLowerCase(), newPlanLimit, newPlanRpm, newPlan5h, newPlan7d)
      setNewPlanTier('')
      setNewPlanLimit(10.0)
      setNewPlanRpm(60)
      setNewPlan5h(1.0)
      setNewPlan7d(5.0)
      await loadPlans()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleUpdatePlan = async (planId: string) => {
    try {
      await adminUpdatePlan(token, planId, {
        monthly_limit: editingPlanLimit,
        rpm_limit: editingPlanRpm,
        tokens_5h_limit: editingPlan5h,
        tokens_7d_limit: editingPlan7d,
      })
      setEditingPlanId(null)
      await loadPlans()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDeletePlan = async (planId: string) => {
    if (!confirm('Are you sure you want to delete this plan preset?')) return
    try {
      await adminDeletePlan(token, planId)
      await loadPlans()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Account Handlers
  const handleEditAccountClick = (acc: any) => {
    setEditingAccountId(acc.id)
    setEditingDisplayName(acc.display_name || '')
    setEditingTier(acc.tier || 'free')
    setEditingLimit(acc.monthly_limit || 10.0)
    setEditingRole(acc.role || 'user')
    setEditingStatus(acc.status || 'active')
    setEditingSuspendedReason(acc.suspended_reason || '')
    setEditingRpmLimit(acc.rpm_limit ?? 60)
    setEditingTokens5hLimit(acc.tokens_5h_limit ?? 1.0)
    setEditingTokens7dLimit(acc.tokens_7d_limit ?? 5.0)
  }

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAccountId) return
    setUpdatingAccount(true)
    try {
      await adminUpdateAccount(token, editingAccountId, {
        display_name: editingDisplayName,
        tier: editingTier,
        monthly_limit: Number(editingLimit),
        role: editingRole,
        status: editingStatus,
        suspended_reason: editingStatus === 'suspended' ? editingSuspendedReason : null,
        rpm_limit: Number(editingRpmLimit),
        tokens_5h_limit: Number(editingTokens5hLimit),
        tokens_7d_limit: Number(editingTokens7dLimit),
      })
      setEditingAccountId(null)
      await loadAccounts(searchQuery)
      await loadStats()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUpdatingAccount(false)
    }
  }

  const handleTierChange = (tierName: string) => {
    setEditingTier(tierName)
    const matchedPlan = plans.find(p => p.tier === tierName)
    if (matchedPlan) {
      setEditingLimit(matchedPlan.monthly_limit)
      setEditingRpmLimit(matchedPlan.rpm_limit ?? 60)
      setEditingTokens5hLimit(matchedPlan.tokens_5h_limit ?? 1.0)
      setEditingTokens7dLimit(matchedPlan.tokens_7d_limit ?? 5.0)
    }
  }

  const handleBanUser = async (acc: any) => {
    const reason = prompt(`Enter suspension reason for user ${acc.email}:`)
    if (reason === null) return
    try {
      await adminUpdateAccount(token, acc.id, {
        status: 'suspended',
        suspended_reason: reason || 'Suspended by Administrator'
      })
      await loadAccounts(searchQuery)
      await loadStats()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleUnbanUser = async (acc: any) => {
    try {
      await adminUpdateAccount(token, acc.id, {
        status: 'active',
        suspended_reason: null
      })
      await loadAccounts(searchQuery)
      await loadStats()
    } catch (err: any) {
      setError(err.message)
    }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const startStatusPolling = useCallback((flowId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/admin/providers/oauth/status/${flowId}`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        setPollStatus(data.status)
        setPollResult(data.result || null)
        if (data.status === 'authorized') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null; setDeviceCodeInfo(null); loadProviders(); loadStats()
        } else if (data.status === 'failed' || data.status === 'timeout') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null; setError(data.error || `OAuth ${data.status}`)
        }
      } catch {}
    }
    pollRef.current = setInterval(check, 5000); check()
  }, [API_URL, authHeaders, loadProviders, loadStats])

  const handleAddAccount = async () => {
    setAddingAccount(true); setPollStatus(''); setPollResult(null); setError('')
    setCopiedUserCode(false)
    try {
      const label = `hermes-${Date.now().toString(36)}`
      const res = await fetch(`${API_URL}/admin/providers/oauth/initiate?account_label=${label}`, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error(`Initiate failed: ${res.status}`)
      const data = await res.json()
      setDeviceCodeInfo({ flow_id: data.flow_id, verification_uri: data.verification_uri, verification_uri_complete: data.verification_uri_complete || '', user_code: data.user_code })
      setPollStatus('pending')
      const pollRes = await fetch(`${API_URL}/admin/providers/oauth/poll/${data.flow_id}`, { method: 'POST', headers: authHeaders() })
      if (pollRes.ok) { setPollStatus('polling'); startStatusPolling(data.flow_id) }
    } catch (err: any) { setError(err.message) } finally { setAddingAccount(false) }
  }

  const handleRefresh = async (id: string) => {
    setRefreshingId(id)
    try { 
      await fetch(`${API_URL}/admin/providers/${id}/refresh`, { method: 'POST', headers: authHeaders() })
      await loadProviders() 
    } catch {}
    setRefreshingId(null)
  }

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  if (!authChecked) {
    return (
      <div className="relative min-h-screen bg-[#09090b] flex items-center justify-center overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-[#ef4444]/5 rounded-full blur-[80px]" />
        <div className="text-zinc-500 font-mono text-xs flex items-center gap-2 z-10 uppercase tracking-widest">
          <Activity className="w-5 h-5 animate-pulse text-[#ef4444] red-glow" />
          Verifying credentials...
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="bg-[#0e0e10] border border-[#ef4444]/30 p-6 text-center max-w-sm crosshair-corners">
          <p className="text-[#ef4444] font-mono font-bold text-xs uppercase tracking-widest">Access Denied</p>
          <p className="text-zinc-500 font-mono text-[10px] mt-2 uppercase tracking-wide">You must possess administrator privileges to access this area.</p>
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

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors group" href="/docs">
            <span className="border border-zinc-800 p-1 group-hover:border-zinc-500 transition-colors flex items-center justify-center">
              <FileText className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Docs</span>
          </Link>

          <Link className="flex items-center gap-3 px-3 py-2 w-full text-white nav-item-active" href="/admin">
            <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
              <Shield className="w-3.5 h-3.5 text-[#ef4444]" />
            </span>
            <span className="tracking-widest font-mono uppercase text-[11px]">Admin Panel</span>
          </Link>
        </div>

        <div className="px-6 mt-auto">
          <div className="font-mono text-[9px] text-zinc-600 mb-2 flex justify-between tracking-tighter">
            <span>[SYS_SESSION]</span>
            <span className="text-[#ef4444] uppercase font-bold">Admin</span>
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
                <Layers className="w-3.5 h-3.5 text-zinc-450" />
              </span>
              <span className="tracking-widest font-mono uppercase text-xs">Usage</span>
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
                className="flex items-center gap-3 px-4 py-3 w-full border border-[#ef4444] bg-[#ef4444]/10 text-white red-glow"
                href="/admin"
              >
                <span className="border border-[#ef4444] p-1 bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center red-glow">
                  <Shield className="w-3.5 h-3.5 text-[#ef4444]" />
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
            <span className="tracking-[0.2em] uppercase font-bold text-zinc-300">ADMINISTRATOR CONTROL MATRIX</span>
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
          <div className="p-6 space-y-6">
            
            {error && (
              <div className="p-4 bg-[#ef4444]/10 border border-[#ef4444] text-[11px] font-mono text-[#ef4444] flex items-center justify-between animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
                  {error.toUpperCase()}
                </div>
                <button onClick={() => setError('')} className="text-[#ef4444] hover:text-red-400 font-bold ml-4 text-base">×</button>
              </div>
            )}

            {/* Admin Stats Grid */}
            {stats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 animate-slide-in">
                <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-1 relative">
                  <span className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[7px] text-zinc-600">ST_01</span>
                  <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Total Providers</p>
                  <p className="text-2xl font-bold text-white font-mono">{stats.providers?.total || 0}</p>
                  <p className="text-[9px] text-emerald-400 font-mono uppercase">{stats.providers?.active || 0} active connections</p>
                </div>
                <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-1 relative">
                  <span className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[7px] text-zinc-600">ST_02</span>
                  <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Routed Requests</p>
                  <p className="text-2xl font-bold text-white font-mono">{(stats.providers?.total_requests || 0).toLocaleString()}</p>
                  <p className="text-[9px] text-zinc-600 font-mono uppercase">all provider channels</p>
                </div>
                <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-1 relative">
                  <span className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[7px] text-zinc-600">ST_03</span>
                  <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Request Errors</p>
                  <p className={`text-2xl font-bold font-mono ${stats.providers?.total_errors > 0 ? 'text-[#ef4444] red-glow-text' : 'text-zinc-400'}`}>
                    {stats.providers?.total_errors || 0}
                  </p>
                  <p className="text-[9px] text-zinc-650 font-mono uppercase">aggregated fail logs</p>
                </div>
                <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-1 relative">
                  <span className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[7px] text-zinc-600">ST_04</span>
                  <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Active Users</p>
                  <p className="text-2xl font-bold text-[#ef4444] font-mono red-glow-text">{stats.accounts?.total || 0}</p>
                  <p className="text-[9px] text-emerald-400 font-mono uppercase">{stats.accounts?.active || 0} active sessions</p>
                </div>
                <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-1 relative">
                  <span className="absolute right-0 top-0 p-1 bg-zinc-900 border-b border-l border-zinc-800 font-mono text-[7px] text-zinc-600">ST_05</span>
                  <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Global consumed Tokens</p>
                  <p className="text-2xl font-bold text-white font-mono">
                    {stats.global_telemetry?.total_consumed_million_tokens ? `${stats.global_telemetry.total_consumed_million_tokens.toFixed(3)}M` : '0.000M'}
                  </p>
                  <p className="text-[9px] text-zinc-600 font-mono uppercase">million tokens count</p>
                </div>
                <div className="bg-[#0e0e10] border border-zinc-900 p-5 space-y-1 relative bg-emerald-500/5">
                  <span className="absolute right-0 top-0 p-1 bg-emerald-500/20 border-b border-l border-emerald-500/30 font-mono text-[7px] text-emerald-450 font-bold">ST_06</span>
                  <p className="text-[9px] text-zinc-400 font-mono uppercase tracking-wider">global consumed cost</p>
                  <p className="text-2xl font-bold text-emerald-400 font-mono">
                    ${stats.global_telemetry?.total_cost ? stats.global_telemetry.total_cost.toFixed(4) : '0.0000'}
                  </p>
                  <p className="text-[9px] text-emerald-500 font-mono uppercase">aggregated cost usd</p>
                </div>
              </div>
            )}
            {/* Tabs Selector Navigation */}
            <div className="flex border-b border-zinc-900 bg-zinc-950/40 p-1 mb-6 overflow-x-auto whitespace-nowrap scrollbar-none">
              <button
                onClick={() => setActiveTab('providers')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 ${
                  activeTab === 'providers'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                [01_PROVIDERS]
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 ${
                  activeTab === 'users'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                [02_USER_MATRIX]
              </button>
              <button
                onClick={() => setActiveTab('plans')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 ${
                  activeTab === 'plans'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                [03_PLAN_PRESETS]
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 ${
                  activeTab === 'settings'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                [04_SYSTEM_CONTROL]
              </button>
            </div>

            {/* Tab Panel: Providers */}
            {activeTab === 'providers' && (
              <section className="bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-5 animate-slide-in relative">
                <div className="absolute inset-0 opacity-[0.03] micro-grid pointer-events-none" />
                
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Cpu className="w-4 h-4 text-[#ef4444]" />
                      HERMES_PROVIDER_CONNECTIONS
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Connect and manage provider accounts, balance weights, and trigger manual key syncs.</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-[9px] text-zinc-500 font-mono uppercase tracking-wider bg-zinc-950 border border-zinc-900 px-2.5 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      REALTIME_STREAM
                    </span>
                    <button
                      onClick={handleAddAccount}
                      disabled={addingAccount}
                      className="bg-[#ef4444] text-black font-mono text-xs font-bold py-2 px-4 hover:bg-[#ff5451] transition-all disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      {addingAccount ? 'CONNECTING...' : 'ADD PROVIDER'}
                    </button>
                  </div>
                </div>

                {deviceCodeInfo && (
                  <div className="p-5 bg-[#090506] border border-[#ef4444]/20 text-[11px] font-mono space-y-4 animate-fade-in relative">
                    <div className="absolute right-2 top-2 w-2 h-2 bg-[#ef4444] red-glow" />
                    <div className="space-y-1 border-b border-[#ef4444]/10 pb-3">
                      <h3 className="font-bold text-[#ef4444] uppercase tracking-wider">[SYSTEM_OVERRIDE_OAUTH_REQUIRED]</h3>
                      <p className="text-zinc-500 text-[9px] uppercase">Follow authorization matrix to connect new Hermes provider account.</p>
                    </div>

                    <ol className="space-y-2 text-zinc-300 list-decimal list-inside leading-relaxed uppercase">
                      <li>
                        Open verification URL: 
                        <a 
                          href={deviceCodeInfo.verification_uri_complete || deviceCodeInfo.verification_uri} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="inline-flex items-center gap-1 text-[#ef4444] hover:text-[#ff5451] font-bold underline ml-1.5"
                        >
                          {deviceCodeInfo.verification_uri}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </li>
                      <li className="flex items-center flex-wrap gap-2">
                        Enter user authorization code: 
                        <code className="bg-[#ef4444]/10 border border-[#ef4444]/25 text-[#ef4444] px-2 py-0.5 font-mono font-bold text-xs select-all">
                          {deviceCodeInfo.user_code}
                        </code>
                        <button 
                          onClick={() => copyToClipboard(deviceCodeInfo.user_code, setCopiedUserCode)}
                          className="p-1 border border-zinc-800 bg-zinc-950 hover:text-white text-zinc-500 transition-all shrink-0"
                          title="Copy Code"
                        >
                          {copiedUserCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </li>
                    </ol>

                    <div className="flex items-center gap-3 pt-2">
                      <StatusDot status={pollStatus} />
                      {pollStatus === 'polling' && (
                        <span className="text-[9px] text-zinc-500 animate-pulse font-mono uppercase">
                          Waiting for provider authorization code input…
                        </span>
                      )}
                    </div>
                    {pollResult && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 uppercase font-mono">
                        ✓ Provider account <strong>{pollResult.account_label}</strong> connected successfully!
                      </div>
                    )}
                  </div>
                )}

                {loading ? (
                  <div className="py-12 text-center font-mono text-xs text-zinc-600 uppercase">[SYNCHRONIZING_CONNECTIONS_TABLE]</div>
                ) : providers.length === 0 ? (
                  <p className="text-xs text-zinc-650 py-6 font-mono uppercase text-center">[NO_ACTIVE_Hermes_CONNECTIONS_CONNECTED_GENERATE_DEVICE_AUTH]</p>
                ) : (
                  <div className="overflow-x-auto border border-zinc-900 bg-zinc-950/20">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead>
                        <tr className="border-b border-zinc-900 bg-zinc-950/60 text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">
                          <th className="p-4">Label</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Concurrency Load</th>
                          <th className="p-4">Requests</th>
                          <th className="p-4">Errors</th>
                          <th className="p-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900/40">
                        {providers.map(a => (
                          <tr key={a.id} className="hover:bg-zinc-900/10 transition-colors">
                            <td className="p-4 font-bold text-white uppercase">{a.account_label || '—'}</td>
                            <td className="p-4"><StatusDot status={a.health_status} /></td>
                            <td className="p-4 text-zinc-400">{a.in_flight}/{a.max_concurrent}</td>
                            <td className="p-4 text-zinc-400 font-mono">{(a.total_requests || 0).toLocaleString()}</td>
                            <td className="p-4 text-[#ef4444] font-mono">{(a.total_errors || 0).toLocaleString()}</td>
                            <td className="p-4 text-right">
                              <button 
                                onClick={() => handleRefresh(a.id)} 
                                disabled={refreshingId === a.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1 border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-550 transition-all disabled:opacity-50 text-[10px]"
                              >
                                <RefreshCw className={`w-3 h-3 ${refreshingId === a.id ? 'animate-spin' : ''}`} />
                                SYNC
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* Tab Panel: User Matrix */}
            {activeTab === 'users' && (
              <section className="bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-5 animate-slide-in relative">
                <div className="absolute inset-0 opacity-[0.03] micro-grid pointer-events-none" />
                
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Users className="w-4 h-4 text-[#ef4444]" />
                      USER_ACCOUNT_ADMINISTRATION
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Search, filter, update details, adjust limitations, and ban/unban user accounts.</p>
                  </div>

                  <form onSubmit={(e) => { e.preventDefault(); loadAccounts(searchQuery) }} className="flex gap-2 w-full md:max-w-md">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                      <input
                        type="text"
                        placeholder="SEARCH BY EMAIL OR NAME..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-900 pl-9 pr-4 py-2 text-xs font-mono text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444] transition-colors"
                      />
                    </div>
                    <button
                      type="submit"
                      className="bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px] font-bold px-4 hover:border-[#ef4444] hover:bg-[#ef4444]/5 hover:text-white transition-all"
                    >
                      QUERY
                    </button>
                  </form>
                </div>

                {loadingAccounts ? (
                  <div className="py-12 text-center font-mono text-xs text-zinc-650 uppercase animate-pulse">[LOADING_ACCOUNTS_FROM_DB...]</div>
                ) : accounts.length === 0 ? (
                  <div className="py-12 text-center font-mono text-xs text-zinc-600 uppercase">[NO_USER_ACCOUNTS_FOUND_MATCHING_FILTER]</div>
                ) : (
                  <div className="overflow-x-auto border border-zinc-900 bg-zinc-950/20">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead>
                        <tr className="border-b border-zinc-900 bg-zinc-950/60 text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">
                          <th className="p-4">Email</th>
                          <th className="p-4">Name</th>
                          <th className="p-4">Plan / Tier</th>
                          <th className="p-4">Monthly Budget</th>
                          <th className="p-4">Role</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Tokens (M)</th>
                          <th className="p-4">Cost (USD)</th>
                          <th className="p-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900/40">
                        {accounts.map(acc => (
                          <tr key={acc.id} className="hover:bg-zinc-900/10 transition-colors">
                            <td className="p-4 text-white font-semibold">{acc.email}</td>
                            <td className="p-4 text-zinc-400">{acc.display_name || '—'}</td>
                            <td className="p-4">
                              <span className="px-2 py-0.5 border border-zinc-800 bg-zinc-900 text-zinc-300 text-[10px] uppercase font-bold">
                                {acc.tier}
                              </span>
                            </td>
                            <td className="p-4 text-zinc-400 font-mono">
                              {acc.monthly_limit >= 999999999 ? 'UNLIMITED' : `$${acc.monthly_limit.toFixed(2)}`}
                            </td>
                            <td className="p-4 text-zinc-400 uppercase text-[10px]">
                              {acc.role || 'user'}
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded-sm border ${
                                acc.status === 'active' 
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                                  : acc.status === 'suspended'
                                  ? 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444] red-glow-text'
                                  : 'bg-zinc-800/40 border-zinc-800 text-zinc-500'
                              }`}>
                                {acc.status}
                              </span>
                              {acc.status === 'suspended' && acc.suspended_reason && (
                                <p className="text-[9px] text-[#ef4444]/70 mt-1 uppercase max-w-xs truncate" title={acc.suspended_reason}>
                                  Reason: {acc.suspended_reason}
                                </p>
                              )}
                            </td>
                            <td className="p-4 font-mono text-zinc-400">
                              {acc.consumption?.million_tokens ? `${acc.consumption.million_tokens.toFixed(3)}M` : '0.000M'}
                            </td>
                            <td className="p-4 font-mono text-emerald-400 font-semibold">
                              ${acc.consumption?.cost ? acc.consumption.cost.toFixed(4) : '0.0000'}
                            </td>
                            <td className="p-4 text-right space-x-2">
                              <button 
                                onClick={() => handleEditAccountClick(acc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-550 transition-all text-[10px]"
                              >
                                <Edit className="w-3 h-3" />
                                EDIT
                              </button>

                              {acc.status === 'suspended' ? (
                                <button 
                                  onClick={() => handleUnbanUser(acc)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all text-[10px]"
                                >
                                  UNBAN
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleBanUser(acc)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] hover:bg-[#ef4444]/20 hover:text-red-400 transition-all text-[10px]"
                                >
                                  <Ban className="w-3 h-3" />
                                  BAN
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* Tab Panel: Plan Presets */}
            {activeTab === 'plans' && (
              <section className="grid grid-cols-12 gap-6 animate-slide-in relative">
                
                {/* Plans Table */}
                <div className="col-span-12 lg:col-span-8 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-4">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Shield className="w-4 h-4 text-[#ef4444]" />
                      PLAN_LIMITATIONS_TEMPLATES
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Define global default limitation templates. Users assigned to these plans will pull their request limits from here.</p>
                  </div>

                  {loadingPlans ? (
                    <div className="py-12 text-center font-mono text-xs text-zinc-650 uppercase animate-pulse">[LOADING_PLANS_FROM_DB...]</div>
                  ) : plans.length === 0 ? (
                    <p className="text-xs text-zinc-600 py-6 font-mono uppercase text-center">[NO_PLAN_PRESETS_DEFINED]</p>
                  ) : (
                    <div className="overflow-x-auto border border-zinc-900 bg-zinc-950/20">
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead>
                          <tr className="border-b border-zinc-900 bg-zinc-950/60 text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">
                            <th className="p-4">Plan Name</th>
                            <th className="p-4">Monthly Budget</th>
                            <th className="p-4">RPM Limit</th>
                            <th className="p-4">5H Budget</th>
                            <th className="p-4">7D Budget</th>
                            <th className="p-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900/40">
                          {plans.map(p => (
                            <tr key={p.id} className="hover:bg-zinc-900/10 transition-colors">
                              <td className="p-4 font-bold text-white uppercase">{p.tier}</td>
                              {editingPlanId === p.id ? (
                                <>
                                  <td className="p-4 text-zinc-300">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={editingPlanLimit}
                                      onChange={e => setEditingPlanLimit(Number(e.target.value))}
                                      className="bg-zinc-950 border border-zinc-900 px-2 py-1 text-white w-20 text-xs focus:outline-none focus:border-[#ef4444]"
                                    />
                                  </td>
                                  <td className="p-4 text-zinc-300">
                                    <input
                                      type="number"
                                      value={editingPlanRpm}
                                      onChange={e => setEditingPlanRpm(Number(e.target.value))}
                                      className="bg-zinc-950 border border-zinc-900 px-2 py-1 text-white w-16 text-xs focus:outline-none focus:border-[#ef4444]"
                                    />
                                  </td>
                                  <td className="p-4 text-zinc-300">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={editingPlan5h}
                                      onChange={e => setEditingPlan5h(Number(e.target.value))}
                                      className="bg-zinc-950 border border-zinc-900 px-2 py-1 text-white w-16 text-xs focus:outline-none focus:border-[#ef4444]"
                                    />
                                  </td>
                                  <td className="p-4 text-zinc-300">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={editingPlan7d}
                                      onChange={e => setEditingPlan7d(Number(e.target.value))}
                                      className="bg-zinc-950 border border-zinc-900 px-2 py-1 text-white w-16 text-xs focus:outline-none focus:border-[#ef4444]"
                                    />
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="p-4 text-zinc-300">
                                    {p.monthly_limit >= 999999999 ? 'UNLIMITED' : `$${p.monthly_limit.toFixed(2)}`}
                                  </td>
                                  <td className="p-4 text-zinc-300">{p.rpm_limit ?? 60} RPM</td>
                                  <td className="p-4 text-zinc-300">${(p.tokens_5h_limit ?? 1.0).toFixed(2)}</td>
                                  <td className="p-4 text-zinc-300">${(p.tokens_7d_limit ?? 5.0).toFixed(2)}</td>
                                </>
                              )}
                              <td className="p-4 text-right space-x-2">
                                {editingPlanId === p.id ? (
                                  <div className="inline-flex gap-2">
                                    <button onClick={() => handleUpdatePlan(p.id)} className="text-emerald-400 font-bold hover:underline">SAVE</button>
                                    <button onClick={() => setEditingPlanId(null)} className="text-zinc-500 font-bold hover:underline">CANCEL</button>
                                  </div>
                                ) : (
                                  <button 
                                    onClick={() => {
                                      setEditingPlanId(p.id);
                                      setEditingPlanLimit(p.monthly_limit);
                                      setEditingPlanRpm(p.rpm_limit ?? 60);
                                      setEditingPlan5h(p.tokens_5h_limit ?? 1.0);
                                      setEditingPlan7d(p.tokens_7d_limit ?? 5.0);
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-550 transition-all text-[10px]"
                                  >
                                    EDIT
                                  </button>
                                )}
                                
                                {/* Protect standard plans from accidental deletions */}
                                {!['free', 'pro', 'enterprise'].includes(p.tier) && (
                                  <button 
                                    onClick={() => handleDeletePlan(p.id)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] hover:bg-[#ef4444]/20 hover:text-red-400 transition-all text-[10px]"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    DELETE
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Plan Creation Panel */}
                <div className="col-span-12 lg:col-span-4 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-4">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Plus className="w-4 h-4 text-[#ef4444]" />
                      NEW_PLAN_PRESET
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Define a brand new subscription plan defaults.</p>
                  </div>

                  <form onSubmit={handleCreatePlan} className="space-y-4 font-mono text-xs text-zinc-300">
                    <div className="space-y-1">
                      <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Plan Name / Identifier</label>
                      <input
                        type="text"
                        placeholder="e.g. developer, startup, scale..."
                        value={newPlanTier}
                        onChange={e => setNewPlanTier(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white placeholder-zinc-800 focus:outline-none focus:border-[#ef4444]"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Default Monthly USD Budget ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={newPlanLimit}
                        onChange={e => setNewPlanLimit(Number(e.target.value))}
                        className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">RPM Limit</label>
                        <input
                          type="number"
                          value={newPlanRpm}
                          onChange={e => setNewPlanRpm(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">5h Budget ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={newPlan5h}
                          onChange={e => setNewPlan5h(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">7d Budget ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={newPlan7d}
                          onChange={e => setNewPlan7d(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-[#ef4444] text-black font-bold py-3 hover:bg-[#ff5451] transition-all flex items-center justify-center gap-2 group crosshair-corners"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="tracking-widest uppercase font-bold">CREATE TEMPLATE</span>
                    </button>
                  </form>
                </div>
              </section>
            )}

            {/* Tab Panel: Settings */}
            {activeTab === 'settings' && (
              <section className="grid grid-cols-12 gap-6 animate-slide-in relative">
                {/* Global Gateway Status Switch Card */}
                <div className="col-span-12 lg:col-span-6 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Shield className="w-4 h-4 text-[#ef4444]" />
                      GLOBAL_GATEWAY_SUSPENSION
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Stop the entire OpenAI compatibility endpoint. If offline, users will see an alert and all completions fail with 503.
                    </p>
                  </div>

                  <div className="p-5 bg-zinc-950 border border-zinc-900 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs text-zinc-400 uppercase tracking-wider font-bold">
                        API GATEWAY ENDPOINT STATUS:
                      </span>
                      <span className={`px-2 py-0.5 font-mono text-[9px] font-bold uppercase rounded-sm border ${
                        systemSettings.gateway_enabled === 'true'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444] red-glow-text animate-pulse'
                      }`}>
                        {systemSettings.gateway_enabled === 'true' ? 'ONLINE (ACTIVE)' : 'OFFLINE (SUSPENDED)'}
                      </span>
                    </div>

                    <div className="border-t border-zinc-900 my-2" />

                    <button
                      onClick={async () => {
                        const nextVal = systemSettings.gateway_enabled !== 'true';
                        try {
                          await adminUpdateSettings(token, { gateway_enabled: nextVal });
                          setSystemSettings((prev: any) => ({ ...prev, gateway_enabled: nextVal ? 'true' : 'false' }));
                          await loadStats();
                        } catch (err: any) {
                          setError(err.message);
                        }
                      }}
                      className={`w-full font-mono text-xs font-bold py-3 transition-all crosshair-corners flex items-center justify-center gap-2 ${
                        systemSettings.gateway_enabled === 'true'
                          ? 'bg-red-950/15 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/15 hover:text-white'
                          : 'bg-emerald-500 text-black hover:bg-emerald-400'
                      }`}
                    >
                      {systemSettings.gateway_enabled === 'true' ? 'STOP / SUSPEND GATEWAY' : 'START / ACTIVATE GATEWAY'}
                    </button>
                  </div>
                </div>

                {/* Model active switches Card */}
                <div className="col-span-12 lg:col-span-6 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Cpu className="w-4 h-4 text-[#ef4444]" />
                      MODEL_ACTIVATION_MATRIX
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Enable or disable inference models. Disabled models will return 400 Bad Request if called and show as inactive on user dashboards.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {adminModels.length === 0 ? (
                      <p className="text-xs text-zinc-650 py-4 font-mono uppercase text-center">[SYNCHRONIZING_MODELS_LIST_WITH_SETTINGS_FALLBACK...]</p>
                    ) : (
                      adminModels.map((m) => (
                        <div key={m.alias} className="flex flex-col gap-4 p-4 bg-zinc-950 border border-zinc-900 hover:border-zinc-850 transition-all group">
                          <div className="flex justify-between items-center">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs font-bold text-white uppercase">{m.alias}</span>
                              <span className="font-mono text-[9px] text-zinc-500 uppercase">{m.upstream_model}</span>
                            </div>
                            
                            <div className="flex items-center gap-4">
                              <span className={`px-2 py-0.5 font-mono text-[9px] font-bold uppercase rounded-sm border ${
                                m.is_active
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444] red-glow-text'
                              }`}>
                                {m.is_active ? 'ACTIVE' : 'DISABLED'}
                              </span>

                              <button
                                onClick={async () => {
                                  try {
                                    await adminUpdateModel(token, m.alias, { is_active: !m.is_active });
                                    setAdminModels(prev =>
                                      prev.map(item =>
                                        item.alias === m.alias ? { ...item, is_active: !m.is_active } : item
                                      )
                                    );
                                  } catch (err: any) {
                                    setError(err.message);
                                  }
                                }}
                                className={`px-3 py-1 font-mono text-[10px] font-bold border transition-all ${
                                  m.is_active
                                    ? 'border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] hover:bg-[#ef4444]/20 hover:text-red-350'
                                    : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-350'
                                }`}
                              >
                                {m.is_active ? 'DISABLE' : 'ENABLE'}
                              </button>
                            </div>
                          </div>

                          <div className="border-t border-zinc-900/60 pt-3 grid grid-cols-2 gap-4 font-mono text-[10px]">
                            <div className="space-y-1">
                              <label className="text-zinc-500 uppercase text-[8px] tracking-wider">Input Cost / 1M ($)</label>
                              <input
                                type="number"
                                step="0.001"
                                defaultValue={m.input_cost_per_million ?? 0.10}
                                id={`input-cost-${m.alias}`}
                                className="w-full bg-zinc-900 border border-zinc-850 px-2 py-1 text-white text-xs focus:outline-none focus:border-[#ef4444]"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-zinc-500 uppercase text-[8px] tracking-wider">Output Cost / 1M ($)</label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  step="0.001"
                                  defaultValue={m.output_cost_per_million ?? 0.30}
                                  id={`output-cost-${m.alias}`}
                                  className="w-full bg-zinc-900 border border-zinc-850 px-2 py-1 text-white text-xs focus:outline-none focus:border-[#ef4444]"
                                />
                                <button
                                  onClick={async () => {
                                    const inputVal = Number((document.getElementById(`input-cost-${m.alias}`) as HTMLInputElement)?.value);
                                    const outputVal = Number((document.getElementById(`output-cost-${m.alias}`) as HTMLInputElement)?.value);
                                    try {
                                      await adminUpdateModel(token, m.alias, {
                                        input_cost_per_million: inputVal,
                                        output_cost_per_million: outputVal,
                                      });
                                      setAdminModels(prev =>
                                        prev.map(item =>
                                          item.alias === m.alias ? { ...item, input_cost_per_million: inputVal, output_cost_per_million: outputVal } : item
                                        )
                                      );
                                      alert(`Pricing updated for ${m.alias}!`);
                                    } catch (err: any) {
                                      setError(err.message);
                                    }
                                  }}
                                  className="px-2 py-1 bg-zinc-900 border border-zinc-805 text-[#ef4444] font-bold text-[9px] hover:border-[#ef4444] transition-all"
                                >
                                  SAVE
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}
            {editingAccountId && (
              <div className="fixed inset-0 z-50 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-[#0e0e10] border border-[#ef4444]/35 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto crosshair-corners relative animate-fade-in space-y-4">
                  <div className="absolute right-3 top-3 w-2.5 h-2.5 bg-[#ef4444] status-pulse red-glow" />
                  <h3 className="font-mono text-sm text-white font-bold tracking-widest border-b border-zinc-900 pb-2">
                    [CONTROL_OVERRIDE_USER_METADATA]
                  </h3>
                  
                  <form onSubmit={handleUpdateAccount} className="space-y-4 font-mono text-xs text-zinc-300">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Display Name</label>
                        <input
                           type="text"
                           value={editingDisplayName}
                           onChange={e => setEditingDisplayName(e.target.value)}
                           className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                        />
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Role</label>
                        <select
                          value={editingRole}
                          onChange={e => setEditingRole(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444] uppercase"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Plan / Tier</label>
                        <select
                          value={editingTier}
                          onChange={e => handleTierChange(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444] uppercase"
                        >
                          {plans.map(p => (
                            <option key={p.id} value={p.tier}>{p.tier.toUpperCase()}</option>
                          ))}
                          {!plans.some(p => p.tier === editingTier) && (
                            <option value={editingTier}>{editingTier.toUpperCase()} (CUSTOM)</option>
                          )}
                        </select>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Monthly USD Budget ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editingLimit}
                          onChange={e => setEditingLimit(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">RPM Limit</label>
                        <input
                          type="number"
                          value={editingRpmLimit}
                          onChange={e => setEditingRpmLimit(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                        />
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">5h Budget ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editingTokens5hLimit}
                          onChange={e => setEditingTokens5hLimit(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">7d Budget ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editingTokens7dLimit}
                          onChange={e => setEditingTokens7dLimit(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Status</label>
                        <select
                          value={editingStatus}
                          onChange={e => setEditingStatus(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444] uppercase"
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended (Banned)</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                    </div>

                    {editingStatus === 'suspended' && (
                      <div className="space-y-1 animate-fade-in">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Suspension Reason</label>
                        <textarea
                          value={editingSuspendedReason}
                          onChange={e => setEditingSuspendedReason(e.target.value)}
                          placeholder="VIOLATION OF TERMS / MISUSE / QUOTA EXCEEDED..."
                          rows={2}
                          className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444] uppercase placeholder-zinc-800"
                        />
                      </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingAccountId(null)}
                        className="px-4 py-2 border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition-colors"
                      >
                        CANCEL
                      </button>
                      <button
                        type="submit"
                        disabled={updatingAccount}
                        className="px-4 py-2 bg-[#ef4444] text-black font-bold hover:bg-[#ff5451] transition-colors disabled:opacity-50"
                      >
                        {updatingAccount ? 'SAVING...' : 'COMMIT CHANGES'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

    </div>
  )
}
