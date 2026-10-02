-- ============================================================================
-- 005 — Outbound Prospector: LinkedIn (assisted) channel
-- ============================================================================
-- LinkedIn connection notes are drafted by Claude and stored in
-- outbound_messages with channel = 'linkedin' (allowed since 002). A PERSON
-- sends them on LinkedIn and marks them sent — nothing is automated on
-- LinkedIn. This adds the prospect's profile URL. Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE outbound_prospects
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

-- Per-prospect, per-channel lookups (the campaign page reads latest by channel).
CREATE INDEX IF NOT EXISTS idx_outbound_messages_prospect_channel
  ON outbound_messages (prospect_id, channel, created_at DESC);

COMMIT;
