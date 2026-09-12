// ============================================================================
// Next.js instrumentation — in-app scheduler for outbound follow-ups
// ============================================================================
// Runs once when the server process starts. When OUTBOUND_INTERNAL_CRON=true,
// it periodically drafts due Touch 2/3 into the human-approval queue — no
// external cron or GitHub Actions needed. It never sends; a person still
// approves every email. The /api/cron/outbound-followups endpoint remains for
// anyone who prefers an external scheduler.
// ============================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.OUTBOUND_INTERNAL_CRON !== 'true') return

  const hours = Number(process.env.OUTBOUND_INTERNAL_CRON_HOURS || 6)
  const intervalMs = Math.max(1, hours) * 3600_000

  const run = async () => {
    try {
      const { draftDueFollowups } = await import('@/lib/outbound/sequencer')
      const r = await draftDueFollowups()
      if (r.drafted || r.errors) {
        console.log(`[internal-cron] drafted ${r.drafted}, skippedSuppressed ${r.skippedSuppressed}, errors ${r.errors}`)
      }
    } catch (err) {
      console.error('[internal-cron] failed', err)
    }
  }

  // Let the server settle, then run on the interval.
  setTimeout(run, 60_000)
  setInterval(run, intervalMs)
  console.log(`[internal-cron] enabled — drafting due follow-ups every ${hours}h`)
}
