// ============================================================================
// WHATSAPP PROVIDERS — Meta Cloud API or Twilio, same env names as autoura-saas
// ============================================================================
// WHATSAPP_PROVIDER=meta | twilio selects one; unset = WhatsApp is off.
//
// Meta:   META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID,
//         META_WHATSAPP_APP_SECRET (X-Hub-Signature-256),
//         META_WHATSAPP_WEBHOOK_VERIFY_TOKEN (GET handshake),
//         META_GRAPH_API_VERSION (default v21.0)
// Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (X-Twilio-Signature),
//         TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886),
//         optional TWILIO_API_KEY + TWILIO_API_SECRET for sending
//
// Replies only ever go to someone who just messaged us (inside WhatsApp's
// 24-hour customer-service window). Nothing here starts a conversation.
// ============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'

export type WhatsAppProvider = 'meta' | 'twilio'

export function whatsAppProvider(): WhatsAppProvider | null {
  const p = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase()
  return p === 'meta' || p === 'twilio' ? p : null
}

/** One inbound message, provider-neutral. */
export interface InboundWhatsApp {
  /** Provider message id (Meta wamid / Twilio MessageSid); stable across webhook retries. */
  messageId: string
  /** Sender's number, digits only (no '+', no 'whatsapp:'). */
  from: string
  /** Text we can answer ('' for media/location/etc.). */
  text: string
  /** False for media, location, contacts, stickers... — things the agent can't read. */
  isText: boolean
  profileName: string | null
}

function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// ---------------------------------------------------------------------------
// Meta Cloud API
// ---------------------------------------------------------------------------

/** HMAC-SHA256 of the RAW body with the app secret, as `sha256=<hex>`. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  return safeEqualStrings(expected, header.slice('sha256='.length))
}

/** GET handshake: echo hub.challenge only when the verify token matches. */
export function metaVerificationChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const token = params.get('hub.verify_token') || ''
  if (params.get('hub.mode') !== 'subscribe' || !safeEqualStrings(token, verifyToken)) return null
  return params.get('hub.challenge')
}

// Loosely typed: Meta's payload is large and versioned; we read a few fields.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Inbound messages from a Meta webhook. With `phoneNumberId`, only messages
 * sent TO that number are returned (one Meta app can carry several numbers).
 */
export function parseMetaWebhook(payload: any, phoneNumberId?: string): InboundWhatsApp[] {
  const out: InboundWhatsApp[] = []
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'messages') continue
      const value = change?.value
      if (phoneNumberId && String(value?.metadata?.phone_number_id ?? '') !== phoneNumberId) continue
      const profileName: string | null = value?.contacts?.[0]?.profile?.name ?? null
      for (const msg of value?.messages ?? []) {
        if (!msg?.id || !msg?.from) continue
        let text = ''
        if (msg.type === 'text') text = msg.text?.body ?? ''
        else if (msg.type === 'button') text = msg.button?.text ?? ''
        else if (msg.type === 'interactive')
          text = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? ''
        out.push({
          messageId: String(msg.id),
          from: String(msg.from).replace(/\D/g, ''),
          text: text.trim(),
          isText: text.trim().length > 0,
          profileName,
        })
      }
      // value.statuses (delivery receipts) arrive here too; we don't need them.
    }
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function sendViaMeta(to: string, body: string): Promise<string> {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN
  const numberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
  if (!token || !numberId) throw new Error('Set META_WHATSAPP_ACCESS_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID')
  const version = process.env.META_GRAPH_API_VERSION || 'v21.0'
  const res = await fetch(`https://graph.facebook.com/${version}/${numberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      type: 'text',
      text: { body, preview_url: true },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } } | null
  if (!res.ok) throw new Error(`Meta ${res.status}${json?.error?.code ? ` (${json.error.code})` : ''}: ${json?.error?.message || res.statusText}`)
  const id = json?.messages?.[0]?.id
  if (!id) throw new Error('Meta returned no message id')
  return id
}

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

/**
 * Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + each POST
 * param name+value, params sorted by name)). `url` is the exact public URL
 * Twilio called, including any query string.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

export function verifyTwilioSignature(
  authToken: string,
  header: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  if (!header) return false
  return safeEqualStrings(twilioSignature(authToken, url, params), header)
}

export function parseTwilioWebhook(params: Record<string, string>): InboundWhatsApp | null {
  const id = params.MessageSid || params.SmsMessageSid
  const from = (params.From || '').replace(/^whatsapp:/i, '').replace(/\D/g, '')
  if (!id || !from) return null
  const text = (params.Body || '').trim()
  return { messageId: id, from, text, isText: text.length > 0, profileName: params.ProfileName || null }
}

async function sendViaTwilio(to: string, body: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM
  const user = process.env.TWILIO_API_KEY || sid
  const pass = process.env.TWILIO_API_KEY ? process.env.TWILIO_API_SECRET : process.env.TWILIO_AUTH_TOKEN
  if (!sid || !fromNumber || !user || !pass) {
    throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_WHATSAPP_FROM and TWILIO_AUTH_TOKEN (or TWILIO_API_KEY + TWILIO_API_SECRET)')
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`,
      To: `whatsapp:+${to.replace(/\D/g, '')}`,
      Body: body,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => null)) as { sid?: string; message?: string; code?: number } | null
  if (!res.ok) throw new Error(`Twilio ${res.status}${json?.code ? ` (${json.code})` : ''}: ${json?.message || res.statusText}`)
  if (!json?.sid) throw new Error('Twilio returned no message sid')
  return json.sid
}

/** Send one text message with the configured provider. Returns the provider message id. */
export async function sendWhatsAppText(to: string, body: string): Promise<string> {
  const provider = whatsAppProvider()
  if (provider === 'meta') return sendViaMeta(to, body)
  if (provider === 'twilio') return sendViaTwilio(to, body)
  throw new Error('WhatsApp is not configured (set WHATSAPP_PROVIDER to meta or twilio)')
}
