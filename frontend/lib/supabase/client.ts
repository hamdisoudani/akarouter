import { createBrowserClient } from '@supabase/ssr'

const NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://fleouqrgltkodumrgxlt.supabase.co'

const NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  (typeof window !== 'undefined'
    ? (window as any)._NEXT_DATA?.buildInfo?.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : '') ||
  ''

export function createClient() {
  return createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
