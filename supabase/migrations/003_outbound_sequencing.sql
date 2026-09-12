-- ============================================================================
-- 003 — Outbound Prospector, Slice B: multi-touch sequencing
-- ============================================================================
-- Adds sequence config (interval + max touches) to campaigns, and per-prospect
-- sequence state (which touch we're on, when the next is due, why it stopped).
-- Touch 2/3 are auto-DRAFTED when due into the same human-approval queue.
-- Idempotent.
-- ============================================================================

BEGIN;

-- Campaign-level sequence config.
ALTER TABLE outbound_campaigns
  ADD COLUMN IF NOT EXISTS touch_interval_days INT NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS max_touches INT NOT NULL DEFAULT 3;

-- Per-prospect sequence state.
ALTER TABLE outbound_prospects
  ADD COLUMN IF NOT EXISTS sequence_status TEXT NOT NULL DEFAULT 'active'
    CHECK (sequence_status IN ('active','completed','replied','stopped','bounced','opted_out')),
  ADD COLUMN IF NOT EXISTS current_touch INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_touch_due_at TIMESTAMPTZ;

-- Scheduler query: find prospects whose next touch is due.
CREATE INDEX IF NOT EXISTS idx_outbound_prospects_due
  ON outbound_prospects (next_touch_due_at)
  WHERE sequence_status = 'active' AND next_touch_due_at IS NOT NULL;

COMMIT;
