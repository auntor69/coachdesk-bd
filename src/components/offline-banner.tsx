'use client'

/**
 * The strip that appears the moment the network goes.
 *
 * Rendered from the root layout, so it is on every screen including /login — a signup
 * that silently does nothing is the worst first impression this product can make, and
 * before this the only signal was a button that stayed pressed.
 *
 * WHAT IT IS ACTUALLY FOR. `experimental.useOffline` holds a failed navigation or Server
 * Action and replays it when the connection returns, so nothing is lost — but nothing
 * *visible* happens either, and the honest reading of a frozen save button is that the
 * app is broken. Someone who believes that force-quits, and a force-quit is the one way
 * to lose a half-marked register that localStorage would otherwise have kept. So this
 * banner is not decoration: it is what stops the recovery mechanism from being defeated
 * by the user.
 *
 * The sentence is handed down from the server, which already knows the locale, rather
 * than looked up here — see lib/i18n's note on why there is no provider.
 */

import { useOffline } from 'next/offline'

export function OfflineBanner({ text }: { text: string }) {
  const offline = useOffline()

  if (!offline) return null

  return (
    /*
     * Fixed to the top, above the app's own sticky header (z-10) and its bottom nav.
     * Not inserted into the flow: this appears and disappears with the signal, and a
     * strip that pushes thirty register rows down and then pulls them back up moves
     * the row a teacher's thumb was heading for.
     *
     * print:hidden with the rest of the chrome. A receipt handed across a desk should
     * not carry a note about the phone's connection.
     */
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-30 bg-late px-4 py-1.5 text-center text-xs
        font-medium text-white print:hidden"
    >
      {text}
    </div>
  )
}
