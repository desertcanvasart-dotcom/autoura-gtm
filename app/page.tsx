import Link from 'next/link'

// Internal reference/demo page (noindexed). Shows the iframe embed snippet and a
// live preview of the widget. Not part of the marketing site.
export default function HomePage() {
  const embedSnippet = `<iframe
  src="https://YOUR-GROWTH-APP-DOMAIN/widget"
  title="Talk to Autoura"
  style="position:fixed;bottom:20px;right:20px;width:400px;height:600px;
         max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);
         border:0;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.18);z-index:2147483000;"
  allow="clipboard-write">
</iframe>`

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Autoura Growth</h1>
      <p className="mt-2 text-slate-600">
        GTM concierge service — qualifies operators/DMCs evaluating Autoura and books demos.
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          href="/widget"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Open widget
        </Link>
        <Link
          href="/admin"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Admin (transcripts &amp; leads)
        </Link>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Embed on the marketing site (iframe)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste this before <code>&lt;/body&gt;</code>. Set{' '}
          <code>GTM_ALLOWED_FRAME_ANCESTORS</code> to your marketing origin(s) first, or the
          browser will refuse to frame it.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
          {embedSnippet}
        </pre>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Live preview</h2>
        <div className="mt-3 h-[600px] max-w-md">
          <iframe src="/widget" title="Widget preview" className="h-full w-full rounded-2xl border-0" />
        </div>
      </section>
    </main>
  )
}
