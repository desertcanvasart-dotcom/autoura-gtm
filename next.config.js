/** @type {import('next').NextConfig} */

// Security headers applied to every response (mirrors autoura-saas).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

// The chat widget is embedded via <iframe> on the marketing site, which is a
// DIFFERENT origin. `X-Frame-Options: SAMEORIGIN` would block that, and it
// can't express an allow-list — so /widget drops it and uses a CSP
// `frame-ancestors` directive instead. Configure the allowed embedders with
// GTM_ALLOWED_FRAME_ANCESTORS (space-separated origins). Defaults to 'self'
// only, so nothing embeds until you set it.
const frameAncestors = (process.env.GTM_ALLOWED_FRAME_ANCESTORS || "'self'").trim()

const nextConfig = {
  async headers() {
    return [
      {
        // Every route EXCEPT /widget gets the standard headers, including
        // X-Frame-Options: SAMEORIGIN. The negative-lookahead keeps this rule
        // from also matching /widget — otherwise Next.js would append
        // X-Frame-Options: SAMEORIGIN there too and browsers could refuse the
        // cross-origin embed despite the CSP below.
        source: '/((?!widget$|widget/).*)',
        headers: securityHeaders,
      },
      {
        // The widget must be cross-origin embeddable — no X-Frame-Options,
        // framing controlled entirely by CSP frame-ancestors.
        source: '/widget',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors};`,
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
