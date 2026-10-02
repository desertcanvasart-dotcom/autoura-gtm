// ============================================================================
// PROSPECT ENRICHMENT — research a prospect's public web presence with Claude
// ============================================================================
// Fills the inputs Touch 1 is written from (signal, destination, company,
// website) using Anthropic's server-side web search + web fetch tools. Guards:
// - a signal is kept only if its source URL was actually returned by a search
//   or fetch in this research run (no invented evidence);
// - low-confidence results are kept for review but not used;
// - only EMPTY fields are filled — CSV/human values are never overwritten;
// - a person still reviews the draft and approves every send.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { AGENT_MODEL, createMessageWithRetry } from '@/lib/ai/anthropic-client'
import { buildEnrichmentSystemPrompt, buildEnrichmentUserMessage, type ResearchTarget } from '@/lib/ai/enrichment-prompt'
import { getProspect, saveEnrichment, type ProspectRow, type EnrichmentStatus } from './db'

// ---------------------------------------------------------------------------
// Research target
// ---------------------------------------------------------------------------

// Personal mailbox providers: their domain says nothing about the company.
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'mail.com', 'yandex.com',
  'yandex.ru', 'zoho.com', 'web.de', 'orange.fr', 'free.fr', 'libero.it', 'qq.com', '163.com',
])

/** Normalize a user-typed website to an https URL, or null if unusable. */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (!u.hostname.includes('.')) return null
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return null
  }
}

/** What to research: the given website, else the company's email domain, else by name. */
export function researchTarget(p: Pick<ProspectRow, 'company_name' | 'destination' | 'website' | 'contact_email'>): ResearchTarget | null {
  const provided = normalizeWebsite(p.website)
  let website = provided
  let websiteSource: ResearchTarget['websiteSource'] = provided ? 'provided' : null
  if (!website) {
    const domain = (p.contact_email.split('@')[1] || '').trim().toLowerCase()
    if (domain && !FREEMAIL_DOMAINS.has(domain)) {
      website = normalizeWebsite(domain)
      websiteSource = website ? 'email_domain' : null
    }
  }
  if (!website && !p.company_name) return null // nothing to go on
  return { companyName: p.company_name, destination: p.destination, website, websiteSource }
}

// ---------------------------------------------------------------------------
// Result parsing + verification
// ---------------------------------------------------------------------------

const nullableText = z.string().trim().min(1).nullable().catch(null)

export const EnrichmentResultSchema = z.object({
  company_name: nullableText,
  website: nullableText,
  destination: nullableText,
  signal: nullableText,
  signal_source_url: nullableText,
  other_observations: z
    .array(z.object({ text: z.string().trim().min(1), source_url: z.string().trim().min(1) }))
    .catch([]),
  confidence: z.enum(['high', 'medium', 'low']).catch('low'),
  notes: z.string().catch(''),
})
export type EnrichmentResult = z.infer<typeof EnrichmentResultSchema>

/** What we store in outbound_prospects.enrichment (for the reviewer). */
export interface EnrichmentRecord extends EnrichmentResult {
  /** Signal dropped because its URL wasn't among the pages actually seen. */
  unverified_signal?: string | null
  sources_seen: string[]
  error?: string
}

/** Comparable form of a URL: lowercase host, no hash, no trailing slash, no www. */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path}${u.search}`
  } catch {
    return null
  }
}

function hostOf(raw: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** URLs returned by web_search / web_fetch results in the response content. */
export function collectSeenUrls(blocks: Anthropic.Messages.ContentBlock[]): string[] {
  const seen = new Set<string>()
  for (const b of blocks) {
    // Success content is a list of results; an error is a single object.
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) seen.add(r.url)
    } else if (b.type === 'web_fetch_tool_result' && b.content.type === 'web_fetch_result') {
      seen.add(b.content.url)
    }
  }
  return [...seen]
}

/**
 * Keep only what's backed by a page actually seen this run. A signal without a
 * seen source URL, or with low confidence, is not used (but is kept on the
 * record so a reviewer can see what was dropped).
 */
export function verifyEnrichment(result: EnrichmentResult, seenUrls: string[]): { record: EnrichmentRecord; status: EnrichmentStatus } {
  const seen = new Set(seenUrls.map(canonicalUrl).filter(Boolean) as string[])
  const seenHosts = new Set(seenUrls.map(hostOf).filter(Boolean) as string[])
  const isSeen = (url: string | null) => !!url && seen.has(canonicalUrl(url) ?? '')

  const record: EnrichmentRecord = {
    ...result,
    other_observations: result.other_observations.filter((o) => isSeen(o.source_url)).slice(0, 3),
    sources_seen: seenUrls,
  }
  // A website is only trusted if research actually touched that host.
  if (record.website && !seenHosts.has(hostOf(record.website) ?? '')) record.website = null

  const signalOk = !!result.signal && isSeen(result.signal_source_url) && result.confidence !== 'low'
  if (!signalOk && result.signal) {
    record.unverified_signal = result.signal
    record.signal = null
  }
  return { record, status: signalOk ? 'enriched' : 'no_signal' }
}

/** Fill only the fields that are still empty on the prospect. */
export function enrichmentPatch(
  p: Pick<ProspectRow, 'company_name' | 'destination' | 'signal' | 'website'>,
  r: EnrichmentRecord,
  status: EnrichmentStatus
) {
  const patch: Record<string, unknown> = {}
  if (!p.company_name && r.company_name && r.confidence !== 'low') patch.company_name = r.company_name
  if (!p.destination && r.destination && r.confidence !== 'low') patch.destination = r.destination
  if (!p.website && r.website) patch.website = normalizeWebsite(r.website)
  if (!p.signal && status === 'enriched' && r.signal) patch.signal = r.signal
  return patch
}

/** Parse the first JSON object that validates, scanning from each `{` in the text. */
export function extractEnrichmentJson(text: string): EnrichmentResult | null {
  const end = text.lastIndexOf('}')
  for (let start = text.indexOf('{'); start !== -1 && start < end; start = text.indexOf('{', start + 1)) {
    try {
      const parsed = EnrichmentResultSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
      if (parsed.success) return parsed.data
    } catch {
      /* not JSON from here; try the next brace */
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// The research call
// ---------------------------------------------------------------------------

// Server tools run on Anthropic's side. The _20260209 variants (dynamic
// filtering) need a Claude 5-era / 4.6+ model.
const RESEARCH_TOOLS: Anthropic.Messages.ToolUnion[] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6, max_content_tokens: 12000 },
]

// A long server-tool turn can stop with pause_turn; resume it this many times.
const MAX_CONTINUATIONS = 4

export async function researchProspect(target: ResearchTarget): Promise<{ result: EnrichmentResult; seenUrls: string[] }> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: buildEnrichmentUserMessage(target) }]
  const allBlocks: Anthropic.Messages.ContentBlock[] = []
  let response: Anthropic.Messages.Message | null = null

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    response = await createMessageWithRetry({
      model: AGENT_MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: buildEnrichmentSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      tools: RESEARCH_TOOLS,
      messages,
    })
    allBlocks.push(...response.content)
    if (response.stop_reason !== 'pause_turn') break
    // Re-send the paused assistant turn as-is; the server resumes where it left off.
    messages.push({ role: 'assistant', content: response.content })
  }

  if (!response) throw new Error('No response from research model')
  if (response.stop_reason === 'refusal') throw new Error('The research model declined this request')
  if (response.stop_reason === 'pause_turn') throw new Error('Research did not finish within the continuation limit')

  const text = allBlocks
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  const result = extractEnrichmentJson(text)
  if (!result) throw new Error('Research did not return a valid result')
  return { result, seenUrls: collectSeenUrls(allBlocks) }
}

const EMPTY_RESULT: EnrichmentResult = {
  company_name: null,
  website: null,
  destination: null,
  signal: null,
  signal_source_url: null,
  other_observations: [],
  confidence: 'low',
  notes: '',
}

/** Enrich one prospect and save the outcome. Never throws; returns the status. */
export async function enrichProspect(prospectId: string): Promise<EnrichmentStatus | null> {
  const p = await getProspect(prospectId)
  if (!p) return null

  const target = researchTarget(p)
  if (!target) {
    await saveEnrichment(p.id, {}, 'no_signal', {
      ...EMPTY_RESULT,
      notes: 'Nothing to research: no website, no company name, and a personal email address. Add a website or company name.',
      sources_seen: [],
    })
    return 'no_signal'
  }

  try {
    const { result, seenUrls } = await researchProspect(target)
    const { record, status } = verifyEnrichment(result, seenUrls)
    await saveEnrichment(p.id, enrichmentPatch(p, record, status), status, record)
    return status
  } catch (err) {
    const message = (err as Error).message
    console.error(`[enrichment] prospect ${p.id} failed`, err)
    await saveEnrichment(p.id, {}, 'failed', { ...EMPTY_RESULT, notes: '', sources_seen: [], error: message }).catch(
      (saveErr) => console.error(`[enrichment] could not record failure for ${p.id}`, saveErr)
    )
    return 'failed'
  }
}
