'use client'

/**
 * The retry link on /offline, and the one piece of that page that knows anything.
 *
 * WHY NOT `useOffline()` FROM next/offline, which this app enables and uses in the
 * banner. That hook learns the app is offline from an `offline` event or from a
 * framework fetch failing. Neither has happened here: this page was served from the
 * service worker's cache during a cold start that never reached the network, so no
 * fetch was made and no event fired — the browser was already offline before the page
 * existed. `useOffline()` would read `false` on the one screen in the app that is only
 * ever seen while offline.
 *
 * `navigator.onLine` is the opposite: wrong about a lot, but available immediately and
 * right about the case that matters — false means there is no network interface at all,
 * so there is nothing to retry yet. True means only that a network exists, which is why
 * the label below says "try again" rather than "you are back online".
 *
 * The read is a `useSyncExternalStore` for the same reason src/lib/drafts.ts is one:
 * `navigator` does not exist during the server render, so the value cannot come from a
 * useState initializer without a hydration mismatch, and reading it in an effect and
 * calling setState is what `react-hooks/set-state-in-effect` exists to stop.
 */

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function OfflineRetry({ retry, stillOffline }: {
  retry: string
  stillOffline: string
}) {
  const offline = useSyncExternalStore(
    subscribe,
    () => !window.navigator.onLine,
    // The server render, and the moment before hydration. `false` so the static HTML
    // in the cache carries the plain "try again" label: if the JavaScript never
    // arrives — an old cached page whose chunks a newer deploy replaced — what is left
    // on screen is a working link rather than a permanent "still no connection".
    () => false,
  )

  /*
   * A real anchor either way, and never a disabled control.
   *
   * `navigator.onLine` is false on some Android builds while data is working fine, and
   * a button that has decided it cannot be pressed is a trap with no way out of it on
   * a screen that has no address bar. So the label tells the truth and the link always
   * works; tapping it with no signal lands back here, which is annoying and honest.
   *
   * `<a>` rather than `<Link>`, and the lint rule below is disabled knowingly. This has
   * to be a real page load. A `<Link>` is a client-side navigation: it needs the router
   * hydrated, it fetches an RSC payload rather than a document, and with
   * `experimental.useOffline` on, that fetch is held pending for as long as there is no
   * signal — so the one button on the one screen that exists to escape being offline
   * would appear to do nothing at all. A document request is also what runs the service
   * worker's navigate branch, which is the thing that has to happen for the app to come
   * back. And it needs no JavaScript, which matters on a page that may be served from a
   * cache older than the chunks it asks for.
   */
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- see the note above
    <a
      href="/"
      className="flex min-h-tap items-center rounded-xl bg-brand-600 px-5 text-sm
        font-semibold text-white hover:bg-brand-700"
    >
      {offline ? stillOffline : retry}
    </a>
  )
}
