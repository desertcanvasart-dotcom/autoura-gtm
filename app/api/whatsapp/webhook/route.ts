// ============================================================================
// /api/whatsapp/webhook — inbound WhatsApp messages → concierge
// ============================================================================
// Public route (Meta/Twilio call it); authenticity comes from the provider
// signature, checked on the RAW body before anything else. We answer 200 at
// once and run the agent in after(), so slow turns never trigger provider
// retries (duplicates that do arrive are dropped by message id).
// GET is Meta's one-time verification handshake.
// ============================================================================

import { NextRequest, NextResponse, after } from 'next/server'
import {
  whatsAppProvider,
  verifyMetaSignature,
  metaVerificationChallenge,
  parseMetaWebhook,
  verifyTwilioSignature,
  parseTwilioWebhook,
  type InboundWhatsApp,
} from '@/lib/whatsapp/providers'
import { handleInboundWhatsApp } from '@/lib/whatsapp/inbound'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const verifyToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
  if (whatsAppProvider() !== 'meta' || !verifyToken) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  const challenge = metaVerificationChallenge(new URL(req.url).searchParams, verifyToken)
  return challenge === null
    ? NextResponse.json({ error: 'forbidden' }, { status: 403 })
    : new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

/** The exact public URL Twilio signed (Railway's proxy changes the internal one). */
function publicUrl(req: NextRequest): string {
  const base = (process.env.GTM_PUBLIC_BASE_URL || '').replace(/\/$/, '')
  if (!base) return req.url
  const u = new URL(req.url)
  return `${base}${u.pathname}${u.search}`
}

function processLater(messages: InboundWhatsApp[]) {
  if (messages.length === 0) return
  after(async () => {
    for (const m of messages) await handleInboundWhatsApp(m)
  })
}

export async function POST(req: NextRequest) {
  const provider = whatsAppProvider()
  if (!provider) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const rawBody = await req.text()

  if (provider === 'meta') {
    const appSecret = process.env.META_WHATSAPP_APP_SECRET
    if (!appSecret) return NextResponse.json({ error: 'not configured' }, { status: 503 })
    if (!verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'), appSecret)) {
      return NextResponse.json({ error: 'bad signature' }, { status: 401 })
    }
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'bad payload' }, { status: 400 })
    }
    processLater(parseMetaWebhook(payload, process.env.META_WHATSAPP_PHONE_NUMBER_ID))
    return NextResponse.json({ ok: true })
  }

  // Twilio
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const params = Object.fromEntries(new URLSearchParams(rawBody))
  if (!verifyTwilioSignature(authToken, req.headers.get('x-twilio-signature'), publicUrl(req), params)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }
  const msg = parseTwilioWebhook(params)
  processLater(msg ? [msg] : [])
  // Empty TwiML: we reply via the REST API once the agent has answered.
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
