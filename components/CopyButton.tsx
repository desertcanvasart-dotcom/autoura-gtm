'use client'

import { useState } from 'react'

/** Copies `text` to the clipboard (used for LinkedIn notes a person pastes by hand). */
export default function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked: the note is still selectable on the page */
        }
      }}
      className="rounded-lg border border-warm-300 px-3 py-1.5 text-sm text-warm-700 hover:bg-warm-50"
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}
