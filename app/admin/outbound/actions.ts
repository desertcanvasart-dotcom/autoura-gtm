'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  createCampaign,
  importProspects,
  getProspect,
  getMessage,
  getCampaign,
  upsertDraft,
  markMessageSent,
  setProspectStatus,
  advanceSequenceAfterSend,
  setSequenceStatus,
  claimDraftForSend,
  cancelPendingDrafts,
  getLatestMessage,
  requeueFailedMessage,
} from '@/lib/outbound/db'
import { parseProspectsCsv } from '@/lib/outbound/csv'
import { draftTouch1 } from '@/lib/outbound/copywriter'
import { sendOutbound } from '@/lib/outbound/sender'
import { addSuppression } from '@/lib/outbound/suppression'
import { handoffToConcierge } from '@/lib/outbound/handoff'

export async function createCampaignAction(formData: FormData) {
  const name = String(formData.get('name') || '').trim()
  if (!name) return
  const fromEmail = String(formData.get('from_email') || '').trim() || null
  const c = await createCampaign(name, fromEmail)
  redirect(`/admin/outbound/${c.id}`)
}

export async function importCsvAction(formData: FormData) {
  const campaignId = String(formData.get('campaign_id') || '')
  const csv = String(formData.get('csv') || '')
  if (!campaignId || !csv.trim()) return
  const parsed = parseProspectsCsv(csv)
  if (parsed.rows.length > 0) {
    await importProspects(campaignId, parsed.rows)
  }
  revalidatePath(`/admin/outbound/${campaignId}`)
}

export async function draftAction(formData: FormData) {
  const prospectId = String(formData.get('prospect_id') || '')
  const p = await getProspect(prospectId)
  if (!p) return
  // Touch 1 is only for prospects never contacted; follow-ups come from the sequencer.
  if (p.current_touch >= 1 || p.status === 'suppressed') return
  try {
    const draft = await draftTouch1(p)
    await upsertDraft(p, draft.subject, draft.body)
  } catch {
    await setProspectStatus(p.id, 'failed')
  }
  revalidatePath(`/admin/outbound/${p.campaign_id}`)
}

export async function approveSendAction(formData: FormData) {
  const messageId = String(formData.get('message_id') || '')
  const m = await getMessage(messageId)
  if (!m || m.status !== 'draft') return
  const p = await getProspect(m.prospect_id)
  const c = p ? await getCampaign(p.campaign_id) : null
  if (!p || !c) return

  // A replied/stopped/bounced/opted-out sequence never sends another touch.
  if (p.sequence_status !== 'active') {
    await cancelPendingDrafts([p.id])
    revalidatePath(`/admin/outbound/${p.campaign_id}`)
    return
  }
  // Claim the draft atomically so a double-click or second tab can't send twice.
  if (!(await claimDraftForSend(m.id))) return

  const outcome = await sendOutbound(m, p, c)
  if (outcome.status === 'suppressed') {
    await setProspectStatus(p.id, 'suppressed')
    await setSequenceStatus(p.id, 'opted_out')
    await markMessageSent(m.id, { status: 'failed', error: 'suppressed' })
  } else if (outcome.status === 'failed') {
    await markMessageSent(m.id, { status: 'failed', error: outcome.error })
    await setProspectStatus(p.id, 'failed')
  } else {
    await markMessageSent(m.id, { status: outcome.status, resendId: outcome.resendId })
    // Advance the sequence: record this touch and schedule the next (or complete).
    await advanceSequenceAfterSend(p, c, m.touch_number)
  }
  revalidatePath(`/admin/outbound/${p.campaign_id}`)
}

export async function retryFailedAction(formData: FormData) {
  const messageId = String(formData.get('message_id') || '')
  const m = await getMessage(messageId)
  if (!m || m.status !== 'failed') return
  const p = await getProspect(m.prospect_id)
  if (!p) return
  // Only retry the prospect's latest message, and only while the sequence is live.
  const latest = await getLatestMessage(p.id)
  if (p.sequence_status === 'active' && p.status !== 'suppressed' && latest?.id === m.id) {
    await requeueFailedMessage(m) // back to draft → needs approval again
  }
  revalidatePath(`/admin/outbound/${p.campaign_id}`)
}

export async function markRepliedAction(formData: FormData) {
  const prospectId = String(formData.get('prospect_id') || '')
  const campaignId = String(formData.get('campaign_id') || '')
  const p = await getProspect(prospectId)
  if (!p) return
  await setSequenceStatus(p.id, 'replied') // stops any further touches
  await handoffToConcierge(p) // creates a gtm-outbound lead in /admin
  if (campaignId) revalidatePath(`/admin/outbound/${campaignId}`)
}

export async function stopSequenceAction(formData: FormData) {
  const prospectId = String(formData.get('prospect_id') || '')
  const campaignId = String(formData.get('campaign_id') || '')
  if (prospectId) await setSequenceStatus(prospectId, 'stopped')
  if (campaignId) revalidatePath(`/admin/outbound/${campaignId}`)
}

export async function suppressAction(formData: FormData) {
  const email = String(formData.get('email') || '')
  const prospectId = String(formData.get('prospect_id') || '')
  const campaignId = String(formData.get('campaign_id') || '')
  if (email) await addSuppression(email, 'manual', 'Suppressed from admin')
  if (prospectId) {
    await setProspectStatus(prospectId, 'suppressed')
    await setSequenceStatus(prospectId, 'opted_out')
  }
  if (campaignId) revalidatePath(`/admin/outbound/${campaignId}`)
}
