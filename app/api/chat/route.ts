// ============================================================================
// POST /api/chat — one concierge turn
// ============================================================================
// Body: { conversationId?, message, pageUrl?, source? }
// - Creates a conversation (+ paired lead) on the first turn.
// - Persists the user message, runs the agent, persists the reply.
// - Returns { conversationId, reply, demoSurfaced, escalated }.
//
// The widget is served same-origin (iframe from this app), so no CORS handling
// is needed — the browser calls this route from the /widget document itself.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runAgentTurn, type AgentHistoryMessage } from '@/lib/ai/concierge-agent'
import {
  createConversation,
  conversationExists,
  appendMessage,
  getMessages,
} from '@/lib/supabase/leads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  pageUrl: z.string().max(2000).optional(),
  source: z.enum(['gtm-inbound', 'gtm-outbound']).optional(),
})

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof BodySchema>
  try {
    parsed = BodySchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid request', details: (err as Error).message },
      { status: 400 }
    )
  }

  const { message, pageUrl, source } = parsed

  try {
    // 1. Resolve (or create) the conversation.
    let conversationId = parsed.conversationId
    if (conversationId) {
      if (!(await conversationExists(conversationId))) {
        return NextResponse.json({ error: 'Unknown conversation' }, { status: 404 })
      }
    } else {
      conversationId = await createConversation({
        source: source ?? 'gtm-inbound',
        pageUrl: pageUrl ?? null,
        userAgent: req.headers.get('user-agent'),
      })
    }

    // 2. Load prior transcript (text turns only) for model context.
    const priorRows = await getMessages(conversationId)
    const history: AgentHistoryMessage[] = priorRows
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    // 3. Persist the incoming user message.
    await appendMessage({ conversationId, role: 'user', content: message })

    // 4. Run the agent (tool audit rows + lead mutations happen inside).
    const result = await runAgentTurn({ conversationId, history, userMessage: message })

    // 5. Persist the assistant reply.
    await appendMessage({ conversationId, role: 'assistant', content: result.reply })

    return NextResponse.json({
      conversationId,
      reply: result.reply,
      demoSurfaced: result.demoSurfaced,
      escalated: result.escalated,
    })
  } catch (err) {
    console.error('[gtm chat] error', err)
    return NextResponse.json(
      { error: 'Something went wrong handling your message. Please try again.' },
      { status: 500 }
    )
  }
}
