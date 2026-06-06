import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fleouqrgltkodumrgxlt.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
  }
  return createClient(supabaseUrl, supabaseAnonKey)
}

// Lazy singleton for client-side usage
let _supabase: ReturnType<typeof createClient> | null = null
export const supabase = {
  get auth() {
    if (!_supabase) {
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase credentials not configured')
      }
      _supabase = createClient(supabaseUrl, supabaseAnonKey)
    }
    return _supabase.auth
  },
  get from() {
    if (!_supabase) {
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase credentials not configured')
      }
      _supabase = createClient(supabaseUrl, supabaseAnonKey)
    }
    return _supabase.from
  },
} as any

// Real client for auth callback route (server-side only, env vars available at runtime)
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) {
    throw new Error('Supabase credentials not configured')
  }
  return createClient(url, key)
}
