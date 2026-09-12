// ============================================================================
// ADMIN READ QUERIES
// ============================================================================
// Read-side helpers for the /admin view. Service-role, server-only.
// ============================================================================

import { getSupabaseAdmin } from './admin'
import type { GtmMessageRow } from './leads'

export interface AdminLeadRow {
  conversation_id: string
  source: string
  contact_name: string | null
  company_name: string | null
  contact_email: string | null
  role_title: string | null
  current_system: string | null
  destinations: string | null
  business_model: string | null
  quotes_per_week: number | null
  top_pain: string | null
  qualification: string
  in_icp: boolean | null
  escalated: boolean
  escalation_reason: string | null
  demo_link_surfaced: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface AdminConversationSummary {
  id: string
  status: string
  source: string
  page_url: string | null
  created_at: string
  updated_at: string
  lead: AdminLeadRow | null
  message_count: number
}

export async function listConversations(limit = 100): Promise<AdminConversationSummary[]> {
  const supabase = getSupabaseAdmin()

  const { data: convos, error } = await supabase
    .from('gtm_conversations')
    .select('id, status, source, page_url, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listConversations failed: ${error.message}`)
  if (!convos?.length) return []

  const ids = convos.map((c) => c.id)

  const { data: leads } = await supabase
    .from('gtm_leads')
    .select('*')
    .in('conversation_id', ids)

  const leadByConvo = new Map<string, AdminLeadRow>()
  for (const l of leads ?? []) leadByConvo.set(l.conversation_id, l as AdminLeadRow)

  // Message counts per conversation.
  const { data: msgs } = await supabase.from('gtm_messages').select('conversation_id').in('conversation_id', ids)
  const countByConvo = new Map<string, number>()
  for (const m of msgs ?? []) {
    countByConvo.set(m.conversation_id, (countByConvo.get(m.conversation_id) ?? 0) + 1)
  }

  return convos.map((c) => ({
    id: c.id,
    status: c.status,
    source: c.source,
    page_url: c.page_url,
    created_at: c.created_at,
    updated_at: c.updated_at,
    lead: leadByConvo.get(c.id) ?? null,
    message_count: countByConvo.get(c.id) ?? 0,
  }))
}

export async function getConversationDetail(conversationId: string): Promise<{
  conversation: AdminConversationSummary | null
  messages: GtmMessageRow[]
}> {
  const supabase = getSupabaseAdmin()

  const { data: convo } = await supabase
    .from('gtm_conversations')
    .select('id, status, source, page_url, created_at, updated_at')
    .eq('id', conversationId)
    .maybeSingle()

  if (!convo) return { conversation: null, messages: [] }

  const { data: lead } = await supabase
    .from('gtm_leads')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle()

  const { data: messages } = await supabase
    .from('gtm_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  return {
    conversation: {
      id: convo.id,
      status: convo.status,
      source: convo.source,
      page_url: convo.page_url,
      created_at: convo.created_at,
      updated_at: convo.updated_at,
      lead: (lead as AdminLeadRow) ?? null,
      message_count: messages?.length ?? 0,
    },
    messages: (messages ?? []) as GtmMessageRow[],
  }
}
