// ============================================================================
// /api/cron/outbound-followups  — draft due Touch 2/3 into the approval queue
// ============================================================================
// Protected by CRON_SECRET (Authorization: Bearer header). Point any daily
// scheduler at it (Railway cron, GitHub Action, cron-job.org). It NEVER sends —
// it drafts due follow-ups for a human to approve. Safe to run frequently.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { draftDueFollowups } from '@/lib/outbound/sequencer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') || ''
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(header).digest()
  const b = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(a, b)
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await draftDueFollowups()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron outbound-followups]', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return run(req)
}
export async function POST(req: NextRequest) {
  return run(req)
}
