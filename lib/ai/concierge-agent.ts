// ============================================================================
// GTM CONCIERGE AGENT — tool-calling loop
// ============================================================================
// Same shape as autoura-saas/lib/whatsapp-ai-agent.ts, pointed at the GTM
// knowledge base with a different goal: qualify an operator/DMC evaluating
// Autoura and book a demo. Guardrails live in the system prompt; the tools let
// the agent keep the lead record current, surface the demo link, and escalate.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { AGENT_MODEL, createMessageWithRetry } from './anthropic-client'
import { buildSystemPrompt } from './system-prompt'
import { getProductTruth } from '@/lib/knowledge/loader'
import { checkEscalation } from '@/lib/qualification'
import {
  appendMessage,
  updateLead,
  markDemoSurfaced,
  escalateLead,
  type LeadUpdate,
} from '@/lib/supabase/leads'

const MAX_TOOL_ITERATIONS = 5
const MAX_TOKENS = 1024

// "Silent" tools do background work and return nothing the user needs to hear.
// If the model already wrote its user-facing message in the same turn as one of
// these, there's no reason to prompt it again (it would just repeat itself).
// offer_demo / escalate_lead are NOT silent — the model relays their result.
const SILENT_TOOLS = new Set(['update_lead'])

export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentTurnResult {
  reply: string
  toolsUsed: string[]
  demoSurfaced: boolean
  escalated: boolean
}

// ----------------------------------------------------------------------------
// Tool definitions
// ----------------------------------------------------------------------------

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'update_lead',
    description:
      'Record or update what you have learned about this prospect. Call whenever you learn a new fact (name, company, current system, destinations, B2C/B2B mix, weekly quote volume, biggest pain) or when you conclude on ICP fit. Pass only the fields you learned this turn.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        company_name: { type: 'string' },
        role_title: { type: 'string' },
        current_system: { type: 'string', description: 'What they run quoting on today (e.g. "WhatsApp + Excel").' },
        destinations: { type: 'string', description: 'Destination(s) they operate in.' },
        business_model: { type: 'string', enum: ['b2c', 'b2b', 'both'] },
        quotes_per_week: { type: 'integer', description: 'Rough number of quotes sent per week.' },
        top_pain: { type: 'string', description: 'The most annoying part of quoting for them.' },
        qualification: {
          type: 'string',
          enum: ['unqualified', 'qualifying', 'qualified', 'not_icp'],
          description: 'Your current read on this lead. Use "not_icp" for clearly-out-of-ICP prospects.',
        },
        in_icp: { type: 'boolean' },
        notes: { type: 'string', description: 'Any other useful context worth keeping on the record.' },
      },
      required: [],
    },
  },
  {
    name: 'offer_demo',
    description:
      'Surface the Calendly demo link to an IN-ICP prospect who has shown real intent (asked about pricing, timeline, or how to start). Do NOT use for out-of-ICP leads or leads that should be escalated to a human instead. Returns the demo URL for you to share.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: { type: 'string', description: 'Why this prospect is ready for a demo.' },
      },
      required: [],
    },
  },
  {
    name: 'escalate_lead',
    description:
      'Flag this lead for a human (Faris) instead of auto-booking. Use for enterprise-tier interest, high monthly quote volume, multi-country rollouts, or any request for custom development, custom pricing, an SLA, or a launch-date commitment. After escalating, tell the prospect a human will reach out personally.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: { type: 'string', description: 'Why this lead needs a human.' },
      },
      required: ['reason'],
    },
  },
]

// ----------------------------------------------------------------------------
// Tool execution
// ----------------------------------------------------------------------------

interface ToolState {
  toolsUsed: string[]
  demoSurfaced: boolean
  escalated: boolean
}

async function executeTool(
  conversationId: string,
  name: string,
  input: Record<string, unknown>,
  state: ToolState
): Promise<string> {
  state.toolsUsed.push(name)

  switch (name) {
    case 'update_lead': {
      await updateLead(conversationId, input as LeadUpdate)
      return 'Lead record updated.'
    }
    case 'offer_demo': {
      await markDemoSurfaced(conversationId)
      state.demoSurfaced = true
      const url = getProductTruth().booking.calendly_url
      return `Demo link ready to share: ${url}`
    }
    case 'escalate_lead': {
      const reason = String(input.reason ?? 'High-value lead')
      await escalateLead(conversationId, reason)
      state.escalated = true
      return 'Lead escalated to a human. Let the prospect know someone will reach out personally.'
    }
    default:
      return `Unknown tool: ${name}`
  }
}

// ----------------------------------------------------------------------------
// Main turn
// ----------------------------------------------------------------------------

export async function runAgentTurn(params: {
  conversationId: string
  history: AgentHistoryMessage[]
  userMessage: string
}): Promise<AgentTurnResult> {
  const { conversationId, history, userMessage } = params

  const conversationText = [...history.map((m) => m.content), userMessage].join('\n')
  // For escalation heuristics, only consider USER-authored text — never the
  // assistant's own messages, which recite the pricing tiers ("Enterprise",
  // "custom quotes") and would otherwise false-trigger an escalation.
  const userText = [...history.filter((m) => m.role === 'user').map((m) => m.content), userMessage].join('\n')
  const systemPrompt = buildSystemPrompt(conversationText)

  // Anthropic requires the first message to be from the user. The persisted
  // history starts with the assistant greeting, so drop any leading assistant
  // turns — the greeting's context is carried in the system prompt instead.
  const trimmedHistory = [...history]
  while (trimmedHistory.length && trimmedHistory[0].role === 'assistant') {
    trimmedHistory.shift()
  }

  const messages: Anthropic.Messages.MessageParam[] = [
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userMessage },
  ]

  const state: ToolState = { toolsUsed: [], demoSurfaced: false, escalated: false }
  // Accumulate every text block the model emits across the loop. The model
  // often writes its user-facing message (e.g. the next question) in the SAME
  // turn as a tool call, then adds little or nothing after the tool result —
  // so we must keep the earlier text, not overwrite it with the tail.
  const textParts: string[] = []

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await createMessageWithRetry({
      model: AGENT_MODEL,
      max_tokens: MAX_TOKENS,
      // Cache the system+tools prefix across iterations of this loop.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    })

    // Collect any text emitted this step.
    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text'
    )
    const stepText = textBlocks.map((b) => b.text).join('\n').trim()
    if (stepText) {
      textParts.push(stepText)
    }

    if (response.stop_reason !== 'tool_use') {
      break
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
    )

    // Persist an audit row for the tool calls (visible in the admin view).
    await appendMessage({
      conversationId,
      role: 'tool',
      content: toolUses.map((t) => t.name).join(', '),
      toolCalls: toolUses.map((t) => ({ name: t.name, input: t.input })),
    })

    // Add the assistant's tool-use turn to the running message list.
    messages.push({ role: 'assistant', content: response.content })

    // Execute each tool and build the tool_result turn.
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const toolUse of toolUses) {
      const result = await executeTool(
        conversationId,
        toolUse.name,
        (toolUse.input ?? {}) as Record<string, unknown>,
        state
      )
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      })
    }
    messages.push({ role: 'user', content: toolResults })

    // If the model already delivered its message this turn and only ran silent
    // background tools, stop — asking it again just produces a redundant repeat.
    const usedNonSilentTool = toolUses.some((t) => !SILENT_TOOLS.has(t.name))
    if (stepText && !usedNonSilentTool) {
      break
    }
  }

  // Deterministic escalation backstop — catches signals the model may have missed.
  if (!state.escalated) {
    const check = checkEscalation({}, userText)
    if (check.shouldEscalate && check.reason) {
      await escalateLead(conversationId, `(auto) ${check.reason}`)
      state.escalated = true
    }
  }

  let finalText = textParts.join('\n\n').trim()
  if (!finalText) {
    finalText =
      "Thanks — let me flag that for the team and someone will follow up. In the meantime, is there anything else about your quoting workflow I can help with?"
  }

  return {
    reply: finalText,
    toolsUsed: state.toolsUsed,
    demoSurfaced: state.demoSurfaced,
    escalated: state.escalated,
  }
}
