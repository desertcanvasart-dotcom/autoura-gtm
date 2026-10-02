// ============================================================================
// RESEND WEBHOOK — Svix signature + replay-window checks
// ============================================================================
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifySvix, isFreshSvixTimestamp, SVIX_TOLERANCE_SECONDS } from '@/lib/outbound/svix'

const KEY = Buffer.from('test-signing-key-material')
const SECRET = `whsec_${KEY.toString('base64')}`

function sign(id: string, ts: string, body: string): string {
  return `v1,${createHmac('sha256', KEY).update(`${id}.${ts}.${body}`).digest('base64')}`
}

describe('verifySvix', () => {
  const body = '{"type":"email.bounced","data":{"to":["a@b.example"]}}'

  it('accepts a correctly signed payload', () => {
    expect(verifySvix(SECRET, 'msg_1', '1700000000', body, sign('msg_1', '1700000000', body))).toBe(true)
  })

  it('accepts when any of several space-separated signatures matches', () => {
    const header = `v1,bm90LXJpZ2h0 ${sign('msg_1', '1700000000', body)}`
    expect(verifySvix(SECRET, 'msg_1', '1700000000', body, header)).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verifySvix(SECRET, 'msg_1', '1700000000', body + ' ', sign('msg_1', '1700000000', body))).toBe(false)
  })

  it('rejects a signature made for a different timestamp', () => {
    expect(verifySvix(SECRET, 'msg_1', '1700000001', body, sign('msg_1', '1700000000', body))).toBe(false)
  })
})

describe('isFreshSvixTimestamp — replay window', () => {
  const now = 1_700_000_000_000 // ms
  const nowSec = now / 1000

  it('accepts a current timestamp', () => {
    expect(isFreshSvixTimestamp(String(nowSec), now)).toBe(true)
  })

  it('accepts the edge of the tolerance window', () => {
    expect(isFreshSvixTimestamp(String(nowSec - SVIX_TOLERANCE_SECONDS), now)).toBe(true)
  })

  it('rejects a stale (replayed) timestamp', () => {
    expect(isFreshSvixTimestamp(String(nowSec - SVIX_TOLERANCE_SECONDS - 1), now)).toBe(false)
  })

  it('rejects a timestamp too far in the future', () => {
    expect(isFreshSvixTimestamp(String(nowSec + SVIX_TOLERANCE_SECONDS + 1), now)).toBe(false)
  })

  it('rejects missing or non-numeric timestamps', () => {
    expect(isFreshSvixTimestamp('', now)).toBe(false)
    expect(isFreshSvixTimestamp('abc', now)).toBe(false)
  })
})
