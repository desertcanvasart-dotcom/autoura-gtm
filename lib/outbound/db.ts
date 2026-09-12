// ============================================================================
// OUTBOUND PERSISTENCE — campaigns, prospects, messages
// ============================================================================
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { normalizeEmail, suppressedAmong } from './suppression'

export type ProspectStatus =
  | 'new' | 'drafted' | 'approved' | 'sent' | 'replied' | 'suppressed' | 'skipped' | 'failed'

export interface CampaignRow {
  id: string
  name: string
  from_email: string | null
  status: string
  touch_interval_days: number
  max_touches: number
  created_at: string
  updated_at: string
}

export type SequenceStatus = 'active' | 'completed' | 'replied' | 'stopped' | 'bounced' | 'opted_out'

export interface ProspectRow {
  id: string
  campaign_id: string
  company_name: string | null
  contact_name: string | null
  contact_email: string
  role_title: string | null
  destination: string | null
  signal: string | null
  status: ProspectStatus
  sequence_status: SequenceStatus
  current_touch: number
  next_touch_due_at: string | null
  created_at: string
  updated_at: string
}

export interface MessageRow {
  id: string
  prospect_id: string
  campaign_id: string
  touch_number: number
  channel: string
  subject: string | null
  body: string | null
  status: 'draft' | 'approved' | 'sent' | 'failed' | 'canceled' | 'dry_run'
  resend_id: string | null
  error: string | null
  approved_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

// ---------------- Campaigns ----------------

export async function createCampaign(name: string, fromEmail?: string | null): Promise<CampaignRow> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('outbound_campaigns')
    .insert({ name, from_email: fromEmail ?? null })
    .select('*')
    .single()
  if (error || !data) throw new Error(`createCampaign failed: ${error?.message}`)
  return data as CampaignRow
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('outbound_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listCampaigns failed: ${error.message}`)
  return (data ?? []) as CampaignRow[]
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from('outbound_campaigns').select('*').eq('id', id).maybeSingle()
  return (data as CampaignRow) ?? null
}

// ---------------- Prospects ----------------

export interface ProspectInput {
  company_name?: string
  contact_name?: string
  contact_email: string
  role_title?: string
  destination?: string
  signal?: string
}

export interface ImportResult {
  inserted: number
  skippedDuplicate: number
  skippedSuppressed: number
  skippedInvalid: number
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Insert prospects for a campaign. Screens against suppression + invalid emails. */
export async function importProspects(campaignId: string, rows: ProspectInput[]): Promise<ImportResult> {
  const supabase = getSupabaseAdmin()
  const result: ImportResult = { inserted: 0, skippedDuplicate: 0, skippedSuppressed: 0, skippedInvalid: 0 }

  const valid = rows.filter((r) => r.contact_email && EMAIL_RE.test(r.contact_email.trim()))
  result.skippedInvalid = rows.length - valid.length
  if (valid.length === 0) return result

  const suppressed = await suppressedAmong(valid.map((r) => r.contact_email))

  for (const r of valid) {
    if (suppressed.has(normalizeEmail(r.contact_email))) {
      result.skippedSuppressed++
      continue
    }
    const { error } = await supabase.from('outbound_prospects').insert({
      campaign_id: campaignId,
      company_name: r.company_name ?? null,
      contact_name: r.contact_name ?? null,
      contact_email: r.contact_email.trim(),
      role_title: r.role_title ?? null,
      destination: r.destination ?? null,
      signal: r.signal ?? null,
    })
    if (error) {
      // Unique-index violation = duplicate within campaign.
      if (error.code === '23505') result.skippedDuplicate++
      else throw new Error(`importProspects insert failed: ${error.message}`)
    } else {
      result.inserted++
    }
  }
  return result
}

export async function listProspects(campaignId: string): Promise<ProspectRow[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('outbound_prospects')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listProspects failed: ${error.message}`)
  return (data ?? []) as ProspectRow[]
}

export async function getProspect(id: string): Promise<ProspectRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from('outbound_prospects').select('*').eq('id', id).maybeSingle()
  return (data as ProspectRow) ?? null
}

export async function setProspectStatus(id: string, status: ProspectStatus): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase.from('outbound_prospects').update({ status }).eq('id', id)
}

// ---------------- Messages ----------------

export async function getLatestMessage(prospectId: string): Promise<MessageRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_messages')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as MessageRow) ?? null
}

export async function upsertDraft(
  prospect: ProspectRow,
  subject: string,
  body: string,
  touchNumber = 1
): Promise<MessageRow> {
  const supabase = getSupabaseAdmin()
  // Replace any existing non-sent draft for this touch.
  await supabase
    .from('outbound_messages')
    .delete()
    .eq('prospect_id', prospect.id)
    .eq('touch_number', touchNumber)
    .in('status', ['draft', 'canceled'])

  const { data, error } = await supabase
    .from('outbound_messages')
    .insert({
      prospect_id: prospect.id,
      campaign_id: prospect.campaign_id,
      touch_number: touchNumber,
      channel: 'email',
      subject,
      body,
      status: 'draft',
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`upsertDraft failed: ${error?.message}`)
  // Clear the due timestamp so the scheduler doesn't re-draft while it waits
  // for approval; keep the prospect 'active' in the sequence.
  await supabase
    .from('outbound_prospects')
    .update({ status: 'drafted', next_touch_due_at: null })
    .eq('id', prospect.id)
  return data as MessageRow
}

// ---------------- Sequencing (Slice B) ----------------

/** Advance the sequence after a touch is successfully sent. */
export async function advanceSequenceAfterSend(
  prospect: ProspectRow,
  campaign: CampaignRow,
  touchNumber: number
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const hasMore = touchNumber < campaign.max_touches
  const nextDue = hasMore
    ? new Date(Date.now() + campaign.touch_interval_days * 86400_000).toISOString()
    : null
  await supabase
    .from('outbound_prospects')
    .update({
      status: 'sent',
      current_touch: touchNumber,
      sequence_status: hasMore ? 'active' : 'completed',
      next_touch_due_at: nextDue,
    })
    .eq('id', prospect.id)
}

export interface DueFollowup {
  prospect: ProspectRow
  campaign: CampaignRow
}

/** Prospects whose next touch is due (active, past due, still under the cap). */
export async function listDueFollowups(limit = 25): Promise<DueFollowup[]> {
  const supabase = getSupabaseAdmin()
  const { data: prospects } = await supabase
    .from('outbound_prospects')
    .select('*')
    .eq('sequence_status', 'active')
    .not('next_touch_due_at', 'is', null)
    .lte('next_touch_due_at', new Date().toISOString())
    .order('next_touch_due_at', { ascending: true })
    .limit(limit)

  const rows = (prospects ?? []) as ProspectRow[]
  const out: DueFollowup[] = []
  for (const p of rows) {
    const campaign = await getCampaign(p.campaign_id)
    if (!campaign) continue
    if (p.current_touch >= campaign.max_touches) continue
    out.push({ prospect: p, campaign })
  }
  return out
}

/** Prior SENT message bodies (ascending by touch), for follow-up continuity. */
export async function getSentTouches(prospectId: string): Promise<MessageRow[]> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_messages')
    .select('*')
    .eq('prospect_id', prospectId)
    .in('status', ['sent', 'dry_run'])
    .order('touch_number', { ascending: true })
  return (data ?? []) as MessageRow[]
}

export async function setSequenceStatus(prospectId: string, status: SequenceStatus): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('outbound_prospects')
    .update({ sequence_status: status, next_touch_due_at: null })
    .eq('id', prospectId)
}

/** Stop every active sequence for an email (used on bounce/complaint webhooks). */
export async function stopSequencesByEmail(email: string, status: SequenceStatus): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('outbound_prospects')
    .update({ sequence_status: status, next_touch_due_at: null })
    .ilike('contact_email', email.trim())
    .eq('sequence_status', 'active')
}

export async function getMessage(id: string): Promise<MessageRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from('outbound_messages').select('*').eq('id', id).maybeSingle()
  return (data as MessageRow) ?? null
}

export async function markMessageSent(
  id: string,
  outcome: { status: 'sent' | 'dry_run' | 'failed'; resendId?: string | null; error?: string | null }
): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('outbound_messages')
    .update({
      status: outcome.status,
      resend_id: outcome.resendId ?? null,
      error: outcome.error ?? null,
      approved_at: new Date().toISOString(),
      sent_at: outcome.status === 'failed' ? null : new Date().toISOString(),
    })
    .eq('id', id)
}

/** Messages by status across all campaigns, most recent first (for the queue view). */
export async function listMessagesByProspect(prospectIds: string[]): Promise<Map<string, MessageRow>> {
  if (prospectIds.length === 0) return new Map()
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_messages')
    .select('*')
    .in('prospect_id', prospectIds)
    .order('created_at', { ascending: false })
  const map = new Map<string, MessageRow>()
  for (const m of (data ?? []) as MessageRow[]) {
    if (!map.has(m.prospect_id)) map.set(m.prospect_id, m) // latest per prospect
  }
  return map
}
