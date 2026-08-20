/**
 * The 404, in the reader's own language.
 *
 * Two pages call `notFound()` — an exam and a batch that the query came back
 * empty for — and until this file existed both of them showed Next's built-in
 * "404: This page could not be found." A Bangla-reading teacher who taps a stale
 * link from a WhatsApp group got an English sentence in a font that isn't the
 * app's, which reads as the app being broken rather than the link being old.
 *
 * It renders in two quite different places, which is why it centres itself rather
 * than sitting at the top of a column like `forbidden.tsx` does:
 *
 *   - inside the shell, when a page in (app) calls `notFound()` — header and nav
 *     intact, so there is always a way onward
 *   - bare inside the root layout, because Next routes *any* unmatched URL here.
 *     A typo in a shared link lands on this with no session at all, hence the
 *     null-safe fall back to /login.
 *
 * What it deliberately does not say is *why* the thing is missing. RLS is what
 * makes those two queries come back empty, so a teacher asking for a batch at a
 * centre they don't belong to arrives here too — and "you do not have permission
 * to view this batch" would confirm the batch exists. Absent and forbidden look
 * identical from the outside on purpose. That is also why this is a separate
 * screen from `forbidden.tsx` rather than a shared one: 403 is reached only after
 * the reader's own role has been checked, so there it is safe to be specific.
 */
import Link from 'next/link'

import { getSession, homePathFor } from '@/lib/auth/session'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

export default async function NotFound() {
  // No guard, for the same reason forbidden.tsx has none: this screen is where a
  // reader lands when something else refused them, and a refusal on the refusal
  // screen has nowhere to go.
  const session = await getSession()
  const t = dict(session?.locale ?? DEFAULT_LOCALE).missing

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-2 text-ink-soft">{t.body}</p>
      </div>

      {/* Their own landing page, not '/'. The root redirects by role, so this
          would work either way — but a teacher who is sent to a URL that then
          bounces them somewhere else has been made to wonder twice. */}
      <Link
        href={session ? homePathFor(session) : '/login'}
        className="flex min-h-tap items-center rounded-xl bg-brand-600 px-5
          text-sm font-semibold text-white hover:bg-brand-700"
      >
        {t.home}
      </Link>
    </div>
  )
}
