// ============================================================================
// OUTBOUND PERSISTENCE — campaigns, prospects, messages
// ============================================================================
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { normalizeEmail, suppressedAmong } from './suppression'
import { normalizeLinkedInUrl } from './linkedin'

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

export type EnrichmentStatus = 'enriched' | 'no_signal' | 'failed'

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
  website: string | null
  linkedin_url: string | null
  enrichment_status: EnrichmentStatus | null
  /** EnrichmentRecord from lib/outbound/enrichment.ts (JSONB). */
  enrichment: Record<string, unknown> | null
  enriched_at: string | null
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
  channel: 'email' | 'linkedin'
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
  website?: string
  linkedin_url?: string
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
      website: r.website ?? null,
      linkedin_url: normalizeLinkedInUrl(r.linkedin_url),
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

// ---------------- Enrichment ----------------

/** Save an enrichment outcome: fill the given empty fields + store the record. */
export async function saveEnrichment(
  prospectId: string,
  fill: Record<string, unknown>,
  status: EnrichmentStatus,
  record: object
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('outbound_prospects')
    .update({ ...fill, enrichment_status: status, enrichment: record, enriched_at: new Date().toISOString() })
    .eq('id', prospectId)
  if (error) throw new Error(`saveEnrichment failed: ${error.message}`)
}

/** Not-yet-enriched prospects still waiting for Touch 1, oldest first. */
export async function listProspectsToEnrich(campaignId: string, limit: number): Promise<ProspectRow[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('outbound_prospects')
    .select('*')
    .eq('campaign_id', campaignId)
    .is('enrichment_status', null)
    .eq('current_touch', 0)
    .eq('sequence_status', 'active')
    .neq('status', 'suppressed')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`listProspectsToEnrich failed: ${error.message}`)
  return (data ?? []) as ProspectRow[]
}

// ---------------- Messages ----------------

export async function getLatestMessage(prospectId: string): Promise<MessageRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_messages')
    .select('*')
    .eq('prospect_id', prospectId)
    .eq('channel', 'email')
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
    .eq('channel', 'email')
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

// ---------------- LinkedIn (assisted) ----------------

/** Replace any unsent LinkedIn draft for this prospect with a new one. */
export async function upsertLinkedInDraft(prospect: ProspectRow, note: string): Promise<MessageRow> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('outbound_messages')
    .delete()
    .eq('prospect_id', prospect.id)
    .eq('channel', 'linkedin')
    .in('status', ['draft', 'canceled', 'failed'])
  const { data, error } = await supabase
    .from('outbound_messages')
    .insert({
      prospect_id: prospect.id,
      campaign_id: prospect.campaign_id,
      touch_number: 1,
      channel: 'linkedin',
      subject: null,
      body: note,
      status: 'draft',
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`upsertLinkedInDraft failed: ${error?.message}`)
  return data as MessageRow
}

/** Record a failed LinkedIn draft so the card can show why (replaces older failures). */
export async function saveLinkedInFailure(prospect: ProspectRow, error: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('outbound_messages')
    .delete()
    .eq('prospect_id', prospect.id)
    .eq('channel', 'linkedin')
    .in('status', ['draft', 'canceled', 'failed'])
  await supabase.from('outbound_messages').insert({
    prospect_id: prospect.id,
    campaign_id: prospect.campaign_id,
    touch_number: 1,
    channel: 'linkedin',
    status: 'failed',
    error: error.slice(0, 500),
  })
}

/** A person sent the note on LinkedIn: draft -> sent (only from draft). */
export async function markLinkedInSent(messageId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('outbound_messages')
    .update({ status: 'sent', approved_at: now, sent_at: now })
    .eq('id', messageId)
    .eq('channel', 'linkedin')
    .eq('status', 'draft')
    .select('id')
  return (data ?? []).length > 0
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
    .eq('channel', 'email')
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
  // A stopped sequence must not leave an approvable follow-up behind.
  if (status !== 'active') await cancelPendingDrafts([prospectId])
}

/** Cancel unsent drafts so they can no longer be approved. */
export async function cancelPendingDrafts(prospectIds: string[]): Promise<void> {
  if (prospectIds.length === 0) return
  const supabase = getSupabaseAdmin()
  await supabase
    .from('outbound_messages')
    .update({ status: 'canceled' })
    .in('prospect_id', prospectIds)
    .eq('status', 'draft')
}

/** Escape LIKE wildcards so a value matches literally (`_` is common in emails). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Stop every active sequence for an email (used on bounce/complaint webhooks). */
export async function stopSequencesByEmail(email: string, status: SequenceStatus): Promise<void> {
  const supabase = getSupabaseAdmin()
  // Case-insensitive exact match: contact_email is stored trimmed, not lowercased.
  const { data } = await supabase
    .from('outbound_prospects')
    .update({ sequence_status: status, next_touch_due_at: null })
    .ilike('contact_email', escapeLikePattern(normalizeEmail(email)))
    .eq('sequence_status', 'active')
    .select('id')
  await cancelPendingDrafts(((data ?? []) as { id: string }[]).map((r) => r.id))
}

// Sequences a reply can still stop. 'completed' is included: a late reply to the
// last touch is still a warm lead worth handing off.
const REPLYABLE_SEQUENCES: SequenceStatus[] = ['active', 'completed']

/**
 * Mark one prospect as replied, but only if its sequence could still be
 * replied to. Returns the updated row when THIS call made the change (so the
 * caller hands off exactly once), or null if it was already replied/stopped.
 */
export async function markProspectReplied(prospectId: string): Promise<ProspectRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_prospects')
    .update({ sequence_status: 'replied', status: 'replied', next_touch_due_at: null })
    .eq('id', prospectId)
    .in('sequence_status', REPLYABLE_SEQUENCES)
    .select('*')
  const row = ((data ?? []) as ProspectRow[])[0] ?? null
  if (row) await cancelPendingDrafts([row.id])
  return row
}

/**
 * Mark every contacted prospect with this email as replied (automatic reply
 * detection). Only prospects we've actually emailed (current_touch >= 1) and
 * whose sequence is still replyable are changed. Returns the rows changed.
 */
export async function markRepliedByEmail(email: string): Promise<ProspectRow[]> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_prospects')
    .update({ sequence_status: 'replied', status: 'replied', next_touch_due_at: null })
    .ilike('contact_email', escapeLikePattern(normalizeEmail(email)))
    .gte('current_touch', 1)
    .in('sequence_status', REPLYABLE_SEQUENCES)
    .select('*')
  const rows = (data ?? []) as ProspectRow[]
  await cancelPendingDrafts(rows.map((r) => r.id))
  return rows
}

/**
 * Atomically move a draft to 'approved'. Returns false if it was no longer a
 * draft (already sent, canceled, or claimed by a concurrent click).
 */
export async function claimDraftForSend(id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_messages')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('channel', 'email') // the email sender never claims a LinkedIn draft
    .eq('status', 'draft')
    .select('id')
  return (data ?? []).length > 0
}

/**
 * Put a failed send back in the approval queue as a draft (same content), so a
 * person can approve it again. Returns false if it was no longer 'failed'.
 */
export async function requeueFailedMessage(message: MessageRow): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_messages')
    .update({ status: 'draft', error: null, approved_at: null, sent_at: null })
    .eq('id', message.id)
    .eq('status', 'failed')
    .select('id')
  if ((data ?? []).length === 0) return false
  await supabase.from('outbound_prospects').update({ status: 'drafted' }).eq('id', message.prospect_id)
  return true
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

/** Latest message per prospect on one channel (for the campaign view). */
export async function listMessagesByProspect(
  prospectIds: string[],
  channel: MessageRow['channel'] = 'email'
): Promise<Map<string, MessageRow>> {
  if (prospectIds.length === 0) return new Map()
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('outbound_messages')
    .select('*')
    .in('prospect_id', prospectIds)
    .eq('channel', channel)
    .order('created_at', { ascending: false })
  const map = new Map<string, MessageRow>()
  for (const m of (data ?? []) as MessageRow[]) {
    if (!map.has(m.prospect_id)) map.set(m.prospect_id, m) // latest per prospect
  }
  return map
}
