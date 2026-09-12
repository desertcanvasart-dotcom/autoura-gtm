# autoura-growth

Standalone GTM service for **selling Autoura (the product) to travel agencies, tour operators, and DMCs**. Phase 1 = **Inbound Concierge** + the shared **product-truth knowledge base**.

> ⚠️ This is *not* about selling tours to travelers. Prospects here are businesses evaluating Autoura. It deliberately does **not** touch the main app's `clients`/traveler data — see "Relationship to autoura-saas" below.

## What's in Phase 1

- **Product-truth knowledge base** — [`knowledge/product-truth.json`](knowledge/product-truth.json). The single source of every claim the agent may make. **Hand-edit this** as claims change; no code change needed.
- **Concierge chat agent** — a Claude tool-calling agent ([`lib/ai/concierge-agent.ts`](lib/ai/concierge-agent.ts)) with RAG over the knowledge base, guardrails baked into the system prompt, and tools to keep the lead current, surface the Calendly link, and escalate high-value leads.
- **Embeddable widget** — iframe target at `/widget`, embedded on the marketing site.
- **Admin view** — `/admin` lists conversations + the lead each generated, with full transcripts, for weekly claims-drift review.
- **Dedicated GTM tables** — `gtm_conversations`, `gtm_messages`, `gtm_leads` in a **separate** Supabase project. `source` ∈ `{gtm-inbound, gtm-outbound}` lives on `gtm_leads`.

**Not built yet** (later phases): outbound sequencing, email sending, LinkedIn tooling, enrichment, WhatsApp inbound.

## Setup

1. `npm install`
2. Create a **new/separate** Supabase project (not the autoura-saas one).
3. Apply the migration: run [`supabase/migrations/001_gtm_tables.sql`](supabase/migrations/001_gtm_tables.sql) in the Supabase SQL editor (or via the Supabase CLI).
4. `cp .env.local.example .env.local` and fill in:
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `GTM_ALLOWED_FRAME_ANCESTORS` — your marketing origin(s), space-separated (e.g. `https://autoura.com https://www.autoura.com`)
   - `ADMIN_ACCESS_TOKEN` — a long random string; you'll be prompted for it (Basic auth) at `/admin`
5. `npm run dev` → http://localhost:3100

## Deploying to Railway

The growth app deploys to Railway (separate service from autoura-saas).

1. New Railway project → Deploy from this repo. Nixpacks auto-detects Next.js; `railway.json` pins the start command + `/widget` health check. `npm start` binds Railway's `$PORT`.
2. Add these service variables in Railway **before the first build** (`GTM_ALLOWED_FRAME_ANCESTORS` is read at build time):
   - `ANTHROPIC_API_KEY`, `GTM_AGENT_MODEL` (`claude-sonnet-5`)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `GTM_ALLOWED_FRAME_ANCESTORS` = `'self' https://getautoura.net https://www.getautoura.net`
   - `ADMIN_ACCESS_TOKEN`, `GTM_ESCALATION_EMAIL`, `NEXT_PUBLIC_CALENDLY_URL`
3. Give the service a domain (e.g. a Railway subdomain, or a custom `growth.getautoura.net`). The widget is then at `https://<that-domain>/widget`.
4. Apply `supabase/migrations/001_gtm_tables.sql` to the GTM Supabase project if not already done.

## Embedding on the marketing site (getautoura.net)

getautoura.net is served by the **autoura-saas** repo. A React launcher component (`components/AutouraGrowthWidget.tsx`) is mounted on the landing page (`app/page.tsx`) — a floating chat bubble that opens `/widget` in an iframe. To activate it, set one env var in **autoura-saas** and redeploy:

```
NEXT_PUBLIC_GROWTH_WIDGET_URL=https://<your-railway-domain>/widget
```

The launcher renders nothing until that var is set (so it can't ship a broken frame), and this app's `GTM_ALLOWED_FRAME_ANCESTORS` already whitelists getautoura.net. For a non-autoura-saas site, a raw `<iframe>` snippet is shown on this app's home page (`/`).

## Guardrails (enforced in the system prompt)

- Only claim what's in `product-truth.json`; otherwise "let me flag that for the team."
- QuickBooks/Xero are **always** "in beta, push-only" — never "integrated."
- Never quote outside the four published tiers; never discount.
- No launch dates, custom features, custom prices, or SLAs.
- Enterprise / high-volume / multi-country leads **escalate** (they don't auto-book). A deterministic backstop in [`lib/qualification.ts`](lib/qualification.ts) catches these even if the model misses them.
- Qualified conversations end by surfacing https://calendly.com/autoura.

Review transcripts weekly at `/admin` for claims drift (the zero-tolerance metric).

## Relationship to autoura-saas

`autoura-saas` treats "leads" as `clients` rows (`status='lead'`, multi-tenant, auto-promoted to Customer on first booking) — that's **travelers**, the customers of Autoura's customers. GTM sales prospects are a different domain, so they live in their own `gtm_` tables in their own Supabase project. The architecture mirrors the existing Travel2Egypt Concierge pattern (a separate app writing to Supabase via the service-role key), but with full project isolation.

## Architecture

```
knowledge/product-truth.json   → editable claims (the RAG source)
lib/knowledge/loader.ts        → load + zod-validate the truth file
lib/knowledge/retrieval.ts     → lightweight RAG (relevant objections/competitors)
lib/ai/anthropic-client.ts     → Anthropic client + retry (mirrors main app)
lib/ai/system-prompt.ts        → spec §4 prompt, composed from the truth file
lib/ai/concierge-agent.ts      → tool-calling loop (update_lead / offer_demo / escalate_lead)
lib/qualification.ts           → deterministic escalation backstop
lib/supabase/*                 → service-role client + persistence + admin reads
app/api/chat/route.ts          → POST one turn
app/widget/                    → iframe-embeddable chat page
app/admin/                     → transcripts + leads review
supabase/migrations/001_*.sql  → gtm_ tables
```
