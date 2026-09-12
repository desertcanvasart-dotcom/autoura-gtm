// ============================================================================
// WARM-REPLY HANDOFF → concierge lead
// ============================================================================
// When an outbound prospect replies, they become a gtm-outbound lead (reusing
// the same gtm_leads table as the inbound concierge), so warm replies show up
// in /admin alongside inbound leads for a human to take over and book.
// ============================================================================

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import type { ProspectRow } from './db'

export async function handoffToConcierge(prospect: ProspectRow): Promise<string | null> {
  const supabase = getSupabaseAdmin()

  const { data: convo, error: convoErr } = await supabase
    .from('gtm_conversations')
    .insert({
      source: 'gtm-outbound',
      status: 'active',
      metadata: { outbound_prospect_id: prospect.id, campaign_id: prospect.campaign_id },
    })
    .select('id')
    .single()
  if (convoErr || !convo) return null

  await supabase.from('gtm_leads').insert({
    conversation_id: convo.id,
    source: 'gtm-outbound',
    contact_name: prospect.contact_name,
    contact_email: prospect.contact_email,
    company_name: prospect.company_name,
    role_title: prospect.role_title,
    destinations: prospect.destination,
    qualification: 'qualifying',
    notes: `Replied to outbound sequence (after touch ${prospect.current_touch}). Signal: ${prospect.signal || '—'}. Continue the conversation by email at ${prospect.contact_email}.`,
  })

  return convo.id as string
}
