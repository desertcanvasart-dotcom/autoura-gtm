-- ============================================================================
-- 002 — Outbound Prospector (Phase 2, Slice A)
-- ============================================================================
-- CSV-imported prospects → agent-drafted personalized Touch 1 → human approval
-- → safe send (suppression-checked) via Resend. Reuses gtm_leads (source =
-- 'gtm-outbound') for prospects who reply. Standalone, service-role only.
-- Idempotent.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Campaigns — a named batch of prospects + its sending config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  from_email  TEXT,  -- overrides the env default when set
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Prospects — one imported operator/contact
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_prospects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  company_name   TEXT,
  contact_name   TEXT,
  contact_email  TEXT NOT NULL,
  role_title     TEXT,
  destination    TEXT,
  -- The real, specific observation the first touch must reference (spec §5):
  -- their public WhatsApp number, a slow-reply review, a job listing, etc.
  signal         TEXT,
  enrichment     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','drafted','approved','sent','replied','suppressed','skipped','failed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No duplicate contact within the same campaign (case-insensitive email).
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_prospect_email
  ON outbound_prospects (campaign_id, lower(contact_email));
CREATE INDEX IF NOT EXISTS idx_outbound_prospects_status ON outbound_prospects(status);
CREATE INDEX IF NOT EXISTS idx_outbound_prospects_campaign ON outbound_prospects(campaign_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Messages — every drafted / approved / sent touch
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id   UUID NOT NULL REFERENCES outbound_prospects(id) ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  touch_number  INT NOT NULL DEFAULT 1,
  channel       TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','linkedin')),
  subject       TEXT,
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','sent','failed','canceled','dry_run')),
  resend_id     TEXT,
  error         TEXT,
  approved_at   TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_prospect ON outbound_messages(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_status ON outbound_messages(status);

-- ----------------------------------------------------------------------------
-- Suppression list — the hard gate. Checked before EVERY send.
-- Opt-outs are permanent. Normalized (lowercased, trimmed) email is unique.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_suppression (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,  -- store normalized (lowercased/trimmed)
  reason      TEXT NOT NULL DEFAULT 'manual'
                CHECK (reason IN ('opt_out','bounce','complaint','manual','existing_lead','customer')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_suppression_email ON outbound_suppression(email);

-- ----------------------------------------------------------------------------
-- updated_at triggers (reuse gtm_set_updated_at from migration 001)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_outbound_campaigns_updated ON outbound_campaigns;
CREATE TRIGGER trg_outbound_campaigns_updated
  BEFORE UPDATE ON outbound_campaigns
  FOR EACH ROW EXECUTE FUNCTION gtm_set_updated_at();

DROP TRIGGER IF EXISTS trg_outbound_prospects_updated ON outbound_prospects;
CREATE TRIGGER trg_outbound_prospects_updated
  BEFORE UPDATE ON outbound_prospects
  FOR EACH ROW EXECUTE FUNCTION gtm_set_updated_at();

DROP TRIGGER IF EXISTS trg_outbound_messages_updated ON outbound_messages;
CREATE TRIGGER trg_outbound_messages_updated
  BEFORE UPDATE ON outbound_messages
  FOR EACH ROW EXECUTE FUNCTION gtm_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: on, no policies — service-role (server) only, like the gtm_ tables.
-- ----------------------------------------------------------------------------
ALTER TABLE outbound_campaigns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_prospects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_suppression ENABLE ROW LEVEL SECURITY;

COMMIT;
