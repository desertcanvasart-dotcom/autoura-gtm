# autoura-growth — Deployment Runbook

Hand this to whoever is deploying. It takes the **autoura-growth** GTM concierge widget from repo → live on **getautoura.net**. Follow the parts in order.

**What you're standing up:**
1. A **Supabase project** (dedicated to GTM — separate from the main app's).
2. The **autoura-growth** Next.js app, deployed on **Railway** (this repo).
3. A one-line change to the already-live **autoura-saas** app so the chat bubble appears on **getautoura.net**.

**Time:** ~30–45 min. **You'll need:** access to Railway, the GTM Supabase project, an Anthropic API key, and the autoura-saas Railway service.

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
   | `GTM_ESCALATION_EMAIL` | Where enterprise leads should be flagged, e.g. `hello@getautoura.net` |
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

---

## Part E — Things the owner maintains (not deploy steps)

- **Editing claims:** all product claims live in [`knowledge/product-truth.json`](knowledge/product-truth.json). Edit it and redeploy the growth app — no code changes needed. The CI test suite (`npm test`) fails if a price or the beta caveat drifts.
- **Weekly review:** check `/admin` transcripts for claims drift (the spec's zero-tolerance metric).
- **Rotating the admin password:** change `ADMIN_ACCESS_TOKEN` in Railway and redeploy.

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
- `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are server-only secrets. If either was ever shared in plaintext (chat, email, screenshot), rotate it.
- The `gtm_` tables have RLS enabled with no public policies, so the anon key can't read/write them — only the server (service-role) can.
