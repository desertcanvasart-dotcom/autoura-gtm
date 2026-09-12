// ============================================================================
// SUPPRESSION LIST — the hard pre-send gate
// ============================================================================
// No outbound email is sent without passing isSuppressed() first. Opt-outs are
// permanent. Emails are normalized (trimmed + lowercased) everywhere.
// ============================================================================

import { getSupabaseAdmin } from '@/lib/supabase/admin'

export type SuppressionReason =
  | 'opt_out'
  | 'bounce'
  | 'complaint'
  | 'manual'
  | 'existing_lead'
  | 'customer'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function isSuppressed(email: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_suppression')
    .select('id')
    .eq('email', normalizeEmail(email))
    .maybeSingle()
  return !!data
}

export async function addSuppression(
  email: string,
  reason: SuppressionReason,
  notes?: string
): Promise<void> {
  const supabase = getSupabaseAdmin()
  // Idempotent: unique index on email means re-adding is a no-op we ignore.
  await supabase
    .from('outbound_suppression')
    .upsert({ email: normalizeEmail(email), reason, notes: notes ?? null }, { onConflict: 'email', ignoreDuplicates: true })
}

/** Emails from this set that are suppressed (for bulk import screening). */
export async function suppressedAmong(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const norm = emails.map(normalizeEmail)
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_suppression')
    .select('email')
    .in('email', norm)
  return new Set((data ?? []).map((r) => r.email as string))
}
