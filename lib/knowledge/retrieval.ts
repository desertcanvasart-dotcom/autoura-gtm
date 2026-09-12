// ============================================================================
// KNOWLEDGE RETRIEVAL (lightweight RAG)
// ============================================================================
// The product-truth file is small and safety-critical, so the strategy is:
//   - ALWAYS inject the core, guardrail-bearing sections (features, pricing,
//     hard rules) fully — retrieval must never cause a required caveat to be
//     dropped.
//   - Additionally surface the most RELEVANT objections / competitor notes /
//     case studies for the latest user message, via keyword-overlap scoring.
//
// This keeps the guardrails complete while still doing query-relevant retrieval
// (spec §3/§4). If the KB grows large enough to blow the context budget, swap
// this for embeddings — the interface (retrieveRelevant) stays the same.
// ============================================================================

import { getProductTruth } from './loader'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are',
  'we', 'i', 'you', 'do', 'does', 'have', 'has', 'my', 'our', 'your', 'it',
  'with', 'that', 'this', 'how', 'what', 'can', 'about', 'at', 'be', 'from',
])

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t)
  )
}

function score(queryTokens: string[], text: string): number {
  const hay = text.toLowerCase()
  let s = 0
  for (const t of queryTokens) {
    if (hay.includes(t)) s += 1
  }
  return s
}

export interface RetrievedContext {
  objections: Array<{ objection: string; response_direction: string; do_not?: string }>
  competitors: Array<{ name: string; differentiator: string }>
  caseStudies: Array<{ name: string; claim: string; caveat?: string }>
}

/**
 * Return the objections / competitor notes / case studies most relevant to the
 * recent conversation text. Falls back to a sensible default set when nothing
 * scores (so the agent always has objection-handling material available).
 */
export function retrieveRelevant(conversationText: string, limit = 3): RetrievedContext {
  const truth = getProductTruth()
  const q = tokenize(conversationText)

  const objections = [...truth.objections]
    .map((o) => ({ o, s: score(q, `${o.objection} ${o.response_direction}`) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .filter((x, i) => x.s > 0 || i < 2) // keep top 2 even if no keyword hit
    .map((x) => x.o as RetrievedContext['objections'][number])

  const competitors = [...truth.competitors.players]
    .map((c) => ({ c, s: score(q, `${c.name} ${c.differentiator}`) }))
    .sort((a, b) => b.s - a.s)
    .filter((x) => x.s > 0)
    .slice(0, limit)
    .map((x) => x.c)

  const caseStudies = [...truth.case_studies]
    .map((cs) => ({ cs, s: score(q, `${cs.name} ${cs.claim}`) }))
    .sort((a, b) => b.s - a.s)
    .filter((x) => x.s > 0)
    .slice(0, limit)
    .map((x) => x.cs as RetrievedContext['caseStudies'][number])

  return { objections, competitors, caseStudies }
}
