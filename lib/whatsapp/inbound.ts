// ============================================================================
// WHATSAPP INBOUND — run the concierge for a prospect who messaged us
// ============================================================================
// Same agent, tools, guardrails, lead record, escalation alerts and /admin
// transcript as the web widget. One conversation per sender's number (a new
// one after MAX_IDLE_DAYS of silence). Replies only ever go to the person who
// just messaged — the app never starts a WhatsApp conversation.
// ============================================================================

import { runAgentTurn, type AgentHistoryMessage } from '@/lib/ai/concierge-agent'
import {
  appendMessage,
  countUserMessagesSince,
  createConversation,
  findWhatsAppConversation,
  getMessages,
  updateLead,
} from '@/lib/supabase/leads'
import { sendWhatsAppText, type InboundWhatsApp } from './providers'
import { splitForWhatsApp, toWhatsAppText } from './format'

const MAX_IDLE_DAYS = 30

export const NON_TEXT_REPLY =
  "Thanks! I can only read text messages here. Could you type your question about Autoura?"
export const DAILY_CAP_REPLY =
  "Thanks for all your messages! I've reached my limit for today, but the team can see this conversation and can follow up with you."
export const ERROR_REPLY =
  "Sorry, something went wrong on our side. Please try again in a moment."

/** Max messages per number per 24h that get an AI reply (cost/abuse guard). */
export function dailyMessageCap(): number {
  const n = Number(process.env.WHATSAPP_MAX_MESSAGES_PER_DAY || 40)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 40
}

// One sender's messages are handled in order, never in parallel, so two quick
// messages don't run overlapping agent turns on the same history. (In-process:
// fine for the single Railway instance this app runs as.)
const chains = new Map<string, Promise<void>>()

export function handleInboundWhatsApp(msg: InboundWhatsApp): Promise<void> {
  const prev = chains.get(msg.from) ?? Promise.resolve()
  const next = prev
    .then(() => processInbound(msg))
    .catch((err) => console.error(`[whatsapp] failed handling ${msg.messageId}`, err))
  chains.set(msg.from, next)
  void next.finally(() => {
    if (chains.get(msg.from) === next) chains.delete(msg.from)
  })
  return next
}

async function processInbound(msg: InboundWhatsApp): Promise<void> {
  let conversationId = await findWhatsAppConversation(msg.from, MAX_IDLE_DAYS)
  if (!conversationId) {
    conversationId = await createConversation({
      source: 'gtm-inbound',
      channel: 'whatsapp',
      externalId: msg.from,
      greeting: false, // they never saw the widget greeting
      metadata: msg.profileName ? { whatsapp_profile_name: msg.profileName } : {},
    })
    await updateLead(conversationId, {
      contact_phone: `+${msg.from}`,
      ...(msg.profileName ? { contact_name: msg.profileName } : {}),
    })
  }

  // History BEFORE this message (same shape the web route builds).
  const prior = await getMessages(conversationId)
  const isNew = await appendMessage({
    conversationId,
    role: 'user',
    content: msg.isText ? msg.text : '[non-text message: media, location or contact]',
    externalId: msg.messageId,
  })
  if (!isNew) return // provider retried a message we already handled

  const reply = await decideReply(conversationId, msg, prior)
  if (!reply) return

  const text = toWhatsAppText(reply)
  await appendMessage({ conversationId, role: 'assistant', content: text })
  for (const chunk of splitForWhatsApp(text)) {
    await sendWhatsAppText(msg.from, chunk)
  }
}

async function decideReply(
  conversationId: string,
  msg: InboundWhatsApp,
  prior: Awaited<ReturnType<typeof getMessages>>
): Promise<string | null> {
  if (!msg.isText) return NON_TEXT_REPLY

  const cap = dailyMessageCap()
  const today = await countUserMessagesSince(conversationId, new Date(Date.now() - 86400_000).toISOString())
  if (today > cap) {
    // Say so once, then stay quiet until the window rolls over.
    return today === cap + 1 ? DAILY_CAP_REPLY : null
  }

  const history: AgentHistoryMessage[] = prior
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  try {
    const result = await runAgentTurn({ conversationId, history, userMessage: msg.text, channel: 'whatsapp' })
    return result.reply
  } catch (err) {
    console.error(`[whatsapp] agent failed for conversation ${conversationId}`, err)
    return ERROR_REPLY
  }
}
