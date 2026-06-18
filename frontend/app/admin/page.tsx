'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import { ModelConfigCard } from '@/components/ModelConfigCard'
import { 
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
  adminGetInvitations,
  adminCreateInvitation,
  adminUpdateInvitation,
  adminDeleteInvitation,
  adminGetDaytonaKeys,
  adminCreateDaytonaKey,
  adminUpdateDaytonaKey,
  adminDeleteDaytonaKey,
  adminTestDaytonaKey,
  type PlanPreset,
  type AdminModelMapping,
  type DaytonaKey
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
  FileText,
  Settings
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

function AdminTableSkeleton({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full space-y-3 animate-pulse font-mono">
      <div className="h-10 bg-zinc-900 border border-zinc-800 rounded-sm w-full" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4">
            {Array.from({ length: cols }).map((_, j) => (
              <div key={j} className="h-9 bg-zinc-900/50 rounded-sm flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function AdminCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse font-mono">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-44 bg-[#0e0e10] border border-zinc-900 rounded-sm p-6 space-y-4">
          <div className="h-4 bg-zinc-850 rounded-sm w-24" />
          <div className="h-6 bg-zinc-900 rounded-sm w-36" />
          <div className="space-y-2">
            <div className="h-3 bg-zinc-900/50 rounded-sm w-full" />
            <div className="h-3 bg-zinc-900/50 rounded-sm w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

function AdminListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3 animate-pulse font-mono">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 bg-zinc-950 border border-zinc-900 rounded-sm flex justify-between items-center">
          <div className="space-y-2 flex-1">
            <div className="h-4 bg-zinc-850 rounded-sm w-1/3" />
            <div className="h-3 bg-zinc-900 rounded-sm w-1/2" />
          </div>
          <div className="h-6 bg-zinc-900 rounded-sm w-16" />
        </div>
      ))}
    </div>
  )
}

function AdminSettingsSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-6 animate-pulse w-full font-mono">
      <div className="col-span-12 lg:col-span-6 bg-[#0e0e10] border border-zinc-900 p-6 rounded-sm space-y-6">
        <div className="space-y-2">
          <div className="h-4 bg-zinc-850 rounded-sm w-1/3" />
          <div className="h-3 bg-zinc-900 rounded-sm w-2/3" />
        </div>
        <div className="h-24 bg-zinc-950 border border-zinc-900 rounded-sm" />
      </div>
      <div className="col-span-12 lg:col-span-6 bg-[#0e0e10] border border-zinc-900 p-6 rounded-sm space-y-6">
        <div className="space-y-2">
          <div className="h-4 bg-zinc-850 rounded-sm w-1/3" />
          <div className="h-3 bg-zinc-900 rounded-sm w-2/3" />
        </div>
        <div className="h-24 bg-zinc-950 border border-zinc-900 rounded-sm" />
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const router = useRouter()
  const { user: contextUser, token: contextToken, loading: authLoading, signOut } = useApp()
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

  const [activeTab, setActiveTab] = useState<'providers' | 'users' | 'plans' | 'settings' | 'invitations' | 'daytona_keys'>('providers')

  // Daytona keys state
  const [daytonaKeys, setDaytonaKeys] = useState<any[]>([])
  const [loadingDaytonaKeys, setLoadingDaytonaKeys] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyApiKey, setNewKeyApiKey] = useState('')
  const [newKeyApiUrl, setNewKeyApiUrl] = useState('https://app.daytona.io/api')
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null)

  // Invitation management state
  const [invitations, setInvitations] = useState<any[]>([])
  const [loadingInvitations, setLoadingInvitations] = useState(false)
  const [newInvCode, setNewInvCode] = useState('')
  const [newInvMaxUses, setNewInvMaxUses] = useState(1)
  const [editingInvId, setEditingInvId] = useState<string | null>(null)
  const [editingInvMaxUses, setEditingInvMaxUses] = useState<number>(1)

  // Settings & Models state
  const [systemSettings, setSystemSettings] = useState<any>({ gateway_enabled: 'true', max_agents_per_user: '1' })
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
  const [newPlanOpenclawEnabled, setNewPlanOpenclawEnabled] = useState(false)
  const [newPlanMaxAgents, setNewPlanMaxAgents] = useState(0)
  const [newPlanAgentCpu, setNewPlanAgentCpu] = useState(1)
  const [newPlanAgentRam, setNewPlanAgentRam] = useState(1)
  const [newPlanPrice, setNewPlanPrice] = useState('$0')
  const [newPlanBillingPeriod, setNewPlanBillingPeriod] = useState('mo')
  const [newPlanDescription, setNewPlanDescription] = useState('')
  const [newPlanBadge, setNewPlanBadge] = useState('')
  const [newPlanHasTrial, setNewPlanHasTrial] = useState(false)
  const [newPlanTrialDays, setNewPlanTrialDays] = useState(7)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editingPlanLimit, setEditingPlanLimit] = useState<number>(10.0)
  const [editingPlanRpm, setEditingPlanRpm] = useState<number>(60)
  const [editingPlan5h, setEditingPlan5h] = useState<number>(1.0)
  const [editingPlan7d, setEditingPlan7d] = useState<number>(5.0)
  const [editingPlanOpenclawEnabled, setEditingPlanOpenclawEnabled] = useState(false)
  const [editingPlanMaxAgents, setEditingPlanMaxAgents] = useState(0)
  const [editingPlanAgentCpu, setEditingPlanAgentCpu] = useState(1)
  const [editingPlanAgentRam, setEditingPlanAgentRam] = useState(1)
  const [editingPlanPrice, setEditingPlanPrice] = useState('$0')
  const [editingPlanBillingPeriod, setEditingPlanBillingPeriod] = useState('mo')
  const [editingPlanDescription, setEditingPlanDescription] = useState('')
  const [editingPlanBadge, setEditingPlanBadge] = useState('')
  const [editingPlanHasTrial, setEditingPlanHasTrial] = useState(false)
  const [editingPlanTrialDays, setEditingPlanTrialDays] = useState(7)

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
  const [editingAccountOpenclawEnabled, setEditingAccountOpenclawEnabled] = useState(false)
  const [editingAccountMaxAgents, setEditingAccountMaxAgents] = useState(0)
  const [editingAccountAgentCpu, setEditingAccountAgentCpu] = useState(1)
  const [editingAccountAgentRam, setEditingAccountAgentRam] = useState(1)
  const [editingRole, setEditingRole] = useState('user')
  const [editingStatus, setEditingStatus] = useState('active')
  const [editingSuspendedReason, setEditingSuspendedReason] = useState('')
  const [updatingAccount, setUpdatingAccount] = useState(false)
  const [accountsTotal, setAccountsTotal] = useState(0)
  const [accountsPage, setAccountsPage] = useState(1)
  const accountsLimit = 20

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akarouter-production.up.railway.app'
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token])

  useEffect(() => {
    if (!authLoading) {
      if (contextUser && contextUser.role === 'admin') {
        setToken(contextToken)
        setIsAdmin(true)
        setUser(contextUser)
        setAuthChecked(true)
      } else {
        const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY
        if (adminKey) {
          setToken(adminKey)
          setIsAdmin(true)
          setUser({ email: 'ADMIN_BYPASS', role: 'admin' })
          setAuthChecked(true)
        } else {
          router.push('/dashboard')
        }
      }
    }
  }, [authLoading, contextUser, contextToken, router])

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

  const loadAccounts = useCallback(async (search?: string, page: number = 1, limit: number = 20) => {
    if (!token) return
    setLoadingAccounts(true)
    try {
      const offset = (page - 1) * limit
      const data = await adminGetAccounts(token, search, limit, offset)
      setAccounts(data.accounts || [])
      setAccountsTotal(data.total || 0)
    } catch {}
    setLoadingAccounts(false)
  }, [token])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (accountsPage === 1) {
      loadAccounts(searchQuery, 1, accountsLimit)
    } else {
      setAccountsPage(1)
    }
  }

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

  const loadInvitations = useCallback(async () => {
    if (!token) return
    setLoadingInvitations(true)
    try {
      const data = await adminGetInvitations(token)
      setInvitations(data.invitations || [])
    } catch (err: any) {
      setError(err.message)
    }
    setLoadingInvitations(false)
  }, [token])

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await adminCreateInvitation(token, newInvCode.trim() || undefined, newInvMaxUses)
      setNewInvCode('')
      setNewInvMaxUses(1)
      await loadInvitations()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleUpdateInvitation = async (id: string, maxUses: number) => {
    try {
      await adminUpdateInvitation(token, id, { max_uses: maxUses })
      setEditingInvId(null)
      await loadInvitations()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleToggleInvitationActive = async (id: string, currentActive: boolean) => {
    try {
      await adminUpdateInvitation(token, id, { is_active: !currentActive })
      await loadInvitations()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDeleteInvitation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this invitation code?')) return
    try {
      await adminDeleteInvitation(token, id)
      await loadInvitations()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const loadDaytonaKeys = useCallback(async () => {
    if (!token) return
    setLoadingDaytonaKeys(true)
    try {
      const data = await adminGetDaytonaKeys(token)
      setDaytonaKeys(data.keys || [])
    } catch (err: any) {
      setError(err.message)
    }
    setLoadingDaytonaKeys(false)
  }, [token])

  const handleCreateDaytonaKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyLabel || !newKeyApiKey) return
    try {
      await adminCreateDaytonaKey(token, newKeyLabel, newKeyApiKey, newKeyApiUrl)
      setNewKeyLabel('')
      setNewKeyApiKey('')
      setNewKeyApiUrl('https://app.daytona.io/api')
      await loadDaytonaKeys()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleToggleDaytonaKeyActive = async (id: string, currentActive: boolean) => {
    try {
      await adminUpdateDaytonaKey(token, id, { is_active: !currentActive })
      await loadDaytonaKeys()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDeleteDaytonaKey = async (id: string) => {
    if (!confirm('Are you sure you want to delete this Daytona API key?')) return
    try {
      await adminDeleteDaytonaKey(token, id)
      await loadDaytonaKeys()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleTestDaytonaKey = async (id: string) => {
    setTestingKeyId(id)
    setTestResult(null)
    try {
      const res = await adminTestDaytonaKey(token, id)
      setTestResult({ id, ok: res.ok, message: res.message })
    } catch (err: any) {
      setTestResult({ id, ok: false, message: err.message })
    }
    setTestingKeyId(null)
  }

  useEffect(() => {
    if (!authChecked || !isAdmin) return
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
  }, [authChecked, isAdmin])

  // Fetch stats once on mount
  useEffect(() => {
    if (!authChecked || !isAdmin || !token) return
    loadStats()
  }, [authChecked, isAdmin, token])

  // Lazy load tab data conditionally
  useEffect(() => {
    if (!authChecked || !isAdmin || !token) return

    if (activeTab === 'providers') {
      loadProviders()
    } else if (activeTab === 'users') {
      loadAccounts(searchQuery, accountsPage, accountsLimit)
      loadPlans()
    } else if (activeTab === 'plans') {
      loadPlans()
    } else if (activeTab === 'settings') {
      loadSettings()
      loadAdminModels()
    } else if (activeTab === 'invitations') {
      loadInvitations()
    } else if (activeTab === 'daytona_keys') {
      loadDaytonaKeys()
    }
  }, [authChecked, isAdmin, token, activeTab, accountsPage])

  // Plan Preset Handlers
  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPlanTier) return
    try {
      await adminCreatePlan(
        token, 
        newPlanTier.toLowerCase(), 
        newPlanLimit, 
        newPlanRpm, 
        newPlan5h, 
        newPlan7d,
        newPlanOpenclawEnabled,
        newPlanMaxAgents,
        newPlanAgentCpu,
        newPlanAgentRam,
        newPlanPrice,
        newPlanBillingPeriod,
        newPlanDescription,
        newPlanBadge,
        newPlanHasTrial,
        newPlanTrialDays
      )
      setNewPlanTier('')
      setNewPlanLimit(10.0)
      setNewPlanRpm(60)
      setNewPlan5h(1.0)
      setNewPlan7d(5.0)
      setNewPlanOpenclawEnabled(false)
      setNewPlanMaxAgents(0)
      setNewPlanAgentCpu(1)
      setNewPlanAgentRam(1)
      setNewPlanPrice('$0')
      setNewPlanBillingPeriod('mo')
      setNewPlanDescription('')
      setNewPlanBadge('')
      setNewPlanHasTrial(false)
      setNewPlanTrialDays(7)
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
        openclaw_enabled: editingPlanOpenclawEnabled,
        max_agents: editingPlanMaxAgents,
        agent_cpu: editingPlanAgentCpu,
        agent_ram: editingPlanAgentRam,
        price: editingPlanPrice,
        billing_period: editingPlanBillingPeriod,
        description: editingPlanDescription,
        badge: editingPlanBadge,
        has_trial: editingPlanHasTrial,
        trial_days: editingPlanTrialDays,
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
    setEditingAccountOpenclawEnabled(acc.openclaw_enabled ?? false)
    setEditingAccountMaxAgents(acc.max_agents ?? 0)
    setEditingAccountAgentCpu(acc.agent_cpu ?? 1)
    setEditingAccountAgentRam(acc.agent_ram ?? 1)
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
        openclaw_enabled: editingAccountOpenclawEnabled,
        max_agents: Number(editingAccountMaxAgents),
        agent_cpu: Number(editingAccountAgentCpu),
        agent_ram: Number(editingAccountAgentRam),
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
      setEditingAccountOpenclawEnabled(matchedPlan.openclaw_enabled ?? false)
      setEditingAccountMaxAgents(matchedPlan.max_agents ?? 0)
      setEditingAccountAgentCpu(matchedPlan.agent_cpu ?? 1)
      setEditingAccountAgentRam(matchedPlan.agent_ram ?? 1)
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
              <button
                onClick={() => setActiveTab('invitations')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 ${
                  activeTab === 'invitations'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                [05_INVITATION_CODES]
              </button>
              <button
                onClick={() => setActiveTab('daytona_keys')}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all shrink-0 ${
                  activeTab === 'daytona_keys'
                    ? 'border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] red-glow'
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                [06_DAYTONA_KEYS]
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
                  <AdminTableSkeleton rows={4} cols={6} />
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

                  <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full md:max-w-md">
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
                  <AdminTableSkeleton rows={5} cols={6} />
                ) : accounts.length === 0 ? (
                  <div className="py-12 text-center font-mono text-xs text-zinc-600 uppercase">[NO_USER_ACCOUNTS_FOUND_MATCHING_FILTER]</div>
                ) : (
                  <div className="space-y-4">
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

                    {/* Pagination Controls */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-zinc-900 font-mono text-[11px] text-zinc-500">
                      <div>
                        SHOWING {Math.min(accountsTotal, (accountsPage - 1) * accountsLimit + 1)} - {Math.min(accountsTotal, accountsPage * accountsLimit)} OF {accountsTotal} USERS
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAccountsPage(prev => Math.max(1, prev - 1))}
                          disabled={accountsPage <= 1}
                          className="px-3 py-1.5 border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-550 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:border-zinc-800 transition-all"
                        >
                          [PREV]
                        </button>
                        <span className="px-3 text-zinc-300">
                          PAGE {accountsPage} OF {Math.max(1, Math.ceil(accountsTotal / accountsLimit))}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAccountsPage(prev => Math.min(Math.ceil(accountsTotal / accountsLimit), prev + 1))}
                          disabled={accountsPage * accountsLimit >= accountsTotal}
                          className="px-3 py-1.5 border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-550 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:border-zinc-800 transition-all"
                        >
                          [NEXT]
                        </button>
                      </div>
                    </div>
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
                    <AdminCardsSkeleton count={3} />
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
                            <th className="p-4">OpenClaw</th>
                            <th className="p-4">Max Agents</th>
                            <th className="p-4">CPU</th>
                            <th className="p-4">RAM</th>
                            <th className="p-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900/40">
                          {plans.map(p => (
                            <tr key={p.id} className="hover:bg-zinc-900/10 transition-colors">
                              <td className="p-4 font-bold text-white uppercase">{p.tier}</td>
                                  <td className="p-4 text-zinc-300">
                                    {p.monthly_limit >= 999999999 ? 'UNLIMITED' : `$${p.monthly_limit.toFixed(2)}`}
                                  </td>
                                  <td className="p-4 text-zinc-300">{p.rpm_limit ?? 60} RPM</td>
                                  <td className="p-4 text-zinc-300">${(p.tokens_5h_limit ?? 1.0).toFixed(2)}</td>
                                  <td className="p-4 text-zinc-300">${(p.tokens_7d_limit ?? 5.0).toFixed(2)}</td>
                                  <td className="p-4 text-zinc-300">
                                    <span className={`px-2 py-0.5 text-[9px] font-mono border rounded-sm font-bold ${
                                      p.openclaw_enabled 
                                        ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' 
                                        : 'border-zinc-850 bg-zinc-900/40 text-zinc-500'
                                    }`}>
                                      {p.openclaw_enabled ? 'ENABLED' : 'DISABLED'}
                                    </span>
                                  </td>
                                  <td className="p-4 text-zinc-300 font-bold">{p.max_agents ?? 0}</td>
                                  <td className="p-4 text-zinc-300">{p.agent_cpu ?? 1} CPU</td>
                                  <td className="p-4 text-zinc-300">{p.agent_ram ?? 1} GB</td>
                              <td className="p-4 text-right space-x-2">
                                {editingPlanId === p.id ? (
                                  <div className="inline-flex gap-2">
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
                                      setEditingPlanOpenclawEnabled(p.openclaw_enabled ?? false);
                                      setEditingPlanMaxAgents(p.max_agents ?? 0);
                                      setEditingPlanAgentCpu(p.agent_cpu ?? 1);
                                      setEditingPlanAgentRam(p.agent_ram ?? 1);
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

                    {/* OpenClaw Feature Settings */}
                    <div className="border border-zinc-900 bg-[#050507]/40 p-4 rounded-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Enable Hosted OpenClaw</label>
                        <input 
                          type="checkbox" 
                          checked={newPlanOpenclawEnabled}
                          onChange={(e) => setNewPlanOpenclawEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] accent-[#ef4444] cursor-pointer"
                        />
                      </div>
                      
                      {newPlanOpenclawEnabled && (
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-900/60 animate-fade-in">
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Max Agents</label>
                            <input
                              type="number"
                              min="1"
                              value={newPlanMaxAgents}
                              onChange={e => setNewPlanMaxAgents(Math.max(1, Number(e.target.value)))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              required
                            />
                          </div>
                          
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">CPU Cores</label>
                            <input
                              type="number"
                              min="1"
                              value={newPlanAgentCpu}
                              onChange={e => setNewPlanAgentCpu(Math.max(1, Number(e.target.value)))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              required
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">RAM (GB)</label>
                            <input
                              type="number"
                              min="1"
                              value={newPlanAgentRam}
                              onChange={e => setNewPlanAgentRam(Math.max(1, Number(e.target.value)))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              required
                            />
                          </div>
                        </div>
                      )}
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
                
                {/* Plan Edit Modal */}
                {editingPlanId && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#0e0e10] border border-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto crosshair-corners p-6 shadow-2xl">
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="font-mono text-lg text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                          <Settings className="w-5 h-5 text-[#ef4444]" />
                          EDIT_PLAN_PRESET
                        </h2>
                        <button onClick={() => setEditingPlanId(null)} className="text-zinc-500 hover:text-white transition-colors">
                          <X className="w-6 h-6" />
                        </button>
                      </div>

                      <div className="space-y-4 font-mono text-xs text-zinc-300">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Monthly Budget ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editingPlanLimit}
                              onChange={e => setEditingPlanLimit(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">RPM Limit</label>
                            <input
                              type="number"
                              value={editingPlanRpm}
                              onChange={e => setEditingPlanRpm(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">5h Budget ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editingPlan5h}
                              onChange={e => setEditingPlan5h(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">7d Budget ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editingPlan7d}
                              onChange={e => setEditingPlan7d(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                            />
                          </div>
                        </div>

                        {/* UI Config Fields */}
                        <div className="border border-zinc-900 bg-zinc-950 p-4 space-y-4">
                          <h3 className="text-[#ef4444] uppercase text-[10px] tracking-widest font-bold">UI Configuration</h3>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Display Price</label>
                              <input
                                type="text"
                                value={editingPlanPrice}
                                onChange={e => setEditingPlanPrice(e.target.value)}
                                placeholder="$0"
                                className="w-full bg-[#050507] border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Billing Period</label>
                              <input
                                type="text"
                                value={editingPlanBillingPeriod}
                                onChange={e => setEditingPlanBillingPeriod(e.target.value)}
                                placeholder="mo"
                                className="w-full bg-[#050507] border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              />
                            </div>
                            <div className="space-y-1 col-span-2">
                              <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Description</label>
                              <input
                                type="text"
                                value={editingPlanDescription}
                                onChange={e => setEditingPlanDescription(e.target.value)}
                                className="w-full bg-[#050507] border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Badge (e.g., POPULAR)</label>
                              <input
                                type="text"
                                value={editingPlanBadge}
                                onChange={e => setEditingPlanBadge(e.target.value)}
                                className="w-full bg-[#050507] border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Free Trial Settings</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={editingPlanHasTrial}
                                  onChange={e => setEditingPlanHasTrial(e.target.checked)}
                                  className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] accent-[#ef4444]"
                                />
                                <span className="text-zinc-400 text-xs">Enable</span>
                                {editingPlanHasTrial && (
                                  <input
                                    type="number"
                                    value={editingPlanTrialDays}
                                    onChange={e => setEditingPlanTrialDays(Number(e.target.value))}
                                    className="w-16 bg-[#050507] border border-zinc-900 px-2 py-1 text-white focus:outline-none focus:border-[#ef4444]"
                                  />
                                )}
                                {editingPlanHasTrial && <span className="text-zinc-400 text-xs">days</span>}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* OpenClaw Config */}
                        <div className="border border-zinc-900 bg-zinc-950 p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-zinc-400 uppercase text-[10px] tracking-widest font-bold">OpenClaw Settings</h3>
                            <input
                              type="checkbox"
                              checked={editingPlanOpenclawEnabled}
                              onChange={e => setEditingPlanOpenclawEnabled(e.target.checked)}
                              className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] accent-[#ef4444]"
                            />
                          </div>
                          {editingPlanOpenclawEnabled && (
                            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-900/60 animate-fade-in">
                              <div className="space-y-1">
                                <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Max Agents</label>
                                <input
                                  type="number"
                                  value={editingPlanMaxAgents}
                                  onChange={e => setEditingPlanMaxAgents(Number(e.target.value))}
                                  className="w-full bg-[#050507] border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-zinc-500 uppercase text-[9px] tracking-wider">CPU Cores</label>
                                <input
                                  type="number"
                                  value={editingPlanAgentCpu}
                                  onChange={e => setEditingPlanAgentCpu(Number(e.target.value))}
                                  className="w-full bg-[#050507] border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-zinc-500 uppercase text-[9px] tracking-wider">RAM (GB)</label>
                                <input
                                  type="number"
                                  value={editingPlanAgentRam}
                                  onChange={e => setEditingPlanAgentRam(Number(e.target.value))}
                                  className="w-full bg-[#050507] border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-4 pt-4 border-t border-zinc-900">
                          <button
                            onClick={() => handleUpdatePlan(editingPlanId)}
                            className="flex-1 bg-[#ef4444] text-black font-bold py-3 hover:bg-[#ff5451] transition-all flex items-center justify-center gap-2 crosshair-corners"
                          >
                            <span className="tracking-widest uppercase font-bold">SAVE CHANGES</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Tab Panel: Settings */}
            {activeTab === 'settings' && (
              loadingSettings ? (
                <AdminSettingsSkeleton />
              ) : (
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

                {/* Require User Activation Switch Card */}
                <div className="col-span-12 lg:col-span-6 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Shield className="w-4 h-4 text-[#ef4444]" />
                      USER_SIGNUP_ACTIVATION_CONTROL
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Require new users to contact the administrator to activate their account and generate API keys.
                    </p>
                  </div>

                  <div className="p-5 bg-zinc-950 border border-zinc-900 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs text-zinc-400 uppercase tracking-wider font-bold">
                        ACTIVATION REQUIREMENT STATUS:
                      </span>
                      <span className={`px-2 py-0.5 font-mono text-[9px] font-bold uppercase rounded-sm border ${
                        systemSettings.require_activation === 'true'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-450'
                          : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400'
                      }`}>
                        {systemSettings.require_activation === 'true' ? 'MANDATORY (PENDING)' : 'DISABLED (AUTO-ACTIVE)'}
                      </span>
                    </div>

                    <div className="border-t border-zinc-900 my-2" />

                    <button
                      onClick={async () => {
                        const nextVal = systemSettings.require_activation !== 'true';
                        try {
                          await adminUpdateSettings(token, { require_activation: nextVal });
                          setSystemSettings((prev: any) => ({ ...prev, require_activation: nextVal ? 'true' : 'false' }));
                        } catch (err: any) {
                          setError(err.message);
                        }
                      }}
                      className={`w-full font-mono text-xs font-bold py-3 transition-all crosshair-corners flex items-center justify-center gap-2 ${
                        systemSettings.require_activation === 'true'
                          ? 'bg-zinc-905 border border-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-white'
                          : 'bg-[#ef4444] text-black hover:bg-[#ff5451]'
                      }`}
                    >
                      {systemSettings.require_activation === 'true' ? 'DISABLE REQUIRE ACTIVATION' : 'ENABLE REQUIRE ACTIVATION'}
                    </button>
                  </div>
                </div>

                {/* Hosted Agent Creation Limit Card */}
                <div className="col-span-12 lg:col-span-6 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Cpu className="w-4 h-4 text-[#ef4444]" />
                      HOSTED_AGENTS_LIMIT_CONTROL
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Configure the maximum number of hosted agents a user is allowed to create.
                    </p>
                  </div>

                  <div className="p-5 bg-zinc-950 border border-zinc-900 flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <label className="font-mono text-xs text-zinc-400 uppercase tracking-wider font-bold">
                        MAX AGENTS PER USER:
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="1"
                          value={systemSettings.max_agents_per_user || '1'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSystemSettings((prev: any) => ({ ...prev, max_agents_per_user: val }));
                          }}
                          className="bg-black border border-zinc-900 font-mono text-xs text-white p-2 w-24 focus:outline-none focus:border-[#ef4444] transition-colors"
                        />
                        <button
                          onClick={async () => {
                            const val = parseInt(systemSettings.max_agents_per_user || '1', 10);
                            if (isNaN(val) || val < 1) {
                              alert('Limit must be a number greater than or equal to 1');
                              return;
                            }
                            try {
                              await adminUpdateSettings(token, { max_agents_per_user: val });
                              alert('Hosted agents limit updated successfully!');
                            } catch (err: any) {
                              setError(err.message);
                            }
                          }}
                          className="bg-[#ef4444] text-black font-mono text-xs font-bold px-4 py-2 hover:bg-[#ff5451] transition-all crosshair-corners"
                        >
                          SAVE LIMIT
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Model active switches Card */}
                <div className="col-span-12 lg:col-span-6 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Cpu className="w-4 h-4 text-[#ef4444]" />
                      MODEL_PRICING_CONFIG
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Toggle activation, switch billing mode (per-token / per-request), and edit pricing per model. Changes take effect immediately and evict the cache.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {adminModels.length === 0 ? (
                      <p className="text-xs text-zinc-650 py-4 font-mono uppercase text-center">[SYNCHRONIZING_MODELS_LIST_WITH_SETTINGS_FALLBACK...]</p>
                    ) : (
                      adminModels.map((m) => (
                        <ModelConfigCard
                          key={m.alias}
                          model={m}
                          token={token}
                          onUpdated={(next) => {
                            setAdminModels((prev) =>
                              prev.map((item) => (item.alias === next.alias ? next : item))
                            )
                          }}
                          onError={(msg) => setError(msg)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </section>
              )
            )}
            {activeTab === 'invitations' && (
              <section className="grid grid-cols-12 gap-6 animate-slide-in relative">
                {/* Create Invitation Card */}
                <div className="col-span-12 lg:col-span-4 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Plus className="w-4 h-4 text-[#ef4444]" />
                      GENERATE_INVITATION_CODE
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Create new invitation keys with custom usage limits. Leave code blank to auto-generate a random key.
                    </p>
                  </div>

                  <form onSubmit={handleCreateInvitation} className="space-y-4 font-mono text-xs text-zinc-300">
                    <div className="space-y-1">
                      <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Invitation Code (Optional)</label>
                      <input
                        type="text"
                        value={newInvCode}
                        onChange={e => setNewInvCode(e.target.value)}
                        placeholder="AUTO-GENERATE IF BLANK"
                        className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white placeholder-zinc-800 uppercase focus:outline-none focus:border-[#ef4444] rounded-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Max Allowed Uses</label>
                      <input
                        type="number"
                        min="1"
                        value={newInvMaxUses}
                        onChange={e => setNewInvMaxUses(Number(e.target.value))}
                        className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444] rounded-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-[#ef4444] text-black font-bold py-3 hover:bg-[#ff5451] transition-all crosshair-corners uppercase tracking-wider rounded-none"
                    >
                      [+] Create Code
                    </button>
                  </form>
                </div>

                {/* List & Manage Invitations Card */}
                <div className="col-span-12 lg:col-span-8 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <KeyRound className="w-4 h-4 text-[#ef4444]" />
                      ACTIVE_INVITATION_REGISTRY
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Manage active registration keys. You can delete, toggle active status, or edit/extend usage limits.
                    </p>
                  </div>

                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                    {loadingInvitations ? (
                      <AdminListSkeleton count={3} />
                    ) : invitations.length === 0 ? (
                      <p className="text-xs text-zinc-650 py-4 font-mono uppercase text-center">[NO_ACTIVE_INVITATION_CODES_FOUND]</p>
                    ) : (
                      invitations.map((inv) => (
                        <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-zinc-950 border border-zinc-900 hover:border-zinc-850 transition-all group">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-sm font-bold text-white uppercase select-all tracking-wider">{inv.code}</span>
                              <span className={`px-2 py-0.5 font-mono text-[9px] font-bold uppercase rounded-sm border ${
                                inv.is_active
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444] red-glow-text'
                              }`}>
                                {inv.is_active ? 'ACTIVE' : 'SUSPENDED'}
                              </span>
                            </div>
                            <div className="font-mono text-[10px] text-zinc-550 uppercase">
                              Uses: <span className="text-zinc-300 font-bold">{inv.used_count}</span> / <span className="text-zinc-350 font-bold">{inv.max_uses}</span> • Created: {new Date(inv.created_at).toLocaleDateString()}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {editingInvId === inv.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={inv.used_count}
                                  value={editingInvMaxUses}
                                  onChange={e => setEditingInvMaxUses(Number(e.target.value))}
                                  className="w-20 bg-zinc-900 border border-zinc-800 text-white text-xs px-2 py-1 focus:outline-none"
                                />
                                <button
                                  onClick={() => handleUpdateInvitation(inv.id, editingInvMaxUses)}
                                  className="px-2 py-1 bg-[#ef4444] text-black font-bold text-[9px] uppercase hover:bg-[#ff5451] transition-all"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingInvId(null)}
                                  className="px-2 py-1 bg-zinc-900 border border-zinc-800 text-zinc-400 text-[9px] uppercase hover:text-white transition-all"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingInvId(inv.id)
                                    setEditingInvMaxUses(inv.max_uses)
                                  }}
                                  className="px-2.5 py-1.5 border border-zinc-850 hover:border-zinc-500 hover:bg-zinc-900 font-mono text-[9px] font-bold text-zinc-350 hover:text-white transition-all uppercase"
                                >
                                  Extend
                                </button>
                                <button
                                  onClick={() => handleToggleInvitationActive(inv.id, inv.is_active)}
                                  className={`px-2.5 py-1.5 border font-mono text-[9px] font-bold transition-all uppercase ${
                                    inv.is_active
                                      ? 'border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] hover:bg-[#ef4444]/15'
                                      : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/15'
                                  }`}
                                >
                                  {inv.is_active ? 'Suspend' : 'Resume'}
                                </button>
                                <button
                                  onClick={() => handleDeleteInvitation(inv.id)}
                                  className="p-1.5 border border-zinc-900 bg-zinc-950 text-zinc-650 hover:text-[#ef4444] hover:border-[#ef4444]/30 hover:bg-[#ef4444]/5 transition-all"
                                  title="Delete Code"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'daytona_keys' && (
              <section className="grid grid-cols-12 gap-6 animate-slide-in relative">
                {/* Create Daytona Key Card */}
                <div className="col-span-12 lg:col-span-4 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Plus className="w-4 h-4 text-[#ef4444]" />
                      REGISTER_DAYTONA_KEY
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Register a new Daytona API credential. Keys are stored encrypted using Fernet (AES-128).
                    </p>
                  </div>

                  <form onSubmit={handleCreateDaytonaKey} className="space-y-4 font-mono text-xs text-zinc-300">
                    <div className="space-y-1">
                      <label className="text-zinc-500 uppercase text-[9px] tracking-wider font-bold">Key Label</label>
                      <input
                        type="text"
                        required
                        value={newKeyLabel}
                        onChange={e => setNewKeyLabel(e.target.value)}
                        placeholder="e.g. DAYTONA-WORKER-01"
                        className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white placeholder-zinc-800 uppercase focus:outline-none focus:border-[#ef4444] rounded-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-zinc-500 uppercase text-[9px] tracking-wider font-bold">API Base URL</label>
                      <input
                        type="url"
                        required
                        value={newKeyApiUrl}
                        onChange={e => setNewKeyApiUrl(e.target.value)}
                        placeholder="https://app.daytona.io/api"
                        className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444] rounded-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-zinc-500 uppercase text-[9px] tracking-wider font-bold">Daytona API Key (dtn_...)</label>
                      <input
                        type="password"
                        required
                        value={newKeyApiKey}
                        onChange={e => setNewKeyApiKey(e.target.value)}
                        placeholder="dtn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444] rounded-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-[#ef4444] text-black font-bold py-3 hover:bg-[#ff5451] transition-all crosshair-corners uppercase tracking-wider rounded-none"
                    >
                      [+] Register Key
                    </button>
                  </form>
                </div>

                {/* List & Manage Daytona Keys Card */}
                <div className="col-span-12 lg:col-span-8 bg-[#0e0e10] border border-zinc-900 p-6 crosshair-corners space-y-6">
                  <div className="space-y-1">
                    <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                      <Cpu className="w-4 h-4 text-[#ef4444]" />
                      ACTIVE_DAYTONA_CREDENTIALS
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">
                      Load-balances OpenClaw provisioning tasks across active credentials. Decrypted previews are shown below.
                    </p>
                  </div>

                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                    {loadingDaytonaKeys ? (
                      <AdminListSkeleton count={2} />
                    ) : daytonaKeys.length === 0 ? (
                      <p className="text-xs text-zinc-650 py-4 font-mono uppercase text-center">[NO_DAYTONA_KEYS_REGISTERED]</p>
                    ) : (
                      daytonaKeys.map((key) => (
                        <div key={key.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-zinc-950 border border-zinc-900 hover:border-zinc-850 transition-all group">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-sm font-bold text-white uppercase tracking-wider">{key.key_label}</span>
                              <span className={`px-2 py-0.5 font-mono text-[9px] font-bold uppercase rounded-sm border ${
                                key.is_active
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444] red-glow-text'
                              }`}>
                                {key.is_active ? 'ACTIVE' : 'INACTIVE'}
                              </span>
                            </div>
                            <div className="font-mono text-[10px] text-zinc-550 uppercase">
                              Preview: <span className="text-zinc-300 font-mono font-semibold">{key.api_key_preview}</span> • Base URL: <span className="text-zinc-350 font-semibold lowercase">{key.api_url}</span>
                            </div>
                            <div className="font-mono text-[10px] text-zinc-550 uppercase">
                              Active Sandboxes: <span className="text-[#ef4444] font-bold">{key.active_vms}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {testResult && testResult.id === key.id && (
                              <span className={`font-mono text-[10px] mr-2 uppercase ${testResult.ok ? 'text-emerald-400' : 'text-[#ef4444]'}`}>
                                {testResult.ok ? '✓ Connected' : `✗ Failed: ${testResult.message}`}
                              </span>
                            )}
                            
                            <button
                              onClick={() => handleTestDaytonaKey(key.id)}
                              disabled={testingKeyId === key.id}
                              className="px-2.5 py-1.5 border border-zinc-850 hover:border-zinc-500 hover:bg-zinc-900 font-mono text-[9px] font-bold text-zinc-350 hover:text-white transition-all uppercase disabled:opacity-50"
                            >
                              {testingKeyId === key.id ? 'Testing...' : 'Test Connection'}
                            </button>
                            
                            <button
                              onClick={() => handleToggleDaytonaKeyActive(key.id, key.is_active)}
                              className={`px-2.5 py-1.5 border font-mono text-[9px] font-bold transition-all uppercase ${
                                key.is_active
                                  ? 'border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] hover:bg-[#ef4444]/15'
                                  : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/15'
                              }`}
                            >
                              {key.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            
                            <button
                              onClick={() => handleDeleteDaytonaKey(key.id)}
                              className="p-1.5 border border-zinc-900 bg-zinc-950 text-zinc-650 hover:text-[#ef4444] hover:border-[#ef4444]/30 hover:bg-[#ef4444]/5 transition-all"
                              title="Delete Key"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

                    {/* OpenClaw User Settings Override */}
                    <div className="border border-zinc-900 bg-[#050507]/40 p-4 rounded-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Enable Hosted OpenClaw</label>
                        <input 
                          type="checkbox" 
                          checked={editingAccountOpenclawEnabled}
                          onChange={(e) => setEditingAccountOpenclawEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-zinc-800 bg-[#050507] text-[#ef4444] accent-[#ef4444] cursor-pointer"
                        />
                      </div>
                      
                      {editingAccountOpenclawEnabled && (
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-900/60 animate-fade-in">
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">Max Agents</label>
                            <input
                              type="number"
                              min="0"
                              value={editingAccountMaxAgents}
                              onChange={e => setEditingAccountMaxAgents(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              required
                            />
                          </div>
                          
                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">CPU Cores</label>
                            <input
                              type="number"
                              min="1"
                              value={editingAccountAgentCpu}
                              onChange={e => setEditingAccountAgentCpu(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              required
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-zinc-500 uppercase text-[9px] tracking-wider">RAM (GB)</label>
                            <input
                              type="number"
                              min="1"
                              value={editingAccountAgentRam}
                              onChange={e => setEditingAccountAgentRam(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-zinc-900 px-3 py-2 text-white focus:outline-none focus:border-[#ef4444]"
                              required
                            />
                          </div>
                        </div>
                      )}
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
