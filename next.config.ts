import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Statically typed links. Stable in Next 16 — no longer under `experimental`.
   *
   * Worth the friction: this app is a set of role-scoped screens that link to
   * each other constantly, and a typo in an href is otherwise invisible until a
   * teacher taps it and gets a 404. A build-time failure is much cheaper than a
   * dead end discovered in a classroom.
   */
  typedRoutes: true,

  experimental: {
    /**
     * Lets a page call `forbidden()` and get a real 403 screen, instead of every
     * wrong-role visit throwing an unhandled error and rendering a 500.
     *
     * The screens are role-scoped and the roles overlap: the same person is an
     * owner at the centre they run and a teacher at the centre they visit, so a
     * bookmark, a stale tab, or a centre switch is enough to land a teacher on
     * /fees. Before this, that was a white error page.
     *
     * Experimental, and knowingly taken. If a future Next removes the flag,
     * `forbidden` disappears from `next/navigation` and this fails to compile —
     * loud, at build time, with `AuthError` still carrying the code needed to do
     * it another way. See `pageRole` in lib/auth/session.
     */
    authInterrupts: true,

    /**
     * Holds a request that had no network and replays it when the network returns,
     * instead of throwing. Covers navigations, prefetches, RSC fetches and — the
     * reason it is here — Server Actions.
     *
     * THIS IS THE OFFLINE ATTENDANCE FEATURE. A teacher marks thirty students in a
     * classroom on the ground floor of a building with one bar of Grameenphone. Every
     * tap is already written to localStorage by lib/drafts.ts, so the sheet survives
     * the tab being discarded. What was missing was the save: with no signal it threw,
     * the teacher saw an error, and the choice in front of them was to keep the phone
     * awake and keep tapping or to give up and use the paper register. Now the save
     * sits pending, retries on a stepped backoff, and goes through by itself when they
     * walk out to the corridor. Nothing is queued in our code and nothing is
     * reconciled — the request itself waits.
     *
     * WHAT HAD TO BE TRUE FIRST, and this is the part worth not forgetting: an
     * automatic retry is a double submit whenever the first request reached the server
     * and only its response was lost. Harmless for an upsert, permanent for money. So
     * 20260811000025 put an idempotency key on both payment tables and both money
     * actions answer a replayed submit with the receipt the first one wrote. Enabling
     * this flag before that migration existed would have turned a flaky connection
     * into duplicate payments that nobody can delete.
     *
     * Also exposes `useOffline()` — see components/offline-banner.tsx, and the
     * register's save label in (app)/teach/[batchId]/attendance-roster.tsx, which is
     * what stops a teacher force-quitting an app they think has frozen.
     *
     * Experimental, and knowingly taken. If a future Next removes the flag,
     * `next/offline` stops resolving and this fails to compile — loud, at build time.
     * What is lost then is the automatic retry, not the sheet: the draft in
     * localStorage is ours and does not depend on any of this.
     *
     * What it does not cover is a cold start with no signal — there is no running
     * JavaScript to hold anything. That is public/sw.js's one job.
     */
    useOffline: true,
  },

  /**
   * Two groups: the ordinary hardening every route should have had, and the three
   * headers a service worker specifically needs. Both are what the Next PWA guide
   * prescribes.
   *
   * The sw.js block is the load-bearing one. A service worker script that a browser is
   * allowed to cache is a bug that caches itself: the file's whole job is deciding what
   * is served from a cache, so a stale copy cannot be fixed by shipping a new one. Paired
   * with `updateViaCache: 'none'` at the registration in components/service-worker.tsx.
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Stops a browser from guessing a response is script when we said it was not.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // No framing at all. Nothing in this product is meant to be embedded, and a
          // fee board or an attendance register inside someone else's page is a
          // clickjack against a screen that takes money.
          { key: 'X-Frame-Options', value: 'DENY' },
          // A path can name a centre and a student id. Cross-origin requests get the
          // origin and no more.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ]
  },
}

export default nextConfig
