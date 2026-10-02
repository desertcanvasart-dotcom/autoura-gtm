// ============================================================================
// ESCALATION ALERTS — email a human when the concierge escalates a lead
// ============================================================================
// Sent once per lead, the first time it is escalated (by the agent's
// escalate_lead tool or the deterministic backstop). Goes to
// GTM_ESCALATION_EMAIL via Resend's REST API. Alerts are internal, so they are
// NOT gated by OUTBOUND_DRY_RUN. Never throws: a failed alert is logged and the
// chat turn carries on — the lead is still flagged in /admin.
// ============================================================================

import type { AdminLeadRow } from '@/lib/supabase/admin-queries'

export interface TranscriptLine {
  role: 'user' | 'assistant'
  content: string
}

export interface EscalationAlertInput {
  conversationId: string
  reason: string
  lead: Partial<AdminLeadRow> | null
  transcript: TranscriptLine[]
}

export interface EscalationEmail {
  subject: string
  text: string
  html: string
}

/** How many recent transcript lines to include in the alert. */
export const ALERT_TRANSCRIPT_LINES = 8

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function adminUrl(conversationId: string): string | null {
  const base = (process.env.GTM_PUBLIC_BASE_URL || process.env.OUTBOUND_PUBLIC_BASE_URL || '').replace(/\/$/, '')
  return base ? `${base}/admin/${conversationId}` : null
}

/** Build the alert email. Pure — all prospect-supplied text is escaped for HTML. */
export function buildEscalationEmail(input: EscalationAlertInput): EscalationEmail {
  const lead = input.lead ?? {}
  const who = oneLine(lead.company_name || lead.contact_name || lead.contact_email || 'Unknown prospect').slice(0, 80)
  const subject = `[Autoura] Escalated lead: ${who}`

  const fields: [string, string | number | null | undefined][] = [
    ['Reason', input.reason],
    ['Source', lead.source],
    ['Company', lead.company_name],
    ['Contact', lead.contact_name],
    ['Email', lead.contact_email],
    ['Role', lead.role_title],
    ['Destinations', lead.destinations],
    ['Business model', lead.business_model],
    ['Quotes / week', lead.quotes_per_week],
    ['Current system', lead.current_system],
    ['Top pain', lead.top_pain],
  ]
  const present = fields.filter(([, v]) => v !== null && v !== undefined && v !== '') as [string, string | number][]

  const lines = input.transcript.slice(-ALERT_TRANSCRIPT_LINES)
  const link = adminUrl(input.conversationId)

  const text = [
    'The concierge escalated a lead for a human to follow up personally.',
    '',
    ...present.map(([k, v]) => `${k}: ${v}`),
    '',
    lines.length ? 'Recent conversation:' : '',
    ...lines.map((l) => `${l.role === 'user' ? 'Prospect' : 'Concierge'}: ${l.content}`),
    '',
    link ? `Full transcript: ${link}` : `Conversation ID: ${input.conversationId}`,
  ].join('\n')

  const rows = present
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#888;vertical-align:top">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(String(v))}</td></tr>`
    )
    .join('')
  const convo = lines
    .map(
      (l) =>
        `<p style="margin:0 0 8px"><strong>${l.role === 'user' ? 'Prospect' : 'Concierge'}:</strong> ${escapeHtml(l.content).replace(/\n/g, '<br>')}</p>`
    )
    .join('')
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">
<p>The concierge escalated a lead for a human to follow up personally.</p>
<table style="border-collapse:collapse;margin:0 0 16px">${rows}</table>
${convo ? `<div style="border-left:3px solid #ddd;padding-left:12px;margin:0 0 16px">${convo}</div>` : ''}
<p>${link ? `<a href="${escapeHtml(link)}">Open the full transcript</a>` : `Conversation ID: ${escapeHtml(input.conversationId)}`}</p>
</div>`

  return { subject, text, html }
}

/** Send the alert. Returns whether it was sent; logs (never throws) on failure. */
export async function sendEscalationAlert(input: EscalationAlertInput): Promise<boolean> {
  const to = (process.env.GTM_ESCALATION_EMAIL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.GTM_ALERT_FROM_EMAIL || process.env.OUTBOUND_FROM_EMAIL
  if (to.length === 0 || !apiKey || !from) {
    console.warn(
      `[escalation-alert] not sent for ${input.conversationId}: set GTM_ESCALATION_EMAIL, RESEND_API_KEY and GTM_ALERT_FROM_EMAIL (or OUTBOUND_FROM_EMAIL)`
    )
    return false
  }

  try {
    const email = buildEscalationEmail(input)
    // Prospect-typed and unverified: only use it if it looks like one address,
    // otherwise Resend would reject the whole alert.
    const contact = (input.lead?.contact_email || '').trim()
    const replyTo = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(contact) ? contact : null
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        // Hitting reply goes straight to the prospect when we have their email.
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`[escalation-alert] Resend ${res.status} for ${input.conversationId}: ${detail.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[escalation-alert] failed for ${input.conversationId}`, err)
    return false
  }
}
