// ============================================================================
// GET /api/unsubscribe?e=<email>&t=<hmac>  (PUBLIC — recipients click this)
// POST same (List-Unsubscribe one-click)
// ============================================================================
// Verifies the HMAC, adds the address to the permanent suppression list, and
// shows a plain confirmation. Public by design — must NOT be behind admin auth.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyUnsubToken } from '@/lib/outbound/unsubscribe-token'
import { addSuppression } from '@/lib/outbound/suppression'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(email: string, token: string): Promise<NextResponse> {
  if (!email || !token || !verifyUnsubToken(email, token)) {
    return htmlResponse('This unsubscribe link is invalid or expired.', 400)
  }
  try {
    await addSuppression(email, 'opt_out', 'One-click unsubscribe')
  } catch {
    return htmlResponse('Something went wrong. Please email us to be removed.', 500)
  }
  return htmlResponse("You've been unsubscribed. You won't receive further emails from us.", 200)
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  return handle(url.searchParams.get('e') || '', url.searchParams.get('t') || '')
}

// RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) sends a POST.
export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  let email = url.searchParams.get('e') || ''
  let token = url.searchParams.get('t') || ''
  if (!email) {
    try {
      const form = await req.formData()
      email = String(form.get('e') || email)
      token = String(form.get('t') || token)
    } catch {
      /* ignore */
    }
  }
  return handle(email, token)
}

function htmlResponse(message: string, status: number): NextResponse {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222;text-align:center">
<h2 style="color:#647C47">Autoura</h2><p style="font-size:16px;line-height:1.5">${message}</p></div>`
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
