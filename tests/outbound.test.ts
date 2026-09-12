// ============================================================================
// OUTBOUND GUARDS — copywriter prompt claims-drift + CSV parsing
// ============================================================================
import { describe, it, expect } from 'vitest'
import { buildOutboundSystemPrompt, buildFollowupSystemPrompt } from '@/lib/ai/outbound-prompt'
import { parseProspectsCsv } from '@/lib/outbound/csv'

const ALLOWED_DOLLARS = new Set([69, 189, 449, 1200])
function extractDollars(text: string): number[] {
  return (text.match(/\$\s?\d[\d,]*/g) || []).map((m) => parseInt(m.replace(/[^0-9]/g, ''), 10))
}

describe('outbound copywriter prompt — claims guardrails', () => {
  const prompt = buildOutboundSystemPrompt()

  it('carries the QuickBooks/Xero beta caveat', () => {
    expect(prompt).toContain('in beta, push-only')
  })

  it('references no price outside the four published tiers', () => {
    const stray = extractDollars(prompt).filter((d) => !ALLOWED_DOLLARS.has(d))
    expect(stray, `unpublished price(s): ${stray.join(', ')}`).toEqual([])
  })

  it('forbids a hard Calendly link on the first touch', () => {
    expect(prompt.toLowerCase()).toContain('calendly')
    expect(prompt).toMatch(/never|not|do NOT|Do NOT|don't/i)
  })

  it('demands strict JSON output with subject + body', () => {
    expect(prompt).toMatch(/"subject"/)
    expect(prompt).toMatch(/"body"/)
  })

  it('instructs to ground claims in the truth file only', () => {
    expect(prompt.toLowerCase()).toMatch(/only make claims|claims from|grounded/)
  })
})

describe('follow-up prompts (Slice B) — claims guardrails + Calendly gating', () => {
  const t2 = buildFollowupSystemPrompt(2)
  const t3 = buildFollowupSystemPrompt(3)

  it('both carry the beta caveat and no unpublished prices', () => {
    for (const p of [t2, t3]) {
      expect(p).toContain('in beta, push-only')
      expect(extractDollars(p).filter((d) => !ALLOWED_DOLLARS.has(d))).toEqual([])
    }
  })

  it('touch 2 must NOT include the Calendly link; touch 3 must', () => {
    expect(t2).toMatch(/do NOT include a Calendly/i)
    expect(t2).not.toContain('https://calendly.com/autoura')
    expect(t3).toContain('https://calendly.com/autoura')
  })

  it('both demand strict JSON output', () => {
    for (const p of [t2, t3]) {
      expect(p).toMatch(/"subject"/)
      expect(p).toMatch(/"body"/)
    }
  })
})

describe('CSV parsing', () => {
  it('maps aliased headers and required email column', () => {
    const csv = [
      'Company,Contact,Email,Destination,Signal',
      'Nile Star,Mona,mona@nilestar.example,Egypt,Public WhatsApp number',
    ].join('\n')
    const { rows, emailColumnFound } = parseProspectsCsv(csv)
    expect(emailColumnFound).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      company_name: 'Nile Star',
      contact_name: 'Mona',
      contact_email: 'mona@nilestar.example',
      destination: 'Egypt',
      signal: 'Public WhatsApp number',
    })
  })

  it('handles quoted fields with embedded commas', () => {
    const csv = 'email,signal\njo@op.example,"Slow quotes, price changed after booking"'
    const { rows } = parseProspectsCsv(csv)
    expect(rows[0].signal).toBe('Slow quotes, price changed after booking')
  })

  it('reports when no email column is present', () => {
    const { emailColumnFound, rows } = parseProspectsCsv('company,note\nFoo,bar')
    expect(emailColumnFound).toBe(false)
    expect(rows).toHaveLength(0)
  })

  it('skips rows without an email', () => {
    const csv = 'company,email\nHasEmail,a@b.example\nNoEmail,'
    const { rows } = parseProspectsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].contact_email).toBe('a@b.example')
  })
})
