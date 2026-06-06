'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getModels, chatCompletion, type ModelsResponse } from '@/lib/api'

export default function Dashboard() {
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<{ email: string } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: any } }) => {
      if (session?.user) setUser(session.user)
    })
    supabase.auth.onAuthStateChange((_event: string, session: any) => {
      setUser(session?.user ?? null)
    })
    getModels().then((res: ModelsResponse) => {
      const modelIds = res.data.map(m => m.id)
      setModels(modelIds)
      if (modelIds.length) setSelectedModel(modelIds[0])
    }).catch(console.error)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !selectedModel) return
    setLoading(true)
    const newMessages = [...messages, { role: 'user', content: input }]
    setMessages(newMessages)
    setInput('')
    try {
      const res = await chatCompletion({ model: selectedModel, messages: newMessages })
      const assistantMsg = res.choices?.[0]?.message?.content || 'No response'
      setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }])
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <h1 className="text-2xl font-bold akarouter-text-gradient">AKAROUTER Dashboard</h1>
          <div className="flex items-center gap-4">
            {user && (
              <>
                <span className="text-sm text-gray-600">{user.email}</span>
                <button onClick={signOut} className="text-sm text-blue-600 hover:underline">Sign out</button>
              </>
            )}
            {!user && (
              <a href="/auth/login" className="text-sm text-blue-600 hover:underline">Sign in</a>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 py-8">
        <div className="mx-auto max-w-5xl grid lg:grid-cols-4 gap-8">
          {/* Chat */}
          <section className="lg:col-span-3 flex flex-col h-[calc(100vh-140px)]">
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white rounded-xl border border-gray-200 shadow-sm">
              {messages.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <p className="text-lg">Start a conversation</p>
                  <p className="text-sm mt-1">Select a model and send a message</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-none'
                          : 'bg-gray-100 text-gray-900 rounded-bl-none'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleSubmit} className="mt-4 flex gap-3">
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={loading || models.length === 0}
                className="w-full sm:w-64 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {models.map(m => <option key={m} value={m}>{m}</option>)}
                {models.length === 0 && <option value="">Loading models...</option>}
              </select>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Message..."
                disabled={loading}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={loading || !input.trim() || !selectedModel}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Sending...' : 'Send'}
              </button>
            </form>
          </section>

          {/* Sidebar */}
          <aside className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">API Status</h2>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-sm text-gray-600">Backend Online</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                https://akarouter-production.up.railway.app
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Available Models</h2>
              <ul className="space-y-1 text-sm text-gray-600">
                {models.map(m => (
                  <li key={m} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    {m}
                  </li>
                ))}
                {models.length === 0 && <li>Loading...</li>}
              </ul>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Endpoints</h2>
              <ul className="space-y-1 text-sm font-mono text-gray-600">
                <li>/v1/models</li>
                <li>/v1/chat/completions</li>
                <li>/healthz</li>
                <li>/health</li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
