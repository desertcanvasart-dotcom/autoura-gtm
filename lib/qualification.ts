// ============================================================================
// QUALIFICATION / ESCALATION HEURISTICS
// ============================================================================
// A deterministic backstop that complements the agent's own tool-driven
// escalation (spec §4 escalation rule, §8 guardrails). Even if the model
// forgets to call escalate_lead, this catches obvious high-value signals from
// the accumulated lead fields + latest message and forces an escalation flag.
// ============================================================================

import type { LeadUpdate } from '@/lib/supabase/leads'

// Above this weekly quote volume, the deal is worth a human taking the call.
const HIGH_VOLUME_QUOTES_PER_WEEK = 50

const ENTERPRISE_KEYWORDS = [
  'enterprise', 'custom pricing', 'custom price', 'sla', 'procurement',
  'rfp', 'security review', 'msa', 'volume discount', 'api access',
]

const MULTI_COUNTRY_KEYWORDS = [
  'multi-country', 'multiple countries', 'multi country', 'several countries',
  'global rollout', 'across countries', 'multiple destinations across',
  'rollout across',
]

export interface EscalationCheck {
  shouldEscalate: boolean
  reason: string | null
}

export function checkEscalation(lead: LeadUpdate, latestText: string): EscalationCheck {
  const text = latestText.toLowerCase()
  const reasons: string[] = []

  if (typeof lead.quotes_per_week === 'number' && lead.quotes_per_week >= HIGH_VOLUME_QUOTES_PER_WEEK) {
    reasons.push(`High quote volume (~${lead.quotes_per_week}/week)`)
  }
  if (ENTERPRISE_KEYWORDS.some((k) => text.includes(k))) {
    reasons.push('Enterprise-tier / custom-terms interest')
  }
  if (MULTI_COUNTRY_KEYWORDS.some((k) => text.includes(k))) {
    reasons.push('Multi-country / multi-destination rollout')
  }

  return reasons.length > 0
    ? { shouldEscalate: true, reason: reasons.join('; ') }
    : { shouldEscalate: false, reason: null }
}
