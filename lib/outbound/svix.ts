// ============================================================================
// SVIX WEBHOOK VERIFICATION (the scheme Resend uses)
// ============================================================================
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Svix's default tolerance: events older/newer than 5 minutes are rejected. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60

/** True if the svix-timestamp header (unix seconds) is within the tolerance window. */
export function isFreshSvixTimestamp(timestamp: string, nowMs = Date.now()): boolean {
  if (!/^\d+$/.test(timestamp)) return false
  const ageSeconds = Math.abs(nowMs / 1000 - Number(timestamp))
  return ageSeconds <= SVIX_TOLERANCE_SECONDS
}

/** Verify a Svix signature header (space-separated "v1,<sig>" entries). */
export function verifySvix(secret: string, id: string, timestamp: string, body: string, sigHeader: string): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
    const expBuf = Buffer.from(expected)
    return sigHeader.split(' ').some((part) => {
      const sig = part.includes(',') ? part.split(',')[1] : part
      const sigBuf = Buffer.from(sig)
      return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)
    })
  } catch {
    return false
  }
}
