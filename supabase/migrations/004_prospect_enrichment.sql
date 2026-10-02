-- ============================================================================
-- 004 — Outbound Prospector: automated prospect enrichment
-- ============================================================================
-- Claude researches each prospect's public web presence and fills in the
-- signal (the specific observation Touch 1 is built on), destination, company
-- and website — only where those are empty. The full result, with the source
-- URLs it saw, is kept in `enrichment` for a human to review. Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE outbound_prospects
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT
    CHECK (enrichment_status IN ('enriched', 'no_signal', 'failed')),
  ADD COLUMN IF NOT EXISTS enrichment JSONB,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

COMMIT;
