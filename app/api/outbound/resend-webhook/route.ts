// ============================================================================
// /api/outbound/resend-webhook  — bounces, complaints & reply detection
// ============================================================================
// Resend signs webhooks with Svix. Configure this URL in the Resend dashboard
// (events: email.bounced, email.complained, email.received) and put the signing
// secret in RESEND_WEBHOOK_SECRET. Bounces/complaints are added to the
// suppression list and stop any active sequence. email.received is a prospect's
// reply (forwarded from the reply inbox) and hands them to the concierge.
// Public route (Resend calls it); authenticity comes from the signature.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifySvix, isFreshSvixTimestamp } from '@/lib/outbound/svix'
import { addSuppression } from '@/lib/outbound/suppression'
import { stopSequencesByEmail } from '@/lib/outbound/db'
import { handleInboundReply } from '@/lib/outbound/replies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 })

  const body = await req.text()
  const id = req.headers.get('svix-id') || ''
  const ts = req.headers.get('svix-timestamp') || ''
  const sig = req.headers.get('svix-signature') || ''
  // Reject stale/future timestamps so a captured signed event can't be replayed.
  if (!isFreshSvixTimestamp(ts) || !verifySvix(secret, id, ts, body, sig)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let event: { type?: string; data?: { to?: string[] | string; from?: string; subject?: string } }
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 })
  }

  if (event.type === 'email.received') {
    const outcome = await handleInboundReply({ from: event.data?.from, subject: event.data?.subject })
    console.log(`[reply-detection] ${outcome.result}${'prospectIds' in outcome ? ` ${outcome.prospectIds.join(',')}` : ''}`)
    return NextResponse.json({ ok: true, ...outcome })
  }

  const to = Array.isArray(event.data?.to) ? event.data?.to[0] : event.data?.to
  if (to) {
    if (event.type === 'email.bounced') {
      await addSuppression(to, 'bounce', 'Resend hard bounce')
      await stopSequencesByEmail(to, 'bounced')
    } else if (event.type === 'email.complained') {
      await addSuppression(to, 'complaint', 'Resend spam complaint')
      await stopSequencesByEmail(to, 'opted_out')
    }
  }

  return NextResponse.json({ ok: true })
}
