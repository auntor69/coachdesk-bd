import type { Metadata } from 'next'

import { Logo } from '@/components/ui'
import { dict } from '@/lib/i18n'
import { OfflineRetry } from './retry'

/**
 * What an installed CoachDesk shows when it is opened with no signal.
 *
 * Served by public/sw.js in place of any document request that fails. Not reachable by
 * accident — nothing links here — but it is a real route because the worker has to be
 * able to fetch and cache it, and src/proxy.ts lists it as public because a worker
 * installing on the login screen has no session to fetch it with.
 *
 * READS NOTHING, AND THAT IS THE WHOLE DESIGN. This file is copied into a cache and
 * handed to whoever opens the app next — which on a shared phone in a coaching centre
 * is not always the person it was cached for. So: no session, no locale cookie, no
 * database. A page that greeted someone by the wrong teacher's name would be the least
 * of it.
 *
 * WHICH IS WHY IT IS IN BOTH LANGUAGES. Every other screen is in the reader's own
 * language, because every other screen knows who is reading. This one cannot: the
 * locale lives in a cookie, and reading it would bake one reader's choice into the copy
 * every future reader gets. Two short sentences in two languages is the honest answer,
 * and it is four lines of text on a page that exists to say one thing.
 *
 * The one thing in the cached bytes that does come from a cookie is `<html lang>`, which
 * the root layout sets from `readerLocale()` for every route in the app. That is why
 * this page is dynamically rendered rather than prerendered, and it is not worth
 * avoiding: `lang` decides how a screen reader pronounces the page and which font the
 * browser falls back to, so a stale one is imperfect for half the text and carries
 * nothing about anybody.
 */

export const metadata: Metadata = {
  title: 'CoachDesk',
  // Nothing to index: this is a cache artifact, and a search result reading "no
  // connection" would be a strange first impression of the product.
  robots: { index: false, follow: false },
}

export default function OfflinePage() {
  const bn = dict('bn').offline
  const en = dict('en').offline

  return (
    <div
      className="flex min-h-full flex-1 flex-col items-center justify-center gap-6
        px-6 py-16"
    >
      {/* The wordmark, because in `display: standalone` there is no address bar and
          nothing else on screen says which app this is. A teacher whose phone has
          just shown them a blank green page needs to know it is ours and not the
          launcher's. Text and CSS only — no image request to fail. */}
      <Logo className="text-base" />

      <div className="max-w-sm text-center">
        <h1 className="text-xl font-bold text-ink">{bn.title}</h1>
        <p className="mt-2 text-ink-soft">{bn.body}</p>

        {/* Under a rule rather than beside it: two languages stacked reads as a
            translation, two languages side by side reads as a layout bug on a
            360px screen. */}
        <div className="mt-5 border-t border-line pt-4">
          <p className="font-semibold text-ink">{en.title}</p>
          <p className="mt-1 text-sm text-ink-soft">{en.body}</p>
        </div>
      </div>

      {/* One label, in Bangla, and not one per language: it is a button, the whole app
          is Bangla-first, and two stacked buttons doing the same thing is a question
          the reader has to answer before they can leave. */}
      <OfflineRetry retry={bn.retry} stillOffline={bn.stillOffline} />
    </div>
  )
}
