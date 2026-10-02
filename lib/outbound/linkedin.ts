// ============================================================================
// LINKEDIN (ASSISTED) — draft connection notes for a person to send by hand
// ============================================================================
// LinkedIn has no public API for connection requests or cold messages, and its
// User Agreement forbids automating them. So this never touches LinkedIn: Claude
// drafts the note, a person copies it, sends it on LinkedIn themselves, and
// clicks "Mark sent". Same voice and claim rules as the email copywriter.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { AGENT_MODEL, createMessageWithRetry } from '@/lib/ai/anthropic-client'
import { buildLinkedInSystemPrompt, buildLinkedInUserMessage } from '@/lib/ai/outbound-prompt'
import type { ProspectRow } from './db'

/**
 * Max note length. LinkedIn's limit depends on the sender's account type
 * (lower on free accounts), so it's configurable; 200 fits every account.
 */
export function linkedInNoteMaxChars(): number {
  const n = Number(process.env.LINKEDIN_NOTE_MAX_CHARS || 200)
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : 200
}

/** A linkedin.com profile/company URL as https, or null if it isn't one. */
export function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    const host = u.hostname.toLowerCase()
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null
    const path = u.pathname.replace(/\/+$/, '')
    if (!/^\/(in|company|pub)\/[^/]+/i.test(path)) return null
    return `https://www.linkedin.com${path}`
  } catch {
    return null
  }
}

/** Why a drafted note can't be used as-is, or null if it's fine. */
export function linkedInNoteProblem(note: string, maxChars: number): string | null {
  if (!note.trim()) return 'empty'
  if (note.length > maxChars) return `too long (${note.length}/${maxChars} characters)`
  if (/https?:\/\/|www\.|calendly/i.test(note)) return 'contains a link'
  if (/\[[^\]]*\]|\{[^}]*\}/.test(note)) return 'contains a placeholder'
  if (/\$\s?\d/.test(note)) return 'mentions a price'
  return null
}

function extractNote(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { note?: unknown }
    return typeof parsed.note === 'string' ? parsed.note.replace(/\s*\n+\s*/g, ' ').trim() : null
  } catch {
    return null
  }
}

/** Draft a connection note; retries once with feedback if the first one is unusable. */
export async function draftLinkedInNote(prospect: ProspectRow): Promise<string> {
  const maxChars = linkedInNoteMaxChars()
  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content: buildLinkedInUserMessage({
        companyName: prospect.company_name,
        contactName: prospect.contact_name,
        roleTitle: prospect.role_title,
        destination: prospect.destination,
        signal: prospect.signal,
      }),
    },
  ]

  let problem = 'no note returned'
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await createMessageWithRetry({
      model: AGENT_MODEL,
      max_tokens: 1000,
      system: [{ type: 'text', text: buildLinkedInSystemPrompt(maxChars), cache_control: { type: 'ephemeral' } }],
      messages,
    })
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    const note = extractNote(text)
    const issue = note === null ? 'no valid {"note": ...} JSON returned' : linkedInNoteProblem(note, maxChars)
    if (note !== null && !issue) return note

    problem = issue ?? problem
    messages.push(
      { role: 'assistant', content: text || '(empty)' },
      { role: 'user', content: `That note can't be used: ${problem}. Rewrite it following every rule, at most ${maxChars} characters. Return only the JSON.` }
    )
  }
  throw new Error(`LinkedIn note unusable after retry: ${problem}`)
}
