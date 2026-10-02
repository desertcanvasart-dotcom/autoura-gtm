// ============================================================================
// AUTOMATIC REPLY DETECTION — sender parsing, auto-reply filter, handoff
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/outbound/db', () => ({ markRepliedByEmail: vi.fn() }))
vi.mock('@/lib/outbound/handoff', () => ({ handoffToConcierge: vi.fn() }))

import { markRepliedByEmail, type ProspectRow } from '@/lib/outbound/db'
import { handoffToConcierge } from '@/lib/outbound/handoff'
import { parseSenderAddress, isAutoReply, pickHandoffProspect, handleInboundReply } from '@/lib/outbound/replies'

function prospect(over: Partial<ProspectRow>): ProspectRow {
  return {
    id: 'p1', campaign_id: 'c1', company_name: 'Nile Star', contact_name: 'Mona',
    contact_email: 'mona@nilestar.example', role_title: null, destination: null, signal: null,
    status: 'replied', sequence_status: 'replied', current_touch: 1, next_touch_due_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', ...over,
  }
}

describe('parseSenderAddress', () => {
  it('handles bare and display-name forms, normalizing case', () => {
    expect(parseSenderAddress('Mona@NileStar.example')).toBe('mona@nilestar.example')
    expect(parseSenderAddress('Mona Fahmy <Mona@NileStar.example>')).toBe('mona@nilestar.example')
    expect(parseSenderAddress('"Fahmy, Mona" <mona@nilestar.example>')).toBe('mona@nilestar.example')
  })

  it('returns null for missing or malformed senders', () => {
    expect(parseSenderAddress(undefined)).toBeNull()
    expect(parseSenderAddress('')).toBeNull()
    expect(parseSenderAddress('Mona Fahmy')).toBeNull()
    expect(parseSenderAddress('a@b.example, c@d.example')).toBeNull()
  })
})

describe('isAutoReply', () => {
  const human = 'mona@nilestar.example'

  it.each([
    'Automatic reply: Re: quick question',
    'Auto-Reply: Re: quick question',
    'AutoReply: away',
    'Out of Office: Re: quick question',
    'OOO until Monday',
    'Undeliverable: Re: quick question',
    'Delivery Status Notification (Failure)',
    'Mail delivery failed: returning message to sender',
    'Réponse automatique : Re: quick question',
    'Respuesta automática: Re: quick question',
    'Abwesenheitsnotiz: Re: quick question',
    'رد تلقائي: Re: quick question',
  ])('flags "%s"', (subject) => {
    expect(isAutoReply(subject, human)).toBe(true)
  })

  it('flags machine senders', () => {
    expect(isAutoReply('Re: quick question', 'mailer-daemon@mail.example')).toBe(true)
    expect(isAutoReply('Re: quick question', 'noreply@nilestar.example')).toBe(true)
    expect(isAutoReply('Re: quick question', 'postmaster@nilestar.example')).toBe(true)
  })

  it.each([
    'Re: quick question',
    'RE: quick question',
    'Re: quick question — yes, interested',
    'Re: Re: quick question',
  ])('treats "%s" from a person as a real reply', (subject) => {
    expect(isAutoReply(subject, human)).toBe(false)
  })

  it('does not flag senders that merely contain a machine word', () => {
    expect(isAutoReply('Re: quick question', 'bouncer.mona@nilestar.example')).toBe(false)
  })
})

describe('pickHandoffProspect', () => {
  it('picks the furthest-along sequence, then the newest prospect', () => {
    const a = prospect({ id: 'a', current_touch: 1, created_at: '2026-09-10T00:00:00Z' })
    const b = prospect({ id: 'b', current_touch: 3, created_at: '2026-08-01T00:00:00Z' })
    const c = prospect({ id: 'c', current_touch: 3, created_at: '2026-09-01T00:00:00Z' })
    expect(pickHandoffProspect([a, b, c]).id).toBe('c')
  })
})

describe('handleInboundReply', () => {
  beforeEach(() => {
    vi.mocked(markRepliedByEmail).mockReset()
    vi.mocked(handoffToConcierge).mockReset().mockResolvedValue('conv-1')
  })

  it('marks the sender replied and hands off exactly one lead', async () => {
    const rows = [prospect({ id: 'a', current_touch: 1 }), prospect({ id: 'b', current_touch: 2 })]
    vi.mocked(markRepliedByEmail).mockResolvedValue(rows)
    const out = await handleInboundReply({ from: 'Mona <MONA@nilestar.example>', subject: 'Re: quick question' })
    expect(markRepliedByEmail).toHaveBeenCalledWith('mona@nilestar.example')
    expect(handoffToConcierge).toHaveBeenCalledTimes(1)
    expect(vi.mocked(handoffToConcierge).mock.calls[0][0].id).toBe('b')
    expect(out).toEqual({ result: 'handed_off', prospectIds: ['a', 'b'] })
  })

  it('logs loudly if the lead cannot be created after marking replied', async () => {
    vi.mocked(markRepliedByEmail).mockResolvedValue([prospect({ id: 'a' })])
    vi.mocked(handoffToConcierge).mockResolvedValue(null)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await handleInboundReply({ from: 'mona@nilestar.example', subject: 'Re: quick question' })
    expect(out.result).toBe('handed_off')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('creating the lead failed'))
    err.mockRestore()
  })

  it('does nothing for an auto-reply (sequence keeps going)', async () => {
    const out = await handleInboundReply({ from: 'mona@nilestar.example', subject: 'Out of office' })
    expect(out.result).toBe('auto_reply')
    expect(markRepliedByEmail).not.toHaveBeenCalled()
  })

  it('hands off nothing when no open sequence matches (unknown sender or webhook retry)', async () => {
    vi.mocked(markRepliedByEmail).mockResolvedValue([])
    const out = await handleInboundReply({ from: 'stranger@else.example', subject: 'Hello' })
    expect(out.result).toBe('no_match')
    expect(handoffToConcierge).not.toHaveBeenCalled()
  })

  it('ignores mail without a usable sender', async () => {
    expect((await handleInboundReply({ from: null, subject: 'Re: x' })).result).toBe('no_sender')
    expect(markRepliedByEmail).not.toHaveBeenCalled()
  })
})
