// ============================================================================
// CLAIMS-DRIFT GUARD (spec §8 zero-tolerance metric)
// ============================================================================
// These tests fail CI if the agent's grounded truth drifts from what the
// product can back up. They are intentionally strict: changing a published
// price, dropping a beta caveat, or introducing a claim outside the truth file
// will break the build until a human consciously updates BOTH the truth file
// and the pinned expectations below.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { getProductTruth, reloadProductTruth } from '@/lib/knowledge/loader'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'

// --- PINNED TRUTH (edit consciously; a diff here is a claims-drift decision) ---
const EXPECTED_TIERS: Array<{ name: string; price: number | null }> = [
  { name: 'Solo', price: 69 },
  { name: 'Studio', price: 189 },
  { name: 'Agency', price: 449 },
  { name: 'Enterprise', price: null }, // throughput-based; display is "$1,200+"
]
const ALLOWED_DOLLARS = new Set([69, 189, 449, 1200])
const BETA_CAVEAT = 'in beta, push-only'
const CALENDLY = 'https://calendly.com/autoura'
const ESCALATE_TO = 'Faris'
const REQUIRED_BETA_IDS = ['quickbooks_sync', 'xero_sync']
const REQUIRED_DO_NOT_CLAIM_IDS = ['multilingual_docs', 'api_module_counts']

// Pull every "$<number>" out of a string as integers (commas stripped).
function extractDollars(text: string): number[] {
  const matches = text.match(/\$\s?\d[\d,]*/g) || []
  return matches.map((m) => parseInt(m.replace(/[^0-9]/g, ''), 10))
}

beforeAll(() => reloadProductTruth())

// ----------------------------------------------------------------------------
describe('product-truth.json integrity', () => {
  it('loads and passes schema validation', () => {
    expect(() => getProductTruth()).not.toThrow()
  })

  it('has exactly the four published pricing tiers, unchanged', () => {
    const t = getProductTruth()
    expect(t.pricing.tiers.map((x) => x.name)).toEqual(EXPECTED_TIERS.map((x) => x.name))
    for (const expected of EXPECTED_TIERS) {
      const tier = t.pricing.tiers.find((x) => x.name === expected.name)!
      expect(tier, `missing tier ${expected.name}`).toBeTruthy()
      expect(tier.price, `price drift on ${expected.name}`).toBe(expected.price)
    }
    // Enterprise stays "$1,200+"-shaped, not a hard quotable number.
    const ent = t.pricing.tiers.find((x) => x.name === 'Enterprise')!
    expect(ent.display).toMatch(/1,200/)
  })

  it('contains no dollar amount outside the four published tiers (anywhere in the file)', () => {
    const dollars = extractDollars(JSON.stringify(getProductTruth()))
    const stray = dollars.filter((d) => !ALLOWED_DOLLARS.has(d))
    expect(stray, `unpublished price(s) found in truth file: ${stray.join(', ')}`).toEqual([])
  })

  it('caveats every beta feature as "in beta, push-only"', () => {
    const beta = getProductTruth().features.beta
    const ids = beta.map((f) => f.id)
    for (const required of REQUIRED_BETA_IDS) {
      expect(ids, `beta feature ${required} missing`).toContain(required)
    }
    for (const f of beta) {
      expect((f as { required_caveat?: string }).required_caveat).toBe(BETA_CAVEAT)
    }
  })

  it('never states a beta or shipped feature as "integrated"', () => {
    const t = getProductTruth()
    const claimText = (f: unknown) =>
      `${(f as { claim?: string }).claim ?? ''} ${(f as { talk_track?: string }).talk_track ?? ''}`.toLowerCase()
    for (const f of [...t.features.shipped, ...t.features.beta]) {
      expect(claimText(f), `"integrated" claim on ${(f as { id: string }).id}`).not.toContain('integrated')
    }
  })

  it('keeps the do-not-claim boundaries (multilingual, API/module counts)', () => {
    const ids = getProductTruth().features.do_not_claim.map((f) => f.id)
    for (const required of REQUIRED_DO_NOT_CLAIM_IDS) {
      expect(ids, `do_not_claim ${required} missing`).toContain(required)
    }
  })

  it('keeps the core hard rules (beta caveat, four tiers, escalation)', () => {
    const rules = getProductTruth().hard_rules.join(' ').toLowerCase()
    expect(rules).toContain('beta')
    expect(rules).toMatch(/four (published )?tiers/)
    expect(rules).toContain('escalate')
  })

  it('points at the correct Calendly link and escalation owner', () => {
    const t = getProductTruth()
    expect(t.booking.calendly_url).toBe(CALENDLY)
    expect(t.escalation.escalate_to).toBe(ESCALATE_TO)
  })
})

// ----------------------------------------------------------------------------
describe('system prompt claims-drift guards', () => {
  // Run against several conversation contexts, including empty + unrelated, to
  // prove the guardrail-bearing sections are ALWAYS injected regardless of RAG.
  const QUERIES = [
    '',
    'tell me about pricing and quickbooks and xero',
    'we are not in egypt, is our data safe, does it replace my team',
    'random unrelated chit chat about the weather',
  ]

  for (const query of QUERIES) {
    const label = query || '(empty)'

    it(`always surfaces the beta caveat for QuickBooks & Xero — "${label}"`, () => {
      const prompt = buildSystemPrompt(query)
      expect(prompt).toContain(BETA_CAVEAT)
      expect(prompt).toContain('QuickBooks')
      expect(prompt).toContain('Xero')
    })

    it(`never references a price outside the four tiers — "${label}"`, () => {
      const prompt = buildSystemPrompt(query)
      const stray = extractDollars(prompt).filter((d) => !ALLOWED_DOLLARS.has(d))
      expect(stray, `unpublished price(s) in prompt: ${stray.join(', ')}`).toEqual([])
    })

    it(`always includes all four tier names, the demo link, and the escalation owner — "${label}"`, () => {
      const prompt = buildSystemPrompt(query)
      for (const tier of EXPECTED_TIERS) expect(prompt).toContain(tier.name)
      expect(prompt).toContain(CALENDLY)
      expect(prompt).toContain(ESCALATE_TO)
    })

    it(`always carries the do-not-claim boundaries (EN/JP docs, no endpoint/module counts) — "${label}"`, () => {
      const prompt = buildSystemPrompt(query)
      expect(prompt).toMatch(/EN\/JP/)
      expect(prompt).toMatch(/endpoint|module/i)
    })
  }
})
