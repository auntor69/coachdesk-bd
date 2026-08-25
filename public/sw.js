/*
 * CoachDesk's service worker.
 *
 * There is exactly one reason this file exists, and it is worth being precise about
 * because a service worker is the easiest place in a web app to cause a data breach.
 *
 * THE PROBLEM IT SOLVES. `experimental.useOffline` (see next.config.ts) keeps a
 * navigation, a prefetch or a Server Action pending while the network is gone and
 * replays it when the network returns. That covers everything a teacher does *inside*
 * the app. What it cannot cover is a cold start: tapping the installed home-screen icon
 * with no signal is a full page load, there is no running JavaScript to keep anything
 * pending, and the browser shows its own error page. In `display: standalone` there is
 * no address bar and no reload button on that page, so the app looks dead and the only
 * way out is to close it. This worker answers that one request with a CoachDesk page
 * that says what is happening and that the half-marked register is still on the phone.
 *
 * WHAT IT MUST NEVER CACHE, AND WHY THAT IS NOT NEGOTIABLE.
 *
 * No HTML document. No RSC payload. No API response. Nothing that carries a session.
 *
 * This is a multi-tenant app whose rows are the names, phone numbers, attendance and
 * exam marks of children. A cache is keyed by URL and knows nothing about who was
 * signed in when it was filled. Coaching centre owners and teachers share phones — that
 * is normal here, not an edge case — so a cached /fees or /teach/<id> served to whoever
 * opens the app next is one centre's fee ledger, or one batch's minors, handed to
 * someone RLS would have refused. The database cannot help: no request is made.
 *
 * So the allow-list below is content-hashed build output and the icons, both of which
 * are the same bytes for every user in the country, plus one page with no user data on
 * it. Everything else is passed straight through to the network, untouched. If a future
 * change here starts caching a page "to make it faster offline", that is the change
 * that leaks a child's record, and no amount of speed is worth it.
 *
 * WHAT OFFLINE ATTENDANCE ACTUALLY LOOKS LIKE, so nobody expects this file to do it:
 * the register is opened while there is signal, every tap is written to localStorage by
 * src/lib/drafts.ts, the sheet survives the tab being discarded, and the save is a
 * Server Action that `useOffline` holds and replays. None of that needs a cached page.
 */

/**
 * Bump this when the offline page changes or the allow-list below does.
 *
 * The name is the cache. `activate` deletes every cache that is not this one, so a new
 * version is a clean slate — which matters more than reuse: the thing being kept is a
 * few kilobytes of CSS, and the thing being avoided is a stale offline page telling
 * someone something that stopped being true two releases ago.
 */
const CACHE = 'coachdesk-v1'

/**
 * The page every failed navigation lands on. Public — src/proxy.ts lists it, because a
 * worker installing on the login screen has no session to fetch it with — and it reads
 * nothing about anybody, which is what makes it the one document safe to keep.
 */
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // `reload` so this never picks up a copy the HTTP cache has been sitting on since
      // the last deploy. It is one request, once per version.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))
      // Take over without waiting for every tab to close. A fix to this file that only
      // arrives after an owner has quit the app is a fix that arrives in a week.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((name) => name !== CACHE)
          .map((name) => caches.delete(name)),
      )
      // Control the pages that are already open, so the tab that installed this is
      // covered too rather than only the next one.
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Anything that changes something on the server is none of this file's business. Every
  // Server Action is a POST, and `useOffline` is what holds those — intercepting one here
  // would put a cache in front of a fee payment.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Supabase, Google Fonts, an SMS gateway: other origins answer for themselves. This
  // also means a cross-origin response can never end up in the cache as an opaque blob.
  if (url.origin !== self.location.origin) return

  /*
   * Build output and icons: cache-first, and safe to be.
   *
   * Everything under /_next/static carries a content hash in its filename, so a URL that
   * matches once matches forever and a new build asks for new URLs. /icons holds four
   * PNGs of the letter ক. Neither depends on who is asking, which is the whole test.
   */
  if (
    url.pathname.startsWith('/_next/static/')
    || url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(cacheFirst(event))
    return
  }

  /*
   * A document the browser is navigating to — the cold start this file exists for.
   *
   * Network first and the response is never stored. On failure the offline page is
   * served in its place, with the original URL left alone: the address is still /teach,
   * so a reload once there is signal lands on the register rather than on a dead end.
   *
   * `mode === 'navigate'` is true only for a real document load. An in-app link is an
   * RSC fetch and falls through to the pass-through below, which is correct — those are
   * the requests `useOffline` retries, and one of them answered from a cache would be a
   * screen of somebody else's students.
   */
  if (request.mode === 'navigate') {
    event.respondWith(networkThenOfflinePage(request))
    return
  }

  // Everything else, deliberately: no respondWith, so the browser does exactly what it
  // would do if this file did not exist. RSC payloads, /api routes, the manifest.
})

async function cacheFirst(event) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(event.request)
  if (hit) return hit

  const response = await fetch(event.request)

  /*
   * Only a clean, same-origin 200 is kept. `type === 'basic'` excludes an opaque
   * cross-origin response, and `ok` excludes a 404 or a 500 — either of those stored
   * against an asset URL is a permanently broken stylesheet, and a hashed URL never
   * changes, so nothing would ever dislodge it.
   *
   * waitUntil rather than await: the response goes back now and the write finishes on
   * the worker's own time. Caught, because a full phone should slow nothing down and
   * break nothing.
   */
  if (response.ok && response.type === 'basic') {
    event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}))
  }

  return response
}

async function networkThenOfflinePage(request) {
  try {
    return await fetch(request)
  } catch (err) {
    const cached = await caches.match(OFFLINE_URL, { cacheName: CACHE })
    if (cached) return cached
    // Install must have failed. Rethrowing hands the browser back its own error page,
    // which is what it would have shown anyway — this worker's job is to be an
    // improvement or nothing, never a new way to fail.
    throw err
  }
}
