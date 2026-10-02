// ============================================================================
// WHATSAPP FORMATTING — concierge replies → WhatsApp-friendly plain text
// ============================================================================
// WhatsApp has its own light markup (*bold*, _italic_) and no link syntax, so
// markdown from the agent is converted; long replies are split under the
// 4096-character text limit.
// ============================================================================

/** WhatsApp's max text body length. */
export const WHATSAPP_TEXT_LIMIT = 4096

export function toWhatsAppText(markdown: string): string {
  return (
    markdown
      // [label](url) → "label: url" (or just the url when the label is the url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
        label.trim() === url ? url : `${label}: ${url}`
      )
      // **bold** / __bold__ → *bold*
      .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
      .replace(/__([^_\n]+)__/g, '*$1*')
      // headings → bold line
      .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
      // "- item" / "* item" bullets → "• item"
      .replace(/^\s*[-*]\s+/gm, '• ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** Split text into chunks ≤ limit, preferring paragraph, then line, then word breaks. */
export function splitForWhatsApp(text: string, limit = WHATSAPP_TEXT_LIMIT): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = window.lastIndexOf('\n\n')
    if (cut < limit * 0.5) cut = window.lastIndexOf('\n')
    if (cut < limit * 0.5) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = limit
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}
