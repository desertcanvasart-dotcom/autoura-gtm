// ============================================================================
// LINKEDIN (ASSISTED) — URL handling, note validation, drafting with retry
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/ai/anthropic-client', () => ({ AGENT_MODEL: 'test-model', createMessageWithRetry: vi.fn() }))

import { createMessageWithRetry } from '@/lib/ai/anthropic-client'
import {
  normalizeLinkedInUrl,
  linkedInNoteProblem,
  linkedInNoteMaxChars,
  draftLinkedInNote,
} from '@/lib/outbound/linkedin'
import { buildLinkedInSystemPrompt } from '@/lib/ai/outbound-prompt'
import { parseProspectsCsv } from '@/lib/outbound/csv'
import type { ProspectRow } from '@/lib/outbound/db'

const prospect = {
  id: 'p1', campaign_id: 'c1', company_name: 'Nile Star Tours', contact_name: 'Mona',
  contact_email: 'mona@nilestar.example', role_title: 'Reservations Manager', destination: 'Egypt',
  signal: 'Quotes by WhatsApp from their booking page.',
} as ProspectRow

function reply(text: string) {
  return { content: [{ type: 'text', text }] } as unknown as Awaited<ReturnType<typeof createMessageWithRetry>>
}

describe('normalizeLinkedInUrl', () => {
  it('accepts profile and company URLs in common forms', () => {
    expect(normalizeLinkedInUrl('linkedin.com/in/mona-fahmy/')).toBe('https://www.linkedin.com/in/mona-fahmy')
    expect(normalizeLinkedInUrl('https://eg.linkedin.com/in/mona-fahmy?trk=x')).toBe('https://www.linkedin.com/in/mona-fahmy')
    expect(normalizeLinkedInUrl('http://www.linkedin.com/company/nile-star')).toBe('https://www.linkedin.com/company/nile-star')
  })

  it('rejects anything that is not a LinkedIn profile/company page', () => {
    expect(normalizeLinkedInUrl('https://evil.example/in/mona')).toBeNull()
    expect(normalizeLinkedInUrl('https://linkedin.com.evil.example/in/mona')).toBeNull()
    expect(normalizeLinkedInUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkedInUrl('https://www.linkedin.com/feed/')).toBeNull()
    expect(normalizeLinkedInUrl('')).toBeNull()
  })
})

describe('linkedInNoteProblem', () => {
  it('accepts a short, plain note', () => {
    expect(linkedInNoteProblem('Hi Mona, saw Nile Star quotes by WhatsApp. Fellow Egypt operator here, would be glad to connect.', 200)).toBeNull()
  })

  it('allows naming a site without linking it', () => {
    expect(linkedInNoteProblem('Hi Mona, noticed your Booking.com reviews mention fast replies.', 200)).toBeNull()
  })

  it.each([
    ['x'.repeat(201), 'too long'],
    ['Book a call: https://calendly.com/autoura', 'link'],
    ['See www.getautoura.net', 'link'],
    ['Hi [Name], let us connect', 'placeholder'],
    ['Plans start at $69/month', 'price'],
    ['   ', 'empty'],
  ])('rejects %j (%s)', (note, why) => {
    expect(linkedInNoteProblem(note, 200)).toContain(why)
  })
})

describe('linkedInNoteMaxChars', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to 200 (fits every account type)', () => {
    vi.stubEnv('LINKEDIN_NOTE_MAX_CHARS', '')
    expect(linkedInNoteMaxChars()).toBe(200)
  })

  it('honors a valid override and ignores nonsense', () => {
    vi.stubEnv('LINKEDIN_NOTE_MAX_CHARS', '300')
    expect(linkedInNoteMaxChars()).toBe(300)
    vi.stubEnv('LINKEDIN_NOTE_MAX_CHARS', 'abc')
    expect(linkedInNoteMaxChars()).toBe(200)
  })
})

describe('LinkedIn prompt guardrails', () => {
  const prompt = buildLinkedInSystemPrompt(200)
  it('states the hard character limit and forbids links and prices', () => {
    expect(prompt).toContain('at most 200 characters')
    expect(prompt).toMatch(/No links of any kind, no Calendly, no prices/)
  })
  it('contains no dollar amounts at all', () => {
    expect(prompt).not.toMatch(/\$\s?\d/)
  })
})

describe('draftLinkedInNote', () => {
  beforeEach(() => {
    vi.mocked(createMessageWithRetry).mockReset()
    vi.stubEnv('LINKEDIN_NOTE_MAX_CHARS', '200')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('returns a valid note, flattening line breaks', async () => {
    vi.mocked(createMessageWithRetry).mockResolvedValueOnce(reply('{"note": "Hi Mona,\\nfellow Egypt operator here. Glad to connect."}'))
    expect(await draftLinkedInNote(prospect)).toBe('Hi Mona, fellow Egypt operator here. Glad to connect.')
  })

  it('retries once with feedback when the first note is too long', async () => {
    vi.mocked(createMessageWithRetry)
      .mockResolvedValueOnce(reply(JSON.stringify({ note: 'x'.repeat(250) })))
      .mockResolvedValueOnce(reply('{"note": "Hi Mona, glad to connect."}'))
    expect(await draftLinkedInNote(prospect)).toBe('Hi Mona, glad to connect.')
    const second = vi.mocked(createMessageWithRetry).mock.calls[1][0]
    const lastMsg = second.messages[second.messages.length - 1]
    expect(String(lastMsg.content)).toContain('too long (250/200 characters)')
  })

  it('gives up after the retry instead of saving a bad note', async () => {
    vi.mocked(createMessageWithRetry).mockResolvedValue(reply('{"note": "Book here: https://calendly.com/autoura"}'))
    await expect(draftLinkedInNote(prospect)).rejects.toThrow(/contains a link/)
    expect(createMessageWithRetry).toHaveBeenCalledTimes(2)
  })
})

describe('CSV linkedin column', () => {
  it('maps linkedin aliases', () => {
    const { rows } = parseProspectsCsv('email,linkedin\na@b.example,linkedin.com/in/mona')
    expect(rows[0].linkedin_url).toBe('linkedin.com/in/mona')
  })
})
