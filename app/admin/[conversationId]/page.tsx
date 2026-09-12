import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getConversationDetail } from '@/lib/supabase/admin-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value || '—'}</dd>
    </div>
  )
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  const { conversation, messages } = await getConversationDetail(conversationId)

  if (!conversation) notFound()
  const lead = conversation.lead

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/admin" className="text-sm text-brand hover:underline">
        ← Back to all conversations
      </Link>

      <h1 className="mt-3 text-2xl font-semibold">
        {lead?.company_name || lead?.contact_name || 'Conversation'}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {conversation.source} · {conversation.status} · started{' '}
        {new Date(conversation.created_at).toLocaleString()}
        {conversation.page_url ? ` · from ${conversation.page_url}` : ''}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_1.2fr]">
        {/* Lead panel */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Lead record</h2>
          {lead ? (
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Contact" value={lead.contact_name} />
              <Field label="Email" value={lead.contact_email} />
              <Field label="Company" value={lead.company_name} />
              <Field label="Role" value={lead.role_title} />
              <Field label="Current system" value={lead.current_system} />
              <Field label="Destinations" value={lead.destinations} />
              <Field label="Business model" value={lead.business_model} />
              <Field label="Quotes / week" value={lead.quotes_per_week?.toString()} />
              <Field label="Qualification" value={lead.qualification} />
              <Field label="In ICP" value={lead.in_icp === null ? '—' : lead.in_icp ? 'Yes' : 'No'} />
              <Field label="Demo offered" value={lead.demo_link_surfaced ? 'Yes' : 'No'} />
              <Field label="Escalated" value={lead.escalated ? 'Yes' : 'No'} />
              <div className="col-span-2">
                <Field label="Top pain" value={lead.top_pain} />
              </div>
              {lead.escalation_reason && (
                <div className="col-span-2">
                  <Field label="Escalation reason" value={lead.escalation_reason} />
                </div>
              )}
              {lead.notes && (
                <div className="col-span-2">
                  <Field label="Notes" value={lead.notes} />
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No lead record.</p>
          )}
        </section>

        {/* Transcript */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Transcript ({messages.length})
          </h2>
          <div className="space-y-3">
            {messages.map((m) => {
              if (m.role === 'tool') {
                return (
                  <div key={m.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">🔧 tool:</span> {m.content}
                    {m.tool_calls ? (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-400">
                        {JSON.stringify(m.tool_calls, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                )
              }
              const isUser = m.role === 'user'
              return (
                <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                      isUser
                        ? 'rounded-br-sm bg-brand text-white'
                        : 'rounded-bl-sm border border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
