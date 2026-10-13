/**
 * Whether a request carries a Supabase session cookie.
 *
 * THE QUESTION THE PROXY ANSWERS WITHOUT ASKING THE AUTH SERVER, and the whole reason it
 * can: `getUser()` is a network round trip, and the cookie is the only thing that call can
 * find a session behind. No cookie means no session, in every case, so the round trip is
 * skipped — which is most of the traffic through that file (a signed-out visitor on /login,
 * a crawler on a public page, the installed app's first launch).
 *
 * WHAT IT DELIBERATELY DOES NOT DO: read the token inside. The name says a session *may*
 * exist; whether it is valid is Supabase's answer and nobody else's, and a second place
 * that decoded a JWT to decide would be a second place to get it wrong. So the caller only
 * ever uses `false` to skip work — never `true` to grant anything.
 *
 * WHY A SUBSTRING AND NOT A NAME. @supabase/ssr stores the session as
 * `sb-<project-ref>-auth-token`, and splits it into `.0`, `.1` … once it outgrows one
 * cookie — so an equality check against the whole name passes every hand test and fails in
 * production the first time somebody signs in properly. Nothing else in this app writes a
 * cookie, and the marker names the library's own storage key.
 *
 * No imports, for the reason `./password.ts` gives: this is read on the hot path of every
 * request, and it is imported by tests under `node --test`, which resolves no tsconfig
 * paths.
 */

/** The piece every session cookie name carries, chunked or not. */
export const AUTH_COOKIE_MARKER = '-auth-token'

/**
 * True when at least one cookie looks like a session.
 *
 * Takes the cookie list rather than a request, so the caller and the test are the same
 * shape — `request.cookies.getAll()` is the only thing either of them passes.
 */
export function hasSessionCookie(cookies: { name: string }[]): boolean {
  return cookies.some((cookie) => cookie.name.includes(AUTH_COOKIE_MARKER))
}
