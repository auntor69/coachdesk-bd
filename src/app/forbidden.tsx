/**
 * The 403 screen, rendered when a page calls `forbidden()` — see `pageRole` in
 * lib/auth/session.
 *
 * Rendered inside whatever layout is above the page that refused — so for every
 * screen in (app) it appears within the shell, keeping the header and the bottom
 * nav. That turns out to be what this screen wants: the nav bar shows the tabs of
 * the role the reader *does* have, and the centre switcher sits in the header, so
 * the most likely cause of landing here is also the fastest thing to undo.
 *
 * A Server Component, which matters: `forbidden.tsx` takes no props, so the only
 * way to write this in the reader's own language and point them at their own
 * landing page is to read the session here. `getSession` and not `pageRole` —
 * a guard on the screen that renders when a guard fails is a loop.
 */
import Link from 'next/link'

import { getSession, homePathFor } from '@/lib/auth/session'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

export default async function Forbidden() {
  const session = await getSession()
  const t = dict(session?.locale ?? DEFAULT_LOCALE).denied

  return (
    // No logo and no shell of its own: on every (app) screen this renders inside
    // the header that already carries one, and a second CoachDesk wordmark half a
    // screen below the first reads as a broken layout rather than a refusal.
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>

        {/* Only when we know which centre. A signed-out reader should have been
            redirected to /login long before this, but "no active centre" is a
            real state — a fresh account mid-onboarding — and a sentence with a
            hole in it is worse than one fewer sentence. */}
        {session?.active && (
          <p className="mt-2 text-ink-soft">{t.atCenter(session.active.centerName)}</p>
        )}

        <p className="mt-2 text-sm text-ink-faint">{t.askOwner}</p>
      </div>

      {/* Their own home, not '/'. A teacher sent to the dashboard would be
          refused again by the same check that sent them here. */}
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
