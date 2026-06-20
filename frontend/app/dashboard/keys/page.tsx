'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useApp } from '@/app/providers'
import { getGatewayUrl } from '@/lib/utils'
import {
  getMyKeys,
  createKey,
  revokeKey,
  type ApiKey,
} from '@/lib/api'
import { z } from 'zod'
import {
  LogOut,
  Copy,
  Check,
  Trash2
} from 'lucide-react'
import { DashboardSidebar } from '@/components/DashboardSidebar'
import InteractionCaptcha from '@/components/InteractionCaptcha'

const CreateKeySchema = z.object({
  keyName: z.string().max(100).optional(),
  captchaToken: z.string().min(1, 'Human verification is required'),
})


export default function ApiKeysPage() {
  const router = useRouter()
  const { user, token, usage, loading: authLoading, signOut } = useApp()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  
  // Track copied states
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [copiedSDK, setCopiedSDK] = useState(false)
  const [copiedCreatedKey, setCopiedCreatedKey] = useState(false)

  const [origin, setOrigin] = useState('http://localhost:8000')

  useEffect(() => {
    setOrigin(getGatewayUrl())
  }, [])

  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const loadData = useCallback(async (accessToken: string) => {
    try {
      if (user?.status === 'pending') {
        router.push('/dashboard')
        return
      }
      const keysData = await getMyKeys(accessToken)
      setKeys(keysData.keys)
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

  const handleCreateKey = async () => {
    if (!token) return
    const parsed = CreateKeySchema.safeParse({ keyName: newKeyName, captchaToken: captchaToken ?? '' })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Invalid form data')
      return
    }
    setError('')
    setCreatedKey(null)
    setCopiedCreatedKey(false)
    try {
      const result = await createKey(token, parsed.data.keyName || 'default', parsed.data.captchaToken)
      setCreatedKey(result.api_key)
      setNewKeyName('')
      setCaptchaToken(null)
      const keysData = await getMyKeys(token)
      setKeys(keysData.keys)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleRevokeKey = async (keyId: string) => {
    if (!token) return
    setError('')
    try {
      await revokeKey(token, keyId)
      setKeys(keys.filter(k => k.id !== keyId))
    } catch (err: any) {
      setError(err.message)
    }
  }

  const copyToClipboard = (text: string, id: string, setCopiedState: (v: any) => void) => {
    navigator.clipboard.writeText(text)
    setCopiedState(id)
    setTimeout(() => setCopiedState(null), 2000)
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
    <div className="relative min-h-screen bg-[#09090b] text-[#e5e1e4] flex flex-col antialiased selection:bg-[#ef4444]/30 selection:text-white">
      
      {/* SideNavBar */}

      <DashboardSidebar />


      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 md:w-[calc(100%-16rem)] w-full relative">
        




        {/* Canvas */}
        <main className="flex-1 p-0 grid-bg relative">
          <div className="p-6">
            <div className="grid grid-cols-12 gap-0 tech-border bg-[#0e0e10] crosshair-corners">
              
              {/* Main Content Grid Area */}
              <div className="col-span-12 lg:col-span-8 lg:tech-border-r border-b lg:border-b-0 border-zinc-900 p-6 space-y-6 flex flex-col justify-between">
                
                {/* API Key Panel */}
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="space-y-1">
                      <h2 className="font-mono text-xs text-white flex items-center gap-2 tracking-[0.2em] uppercase font-bold">
                        <div className="w-[3px] h-3 bg-[#ef4444]"></div>
                        PROGRAMMATIC_API_KEYS
                      </h2>
                      <p className="text-[10px] font-mono text-zinc-500 uppercase">Generate secure bearer tokens to connect to your routed models.</p>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="Key label (e.g. dev, prod)"
                        className="border border-zinc-800 bg-[#050507] px-4 py-2 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-[#ef4444]/50 transition-colors w-40 font-mono"
                      />
                      <div className="flex flex-col gap-2">
                        <InteractionCaptcha
                          action="create_key"
                          boxed
                          onVerified={(token) => setCaptchaToken(token)}
                        />
                        <button
                          onClick={handleCreateKey}
                          disabled={!captchaToken}
                          className="bg-zinc-900 border border-zinc-850 hover:border-[#ef4444] hover:bg-[#ef4444]/5 text-white font-mono text-xs font-bold py-2 px-4 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          [+] CREATE
                        </button>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="p-4 bg-[#ef4444]/10 border border-[#ef4444] text-[11px] font-mono text-[#ef4444] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-[#ef4444] status-pulse red-glow" />
                      {error.toUpperCase()}
                    </div>
                  )}

                  {/* New Key Alert Box */}
                  {createdKey && (
                    <div className="p-4 bg-[#ef4444]/5 border border-[#ef4444]/20 text-[11px] font-mono space-y-2 animate-fade-in">
                      <p className="text-[#ef4444] font-bold">✓ NEW API KEY GENERATED SUCCESSFULLY! COPY NOW — IT WILL NOT BE DISPLAYED AGAIN:</p>
                      <div className="flex items-center justify-between gap-3 bg-[#050507] p-3 border border-[#ef4444]/20 font-mono text-xs text-[#ef4444] red-glow-text">
                        <code className="select-all break-all">{createdKey}</code>
                        <button 
                          onClick={() => copyToClipboard(createdKey, 'createdKey', (v) => setCopiedCreatedKey(!!v))}
                          className="p-1 border border-[#ef4444]/30 bg-zinc-950 text-zinc-400 hover:text-white transition-all shrink-0"
                          title="Copy Key"
                        >
                          {copiedCreatedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <button onClick={() => setCreatedKey(null)} className="text-[9px] text-zinc-500 hover:text-zinc-400 uppercase font-bold underline">Dismiss Alert</button>
                    </div>
                  )}

                  {/* Keys list */}
                  {loading ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="h-16 bg-[#050507] border border-zinc-900 animate-pulse flex items-center px-4">
                        <span className="text-[10px] text-zinc-600 font-mono tracking-widest uppercase">READING_KEY_VAULT_01...</span>
                      </div>
                      <div className="h-16 bg-[#050507] border border-zinc-900 animate-pulse flex items-center px-4">
                        <span className="text-[10px] text-zinc-600 font-mono tracking-widest uppercase">READING_KEY_VAULT_02...</span>
                      </div>
                    </div>
                  ) : keys.length === 0 ? (
                    <p className="text-xs text-zinc-650 py-4 font-mono uppercase text-center">[NO_ACTIVE_KEYS_FOUND_GENERATE_ABOVE]</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {keys.map((key) => (
                        <div key={key.id} className="flex items-center justify-between p-4 bg-[#050507] border border-zinc-900 hover:border-zinc-800 transition-all">
                          <div className="space-y-1">
                            <p className="text-xs font-mono font-bold text-zinc-300 uppercase">{key.key_name}</p>
                            <p className="text-[10px] text-zinc-600 font-mono">{key.key_prefix}...••••</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-zinc-600 font-mono">
                              {new Date(key.created_at).toLocaleDateString()}
                            </span>
                            <button
                              onClick={() => handleRevokeKey(key.id)}
                              className="p-2 border border-zinc-900 bg-zinc-950 text-zinc-500 hover:text-[#ef4444] hover:border-[#ef4444]/30 hover:bg-[#ef4444]/5 transition-all"
                              title="Revoke Key"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Quick Start Connection Guide Right Column */}
              <div className="col-span-12 lg:col-span-4 p-6 flex flex-col justify-between bg-[#0e0e10]">
                <div className="space-y-4">
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

                <div className="mt-6 pt-6 border-t border-zinc-900">
                  <div className="flex justify-between items-center px-1 font-mono text-[9px]">
                    <span className="text-zinc-650">CLIENT_COMPATIBILITY</span>
                    <span className="text-emerald-500">v1_OPENAI_COMPATIBLE</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </main>
      </div>

    </div>
  )
}
