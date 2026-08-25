'use client'

/**
 * Registers public/sw.js, and unregisters it in development.
 *
 * Renders nothing. It is a component rather than a script tag because registration has
 * to happen after hydration — doing it inline in the document would race the app's own
 * first requests for the chunks the worker wants to cache.
 *
 * WHY DEV UNREGISTERS RATHER THAN JUST SKIPPING. The worker caches /_next/static
 * cache-first, which is correct for a build whose filenames carry a content hash and
 * catastrophic for `next dev`, where the same URL serves different bytes after every
 * edit: the page would keep rendering a version of the app from ten minutes ago and
 * nothing on screen would say so. Not registering in dev prevents that going forward,
 * but a worker registered once at localhost:3000 outlives the session that installed it
 * — including a worker installed by `next start` while testing this very feature, which
 * is the likeliest way to meet the problem. So dev actively tears it down. The Next docs
 * are explicit that offline behaviour must be tested with `next build && next start`,
 * and that is the only place this registers.
 */

import { useEffect } from 'react'

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      // Also drops the caches: an unregistered worker stops intercepting, but the
      // stale chunks it stored would still be there for the next `next start`.
      navigator.serviceWorker.getRegistrations().then(
        (regs) => regs.forEach((reg) => void reg.unregister()),
        () => {},
      )
      if ('caches' in window) {
        caches.keys().then((names) => names.forEach((n) => void caches.delete(n)), () => {})
      }
      return
    }

    /*
     * `updateViaCache: 'none'` so the browser always revalidates sw.js itself rather
     * than serving it from the HTTP cache — which, paired with the no-store headers in
     * next.config.ts, is what makes a fix to the worker reach a phone that already has
     * one. Without it a browser may hold a service worker script for up to 24 hours,
     * and a bug in a file whose whole job is caching is a bug that caches itself.
     *
     * Silent on failure. A refused registration — private browsing, storage disabled by
     * policy, an http:// origin on the local network — costs the offline fallback and
     * nothing else, and an error message about service workers means nothing to a
     * coaching centre owner.
     */
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {})
  }, [])

  return null
}
