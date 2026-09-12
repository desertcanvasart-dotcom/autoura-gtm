// ============================================================================
// CONCIERGE GREETING
// ============================================================================
// The opening line the widget shows. Defined here (no server-only imports) so
// BOTH the client widget and the server agent use the exact same text — the
// agent needs to know what it already said, or it treats the user's first
// reply as context-free and answers oddly.
// ============================================================================

export const CONCIERGE_GREETING =
  "Hi — I'm the Autoura concierge. I work with tour operators and DMCs to see if Autoura fits how you quote today. To start: what are you running quoting on right now — WhatsApp + Excel, another system, or nothing formal yet?"
