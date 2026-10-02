// ============================================================================
// WHATSAPP INBOUND — signatures, parsing, sending, formatting, handler flow
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/lib/supabase/leads', () => ({
  appendMessage: vi.fn(),
  countUserMessagesSince: vi.fn(),
  createConversation: vi.fn(),
  findWhatsAppConversation: vi.fn(),
  getMessages: vi.fn(),
  updateLead: vi.fn(),
}))
vi.mock('@/lib/ai/concierge-agent', () => ({ runAgentTurn: vi.fn() }))

import * as leads from '@/lib/supabase/leads'
import { runAgentTurn } from '@/lib/ai/concierge-agent'
import {
  whatsAppProvider,
  verifyMetaSignature,
  metaVerificationChallenge,
  parseMetaWebhook,
  twilioSignature,
  verifyTwilioSignature,
  parseTwilioWebhook,
  sendWhatsAppText,
} from '@/lib/whatsapp/providers'
import { toWhatsAppText, splitForWhatsApp } from '@/lib/whatsapp/format'
import { handleInboundWhatsApp, NON_TEXT_REPLY, DAILY_CAP_REPLY, ERROR_REPLY } from '@/lib/whatsapp/inbound'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('provider selection', () => {
  it('is off unless WHATSAPP_PROVIDER is meta or twilio', () => {
    vi.stubEnv('WHATSAPP_PROVIDER', '')
    expect(whatsAppProvider()).toBeNull()
    vi.stubEnv('WHATSAPP_PROVIDER', 'Meta')
    expect(whatsAppProvider()).toBe('meta')
    vi.stubEnv('WHATSAPP_PROVIDER', 'twilio')
    expect(whatsAppProvider()).toBe('twilio')
    vi.stubEnv('WHATSAPP_PROVIDER', 'something')
    expect(whatsAppProvider()).toBeNull()
  })
})

describe('Meta webhook', () => {
  const secret = 'app-secret'
  const body = '{"entry":[]}'
  const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts a valid X-Hub-Signature-256 and rejects tampering', () => {
    expect(verifyMetaSignature(body, sig, secret)).toBe(true)
    expect(verifyMetaSignature(body + ' ', sig, secret)).toBe(false)
    expect(verifyMetaSignature(body, null, secret)).toBe(false)
    expect(verifyMetaSignature(body, sig.replace('sha256=', 'sha1='), secret)).toBe(false)
  })

  it('answers the GET handshake only with the right verify token', () => {
    const ok = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' })
    expect(metaVerificationChallenge(ok, 'tok')).toBe('42')
    expect(metaVerificationChallenge(ok, 'other')).toBeNull()
    ok.set('hub.mode', 'unsubscribe')
    expect(metaVerificationChallenge(ok, 'tok')).toBeNull()
  })

  it('only takes messages sent to our phone number id', () => {
    const payload = { entry: [{ changes: [
      { field: 'messages', value: { metadata: { phone_number_id: 'ours' }, messages: [{ id: 'a', from: '1', type: 'text', text: { body: 'hi' } }] } },
      { field: 'messages', value: { metadata: { phone_number_id: 'other' }, messages: [{ id: 'b', from: '1', type: 'text', text: { body: 'hi' } }] } },
    ] }] }
    expect(parseMetaWebhook(payload, 'ours').map((m) => m.messageId)).toEqual(['a'])
    expect(parseMetaWebhook(payload).map((m) => m.messageId)).toEqual(['a', 'b'])
  })

  it('parses text, buttons and media; ignores delivery statuses', () => {
    const payload = {
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ profile: { name: 'Mona' } }],
        messages: [
          { id: 'wamid.1', from: '201001234567', type: 'text', text: { body: ' Pricing? ' } },
          { id: 'wamid.2', from: '201001234567', type: 'interactive', interactive: { button_reply: { title: 'Book a demo' } } },
          { id: 'wamid.3', from: '201001234567', type: 'image', image: { id: 'm1' } },
        ],
        statuses: [{ id: 'wamid.out', status: 'delivered' }],
      } }] }],
    }
    expect(parseMetaWebhook(payload)).toEqual([
      { messageId: 'wamid.1', from: '201001234567', text: 'Pricing?', isText: true, profileName: 'Mona' },
      { messageId: 'wamid.2', from: '201001234567', text: 'Book a demo', isText: true, profileName: 'Mona' },
      { messageId: 'wamid.3', from: '201001234567', text: '', isText: false, profileName: 'Mona' },
    ])
  })
})

describe('Twilio webhook', () => {
  // Expected values computed with the official `twilio` library
  // (getExpectedTwilioSignature / validateRequest), incl. Twilio's docs example.
  it('matches the official signature algorithm', () => {
    expect(
      twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
        CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212',
      })
    ).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=')
    expect(
      twilioSignature('secret-token', 'https://growth.example/api/whatsapp/webhook', {
        MessageSid: 'SM1', From: 'whatsapp:+201001234567', To: 'whatsapp:+14155238886',
        Body: 'Hi — مرحبا, pricing?', ProfileName: 'Mona', NumMedia: '0',
      })
    ).toBe('TsZBwncjh1tMrmr+4ldUYlJb+5g=')
  })

  it('rejects a wrong URL, changed params or missing header', () => {
    const params = { MessageSid: 'SM1', Body: 'hi' }
    const url = 'https://growth.example/api/whatsapp/webhook'
    const sig = twilioSignature('tok', url, params)
    expect(verifyTwilioSignature('tok', sig, url, params)).toBe(true)
    expect(verifyTwilioSignature('tok', sig, 'http://internal:8080/api/whatsapp/webhook', params)).toBe(false)
    expect(verifyTwilioSignature('tok', sig, url, { ...params, Body: 'changed' })).toBe(false)
    expect(verifyTwilioSignature('tok', null, url, params)).toBe(false)
  })

  it('parses an inbound message', () => {
    expect(parseTwilioWebhook({ MessageSid: 'SM1', From: 'whatsapp:+20 100 123 4567', Body: ' hello ', ProfileName: 'Mona' })).toEqual({
      messageId: 'SM1', from: '201001234567', text: 'hello', isText: true, profileName: 'Mona',
    })
    expect(parseTwilioWebhook({ MessageSid: 'SM2', From: 'whatsapp:+201001234567', Body: '', NumMedia: '1' })?.isText).toBe(false)
    expect(parseTwilioWebhook({ Body: 'no id' })).toBeNull()
  })
})

describe('sendWhatsAppText', () => {
  it('sends a Meta text message to bare digits', async () => {
    vi.stubEnv('WHATSAPP_PROVIDER', 'meta')
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'tok')
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"messages":[{"id":"wamid.out"}]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendWhatsAppText('201001234567', 'Hi')).toBe('wamid.out')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/123/messages')
    expect(JSON.parse(init.body)).toMatchObject({ to: '201001234567', type: 'text', text: { body: 'Hi' } })
  })

  it('sends via Twilio with whatsapp: addresses and surfaces API errors', async () => {
    vi.stubEnv('WHATSAPP_PROVIDER', 'twilio')
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC1')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok')
    vi.stubEnv('TWILIO_WHATSAPP_FROM', '+14155238886')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"sid":"SMout"}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendWhatsAppText('201001234567', 'Hi')).toBe('SMout')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json')
    const form = new URLSearchParams(init.body)
    expect(form.get('From')).toBe('whatsapp:+14155238886')
    expect(form.get('To')).toBe('whatsapp:+201001234567')

    fetchMock.mockResolvedValue(new Response('{"code":63016,"message":"outside window"}', { status: 400 }))
    await expect(sendWhatsAppText('201001234567', 'Hi')).rejects.toThrow(/63016/)
  })
})

describe('WhatsApp formatting', () => {
  it('converts markdown to WhatsApp text', () => {
    expect(toWhatsAppText('**Pricing**: see [our plans](https://getautoura.net/pricing)\n- Solo\n- Studio')).toBe(
      '*Pricing*: see our plans: https://getautoura.net/pricing\n• Solo\n• Studio'
    )
    expect(toWhatsAppText('Book here: [https://calendly.com/autoura](https://calendly.com/autoura)')).toBe(
      'Book here: https://calendly.com/autoura'
    )
  })

  it('splits long replies under the limit at natural breaks', () => {
    const para = 'word '.repeat(150).trim() // ~750 chars
    const chunks = splitForWhatsApp([para, para, para].join('\n\n'), 1000)
    expect(chunks.length).toBe(3)
    expect(chunks.every((c) => c.length <= 1000)).toBe(true)
    expect(splitForWhatsApp('short')).toEqual(['short'])
  })
})

describe('concierge prompt channel note', () => {
  it('adds WhatsApp guidance only for WhatsApp', () => {
    expect(buildSystemPrompt('hi', 'whatsapp')).toContain('CHANNEL: WHATSAPP')
    expect(buildSystemPrompt('hi')).not.toContain('CHANNEL: WHATSAPP')
  })
})

describe('handleInboundWhatsApp', () => {
  const msg = { messageId: 'wamid.1', from: '201001234567', text: 'How much is it?', isText: true, profileName: 'Mona' }
  let sent: { to: string; body: string }[]

  beforeEach(() => {
    vi.clearAllMocks()
    sent = []
    vi.stubEnv('WHATSAPP_PROVIDER', 'meta')
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'tok')
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body)
      sent.push({ to: b.to, body: b.text.body })
      return new Response('{"messages":[{"id":"wamid.out"}]}', { status: 200 })
    }))
    vi.mocked(leads.findWhatsAppConversation).mockResolvedValue(null)
    vi.mocked(leads.createConversation).mockResolvedValue('conv-1')
    vi.mocked(leads.getMessages).mockResolvedValue([])
    vi.mocked(leads.appendMessage).mockResolvedValue(true)
    vi.mocked(leads.countUserMessagesSince).mockResolvedValue(1)
    vi.mocked(runAgentTurn).mockResolvedValue({ reply: 'Plans start at the **Solo** tier.', toolsUsed: [], demoSurfaced: false, escalated: false })
  })

  it('starts a conversation (no widget greeting), records the phone, runs the agent, replies', async () => {
    await handleInboundWhatsApp(msg)
    expect(leads.createConversation).toHaveBeenCalledWith(expect.objectContaining({ channel: 'whatsapp', externalId: '201001234567', greeting: false }))
    expect(leads.updateLead).toHaveBeenCalledWith('conv-1', { contact_phone: '+201001234567', contact_name: 'Mona' })
    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: 'How much is it?', channel: 'whatsapp' }))
    expect(sent).toEqual([{ to: '201001234567', body: 'Plans start at the *Solo* tier.' }])
  })

  it('reuses an existing conversation', async () => {
    vi.mocked(leads.findWhatsAppConversation).mockResolvedValue('conv-old')
    await handleInboundWhatsApp(msg)
    expect(leads.createConversation).not.toHaveBeenCalled()
    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-old' }))
  })

  it('drops a duplicate delivery of the same message id', async () => {
    vi.mocked(leads.appendMessage).mockResolvedValueOnce(false)
    await handleInboundWhatsApp(msg)
    expect(runAgentTurn).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('asks for text when sent media', async () => {
    await handleInboundWhatsApp({ ...msg, text: '', isText: false })
    expect(runAgentTurn).not.toHaveBeenCalled()
    expect(sent[0].body).toBe(NON_TEXT_REPLY)
  })

  it('says it has hit the daily cap once, then stays quiet', async () => {
    vi.stubEnv('WHATSAPP_MAX_MESSAGES_PER_DAY', '3')
    vi.mocked(leads.countUserMessagesSince).mockResolvedValueOnce(4).mockResolvedValueOnce(5)
    await handleInboundWhatsApp(msg)
    await handleInboundWhatsApp({ ...msg, messageId: 'wamid.2' })
    expect(runAgentTurn).not.toHaveBeenCalled()
    expect(sent.map((s) => s.body)).toEqual([DAILY_CAP_REPLY])
  })

  it('sends an apology if the agent fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(runAgentTurn).mockRejectedValueOnce(new Error('overloaded'))
    await handleInboundWhatsApp(msg)
    expect(sent[0].body).toBe(ERROR_REPLY)
  })

  it('handles one sender’s messages in order, never overlapping', async () => {
    const order: string[] = []
    vi.mocked(runAgentTurn).mockImplementation(async ({ userMessage }) => {
      order.push(`start:${userMessage}`)
      await new Promise((r) => setTimeout(r, userMessage === 'first' ? 20 : 0))
      order.push(`end:${userMessage}`)
      return { reply: 'ok', toolsUsed: [], demoSurfaced: false, escalated: false }
    })
    await Promise.all([
      handleInboundWhatsApp({ ...msg, messageId: 'a', text: 'first' }),
      handleInboundWhatsApp({ ...msg, messageId: 'b', text: 'second' }),
    ])
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })
})
