"use client"
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Provider = {
  id: string
  account_label: string
  health_status: string
  weight: number
  total_requests: number
  total_errors: number
  in_flight: number
  max_concurrent: number
  last_used_at: string | null
  last_error_at: string | null
  last_error_msg: string | null
  created_at: string
}

export default function AdminDashboard() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [authData, setAuthData] = useState<{ user_code: string; verification_uri: string } | null>(null)
  const [polling, setPolling] = useState(false)

  const fetchProviders = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/admin/providers', {
        headers: {
          'Authorization': 'Bearer ' + (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        }
      })
      if (res.ok) {
        const data = await res.json()
        setProviders(data.providers)
      } else {
        console.error("Failed to fetch providers", await res.text())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProviders()

    const channel = supabase
      .channel('providers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'providers' }, (payload: any) => {
        console.log('Change received!', payload)
        if (payload.eventType === 'INSERT') {
          setProviders((prev) => [...prev, payload.new as Provider])
        } else if (payload.eventType === 'UPDATE') {
          setProviders((prev) => prev.map(p => p.id === payload.new.id ? payload.new as Provider : p))
        } else if (payload.eventType === 'DELETE') {
          setProviders((prev) => prev.filter(p => p.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const handleConnectNewAccount = async () => {
    setPolling(true)
    setAuthData(null)
    const label = prompt("Enter an account label (e.g. your email):") || "unnamed"

    try {
      const res = await fetch(`http://127.0.0.1:8000/admin/hermes/auth?account_label=${encodeURIComponent(label)}`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        }
      })
      if (res.ok) {
        const data = await res.json()
        setAuthData({ user_code: data.user_code, verification_uri: data.verification_uri })
      } else {
        alert("Failed to start auth flow: " + await res.text())
        setPolling(false)
      }
    } catch (e) {
      console.error(e)
      alert("Error starting auth flow")
      setPolling(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Admin Dashboard - Providers</h1>
        <button
          onClick={handleConnectNewAccount}
          disabled={polling && !authData}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {polling && !authData ? "Starting..." : "Connect New Hermes Account"}
        </button>
      </div>

      {authData && (
        <div className="mb-8 p-6 bg-yellow-100 border border-yellow-400 rounded-lg text-yellow-900">
          <h2 className="text-xl font-bold mb-2">Authentication Required</h2>
          <p className="mb-4">Please open the following link in your browser and enter the code below to authorize the application.</p>
          <div className="flex items-center gap-4 mb-4">
            <a href={authData.verification_uri} target="_blank" rel="noreferrer" className="text-blue-600 underline font-semibold">
              {authData.verification_uri}
            </a>
          </div>
          <div className="text-2xl font-mono bg-yellow-200 inline-block px-4 py-2 rounded">
            {authData.user_code}
          </div>
          <p className="mt-4 text-sm">Waiting for approval... This window will update automatically when done.</p>
        </div>
      )}

      {loading ? (
        <p>Loading providers...</p>
      ) : providers.length === 0 ? (
        <p>No providers configured yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border-b text-left">Label</th>
                <th className="py-2 px-4 border-b text-left">Status</th>
                <th className="py-2 px-4 border-b text-right">Weight</th>
                <th className="py-2 px-4 border-b text-right">Requests</th>
                <th className="py-2 px-4 border-b text-right">Errors</th>
                <th className="py-2 px-4 border-b text-right">In Flight</th>
                <th className="py-2 px-4 border-b text-right">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {providers.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="py-2 px-4 border-b">{p.account_label}</td>
                  <td className="py-2 px-4 border-b">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      p.health_status === 'active' || p.health_status === 'healthy' ? 'bg-green-100 text-green-800' :
                      p.health_status === 'degraded' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {p.health_status}
                    </span>
                  </td>
                  <td className="py-2 px-4 border-b text-right">{p.weight}</td>
                  <td className="py-2 px-4 border-b text-right">{p.total_requests}</td>
                  <td className="py-2 px-4 border-b text-right">{p.total_errors}</td>
                  <td className="py-2 px-4 border-b text-right">{p.in_flight} / {p.max_concurrent}</td>
                  <td className="py-2 px-4 border-b text-right text-sm text-gray-500">
                    {p.last_used_at ? new Date(p.last_used_at).toLocaleString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
