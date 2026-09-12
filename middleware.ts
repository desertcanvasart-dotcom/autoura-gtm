import { NextRequest, NextResponse } from 'next/server'

// Phase-1 admin gate: HTTP Basic auth over /admin using ADMIN_ACCESS_TOKEN as
// the password (any username). Not a full auth system — enough to keep the
// transcript/leads review page private. Swap for real auth when the GTM app
// grows. Uses the Edge runtime, so no Node APIs here.
export const config = { matcher: ['/admin/:path*'] }

export function middleware(req: NextRequest) {
  const token = process.env.ADMIN_ACCESS_TOKEN
  if (!token) {
    return new NextResponse('Admin access is not configured (set ADMIN_ACCESS_TOKEN).', {
      status: 503,
    })
  }

  const header = req.headers.get('authorization') || ''
  if (header.startsWith('Basic ')) {
    const decoded = atob(header.slice(6))
    const password = decoded.split(':').slice(1).join(':')
    if (safeEqual(password, token)) {
      return NextResponse.next()
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Autoura Growth Admin"' },
  })
}

// Constant-time-ish comparison to avoid trivial timing leaks.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
