import Link from 'next/link'
import { listConversations } from '@/lib/supabase/admin-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function StatusBadge({ value }: { value: string }) {
  const color =
    {
      qualified: 'bg-green-100 text-green-800',
      escalated: 'bg-amber-100 text-amber-800',
      disqualified: 'bg-slate-100 text-slate-600',
      abandoned: 'bg-slate-100 text-slate-500',
      active: 'bg-blue-100 text-blue-800',
    }[value] || 'bg-slate-100 text-slate-600'
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{value}</span>
}

export default async function AdminPage() {
  let rows: Awaited<ReturnType<typeof listConversations>> = []
  let loadError: string | null = null
  try {
    rows = await listConversations()
  } catch (err) {
    loadError = (err as Error).message
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">GTM Concierge — conversations &amp; leads</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review transcripts for claims drift and see the lead each chat generated.
          </p>
        </div>
        <div className="text-sm text-slate-500">{rows.length} conversation(s)</div>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn&apos;t load data: {loadError}
          <div className="mt-1 text-red-500">
            Check Supabase env vars and that migration 001 has been applied.
          </div>
        </div>
      )}

      {!loadError && rows.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          No conversations yet. Try the widget at <code className="text-slate-700">/widget</code>.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Company / Contact</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Qualification</th>
                <th className="px-4 py-3">Signals</th>
                <th className="px-4 py-3">Msgs</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">
                      {r.lead?.company_name || r.lead?.contact_name || '—'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.lead?.contact_email || (r.lead?.contact_name && r.lead?.company_name ? r.lead.contact_name : '')}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.source}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={r.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.lead?.qualification ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.lead?.escalated && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">escalated</span>
                      )}
                      {r.lead?.demo_link_surfaced && (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">demo offered</span>
                      )}
                      {typeof r.lead?.quotes_per_week === 'number' && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {r.lead.quotes_per_week}/wk
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.message_count}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/${r.id}`} className="font-medium text-brand hover:underline">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
