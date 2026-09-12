// ============================================================================
// SUPABASE SERVICE-ROLE CLIENT (server-only)
// ============================================================================
// Uses the service-role key to read/write the gtm_ tables, bypassing RLS.
// NEVER import this into client components — it must never reach the browser.
// ============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _admin: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      throw new Error(
        'Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
      )
    }
    _admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _admin
}
