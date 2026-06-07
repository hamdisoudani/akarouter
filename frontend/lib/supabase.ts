import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Hardcode fallbacks — these are PUBLIC anon keys, not secrets
// Next.js embeds NEXT_PUBLIC_* at BUILD time, so Railway runtime env vars
// don't work unless passed as Docker build args. Fallbacks ensure it always works.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fleouqrgltkodumrgxlt.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsZW91cXJnbHRrb2R1bXJneGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3NzA4MjYsImV4cCI6MjA2MjM0NjgyNn0.Kx6tO7X6O9t4yOVhz3GFqN4y_NL3uLBW56C4Jgw'

// Create singleton client immediately — no lazy getter that can throw
let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnonKey)
  }
  return _client
}

// Export the full client — consumers use supabase.auth, supabase.from, supabase.channel etc.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, _receiver) {
    const client = getClient()
    const value = (client as any)[prop]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  }
})

// Server-side helper (for API routes)
export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || supabaseUrl
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || supabaseAnonKey
  return createClient(url, key)
}
