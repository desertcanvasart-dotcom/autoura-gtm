// ============================================================================
// UNSUBSCRIBE TOKENS (HMAC-signed)
// ============================================================================
// A recipient's unsubscribe link carries their email + an HMAC so the endpoint
// can trust it without a lookup and nobody can suppress arbitrary addresses.
// ============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeEmail } from './suppression'

function secret(): string {
  const s = process.env.OUTBOUND_UNSUB_SECRET
  if (!s) throw new Error('OUTBOUND_UNSUB_SECRET is not configured')
  return s
}

function sign(email: string): string {
  return createHmac('sha256', secret()).update(normalizeEmail(email)).digest('base64url')
}

export function makeUnsubToken(email: string): string {
  return sign(email)
}

export function verifyUnsubToken(email: string, token: string): boolean {
  try {
    const expected = sign(email)
    const a = Buffer.from(expected)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function buildUnsubscribeUrl(email: string): string {
  const base = (process.env.OUTBOUND_PUBLIC_BASE_URL || '').replace(/\/$/, '')
  const q = new URLSearchParams({ e: normalizeEmail(email), t: makeUnsubToken(email) })
  return `${base}/api/unsubscribe?${q.toString()}`
}
