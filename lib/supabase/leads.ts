// ============================================================================
// GTM PERSISTENCE — conversations, messages, leads
// ============================================================================
// All writes go through the service-role client. Every conversation has exactly
// one gtm_leads row (created lazily on first write).
// ============================================================================

import { getSupabaseAdmin } from './admin'

export type LeadSource = 'gtm-inbound' | 'gtm-outbound'
export type Qualification = 'unqualified' | 'qualifying' | 'qualified' | 'not_icp'
export type BusinessModel = 'b2c' | 'b2b' | 'both'

export interface GtmMessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls: unknown | null
  created_at: string
}

export interface LeadUpdate {
  contact_name?: string
  contact_email?: string
  company_name?: string
  role_title?: string
  current_system?: string
  destinations?: string
  business_model?: BusinessModel
  quotes_per_week?: number
  top_pain?: string
  qualification?: Qualification
  in_icp?: boolean
  notes?: string
}

// ----------------------------------------------------------------------------
// Conversations
// ----------------------------------------------------------------------------

export async function createConversation(input: {
  source?: LeadSource
  pageUrl?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}): Promise<string> {
  const supabase = getSupabaseAdmin()
  const source = input.source ?? 'gtm-inbound'

  const { data, error } = await supabase
    .from('gtm_conversations')
    .insert({
      source,
      page_url: input.pageUrl ?? null,
      user_agent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`createConversation failed: ${error?.message}`)

  // Create the paired lead row up front so it always exists.
  const { error: leadError } = await supabase
    .from('gtm_leads')
    .insert({ conversation_id: data.id, source })
  if (leadError) throw new Error(`createLead failed: ${leadError.message}`)

  return data.id as string
}

export async function conversationExists(conversationId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('gtm_conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()
  return !!data
}

export async function setConversationStatus(
  conversationId: string,
  status: 'active' | 'qualified' | 'escalated' | 'disqualified' | 'abandoned'
): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase.from('gtm_conversations').update({ status }).eq('id', conversationId)
}

// ----------------------------------------------------------------------------
// Messages
// ----------------------------------------------------------------------------

export async function appendMessage(input: {
  conversationId: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: unknown
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('gtm_messages').insert({
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    tool_calls: input.toolCalls ?? null,
  })
  if (error) throw new Error(`appendMessage failed: ${error.message}`)
}

export async function getMessages(conversationId: string): Promise<GtmMessageRow[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('gtm_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`getMessages failed: ${error.message}`)
  return (data ?? []) as GtmMessageRow[]
}

// ----------------------------------------------------------------------------
// Leads
// ----------------------------------------------------------------------------

export async function updateLead(conversationId: string, patch: LeadUpdate): Promise<void> {
  const supabase = getSupabaseAdmin()
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== '')
  )
  if (Object.keys(clean).length === 0) return
  const { error } = await supabase.from('gtm_leads').update(clean).eq('conversation_id', conversationId)
  if (error) throw new Error(`updateLead failed: ${error.message}`)
}

export async function markDemoSurfaced(conversationId: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('gtm_leads')
    .update({ demo_link_surfaced: true, qualification: 'qualified' })
    .eq('conversation_id', conversationId)
  await setConversationStatus(conversationId, 'qualified')
}

export async function escalateLead(conversationId: string, reason: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('gtm_leads')
    .update({ escalated: true, escalation_reason: reason })
    .eq('conversation_id', conversationId)
  await setConversationStatus(conversationId, 'escalated')
}
