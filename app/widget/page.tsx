// Standalone chat page, designed to be embedded via <iframe> on the marketing
// site. next.config.js sets `frame-ancestors` (GTM_ALLOWED_FRAME_ANCESTORS) for
// this route so it can be framed cross-origin.

import ChatWidget from '@/components/ChatWidget'
import WidgetBodyClass from './widget-body-class'

export const metadata = {
  title: 'Talk to Autoura',
  robots: { index: false, follow: false },
}

export default function WidgetPage() {
  return (
    <>
      <WidgetBodyClass />
      <main className="h-screen w-screen bg-transparent p-2 sm:p-3">
        <div className="mx-auto h-full max-w-md">
          <ChatWidget />
        </div>
      </main>
    </>
  )
}
