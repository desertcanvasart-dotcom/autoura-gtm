// ============================================================================
// OUTBOUND COPYWRITER SYSTEM PROMPT
// ============================================================================
// Drafts a personalized Touch 1 cold email. Claims come ONLY from
// product-truth.json (same guardrails as the concierge); structure/tone come
// from outbound-playbook.json. Produces observation-not-pitch copy (spec §5).
// ============================================================================

import { getProductTruth } from '@/lib/knowledge/loader'
import playbook from '@/knowledge/outbound-playbook.json'

export interface ProspectFacts {
  companyName?: string | null
  contactName?: string | null
  roleTitle?: string | null
  destination?: string | null
  signal?: string | null
}

export function buildOutboundSystemPrompt(): string {
  const t = getProductTruth()
  const tiers = t.pricing.tiers.map((x) => `${x.name} ${x.display}`).join(', ')
  const differentiator = t.competitors.guidance
  const hardRules = t.hard_rules.map((r) => `- ${r}`).join('\n')
  const t1 = playbook.touch1

  return `You write the FIRST cold outreach email for Autoura — a quoting/operations
platform sold to tour operators and DMCs. You write like Islam, who built it
after 30+ years running tour operations in Egypt. Operator-to-operator, not a
marketing team.

GOAL OF TOUCH 1
${t1.goal}

STRUCTURE
${t1.structure.map((s) => `- ${s}`).join('\n')}
Length: ${t1.length}
Subject: ${t1.subject}

POSITIONING (for grounding — do not dump this in the email)
${t.positioning.one_liner}
Core differentiator: ${differentiator}

═══════════════════════════════════════════════════════════════════════════
NON-NEGOTIABLE CLAIM RULES (identical to the concierge — never break)
═══════════════════════════════════════════════════════════════════════════
${hardRules}
- The ONLY prices you may ever mention are the four published tiers: ${tiers}. Don't put pricing in a cold email unless it's genuinely useful, and never a number outside these.
- QuickBooks/Xero, if ever mentioned, are "in beta, push-only" — never "integrated".

MUST DO
${playbook.must_do.map((s) => `- ${s}`).join('\n')}

MUST NOT
${playbook.must_not.map((s) => `- ${s}`).join('\n')}

OUTPUT FORMAT
Return ONLY a JSON object, no prose around it, no code fences:
{"subject": "<subject line>", "body": "<plain-text email body>"}
The body is plain text (real newlines are fine inside the JSON string as \\n).
Do NOT include a signature, an unsubscribe line, or a physical address — those
are appended by the system. Do NOT include a Calendly link.`
}

export function buildProspectMessage(p: ProspectFacts): string {
  const lines = [
    `Company: ${p.companyName || '(unknown)'}`,
    `Contact: ${p.contactName || '(unknown)'}`,
    `Role: ${p.roleTitle || '(unknown)'}`,
    `Destination(s): ${p.destination || '(unknown)'}`,
    `Signal to reference (the real, specific observation): ${p.signal || '(none provided — keep the observation honest and general to their destination; do not invent specifics)'}`,
  ]
  return `Draft Touch 1 for this prospect:\n${lines.join('\n')}`
}
