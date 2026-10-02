// ============================================================================
// ESCALATION ALERT EMAIL — content, escaping, and send gating
// ============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildEscalationEmail,
  sendEscalationAlert,
  ALERT_TRANSCRIPT_LINES,
  type EscalationAlertInput,
} from '@/lib/notifications/escalation-alert'

const base: EscalationAlertInput = {
  conversationId: '11111111-2222-3333-4444-555555555555',
  reason: 'Enterprise-tier / custom-terms interest',
  lead: {
    source: 'gtm-inbound',
    company_name: 'Nile Star Tours',
    contact_name: 'Mona',
    contact_email: 'mona@nilestar.example',
    quotes_per_week: 80,
    destinations: null,
  },
  transcript: [
    { role: 'assistant', content: 'Hi! What do you use for quoting today?' },
    { role: 'user', content: 'We need an SLA and custom pricing for 6 countries.' },
  ],
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('buildEscalationEmail', () => {
  it('names the company in the subject and includes reason, fields and transcript', () => {
    const e = buildEscalationEmail(base)
    expect(e.subject).toBe('[Autoura] Escalated lead: Nile Star Tours')
    expect(e.text).toContain('Reason: Enterprise-tier / custom-terms interest')
    expect(e.text).toContain('Quotes / week: 80')
    expect(e.text).toContain('Prospect: We need an SLA')
    expect(e.text).not.toContain('Destinations:') // empty fields are omitted
  })

  it('falls back to contact, then a placeholder, for the subject', () => {
    expect(buildEscalationEmail({ ...base, lead: { contact_name: 'Karim' } }).subject).toContain('Karim')
    expect(buildEscalationEmail({ ...base, lead: null }).subject).toContain('Unknown prospect')
  })

  it('keeps the subject on one line (no header injection from prospect text)', () => {
    const e = buildEscalationEmail({ ...base, lead: { company_name: 'Evil\r\nBcc: x@y.example' } })
    expect(e.subject).not.toMatch(/[\r\n]/)
  })

  it('escapes prospect-supplied text in the HTML', () => {
    const e = buildEscalationEmail({
      ...base,
      lead: { company_name: '<script>alert(1)</script>' },
      transcript: [{ role: 'user', content: '<img src=x onerror=alert(1)>' }],
    })
    expect(e.html).not.toContain('<script>')
    expect(e.html).not.toContain('<img')
    expect(e.html).toContain('&lt;script&gt;')
  })

  it('includes only the most recent transcript lines', () => {
    const transcript = Array.from({ length: ALERT_TRANSCRIPT_LINES + 5 }, (_, i) => ({
      role: 'user' as const,
      content: `line-${i}`,
    }))
    const e = buildEscalationEmail({ ...base, transcript })
    expect(e.text).not.toContain('line-0\n')
    expect(e.text).toContain(`line-${ALERT_TRANSCRIPT_LINES + 4}`)
  })

  it('links to the admin transcript when a public base URL is set', () => {
    vi.stubEnv('GTM_PUBLIC_BASE_URL', 'https://growth.example/')
    const e = buildEscalationEmail(base)
    expect(e.text).toContain(`https://growth.example/admin/${base.conversationId}`)
  })
})

describe('sendEscalationAlert', () => {
  function stubConfigured() {
    vi.stubEnv('GTM_ESCALATION_EMAIL', 'faris@example.com, ops@example.com')
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('GTM_ALERT_FROM_EMAIL', 'Autoura Alerts <alerts@example.com>')
  }

  it('skips (without calling Resend) when not configured', async () => {
    vi.stubEnv('GTM_ESCALATION_EMAIL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await sendEscalationAlert(base)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends to every recipient with reply_to set to the prospect', async () => {
    stubConfigured()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendEscalationAlert(base)).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.to).toEqual(['faris@example.com', 'ops@example.com'])
    expect(body.from).toBe('Autoura Alerts <alerts@example.com>')
    expect(body.reply_to).toBe('mona@nilestar.example')
  })

  it('omits reply_to when the prospect-typed email is malformed', async () => {
    stubConfigured()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendEscalationAlert({ ...base, lead: { contact_email: 'mona at nilestar' } })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reply_to).toBeUndefined()
  })

  it('returns false and does not throw when Resend errors', async () => {
    stubConfigured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await sendEscalationAlert(base)).toBe(false)
  })

  it('returns false and does not throw on a network error', async () => {
    stubConfigured()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await sendEscalationAlert(base)).toBe(false)
  })
})
