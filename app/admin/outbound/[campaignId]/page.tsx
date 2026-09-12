import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCampaign, listProspects, listMessagesByProspect, type ProspectRow, type MessageRow } from '@/lib/outbound/db'
import { importCsvAction, draftAction, approveSendAction, suppressAction, markRepliedAction, stopSequenceAction } from '../actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DRY_RUN = process.env.OUTBOUND_DRY_RUN === 'true'

function StatusPill({ value }: { value: string }) {
  const color = {
    new: 'bg-warm-100 text-warm-600',
    drafted: 'bg-blue-100 text-blue-800',
    approved: 'bg-blue-100 text-blue-800',
    sent: 'bg-green-100 text-green-800',
    replied: 'bg-green-100 text-green-800',
    suppressed: 'bg-warm-200 text-warm-600',
    skipped: 'bg-warm-100 text-warm-500',
    failed: 'bg-red-100 text-red-700',
  }[value] || 'bg-warm-100 text-warm-600'
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{value}</span>
}

export default async function CampaignPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params
  const campaign = await getCampaign(campaignId)
  if (!campaign) notFound()

  const prospects = await listProspects(campaignId)
  const latestByProspect = await listMessagesByProspect(prospects.map((p) => p.id))

  const counts = prospects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/admin/outbound" className="text-sm text-brand hover:underline">← All campaigns</Link>
      <h1 className="mt-2 text-2xl font-semibold">{campaign.name}</h1>
      <p className="mt-1 text-sm text-warm-500">
        {prospects.length} prospect(s) · {Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ') || '—'}
      </p>

      {DRY_RUN && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          DRY-RUN mode is on — approving a message runs the full pipeline but sends no real email. Unset OUTBOUND_DRY_RUN to send.
        </div>
      )}

      {/* Import */}
      <section className="mt-6 rounded-lg border border-warm-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-warm-500">Import prospects (CSV)</h2>
        <p className="mt-1 text-xs text-warm-500">
          Header row required. Columns (aliases ok): <code>company, contact, email, role, destination, signal</code>. Only <code>email</code> is required. Suppressed + duplicate emails are skipped automatically.
        </p>
        <form action={importCsvAction} className="mt-3">
          <input type="hidden" name="campaign_id" value={campaign.id} />
          <textarea
            name="csv"
            rows={5}
            placeholder={'company,contact,email,destination,signal\nNile Star Tours,Mona,mona@nilestar.example,Egypt,"Public WhatsApp number on booking page; TripAdvisor review mentions slow quotes"'}
            className="w-full rounded-lg border border-warm-300 p-3 font-mono text-xs outline-none focus:border-brand"
          />
          <button className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Import</button>
        </form>
      </section>

      <p className="mt-4 text-xs text-warm-500">
        Sequence: up to {campaign.max_touches} touches, {campaign.touch_interval_days} days apart. Follow-ups
        (Touch 2/3) are auto-drafted when due and wait here for your approval.
      </p>

      {/* Prospects */}
      <section className="mt-4 space-y-4">
        {prospects.map((p) => (
          <ProspectCard key={p.id} p={p} m={latestByProspect.get(p.id) || null} maxTouches={campaign.max_touches} />
        ))}
      </section>
    </main>
  )
}

function SeqPill({ value }: { value: string }) {
  const color = {
    active: 'bg-blue-50 text-blue-700',
    completed: 'bg-warm-100 text-warm-600',
    replied: 'bg-green-100 text-green-800',
    stopped: 'bg-warm-200 text-warm-600',
    bounced: 'bg-red-100 text-red-700',
    opted_out: 'bg-warm-200 text-warm-600',
  }[value] || 'bg-warm-100 text-warm-600'
  return <span className={`rounded px-2 py-0.5 text-xs ${color}`}>seq: {value}</span>
}

function ProspectCard({ p, m, maxTouches }: { p: ProspectRow; m: MessageRow | null; maxTouches: number }) {
  const hasDraft = m && m.status === 'draft'
  const isSent = p.status === 'sent' || (m && (m.status === 'sent' || m.status === 'dry_run'))
  const inSequence = p.current_touch >= 1 && ['active', 'completed'].includes(p.sequence_status)
  const dueText = p.next_touch_due_at ? `next touch due ${new Date(p.next_touch_due_at).toLocaleDateString()}` : ''

  return (
    <div className="rounded-lg border border-warm-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-warm-800">
            {p.company_name || '(no company)'} {p.contact_name ? `· ${p.contact_name}` : ''}
          </div>
          <div className="text-xs text-warm-500">
            {p.contact_email}{p.role_title ? ` · ${p.role_title}` : ''}{p.destination ? ` · ${p.destination}` : ''}
          </div>
          {p.signal && <div className="mt-1 text-xs text-warm-500"><span className="text-warm-400">signal:</span> {p.signal}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <SeqPill value={p.sequence_status} />
            <span className="text-xs text-warm-500">touch {p.current_touch}/{maxTouches}{dueText ? ` · ${dueText}` : ''}</span>
          </div>
        </div>
        <StatusPill value={p.status} />
      </div>

      {m && (m.subject || m.body) && (
        <div className="mt-3 rounded-md bg-warm-50 p-3">
          <div className="text-xs font-medium text-warm-600">Touch {m.touch_number} · Subject: {m.subject}</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-warm-800">{m.body}</div>
          {m.error && <div className="mt-2 text-xs text-red-600">error: {m.error}</div>}
          {isSent && <div className="mt-2 text-xs text-green-700">✓ {m.status}{m.resend_id ? ` (${m.resend_id})` : ''}</div>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!isSent && (
          <form action={draftAction}>
            <input type="hidden" name="prospect_id" value={p.id} />
            <button className="rounded-lg border border-warm-300 px-3 py-1.5 text-sm text-warm-700 hover:bg-warm-50">
              {hasDraft ? 'Re-draft' : 'Draft touch 1'}
            </button>
          </form>
        )}
        {hasDraft && (
          <form action={approveSendAction}>
            <input type="hidden" name="message_id" value={m!.id} />
            <button className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
              {DRY_RUN ? 'Approve (dry-run)' : 'Approve & send'}
            </button>
          </form>
        )}
        {!isSent && p.status !== 'suppressed' && (
          <form action={suppressAction}>
            <input type="hidden" name="email" value={p.contact_email} />
            <input type="hidden" name="prospect_id" value={p.id} />
            <input type="hidden" name="campaign_id" value={p.campaign_id} />
            <button className="rounded-lg border border-warm-300 px-3 py-1.5 text-sm text-warm-600 hover:bg-warm-50">Suppress</button>
          </form>
        )}
        {inSequence && (
          <>
            <form action={markRepliedAction}>
              <input type="hidden" name="prospect_id" value={p.id} />
              <input type="hidden" name="campaign_id" value={p.campaign_id} />
              <button className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100">
                Replied → hand to concierge
              </button>
            </form>
            <form action={stopSequenceAction}>
              <input type="hidden" name="prospect_id" value={p.id} />
              <input type="hidden" name="campaign_id" value={p.campaign_id} />
              <button className="rounded-lg border border-warm-300 px-3 py-1.5 text-sm text-warm-600 hover:bg-warm-50">Stop sequence</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
