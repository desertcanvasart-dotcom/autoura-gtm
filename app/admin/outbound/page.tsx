import Link from 'next/link'
import { listCampaigns } from '@/lib/outbound/db'
import { createCampaignAction } from './actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function OutboundIndex() {
  let campaigns: Awaited<ReturnType<typeof listCampaigns>> = []
  let loadError: string | null = null
  try {
    campaigns = await listCampaigns()
  } catch (err) {
    loadError = (err as Error).message
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Outbound campaigns</h1>
          <p className="mt-1 text-sm text-warm-500">
            Import operators, draft personalized first touches, approve every send.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-brand hover:underline">
          ← Inbound / leads
        </Link>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn&apos;t load: {loadError}
          <div className="mt-1 text-red-500">Has migration 002 been applied to the GTM database?</div>
        </div>
      )}

      <form action={createCampaignAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-warm-200 bg-white p-4">
        <div className="flex-1">
          <label className="block text-xs uppercase tracking-wide text-warm-400">New campaign name</label>
          <input name="name" required placeholder="Egypt DMCs — Sept" className="mt-1 w-full rounded-lg border border-warm-300 px-3 py-2 text-sm outline-none focus:border-brand" />
        </div>
        <div className="flex-1">
          <label className="block text-xs uppercase tracking-wide text-warm-400">From (optional override)</label>
          <input name="from_email" placeholder="Islam Hussein <islam@outreach.getautoura.net>" className="mt-1 w-full rounded-lg border border-warm-300 px-3 py-2 text-sm outline-none focus:border-brand" />
        </div>
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Create</button>
      </form>

      {campaigns.length === 0 && !loadError && (
        <div className="rounded-lg border border-warm-200 bg-warm-50 p-8 text-center text-sm text-warm-500">
          No campaigns yet. Create one above.
        </div>
      )}

      <ul className="divide-y divide-warm-200 rounded-lg border border-warm-200">
        {campaigns.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <Link href={`/admin/outbound/${c.id}`} className="font-medium text-brand hover:underline">
                {c.name}
              </Link>
              <div className="text-xs text-warm-500">{new Date(c.created_at).toLocaleString()} · {c.status}</div>
            </div>
            <Link href={`/admin/outbound/${c.id}`} className="text-sm text-brand hover:underline">Open →</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
