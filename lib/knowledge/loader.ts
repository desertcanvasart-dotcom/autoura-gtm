// ============================================================================
// KNOWLEDGE BASE LOADER
// ============================================================================
// Loads + validates knowledge/product-truth.json. Cached per server process;
// call reloadProductTruth() (or restart) after editing the file in prod.
// ============================================================================

import { z } from 'zod'
import productTruthRaw from '@/knowledge/product-truth.json'

const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  confidence: z.enum(['shipped', 'beta', 'do_not_claim']),
}).passthrough()

const ProductTruthSchema = z.object({
  _last_reviewed: z.string(),
  positioning: z.object({
    one_liner: z.string(),
    built_by: z.string(),
    core_pain_solved: z.array(z.string()),
  }).passthrough(),
  features: z.object({
    shipped: z.array(FeatureSchema),
    beta: z.array(FeatureSchema),
    do_not_claim: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  }),
  pricing: z.object({
    policy: z.string(),
    currency: z.string(),
    tiers: z.array(z.object({
      name: z.string(),
      price: z.number().nullable(),
      display: z.string(),
      positioning: z.string(),
    })),
  }).passthrough(),
  objections: z.array(z.object({
    objection: z.string(),
    response_direction: z.string(),
  }).passthrough()),
  case_studies: z.array(z.object({ id: z.string(), name: z.string(), claim: z.string() }).passthrough()),
  competitors: z.object({
    guidance: z.string(),
    players: z.array(z.object({ name: z.string(), differentiator: z.string() })),
  }).passthrough(),
  qualification: z.object({
    questions: z.array(z.string()),
    icp: z.object({ in: z.array(z.string()), out: z.array(z.string()) }),
  }).passthrough(),
  escalation: z.object({
    policy: z.string(),
    triggers: z.array(z.string()),
    escalate_to: z.string(),
  }).passthrough(),
  booking: z.object({
    calendly_url: z.string(),
    when_to_offer: z.string(),
  }).passthrough(),
  hard_rules: z.array(z.string()),
}).passthrough()

export type ProductTruth = z.infer<typeof ProductTruthSchema>

let _cached: ProductTruth | null = null

export function getProductTruth(): ProductTruth {
  if (!_cached) {
    const parsed = ProductTruthSchema.safeParse(productTruthRaw)
    if (!parsed.success) {
      throw new Error(
        `product-truth.json failed validation — fix the file before the agent can run:\n${parsed.error.message}`
      )
    }
    _cached = parsed.data
  }
  return _cached
}

/** For tests / hot-reload after editing the file. */
export function reloadProductTruth(): void {
  _cached = null
}
