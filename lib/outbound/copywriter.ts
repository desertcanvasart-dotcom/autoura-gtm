// ============================================================================
// OUTBOUND COPYWRITER — drafts a personalized Touch 1
// ============================================================================
import Anthropic from '@anthropic-ai/sdk'
import { AGENT_MODEL, createMessageWithRetry } from '@/lib/ai/anthropic-client'
import { buildOutboundSystemPrompt, buildProspectMessage } from '@/lib/ai/outbound-prompt'
import type { ProspectRow } from './db'

export interface DraftedTouch {
  subject: string
  body: string
}

// Pull the first JSON object out of the model's text, tolerating stray prose or
// code fences the model may add despite instructions.
function extractJson(text: string): { subject?: string; body?: string } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function draftTouch1(prospect: ProspectRow): Promise<DraftedTouch> {
  const response = await createMessageWithRetry({
    model: AGENT_MODEL,
    max_tokens: 700,
    system: [
      { type: 'text', text: buildOutboundSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: buildProspectMessage({
          companyName: prospect.company_name,
          contactName: prospect.contact_name,
          roleTitle: prospect.role_title,
          destination: prospect.destination,
          signal: prospect.signal,
        }),
      },
    ],
  })

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

  const parsed = extractJson(text)
  if (!parsed?.subject || !parsed?.body) {
    throw new Error('Copywriter did not return a valid {subject, body} draft')
  }
  return { subject: parsed.subject.trim(), body: parsed.body.trim() }
}
