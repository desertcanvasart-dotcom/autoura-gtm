# autoura-growth — Deployment Runbook

Hand this to whoever is deploying. It takes the **autoura-growth** GTM concierge widget from repo → live on **getautoura.net**. Follow the parts in order.

**What you're standing up:**
1. A **Supabase project** (dedicated to GTM — separate from the main app's).
2. The **autoura-growth** Next.js app, deployed on **Railway** (this repo).
3. A one-line change to the already-live **autoura-saas** app so the chat bubble appears on **getautoura.net**.
4. *(Optional, Phase 2)* The **Outbound Prospector** — human-approved cold email via Resend, with automatic follow-ups. See **Part F**; skip it if you're only launching the chat widget.

**Time:** ~30–45 min for Parts A–E, plus ~30 min (and DNS propagation) for Part F. **You'll need:** access to Railway, the GTM Supabase project, an Anthropic API key, and the autoura-saas Railway service. For Part F also: a Resend account, DNS access for getautoura.net, and admin access to this GitHub repo.

---

## Part A — Supabase (the GTM database)

> If the GTM Supabase project already exists and migration `001` was applied, skip to Part B and just collect the keys in step A4.

1. Create a **new** Supabase project (name it e.g. `autoura-growth`). This must be **separate** from the main autoura-saas project — do not reuse it.
2. Open **SQL Editor** → New query.
3. Paste the entire contents of [`supabase/migrations/001_gtm_tables.sql`](supabase/migrations/001_gtm_tables.sql) and **Run**. It creates `gtm_conversations`, `gtm_messages`, `gtm_leads` and is safe to re-run.
4. Collect three values from **Project Settings → API**:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ secret — server-only, never share publicly)

Verify: **Table Editor** should now list the three `gtm_` tables.

---

## Part B — Deploy autoura-growth to Railway

1. In Railway: **New Project → Deploy from GitHub repo** → pick this repo (`autoura-gtm`).
   Railway auto-detects Next.js (Nixpacks). `railway.json` pins the start command and a `/widget` health check; `npm start` binds Railway's `$PORT`. No extra build config needed.

2. **Before the first build finishes**, add the service variables below (**Variables** tab). One (`GTM_ALLOWED_FRAME_ANCESTORS`) is read at build time, so set them all now and then trigger a redeploy if the first build ran without them.

   | Variable | Value / where to get it |
   |---|---|
   | `ANTHROPIC_API_KEY` | From console.anthropic.com. Must be a workspace that has the Claude 5 models. |
   | `GTM_AGENT_MODEL` | `claude-sonnet-5` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Part A4 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Part A4 |
   | `SUPABASE_SERVICE_ROLE_KEY` | Part A4 (secret) |
   | `GTM_ALLOWED_FRAME_ANCESTORS` | `'self' https://getautoura.net https://www.getautoura.net` (include the single quotes around self, space-separated) |
   | `ADMIN_ACCESS_TOKEN` | A long random string YOU generate — see below. This is the password for the `/admin` page. |
   | `GTM_ESCALATION_EMAIL` | Who gets emailed when a lead is escalated, e.g. `hello@getautoura.net`. Comma-separate several. |
   | `RESEND_API_KEY` | Needed for escalation alert emails. See **Part F2** for creating the key and verifying a sending domain. Without it, escalations are still flagged in `/admin`; no email goes out. |
   | `GTM_ALERT_FROM_EMAIL` | Sender for alerts, on a Resend-verified domain, e.g. `Autoura Alerts <alerts@outreach.getautoura.net>`. Falls back to `OUTBOUND_FROM_EMAIL`. |
   | `GTM_PUBLIC_BASE_URL` | This app's public URL, no trailing slash, for the transcript link in alerts. Falls back to `OUTBOUND_PUBLIC_BASE_URL`. |
   | `NEXT_PUBLIC_CALENDLY_URL` | `https://calendly.com/autoura` |

   Generate a strong admin token (run locally, paste the output as `ADMIN_ACCESS_TOKEN`):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   Save it in a password manager — it's how you'll log into `/admin`.

3. **Give the service a public domain.** Railway → the service → **Settings → Networking → Generate Domain** (gives `something.up.railway.app`), *or* add a custom domain like `growth.getautoura.net` (add the CNAME Railway shows you at your DNS provider).

4. **Verify the deploy.** Open `https://<your-railway-domain>/widget` in a browser — you should see the Autoura concierge chat greeting. Send a test message like *"We do about 20 quotes a week on WhatsApp, how does pricing work?"* — you should get a real reply mentioning the four pricing tiers.

   If the reply errors, see **Troubleshooting** at the bottom.

5. **Note the widget URL** for Part C: `https://<your-railway-domain>/widget`

---

## Part C — Show the widget on getautoura.net

The marketing site is served by the **autoura-saas** repo, which is already live on Railway. The code change adds a floating chat bubble (`components/AutouraGrowthWidget.tsx`, mounted on the landing page) that stays **hidden** until you set one environment variable — so activating it is just config + redeploy. (If autoura-saas doesn't yet have the change, apply **Appendix A** first.)

> If the autoura-saas code changes are NOT yet in the deployed branch, apply them first — see **Appendix A**.

1. Open the **autoura-saas** service in Railway → **Variables**.
2. Add:
   ```
   NEXT_PUBLIC_GROWTH_WIDGET_URL=https://<your-railway-domain>/widget
   ```
   (the same URL from Part B5, ending in `/widget`).
3. **Redeploy** autoura-saas (Railway redeploys automatically on a variable change; if not, trigger it).
4. Visit **https://getautoura.net** in a normal browser tab. A teal chat bubble appears bottom-right. Click it → the concierge opens in a panel. Send a message → it replies.

---

## Part D — Post-deploy verification checklist

- [ ] `https://<railway-domain>/widget` loads the chat greeting.
- [ ] Sending a message returns a real reply that quotes only the four tiers (Solo $69 / Studio $189 / Agency $449 / Enterprise $1,200+).
- [ ] Asking about QuickBooks/Xero gets *"in beta, push-only"* (never "integrated").
- [ ] The chat bubble is visible on https://getautoura.net and https://www.getautoura.net.
- [ ] Admin: open `https://<railway-domain>/admin`, log in (username: anything, password: your `ADMIN_ACCESS_TOKEN`). Your test conversations + the leads they generated appear.
- [ ] A lead row shows `source = gtm-inbound`.
- [ ] Escalation alert: in a **new** chat, say *"We need an SLA and custom pricing for a rollout across 6 countries."* The lead shows `escalated` in `/admin`, and `GTM_ESCALATION_EMAIL` receives one *"[Autoura] Escalated lead"* email. More escalating messages in the same chat don't send another email.

---

## Part E — Things the owner maintains (not deploy steps)

- **Editing claims:** all product claims live in [`knowledge/product-truth.json`](knowledge/product-truth.json). Edit it and redeploy the growth app — no code changes needed. The CI test suite (`npm test`) fails if a price or the beta caveat drifts.
- **Weekly review:** check `/admin` transcripts for claims drift (the spec's zero-tolerance metric).
- **Rotating the admin password:** change `ADMIN_ACCESS_TOKEN` in Railway and redeploy.

---

## Part F — Phase 2: Outbound Prospector (optional)

Outbound lets you import a list of operators, have Claude draft a personalized first email for each, and send it through Resend **only after a person clicks Approve**. Follow-ups (Touch 2 and 3) are drafted automatically when due and land in the same approval queue. Nothing is ever sent without a click.

Do Parts A–E first. Then work through F1–F7 in order. **Leave `OUTBOUND_DRY_RUN=true` until F6 passes.** F8 (automatic reply detection) is optional and can be done any time after F4.

### F1 — Apply the outbound migrations

In the GTM Supabase project's **SQL Editor**, run these files in order. All are safe to re-run.

1. [`supabase/migrations/002_outbound_tables.sql`](supabase/migrations/002_outbound_tables.sql) — creates `outbound_campaigns`, `outbound_prospects`, `outbound_messages`, `outbound_suppression`.
2. [`supabase/migrations/003_outbound_sequencing.sql`](supabase/migrations/003_outbound_sequencing.sql) — adds follow-up timing and sequence state.
3. [`supabase/migrations/004_prospect_enrichment.sql`](supabase/migrations/004_prospect_enrichment.sql) — adds `website` and the enrichment (research) columns.
4. [`supabase/migrations/005_linkedin_channel.sql`](supabase/migrations/005_linkedin_channel.sql) — adds `linkedin_url` for the assisted LinkedIn channel.

Verify: **Table Editor** lists the four `outbound_` tables, and `outbound_prospects` has `sequence_status`, `current_touch` and `next_touch_due_at` columns, plus `website`, `enrichment_status` and `linkedin_url`.

### F2 — Set up a sending subdomain in Resend

Send cold email from a **separate subdomain** (e.g. `outreach.getautoura.net`), never from `getautoura.net` itself. Then spam complaints can't hurt deliverability for your normal mail.

1. In Resend → **Domains → Add domain** → `outreach.getautoura.net`.
2. Add the DNS records Resend shows you (SPF, DKIM, and the MX for bounces) at your DNS provider. If `getautoura.net` has no DMARC record yet, add one. A monitoring-only `v=DMARC1; p=none; rua=mailto:<you>@getautoura.net` is fine to start.
3. Wait until Resend shows the domain as **Verified**.
4. Resend → **API Keys → Create** (sending access is enough) → copy it for F3.

A sending subdomain doesn't receive mail. Replies go to the inbox you set in `OUTBOUND_REPLY_TO`, so it must be a **real, monitored** mailbox.

### F3 — Add the outbound variables in Railway

On the **autoura-growth** service → **Variables**, add the following. Railway redeploys when variables change. None of these are build-time, so a redeploy is enough.

| Variable | Value / where to get it |
|---|---|
| `RESEND_API_KEY` | F2 step 4 (secret) |
| `OUTBOUND_FROM_EMAIL` | Sender on the verified subdomain, e.g. `Islam at Autoura <islam@outreach.getautoura.net>` |
| `OUTBOUND_REPLY_TO` | A real inbox you read, e.g. `islam@getautoura.net` |
| `OUTBOUND_POSTAL_ADDRESS` | Your physical mailing address, shown in every email footer. Cold email law requires it. |
| `OUTBOUND_PUBLIC_BASE_URL` | This app's public URL, no trailing slash, e.g. `https://autoura-growth-production.up.railway.app`. Unsubscribe links are built from it. |
| `OUTBOUND_UNSUB_SECRET` | Generate (below). Signs unsubscribe links. **Don't change it later**, or links in emails already sent stop working. |
| `CRON_SECRET` | Generate (below). Protects the follow-up endpoint. |
| `RESEND_WEBHOOK_SECRET` | Leave empty for now; filled in F4. |
| `OUTBOUND_DRY_RUN` | `true` for now. The whole flow runs, but no email is actually sent. |
| `LINKEDIN_NOTE_MAX_CHARS` | *Optional.* Character limit for LinkedIn connection notes. Default `200`, which fits every account. Set `300` if whoever sends them has a paid LinkedIn plan with the longer limit. |

Generate each secret separately:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

A campaign can override the sender. If you fill in "from email" when you create the campaign, it's used instead of `OUTBOUND_FROM_EMAIL`.

### F4 — Connect the Resend webhook (bounces, complaints & replies)

This automatically suppresses addresses that hard-bounce or mark you as spam, and stops their sequences.

1. Resend → **Webhooks → Add endpoint** → URL `https://<your-railway-domain>/api/outbound/resend-webhook`.
2. Events: **`email.bounced`** and **`email.complained`**. Also tick **`email.received`** if you'll set up reply detection (F8).
3. Copy the endpoint's signing secret (`whsec_...`) into `RESEND_WEBHOOK_SECRET` on Railway, and let it redeploy.
4. Check delivery in the endpoint's log in Resend (use a test event if Resend offers one; otherwise check after the first real bounce). It should show `200`. A `401` means the secret is wrong, or the event is more than 5 minutes old — older events are rejected to block replays. A `503` means `RESEND_WEBHOOK_SECRET` isn't set yet.

### F5 — Schedule the follow-up drafter

Something must call `/api/cron/outbound-followups` regularly. It only **drafts** due follow-ups into the approval queue and never sends. Pick **one** option:

**Option 1 — GitHub Action (already in the repo).** [`.github/workflows/outbound-followups.yml`](.github/workflows/outbound-followups.yml) runs daily at 08:00 UTC.
1. GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret** → name `CRON_SECRET`, value identical to Railway's `CRON_SECRET`.
2. The workflow calls `https://autoura-growth-production.up.railway.app/...`. If your Railway domain is different, edit the URL in the workflow file.
3. **Actions → Outbound follow-ups → Run workflow** once by hand. The log should end with `{"ok":true,"drafted":0,...}`.

**Option 2 — In-app timer.** On Railway set `OUTBOUND_INTERNAL_CRON=true` and optionally `OUTBOUND_INTERNAL_CRON_HOURS` (default `6`). The server drafts due follow-ups on that interval; logs show `[internal-cron] enabled`. Use this only if the app runs as a **single** replica. With more replicas, each one would run the timer.

**Option 3 — Any external scheduler** (Railway cron, cron-job.org): `POST` the URL with header `Authorization: Bearer <CRON_SECRET>`. Passing the secret as `?secret=` in the URL is **not** accepted.

### F6 — Dry-run verification (with `OUTBOUND_DRY_RUN=true`)

Use addresses you control (e.g. `you+test1@gmail.com`). Start from [`docs/outbound-prospects-template.csv`](docs/outbound-prospects-template.csv): delete the example rows and add yours.

- [ ] `https://<railway-domain>/admin/outbound` loads with no "Couldn't load" error. If it errors, F1 wasn't applied.
- [ ] Create a campaign → paste the CSV → **Import**. Prospects appear.
- [ ] On a prospect with a real company website (put it in the `website` column, or use a company email address) and an empty `signal`, click **Enrich**. Within about a minute the card shows `research: enriched` with a source link you can open, and the `signal` is filled in. Or `research: no signal` with notes explaining why. Enrichment runs on your Anthropic key and uses web search, so it costs a little per prospect; use **Enrich next 5** for batches.
- [ ] On a prospect, click **Draft LinkedIn note**. A short note appears with a character count under the limit and no links or prices. **Copy note** copies it; **Mark sent on LinkedIn** records it (do this only after you've actually sent it on LinkedIn).
- [ ] **Draft touch 1** produces a personalized subject and body that quote only published prices and never call QuickBooks/Xero "integrated".
- [ ] **Approve (dry-run)** marks it `dry_run`, and the prospect shows `touch 1/3` with a "next touch due" date.
- [ ] Force a follow-up: in Supabase set that prospect's `next_touch_due_at` to a past time, then run the scheduler (F5). A **Touch 2** draft appears with a `Re:` subject.
- [ ] On the prospect with the pending Touch 2 draft, click **Replied → hand to concierge**. The sequence shows `replied`, the Approve button is gone, and a `gtm-outbound` lead appears in `/admin`.
- [ ] On a prospect you haven't sent to, click **Suppress**. It shows `suppressed`, and its sequence shows `opted_out`.

### F7 — Go live

1. Set `OUTBOUND_DRY_RUN=false` on Railway (it redeploys).
2. The approve button now reads **Approve & send**. Send **one** real email to an address you own and check:
   - it arrives in the inbox (not spam);
   - the footer shows your postal address;
   - **Unsubscribe** works and shows a confirmation. After that, the address is permanently suppressed.
   - replying lands in `OUTBOUND_REPLY_TO`.
3. Start real campaigns small, a few dozen sends per day, and grow gradually while the new subdomain builds a sending reputation.

**Day-to-day:**
- Check `OUTBOUND_REPLY_TO` daily and answer replies from there. With F8 set up, a reply automatically stops that prospect's sequence and creates a `gtm-outbound` lead in `/admin`. Without F8, or if they replied from a different address, click **Replied → hand to concierge** on their card. Either way, a lead is only created once.
- **LinkedIn:** the app only drafts the connection note. Open the profile, send the request yourself with the copied note, then click **Mark sent on LinkedIn**. LinkedIn replies aren't detected automatically: when someone replies there, click **Replied → hand to concierge**. Keep to a modest pace: LinkedIn limits weekly invitations and restricts accounts that send too many.
- A reply like *"not interested"* or *"remove me"* also ends up as a lead. If they asked to be removed, click **Suppress** on their card so no future campaign emails them.
- If a send fails, the card shows the error and a **Retry touch N** button. If the error looks like a network timeout, check Resend's **Emails** log first, because the email may already have gone out.

### F8 — Automatic reply detection (optional)

Without this, someone has to click **Replied → hand to concierge** for each reply, and a prospect who replied can still be sent the next follow-up if nobody clicks in time. With it, a reply stops the sequence on its own.

How it works: replies keep arriving in your `OUTBOUND_REPLY_TO` inbox exactly as before. That inbox also **forwards a copy** to a Resend receiving address. Resend tells this app (`email.received`), and the app matches the sender to a prospect you've emailed. Emails prospects see don't change.

1. **Get a receiving address.** Resend → **Emails → Receiving** shows an address like `anything@<your-id>.resend.app`. That works with no DNS changes. You can use a custom subdomain instead (add the MX record Resend gives you on e.g. `inbound.getautoura.net`), but **never on `getautoura.net` itself**, or it will take over your normal mail.
2. **Webhook:** on the F4 endpoint, make sure **`email.received`** is ticked.
3. **Forward replies from the `OUTBOUND_REPLY_TO` mailbox** to that address, **keeping the original sender**:
   - **Gmail / Google Workspace:** Settings → **Forwarding and POP/IMAP → Add a forwarding address**. Google sends a confirmation code to it; read it in Resend → **Emails → Receiving**. Then create a **filter** (e.g. `subject:(Re:)`) with **Forward it to** that address, so only replies are forwarded rather than all your mail.
   - **Outlook / Microsoft 365:** an inbox rule using **Redirect to**, not "Forward to". "Forward" replaces the sender with your own address, so nothing would match.
4. **Test** (dry-run is fine): reply from an address that is a prospect you've already sent to. Within a minute the card shows `replied`, a `gtm-outbound` lead appears in `/admin`, and Railway logs show `[reply-detection] handed_off`.

What it ignores: out-of-office and other automatic replies (in English, French, Spanish, German, Italian and Arabic), bounce notices, and senders that aren't a prospect you've emailed. An out-of-office reply leaves the sequence running.

Limits:
- It matches on the sender's address. If someone else at the company replies, use the button.
- Forwarded replies are stored in your Resend account.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Chat replies with a generic error; Railway logs show `404 model: ...` | The Anthropic key's workspace doesn't have that model. Confirm `GTM_AGENT_MODEL=claude-sonnet-5` and that the key's workspace has the Claude 5 family. |
| Chat error; logs show `relation "gtm_..." does not exist` | Migration `001` wasn't applied to the Supabase project this app points at. Re-run Part A2–A3. |
| Chat error; logs mention Supabase auth/`service role` | `SUPABASE_SERVICE_ROLE_KEY` or `NEXT_PUBLIC_SUPABASE_URL` is wrong/missing. Re-check Part A4. |
| Bubble shows on getautoura.net but the panel is blank / "refused to connect" | `GTM_ALLOWED_FRAME_ANCESTORS` on the **growth** app doesn't include the site origin, OR it was set *after* the build. Set it exactly as in Part B2 and **redeploy the growth app** (it's read at build time). |
| No bubble on getautoura.net at all | `NEXT_PUBLIC_GROWTH_WIDGET_URL` not set on **autoura-saas**, or autoura-saas wasn't redeployed after setting it. See Part C. |
| `/admin` returns 401 | Wrong password. Use the exact `ADMIN_ACCESS_TOKEN` value; leave username blank or type anything. |
| `/admin` returns 503 | `ADMIN_ACCESS_TOKEN` isn't set on the growth service. Add it (Part B2) and redeploy. |
| Lead shows `escalated` but no alert email arrives | Railway logs show `[escalation-alert] not sent …` (a variable is missing: `GTM_ESCALATION_EMAIL`, `RESEND_API_KEY`, or a sender) or `[escalation-alert] Resend 4xx …` (usually the sender isn't on a verified domain). Each lead alerts only once, so test with a new chat. Also check spam. |
| `/admin/outbound` says "Couldn't load … migration 002" | Migrations 002/003 weren't applied to this Supabase project. See F1. |
| LinkedIn shows `draft failed: … unusable after retry` | Claude twice wrote a note that broke a rule (too long, a link, a price or a placeholder). Click **Draft LinkedIn note** again, or write the note yourself on LinkedIn. If it's always "too long", check `LINKEDIN_NOTE_MAX_CHARS` isn't set very low. |
| A prospect's LinkedIn link is missing after import | Only `linkedin.com/in/…` and `linkedin.com/company/…` URLs are kept. Anything else in the `linkedin` column is dropped. |
| Enrich shows `research: failed` | Open the research details on the card for the error. Railway logs show `[enrichment] prospect … failed`. A `400` mentioning `web_search` or `web_fetch` means the Anthropic organization has web search/fetch turned off (enable it in the Claude Console's privacy/feature settings) or `GTM_AGENT_MODEL` is set to an older model that doesn't support these tools. |
| Enrich shows `research: no signal` | Nothing specific and verifiable was found, or the company couldn't be identified for sure. The notes say which. Add the company's `website` and **Re-enrich**, or write the signal yourself. |
| Draft button does nothing / prospect turns `failed` | Drafting calls Claude. Check Railway logs for the Anthropic error, same causes as the chat 404 above. |
| Approve shows `error: RESEND_API_KEY not configured` | `OUTBOUND_DRY_RUN=false` but no `RESEND_API_KEY`. Set it (F3), or go back to dry-run. |
| Approve shows `Resend 403` (or another `Resend 4xx`) mentioning the domain | `OUTBOUND_FROM_EMAIL` isn't on a domain Resend has verified. Finish F2 or fix the address. |
| Approve shows `error: OUTBOUND_UNSUB_SECRET is not configured` | Set it (F3), then click **Retry**. Every email needs a signed unsubscribe link. |
| Unsubscribe link points to the wrong host or `/api/unsubscribe` with no domain | `OUTBOUND_PUBLIC_BASE_URL` is missing or wrong (F3). |
| GitHub Action fails with `401` | The repo secret `CRON_SECRET` doesn't match Railway's, or isn't set (F5). |
| GitHub Action fails to connect / `404` | The URL in `outbound-followups.yml` doesn't match your Railway domain (F5). |
| Follow-ups never get drafted | No scheduler is running (F5), or the prospect's sequence isn't `active` (replied/stopped/opted out). Railway logs show `[sequencer] failed …` for drafting errors. |
| A reply didn't stop the sequence | Check Railway logs for `[reply-detection]`. **No line at all:** the forward isn't reaching Resend (check Resend → Emails → Receiving) or `email.received` isn't ticked on the webhook (F8). **`no_match`:** the sender doesn't match a prospect's email, or the forward replaced the sender with your own address (use Outlook's *Redirect*, F8). **`auto_reply`:** it looked like an out-of-office. In any of these cases, click **Replied → hand to concierge**. |
| Resend webhook deliveries return `401` | `RESEND_WEBHOOK_SECRET` doesn't match the endpoint's signing secret, or the event is older than 5 minutes (e.g. a delayed retry). |

---

## Appendix A — autoura-saas code changes (only if not already applied)

Three changes in the **autoura-saas** repo. If deploying from a fresh checkout that doesn't have them, apply exactly:

**1. New file `components/AutouraGrowthWidget.tsx`** — copy it verbatim from this repo's reference copy at [`docs/embed/AutouraGrowthWidget.tsx`](docs/embed/AutouraGrowthWidget.tsx) into autoura-saas at `components/AutouraGrowthWidget.tsx`.

**2. In `app/page.tsx`** — add the import next to the other imports:
```tsx
import AutouraGrowthWidget from '@/components/AutouraGrowthWidget'
```
and mount it just before the final closing `</div>` of the page's returned JSX:
```tsx
      {/* Autoura Growth — Inbound Concierge launcher (GTM widget) */}
      <AutouraGrowthWidget />
    </div>
  )
}
```

**3. In `.env.example`** — document the variable (optional but recommended):
```
NEXT_PUBLIC_GROWTH_WIDGET_URL=
```

Commit and deploy autoura-saas, then do Part C.

---

## Security notes

- `.env.local` is gitignored and is **not** in this repo — real keys live only in Railway's Variables. Never commit secrets.
- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `RESEND_WEBHOOK_SECRET` and `OUTBOUND_UNSUB_SECRET` are server-only secrets. If any was ever shared in plaintext (chat, email, screenshot), rotate it.
- The `gtm_` and `outbound_` tables have RLS enabled with no public policies, so the anon key can't read/write them — only the server (service-role) can.
