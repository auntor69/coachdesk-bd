import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

/**
 * Where the confirmation email's link lands (§5.4).
 *
 * A Server Action cannot be the destination of an email link — the browser
 * arrives here with a GET, carrying no form state and no action id — so the
 * route exists to finish what the signup screen started. Two shapes reach it,
 * because two shapes of link can leave Supabase:
 *
 * - `?token_hash=…&type=signup` — what a custom template points at, and the
 *   shape the template shipped with this app uses beside the six-digit code.
 *   `verifyOtp` with a token hash needs no code challenge, no cookie from the
 *   original request, nothing but the link itself.
 * - `?code=…` — what Supabase's own verify page redirects with when the
 *   project's PKCE flow is in play. `exchangeCodeForSession` settles it against
 *   the verifier the signup call left in this browser's cookies.
 *
 * Both end the same way: the session cookie is set here, in the response to
 * this request, and the redirect to `/` lets the root router send the reader
 * where their session belongs — onboarding for a brand-new account, home for
 * an old one, login if neither half worked. `/` is public-safe by proxy config
 * (`/auth` is in PUBLIC_ROUTES) and self-corrects, which is why this route
 * never has to guess.
 *
 * The `type` is whitelisted rather than passed through: a query string is
 * attacker-controlled input like any other, and the four values listed are the
 * only ones a confirmation email of ours can ever carry.
 */
const LINK_TYPES = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change'])

export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const code = url.searchParams.get('code')

  const supabase = await createClient()

  if (code) {
    await supabase.auth.exchangeCodeForSession(code)
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (tokenHash && type && LINK_TYPES.has(type)) {
    await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change',
    })
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Nothing we can act on. The email may be stale, the link tampered with, or
  // the template older than this route — none of them the reader's problem to
  // diagnose, and the login screen answers all three the same way.
  return NextResponse.redirect(new URL('/login', request.url))
}
