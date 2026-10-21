import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

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
 */
const PUBLIC_ROUTES = ['/login', '/signup', '/onboarding', '/auth', '/offline', '/terms']

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
 * Renamed from `middleware` in Next 16 — the file convention is deprecated.
 * Runs on the Node.js runtime by default now, which is what @supabase/ssr wants.
 *
 * This only refreshes the session and bounces signed-out visitors. It is not
 * the security boundary: RLS is. Every server action re-checks the user, since
 * a matcher change here must never be able to silently open a door.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Before the Supabase client, not after: a token-authenticated request has no
  // cookie to refresh, and getUser() is a network round trip to the auth server.
  // The cron job would pay for it on every run and get nothing for it.
  if (TOKEN_ROUTES.some((route) => pathname.startsWith(route))) {
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
  // bounced to the login screen.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route))

  if (!user && !isPublic) {
    // The whole target, query string included. `pathname` alone was silently
    // dropping it twice over: the login URL kept a copy of the original
    // parameters — `clone()` carries them and only the pathname was replaced —
    // while `next` carried none of them, so signing in landed the reader on a
    // bare path. A download link is where that stops being cosmetic:
    // /api/export?kind=collections&month=… comes back as /api/export, which the
    // handler answers with "that is not a list we can produce". The login action
    // still refuses anything that is not a same-origin path, so a query string
    // riding along here cannot become an open redirect.
    const target = `${pathname}${request.nextUrl.search}`
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', target)
    return NextResponse.redirect(url)
  }

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
