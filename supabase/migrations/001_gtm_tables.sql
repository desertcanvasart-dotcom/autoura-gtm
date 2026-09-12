-- ============================================================================
-- 001 — autoura-growth GTM tables
-- ============================================================================
-- Runs against the SEPARATE autoura-growth Supabase project (NOT the main
-- autoura-saas project). These tables are for selling Autoura-the-product to
-- travel agencies / tour operators / DMCs. They are intentionally standalone
-- with NO foreign keys into any product table — GTM sales prospects are a
-- different domain from the product's traveler `clients`.
--
--   gtm_conversations : one row per chat session (the widget conversation)
--   gtm_messages      : append-only transcript (user + assistant + tool turns)
--   gtm_leads         : one row per conversation — the qualified/qualifying lead
--
-- Access model: the Next.js server (chat API + admin) uses the service-role
-- key and bypasses RLS. RLS is enabled with NO permissive policies, so the
-- anon/public key can read/write nothing directly. Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- gtm_conversations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gtm_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL DEFAULT 'gtm-inbound'
                  CHECK (source IN ('gtm-inbound', 'gtm-outbound')),
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'qualified', 'escalated', 'disqualified', 'abandoned')),
  -- Free-form context captured from the embedding page (URL, utm, etc.).
  page_url      TEXT,
  user_agent    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gtm_conversations_created ON gtm_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gtm_conversations_status  ON gtm_conversations(status);

-- ----------------------------------------------------------------------------
-- gtm_messages (append-only transcript)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gtm_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES gtm_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content          TEXT NOT NULL DEFAULT '',
  -- Tool calls / results and any structured extras for auditability.
  tool_calls       JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gtm_messages_conversation ON gtm_messages(conversation_id, created_at);

-- ----------------------------------------------------------------------------
-- gtm_leads (one per conversation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gtm_leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL UNIQUE REFERENCES gtm_conversations(id) ON DELETE CASCADE,

  -- Source of this lead. The whole point of the field (spec step 2).
  source           TEXT NOT NULL DEFAULT 'gtm-inbound'
                     CHECK (source IN ('gtm-inbound', 'gtm-outbound')),

  -- Contact / company (all nullable — captured conversationally over time).
  contact_name     TEXT,
  contact_email    TEXT,
  company_name     TEXT,
  role_title       TEXT,

  -- Qualification signals (spec §4). current_system, destinations, b2b/b2c mix,
  -- quote volume, top pain — filled as the agent learns them.
  current_system   TEXT,
  destinations     TEXT,
  business_model   TEXT CHECK (business_model IN ('b2c', 'b2b', 'both') OR business_model IS NULL),
  quotes_per_week  INTEGER,
  top_pain         TEXT,

  -- Outcome.
  qualification    TEXT NOT NULL DEFAULT 'unqualified'
                     CHECK (qualification IN ('unqualified', 'qualifying', 'qualified', 'not_icp')),
  in_icp           BOOLEAN,
  escalated        BOOLEAN NOT NULL DEFAULT false,
  escalation_reason TEXT,
  demo_link_surfaced BOOLEAN NOT NULL DEFAULT false,

  notes            TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gtm_leads_source        ON gtm_leads(source);
CREATE INDEX IF NOT EXISTS idx_gtm_leads_qualification ON gtm_leads(qualification);
CREATE INDEX IF NOT EXISTS idx_gtm_leads_escalated     ON gtm_leads(escalated) WHERE escalated = true;
CREATE INDEX IF NOT EXISTS idx_gtm_leads_created       ON gtm_leads(created_at DESC);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gtm_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gtm_conversations_updated ON gtm_conversations;
CREATE TRIGGER trg_gtm_conversations_updated
  BEFORE UPDATE ON gtm_conversations
  FOR EACH ROW EXECUTE FUNCTION gtm_set_updated_at();

DROP TRIGGER IF EXISTS trg_gtm_leads_updated ON gtm_leads;
CREATE TRIGGER trg_gtm_leads_updated
  BEFORE UPDATE ON gtm_leads
  FOR EACH ROW EXECUTE FUNCTION gtm_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: enabled, no permissive policies. Only the service-role key (server)
-- can touch these tables. The public anon key gets nothing.
-- ----------------------------------------------------------------------------
ALTER TABLE gtm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gtm_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gtm_leads         ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ----------------------------------------------------------------------------
-- Post-check:
--   SELECT source, count(*) FROM gtm_leads GROUP BY 1;
--   SELECT status, count(*) FROM gtm_conversations GROUP BY 1;
-- ----------------------------------------------------------------------------
