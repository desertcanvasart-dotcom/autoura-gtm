-- ============================================================================
-- 006 — WhatsApp inbound concierge
-- ============================================================================
-- Prospects can message Autoura's WhatsApp Business number and get the same
-- concierge agent as the web widget. Inbound only: the app replies to people
-- who messaged first and never starts a WhatsApp conversation. Idempotent.
-- ============================================================================

BEGIN;

-- Which surface a conversation came from, and (for WhatsApp) whose number.
ALTER TABLE gtm_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web'
    CHECK (channel IN ('web', 'whatsapp')),
  ADD COLUMN IF NOT EXISTS external_id TEXT; -- WhatsApp: sender's number, digits only

CREATE INDEX IF NOT EXISTS idx_gtm_conversations_channel_external
  ON gtm_conversations (channel, external_id, created_at DESC)
  WHERE external_id IS NOT NULL;

-- Provider message id (Meta wamid / Twilio MessageSid). Providers retry
-- webhooks, so this makes each inbound message processed exactly once.
ALTER TABLE gtm_messages
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gtm_messages_external_id
  ON gtm_messages (external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE gtm_leads
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

COMMIT;
