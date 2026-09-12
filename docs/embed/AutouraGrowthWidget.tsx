'use client'

// ============================================================================
// Autoura Growth — Inbound Concierge launcher
// ============================================================================
// Floating chat bubble on the marketing site that opens the GTM concierge
// widget (served by the separate `autoura-growth` app) in an iframe. The
// concierge qualifies operators/DMCs evaluating Autoura and books demos.
//
// The widget lives in a DIFFERENT app/origin (deployed on Railway), embedded
// here via <iframe>. Set the URL with NEXT_PUBLIC_GROWTH_WIDGET_URL in this
// app's environment, e.g.:
//   NEXT_PUBLIC_GROWTH_WIDGET_URL=https://growth.getautoura.net/widget
//
// Until that env var is set, the launcher renders NOTHING (so it can never
// ship a broken frame). The growth app must also allow this origin to embed it
// via GTM_ALLOWED_FRAME_ANCESTORS (already set to getautoura.net there).
// ============================================================================

import { useState } from 'react'

const WIDGET_URL = process.env.NEXT_PUBLIC_GROWTH_WIDGET_URL || ''

export default function AutouraGrowthWidget() {
  const [open, setOpen] = useState(false)

  // Inert until the widget URL is configured — avoids a broken iframe in prod.
  if (!WIDGET_URL) return null

  return (
    <>
      {/* Chat panel */}
      <div
        aria-hidden={!open}
        style={{
          position: 'fixed',
          bottom: '96px',
          right: '20px',
          width: '400px',
          height: '600px',
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 130px)',
          zIndex: 2147483000,
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,0.22)',
          transformOrigin: 'bottom right',
          transition: 'opacity 160ms ease, transform 160ms ease',
          opacity: open ? 1 : 0,
          transform: open ? 'scale(1)' : 'scale(0.96)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <iframe
          src={WIDGET_URL}
          title="Talk to Autoura"
          style={{ width: '100%', height: '100%', border: 0 }}
          allow="clipboard-write"
          loading="lazy"
        />
      </div>

      {/* Launcher bubble */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close Autoura concierge chat' : 'Chat with the Autoura concierge'}
        aria-expanded={open}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          width: '60px',
          height: '60px',
          zIndex: 2147483001,
          borderRadius: '9999px',
          border: 0,
          cursor: 'pointer',
          background: '#0f766e',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(15,118,110,0.42)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 120ms ease, background 120ms ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#115e59')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#0f766e')}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </>
  )
}

function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
