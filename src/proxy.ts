import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { hasSessionCookie } from '@/lib/auth/session-cookie'

/**
 * Routes reachable without a session.
 *
 * /onboarding is here despite requiring a user: it is the destination right
 * after signup, and if the fresh auth cookie has not propagated by the time
 * this runs, a new owner would be bounced to /login seconds after creating
 * their account. The page itself redirects signed-out visitors, so nothing is
 * exposed — this only removes a race from the worst possible moment.
 *
 * /offline is here because public/sw.js has to be able to fetch it, and the worker may
 * install on the login screen — before anybody has signed in. A redirect to /login
 * cached as the offline fallback would mean an installed app opening with no signal
 * shows a login form it cannot submit. The page reads no session and no cookie by
 * design, precisely so that being public costs nothing; see its own note.
 *
 * /legal is here because it is the one public surface a stranger is *sent* to. Seven
 * documents — the prepaid terms above all — that the signup checkbox links to before an
 * account exists, and that the recharge screen's non-refundable line links to for an owner
 * whose balance has already run out. Behind a session check, the second of those would be
 * unreachable in exactly the state that makes it matter (MASTERPLAN.md §14.1). The pages
 * read no tenant data: every word is a constant in src/lib/legal.
 */
const PUBLIC_ROUTES = ['/login', '/signup', '/onboarding', '/auth', '/offline', '/legal', '/terms']

/**
 * Routes authenticated by a bearer token instead of a cookie.
 *
 * Kept separate from PUBLIC_ROUTES on purpose. These are not public — /api/cron
 * refuses any call whose Authorization header does not carry CRON_SECRET, and
 * refuses every call at all when that variable is unset. Listing them here says
 * only "do not apply the cookie rule", which is a different statement from "no
 * session needed", and the two should not be able to be confused by someone
 * adding a route to a list.
 *
 * Without this the redirect below is a real bug rather than an inconvenience: the
 * matcher catches /api/*, a cron request arrives with no cookie, and it would be
 * answered with a 307 to /login. Vercel Cron, GitHub Actions and pg_net all read
 * a 3xx as success, so the SMS queue would silently never drain and every report
 * would say the job ran fine.
 */
const TOKEN_ROUTES = ['/api/cron']

/**
 * `/login` carrying the whole target, query string included.
 *
 * `pathname` alone was silently dropping it twice over: the login URL kept a copy of the
 * original parameters — `clone()` carries them and only the pathname was replaced — while
 * `next` carried none of them, so signing in landed the reader on a bare path. A download
 * link is where that stops being cosmetic: /api/export?kind=collections&month=… came back
 * as /api/export, which the handler answers with "that is not a list we can produce". The
 * login action still refuses anything that is not a same-origin path, so a query string
 * riding along here cannot become an open redirect.
 */
function loginRedirect(request: NextRequest, pathname: string) {
  const target = `${pathname}${request.nextUrl.search}`
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', target)
  return NextResponse.redirect(url)
}

/**
 * Renamed from `middleware` in Next 16 — the file convention is deprecated.
 * Runs on the Node.js runtime by default now, which is what @supabase/ssr wants.
 *
 * This only refreshes the session and bounces signed-out visitors. It is not
 * the security boundary: RLS is. Every server action re-checks the user, since
 * a matcher change here must never be able to silently open a door.
 *
 * AND A REQUEST WITH NO SESSION COOKIE IS ANSWERED WITHOUT CALLING SUPABASE AT ALL, which
 * is the one cost lever this file has: it runs on every navigation, and most of what passes
 * through it has no session to check. See the note in the body, and lib/auth/session-cookie
 * for why the cookie's *name* is enough to make that call on.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Before the Supabase client, not after: a token-authenticated request has no
  // cookie to refresh, and getUser() is a network round trip to the auth server.
  // The cron job would pay for it on every run and get nothing for it.
  if (TOKEN_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next({ request })
  }

  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route))

  /*
   * NO SESSION COOKIE, NO ROUND TRIP.
   *
   * `getUser()` is a network call to the auth server, and this file was making it for
   * every request that reached it — including the ones with nothing to verify: a
   * signed-out visitor on /login, a crawler on a public page, the installed app's first
   * launch before anybody has signed in. The cookie is the only thing that call can find a
   * session behind, so its absence already answers the question, and the two branches
   * below are the same two the call produced: a public route is served, and a private one
   * is sent to /login carrying its whole target.
   *
   * What is skipped is the refresh — and a refresh has nothing to do here: a session that
   * does not exist cannot be renewed, and a request that carries no cookie has no expired
   * token to rotate. Deciding this from the cookie's *presence* rather than from its
   * contents is the point: reading the token to check an expiry would be a second place
   * that decides whether a session is valid, and the answer this file is allowed to give
   * is "ask Supabase", never "trust what I decoded".
   */
  const hasSession = hasSessionCookie(request.cookies.getAll())

  if (!hasSession) {
    return isPublic ? NextResponse.next({ request }) : loginRedirect(request, pathname)
  }

  /*
   * A PREFETCH IS A GUESS, AND A GUESS DOES NOT PAY FOR A ROUND TRIP.
   *
   * Next sends `next-router-prefetch` on the requests it issues on its own — a `<Link>`
   * that scrolled into view, before anybody clicked it (see app-nav.tsx's `DAILY`, which
   * is what keeps that list down to four). The proxy cannot refresh a session that is
   * not expiring and cannot decide anything a page will not decide again: the layout's
   * `getSession()` still calls `getUser()` and still redirects, and RLS still refuses.
   * What this call buys on a prefetch is nothing, and what it costs is one auth round
   * trip per menu row, in parallel with the navigation the reader actually asked for.
   *
   * A HINT IS NOT A BYPASS. Nothing is served here that a real navigation would not be
   * served: the same request is rendered by the same layout, which refuses a signed-out
   * or expired session exactly as it does on a click, and RLS still scopes every row. The
   * only thing skipped is this file's *redirect* decision for a request whose answer may
   * never be shown — and where Next does show a prefetched shell, that shell came from a
   * render that made the same refusal one layer down.
   *
   * The presence of the header is the test, not its value: this Next writes `1` for a
   * loading-boundary prefetch, `2` and `3` for the PPR strategies, and nothing at all on
   * a real navigation (`FetchStrategy.Full` in the segment cache).
   */
  if (request.headers.get('next-router-prefetch') !== null) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refreshes an expiring session so a teacher mid-attendance is never
  // bounced to the login screen. A cookie is not a session — it can be expired, revoked
  // or forged — so this is still the only thing that decides, for every request that has
  // one. See the note above for the requests that do not.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublic) return loginRedirect(request, pathname)

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, the PWA shell files, and images —
     * those must stay reachable offline without a session check.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
