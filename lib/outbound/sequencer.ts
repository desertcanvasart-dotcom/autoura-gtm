// ============================================================================
// SEQUENCER — auto-draft due follow-ups (Touch 2/3) into the approval queue
// ============================================================================
// Run on a schedule (see /api/cron/outbound-followups). For each prospect whose
// next touch is due — still active, under the cap, not replied/opted-out — this
// drafts the next touch and leaves it in the human-approval queue. It never
// sends; a person still approves every send.
// ============================================================================

import { listDueFollowups, getSentTouches, upsertDraft, setSequenceStatus } from './db'
import { isSuppressed } from './suppression'
import { draftFollowup } from './copywriter'

export interface SequencerResult {
  drafted: number
  skippedSuppressed: number
  errors: number
}

export async function draftDueFollowups(limit = 25): Promise<SequencerResult> {
  const due = await listDueFollowups(limit)
  const result: SequencerResult = { drafted: 0, skippedSuppressed: 0, errors: 0 }

  for (const { prospect, campaign } of due) {
    try {
      // Opt-outs/suppression stop the sequence immediately.
      if (await isSuppressed(prospect.contact_email)) {
        await setSequenceStatus(prospect.id, 'opted_out')
        result.skippedSuppressed++
        continue
      }

      const sent = await getSentTouches(prospect.id)
      const touch1Subject = sent[0]?.subject || 'quick question'
      const nextTouch = (prospect.current_touch + 1) as 2 | 3
      if (nextTouch < 2 || nextTouch > 3) continue

      const draft = await draftFollowup(prospect, nextTouch, sent.map((m) => m.body || ''))
      // Keep the same thread subject with a Re: prefix.
      const subject = touch1Subject.toLowerCase().startsWith('re:') ? touch1Subject : `Re: ${touch1Subject}`
      await upsertDraft(prospect, subject, draft.body, nextTouch)
      result.drafted++
    } catch {
      result.errors++
    }
  }
  return result
}
