// ============================================================================
// AUTOMATIC REPLY DETECTION
// ============================================================================
// Replies land in the OUTBOUND_REPLY_TO inbox as usual; that inbox forwards a
// copy to a Resend receiving address, and Resend posts `email.received` to our
// signed webhook. We match the sender to a prospect we've emailed and run the
// same handoff as the "Replied → hand to concierge" button: stop the sequence,
// cancel pending drafts, create a gtm-outbound lead. Auto-replies (out of
// office, bounces) are ignored so they don't end a sequence.
// ============================================================================

import { markRepliedByEmail, type ProspectRow } from './db'
import { handoffToConcierge } from './handoff'
import { normalizeEmail } from './suppression'

/** Pull the bare address out of `Name <a@b.c>` / `a@b.c`. Null if none. */
export function parseSenderAddress(from: string | null | undefined): string | null {
  if (!from) return null
  const angle = from.match(/<([^<>\s]+@[^<>\s]+)>/)
  const candidate = (angle ? angle[1] : from).trim().replace(/^mailto:/i, '')
  return /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(candidate) ? normalizeEmail(candidate) : null
}

// Subjects that mark automatic responses (EN plus the markets we sell into).
const AUTO_SUBJECT_PATTERNS: RegExp[] = [
  /^\s*(automatic|auto)[\s-]?reply\b/i,
  /^\s*autoreply\b/i,
  /^\s*auto:/i,
  /\bout of (the )?office\b/i,
  /^\s*ooo\b/i,
  /\baway from (the )?office\b/i,
  /\bon (annual )?leave\b/i,
  /^\s*(undeliverable|undelivered)\b/i,
  /\bdelivery status notification\b/i,
  /\b(mail delivery|delivery) (failed|failure|subsystem)\b/i,
  /^\s*returned mail\b/i,
  /^\s*réponse automatique\b/i, // FR
  /^\s*respuesta automática\b/i, // ES
  /^\s*abwesenheitsnotiz\b/i, // DE
  /^\s*risposta automatica\b/i, // IT
  /رد تلقائي|خارج المكتب/, // AR
]

const AUTO_SENDER_LOCALPARTS = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)([+.-]|$)/i

/** True for out-of-office notices, bounces and other machine-sent mail. */
export function isAutoReply(subject: string | null | undefined, senderAddress: string | null): boolean {
  if (senderAddress && AUTO_SENDER_LOCALPARTS.test(senderAddress.split('@')[0])) return true
  const s = subject || ''
  return AUTO_SUBJECT_PATTERNS.some((re) => re.test(s))
}

export type InboundReplyOutcome =
  | { result: 'handed_off'; prospectIds: string[] }
  | { result: 'no_match' } // unknown sender, or already replied/stopped
  | { result: 'auto_reply' }
  | { result: 'no_sender' }

export interface InboundEmail {
  from?: string | null
  subject?: string | null
}

/** Choose which of several matched prospects gets the lead. */
export function pickHandoffProspect(rows: ProspectRow[]): ProspectRow {
  return rows.reduce((a, b) =>
    b.current_touch > a.current_touch || (b.current_touch === a.current_touch && b.created_at > a.created_at) ? b : a
  )
}

/**
 * Handle one inbound email. Idempotent: webhook retries or a manual
 * "Replied" click find nothing left to change and hand off nothing.
 */
export async function handleInboundReply(email: InboundEmail): Promise<InboundReplyOutcome> {
  const sender = parseSenderAddress(email.from)
  if (!sender) return { result: 'no_sender' }
  if (isAutoReply(email.subject, sender)) return { result: 'auto_reply' }

  const changed = await markRepliedByEmail(sender)
  if (changed.length === 0) return { result: 'no_match' }

  // One lead per reply, even if the address was in several campaigns: hand off
  // the furthest-along sequence (newest prospect on a tie).
  const target = pickHandoffProspect(changed)
  if (!(await handoffToConcierge(target))) {
    // The sequence is already stopped, so a retry won't redo this — say so loudly.
    console.error(`[reply-detection] prospect ${target.id} replied but creating the lead failed; add it by hand in /admin`)
  }
  return { result: 'handed_off', prospectIds: changed.map((p) => p.id) }
}
