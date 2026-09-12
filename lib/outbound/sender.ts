// ============================================================================
// OUTBOUND SENDER — safe send via Resend
// ============================================================================
// Enforces the suppression gate, appends unsubscribe + postal identity, and
// sends through Resend's REST API (no SDK dependency). Set OUTBOUND_DRY_RUN=true
// to exercise the whole pipeline without actually sending.
// ============================================================================

import { isSuppressed, addSuppression } from './suppression'
import { buildUnsubscribeUrl } from './unsubscribe-token'
import type { MessageRow, ProspectRow, CampaignRow } from './db'

export interface SendOutcome {
  status: 'sent' | 'dry_run' | 'failed' | 'suppressed'
  resendId?: string | null
  error?: string | null
}

const DRY_RUN = process.env.OUTBOUND_DRY_RUN === 'true'

function fromAddress(campaign: CampaignRow): string {
  return (
    campaign.from_email ||
    process.env.OUTBOUND_FROM_EMAIL ||
    'Autoura <outreach@outreach.getautoura.net>'
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderHtml(bodyText: string, unsubUrl: string): string {
  const paragraphs = escapeHtml(bodyText)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
  const postal = process.env.OUTBOUND_POSTAL_ADDRESS || ''
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">
${paragraphs}
<hr style="border:none;border-top:1px solid #eee;margin:20px 0 10px">
<div style="font-size:12px;color:#888">
${postal ? escapeHtml(postal) + '<br>' : ''}
Don't want to hear from us? <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>.
</div>
</div>`
}

/**
 * Send one message to one prospect. Suppression is checked here — this is the
 * gate no send bypasses. Marks the prospect suppressed if it turns out they are.
 */
export async function sendOutbound(
  message: MessageRow,
  prospect: ProspectRow,
  campaign: CampaignRow
): Promise<SendOutcome> {
  // HARD GATE.
  if (await isSuppressed(prospect.contact_email)) {
    return { status: 'suppressed' }
  }

  const unsubUrl = buildUnsubscribeUrl(prospect.contact_email)
  const html = renderHtml(message.body || '', unsubUrl)
  const text = `${message.body || ''}\n\n---\n${process.env.OUTBOUND_POSTAL_ADDRESS || ''}\nUnsubscribe: ${unsubUrl}`

  if (DRY_RUN) {
    return { status: 'dry_run', resendId: null }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { status: 'failed', error: 'RESEND_API_KEY not configured (set it, or use OUTBOUND_DRY_RUN=true)' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress(campaign),
        to: [prospect.contact_email],
        // Send from the (isolated) sending domain, but route replies to a real
        // monitored inbox — a sending subdomain doesn't receive mail.
        ...(process.env.OUTBOUND_REPLY_TO ? { reply_to: process.env.OUTBOUND_REPLY_TO } : {}),
        subject: message.subject || '(no subject)',
        html,
        text,
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { status: 'failed', error: `Resend ${res.status}: ${detail.slice(0, 300)}` }
    }
    const data = (await res.json()) as { id?: string }
    return { status: 'sent', resendId: data.id ?? null }
  } catch (err) {
    return { status: 'failed', error: (err as Error).message }
  }
}

export { addSuppression }
