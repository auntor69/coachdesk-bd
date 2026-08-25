import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

import manifest from '../src/app/manifest.ts'

/**
 * The PWA shell: public/sw.js, and the two files it is coupled to.
 *
 * WHY THIS IS A TEST AND NOT A BROWSER CHECK. The worker's central rule is a
 * negative — it must never put an HTML document, an RSC payload or an API response
 * in the cache — and a negative is exactly what a manual look at DevTools cannot
 * establish. Confirming the cache is clean on the four screens somebody happened to
 * open says nothing about the fifth. So the request table below is driven straight
 * through the real fetch handler and the cache is asserted to hold nothing but the
 * allow-list, every time the suite runs.
 *
 * What is at stake if that rule breaks is in sw.js's own preamble: a cache is keyed
 * by URL and knows nothing about who was signed in when it was filled, coaching
 * centre phones are shared, and the rows are minors' names, phones, attendance and
 * marks. A cached /fees served to whoever opens the app next is a breach that RLS
 * cannot prevent, because no request is made.
 *
 * The scope below is a fake rather than jsdom or a headless browser: a service
 * worker global is four objects wide — `self`, `caches`, `fetch`, `Request` — and a
 * fake is the only way to control the ones that matter (`Response.type` is read-only
 * in undici, `new Request('/offline')` throws on a relative URL, and no browser
 * automation can make a real network fail on demand).
 */

const ROOT = path.join(import.meta.dirname, '..')
const SW_SOURCE = readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8')

/** Not localhost, so a bug that hardcodes the dev origin cannot pass. */
const ORIGIN = 'https://coachdesk.app'

const CACHE = 'coachdesk-v1'

type ResponseType = 'basic' | 'opaque' | 'default'

type ResponseInit = {
  status?: number
  type?: ResponseType
  redirected?: boolean
}

/**
 * Only the four members sw.js touches: `ok`, `type`, `clone()` and — for install —
 * `redirected`. A real undici Response cannot stand in, because `type` is a
 * read-only getter that reports 'default' for anything constructed by hand, and
 * `type === 'basic'` is one of the two conditions guarding every cache write.
 */
class FakeResponse {
  body: string
  status: number
  type: ResponseType
  redirected: boolean

  constructor(body: string, init: ResponseInit = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.type = init.type ?? 'basic'
    this.redirected = init.redirected ?? false
  }

  get ok() {
    return this.status >= 200 && this.status < 300
  }

  clone() {
    return new FakeResponse(this.body, {
      status: this.status,
      type: this.type,
      redirected: this.redirected,
    })
  }
}

type RequestInit = {
  method?: string
  mode?: string
  cache?: string
}

/**
 * Relative URLs resolve against the worker's scope, which is what a service worker
 * does and what undici's Request refuses to do. `mode` is settable here because
 * `mode === 'navigate'` is the whole navigate branch and no fetch API lets a caller
 * set it.
 */
class FakeRequest {
  url: string
  method: string
  mode: string
  cache: string

  constructor(input: string, init: RequestInit = {}) {
    this.url = new URL(input, ORIGIN).href
    this.method = init.method ?? 'GET'
    this.mode = init.mode ?? 'cors'
    this.cache = init.cache ?? 'default'
  }
}

function keyOf(request: FakeRequest | string): string {
  return typeof request === 'string' ? new URL(request, ORIGIN).href : request.url
}

type NetFetch = (request: FakeRequest) => Promise<FakeResponse>

class FakeCache {
  entries = new Map<string, FakeResponse>()
  netFetch: NetFetch

  constructor(netFetch: NetFetch) {
    this.netFetch = netFetch
  }

  /** Browsers reject a non-2xx and a redirect. Both are how install goes wrong. */
  async add(request: FakeRequest) {
    const response = await this.netFetch(request)
    if (!response.ok) throw new TypeError(`cache.add: status ${response.status}`)
    if (response.redirected) throw new TypeError('cache.add: response redirected')
    await this.put(request, response)
  }

  async put(request: FakeRequest | string, response: FakeResponse) {
    this.entries.set(keyOf(request), response)
  }

  async match(request: FakeRequest | string) {
    return this.entries.get(keyOf(request))
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new FakeRequest(url))
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  netFetch: NetFetch

  constructor(netFetch: NetFetch) {
    this.netFetch = netFetch
  }

  async open(name: string) {
    let store = this.stores.get(name)
    if (!store) {
      store = new FakeCache(this.netFetch)
      this.stores.set(name, store)
    }
    return store
  }

  async keys() {
    return [...this.stores.keys()]
  }

  async delete(name: string) {
    return this.stores.delete(name)
  }

  async match(request: FakeRequest | string, options: { cacheName?: string } = {}) {
    const names = options.cacheName ? [options.cacheName] : [...this.stores.keys()]
    for (const name of names) {
      const hit = await this.stores.get(name)?.match(request)
      if (hit) return hit
    }
    return undefined
  }
}

type ExtendableEvent = {
  waitUntil(promise: Promise<unknown>): void
  settle(): Promise<unknown>
}

function extendable(): ExtendableEvent {
  const waits: Promise<unknown>[] = []
  return {
    waitUntil(promise) {
      waits.push(Promise.resolve(promise))
    },
    settle() {
      return Promise.all(waits)
    },
  }
}

type FetchEvent = ExtendableEvent & {
  request: FakeRequest
  respondWith(response: Promise<FakeResponse> | FakeResponse): void
  /** null when the worker did not intercept — the case most of these tests want. */
  responded(): Promise<FakeResponse> | null
}

function fetchEvent(request: FakeRequest): FetchEvent {
  const base = extendable()
  let responded: Promise<FakeResponse> | null = null
  return {
    ...base,
    request,
    respondWith(response) {
      responded = Promise.resolve(response)
    },
    responded() {
      return responded
    },
  }
}

type Worker = {
  caches: FakeCacheStorage
  /** Every URL the worker asked the network for, in order. */
  hits: FakeRequest[]
  calls: { skipWaiting: number; claim: number }
  dispatch(type: string, event: object): void
}

function loadWorker(netFetch?: NetFetch): Worker {
  const hits: FakeRequest[] = []
  const calls = { skipWaiting: 0, claim: 0 }

  const wrapped: NetFetch = async (request) => {
    hits.push(request)
    return (netFetch ?? (async (r) => new FakeResponse(`net:${keyOf(r)}`)))(request)
  }

  const cacheStorage = new FakeCacheStorage(wrapped)
  const listeners = new Map<string, ((event: object) => void)[]>()

  const scope = {
    location: { origin: ORIGIN },
    addEventListener(type: string, fn: (event: object) => void) {
      const existing = listeners.get(type) ?? []
      existing.push(fn)
      listeners.set(type, existing)
    },
    async skipWaiting() {
      calls.skipWaiting++
    },
    clients: {
      async claim() {
        calls.claim++
      },
    },
  }

  vm.runInNewContext(SW_SOURCE, {
    self: scope,
    caches: cacheStorage,
    fetch: wrapped,
    Request: FakeRequest,
    Response: FakeResponse,
    URL,
  })

  return {
    caches: cacheStorage,
    hits,
    calls,
    dispatch(type, event) {
      const fns = listeners.get(type)
      assert.ok(fns?.length, `sw.js registered no ${type} listener`)
      for (const fn of fns) fn(event)
    },
  }
}

async function cachedUrls(worker: Worker, name = CACHE) {
  const store = worker.caches.stores.get(name)
  if (!store) return []
  return (await store.keys()).map((request) => request.url).sort()
}

/** Installs the worker and settles it, which is the precondition for most tests. */
async function install(worker: Worker) {
  const event = extendable()
  worker.dispatch('install', event)
  await event.settle()
}

test('install caches the offline page, and only the offline page', async () => {
  const worker = loadWorker()
  await install(worker)

  assert.deepEqual(await cachedUrls(worker), [`${ORIGIN}/offline`])
  assert.equal(worker.hits.length, 1)
  assert.equal(worker.hits[0]?.url, `${ORIGIN}/offline`)
  // Bypassing the HTTP cache is the point of the `reload` in sw.js: without it a
  // new version can install the copy the browser has been holding since the last
  // deploy, so the cache-name bump buys nothing.
  assert.equal(worker.hits[0]?.cache, 'reload')
  assert.equal(worker.calls.skipWaiting, 1)
})

test('install fails loudly if /offline answers with a redirect to login', async () => {
  // What removing '/offline' from PUBLIC_ROUTES in src/proxy.ts looks like from
  // here. It has to reject: caching a login form as the offline page would give an
  // installed app opening with no signal a screen it cannot submit.
  const worker = loadWorker(async () =>
    new FakeResponse('login', { redirected: true }),
  )
  const event = extendable()
  worker.dispatch('install', event)

  await assert.rejects(event.settle(), /redirected/)
  assert.deepEqual(await cachedUrls(worker), [])
})

test('activate drops every other cache and claims open pages', async () => {
  const worker = loadWorker()
  const stale = await worker.caches.open('coachdesk-v0')
  await stale.put('/offline', new FakeResponse('an older promise'))
  await install(worker)

  const event = extendable()
  worker.dispatch('activate', event)
  await event.settle()

  assert.deepEqual(await worker.caches.keys(), [CACHE])
  assert.equal(worker.calls.claim, 1)
})

test('build output and icons are cached, then served without the network', async () => {
  const worker = loadWorker()
  const paths = [
    '/_next/static/chunks/310vm2bl3xxpt.js',
    '/_next/static/chunks/0ndmirri5qno8.css',
    '/_next/static/media/0b1792555a6d440e-s.p.0mbba7e7fye4a.woff2',
    '/icons/icon-192.png',
    '/icons/maskable-512.png',
  ]

  for (const asset of paths) {
    const event = fetchEvent(new FakeRequest(asset))
    worker.dispatch('fetch', event)
    const response = await event.responded()
    assert.ok(response, `${asset} was not intercepted`)
    assert.equal(response.body, `net:${ORIGIN}${asset}`)
    await event.settle()
  }

  assert.deepEqual(await cachedUrls(worker), paths.map((p) => `${ORIGIN}${p}`).sort())
  assert.equal(worker.hits.length, paths.length)

  // Second time round: answered from the cache, so the count above does not move.
  for (const asset of paths) {
    const event = fetchEvent(new FakeRequest(asset))
    worker.dispatch('fetch', event)
    assert.equal((await event.responded())?.body, `net:${ORIGIN}${asset}`)
  }
  assert.equal(worker.hits.length, paths.length)
})

test('nothing that can carry a session ever enters the cache', async () => {
  const worker = loadWorker()
  await install(worker)

  /*
   * One row per way a signed-in request reaches the worker. `navigate` is a document
   * load — tapping the icon, a reload, an external link. `cors` is everything the
   * running app fetches for itself: an RSC payload for an in-app link, a Server
   * Action's response, /api/export, the manifest.
   *
   * The network succeeds for all of them, which is the dangerous case: a failing
   * request has nothing to store.
   */
  const requests: FakeRequest[] = [
    new FakeRequest('/', { mode: 'navigate' }),
    new FakeRequest('/dashboard', { mode: 'navigate' }),
    new FakeRequest('/teach/8f2c1d40-0b6a-4f2e-9c11-77a3e5b1d904', { mode: 'navigate' }),
    new FakeRequest('/fees', { mode: 'navigate' }),
    new FakeRequest('/fees/reminders?stage=overdue', { mode: 'navigate' }),
    new FakeRequest('/exams/3a9f/marks', { mode: 'navigate' }),
    new FakeRequest('/settings/students/7c1e', { mode: 'navigate' }),
    new FakeRequest('/founder', { mode: 'navigate' }),
    new FakeRequest('/login?next=%2Ffees', { mode: 'navigate' }),
    new FakeRequest('/teach/8f2c1d40-0b6a-4f2e-9c11-77a3e5b1d904?_rsc=1a2b3'),
    new FakeRequest('/dashboard?_rsc=9f8e7'),
    new FakeRequest('/api/export?kind=collections&month=2026-08'),
    new FakeRequest('/api/cron'),
    new FakeRequest('/manifest.webmanifest'),
    new FakeRequest('/sw.js'),
  ]

  for (const request of requests) {
    const event = fetchEvent(request)
    worker.dispatch('fetch', event)
    const responded = event.responded()
    if (responded) {
      // Only a navigation may be answered at all, and only from the network.
      assert.equal(request.mode, 'navigate', `${request.url} was intercepted`)
      assert.equal((await responded).body, `net:${request.url}`)
    }
    await event.settle()
  }

  assert.deepEqual(await cachedUrls(worker), [`${ORIGIN}/offline`])
})

test('a Server Action is never intercepted, whatever it is posted to', async () => {
  const worker = loadWorker()
  await install(worker)

  const posts = [
    new FakeRequest('/fees', { method: 'POST', mode: 'cors' }),
    new FakeRequest('/teach/8f2c', { method: 'POST', mode: 'cors' }),
    // Method is checked before the allow-list, so even this stays out.
    new FakeRequest('/icons/icon-192.png', { method: 'POST' }),
    new FakeRequest('/', { method: 'POST', mode: 'navigate' }),
  ]

  for (const request of posts) {
    const event = fetchEvent(request)
    worker.dispatch('fetch', event)
    assert.equal(event.responded(), null, `${request.method} ${request.url}`)
  }

  assert.deepEqual(await cachedUrls(worker), [`${ORIGIN}/offline`])
  assert.equal(worker.hits.length, 1) // the install fetch, and nothing since
})

test('another origin answers for itself', async () => {
  const worker = loadWorker()
  await install(worker)

  const foreign = [
    'https://xyzcompany.supabase.co/rest/v1/students?select=*',
    'https://fonts.gstatic.com/s/hindsiliguri/v11/x.woff2',
    'https://api.smsprovider.com.bd/send',
    // The origin check comes first, so a path that looks like ours off-site is
    // still passed through — otherwise an opaque response could reach the cache.
    'https://cdn.example.com/icons/icon-192.png',
    'https://cdn.example.com/_next/static/chunks/evil.js',
  ]

  for (const url of foreign) {
    const event = fetchEvent(new FakeRequest(url))
    worker.dispatch('fetch', event)
    assert.equal(event.responded(), null, url)
  }

  assert.deepEqual(await cachedUrls(worker), [`${ORIGIN}/offline`])
})

test('a cold start with no network gets the offline page, at the original URL', async () => {
  const worker = loadWorker()
  await install(worker)

  const offlineNow = loadWorker(async () => {
    throw new TypeError('Failed to fetch')
  })
  // The cache survives a restart; the network does not. Reuse the filled store.
  offlineNow.caches.stores.set(CACHE, worker.caches.stores.get(CACHE)!)

  for (const target of ['/', '/teach/8f2c1d40-0b6a-4f2e-9c11-77a3e5b1d904', '/fees']) {
    const event = fetchEvent(new FakeRequest(target, { mode: 'navigate' }))
    offlineNow.dispatch('fetch', event)
    const response = await event.responded()
    assert.equal(response?.body, `net:${ORIGIN}/offline`)
  }

  // Still just the one document. Serving the fallback must not store the failure.
  assert.deepEqual(await cachedUrls(offlineNow), [`${ORIGIN}/offline`])
})

test('with no network and nothing cached, the browser gets its own error page back', async () => {
  // Install never completed. Rethrowing is what leaves the browser showing exactly
  // what it would have shown anyway — this worker is an improvement or nothing.
  const worker = loadWorker(async () => {
    throw new TypeError('Failed to fetch')
  })
  const event = fetchEvent(new FakeRequest('/', { mode: 'navigate' }))
  worker.dispatch('fetch', event)

  await assert.rejects(event.responded()!, /Failed to fetch/)
})

test('a broken or opaque asset response is returned but never stored', async () => {
  const cases: { path: string; init: ResponseInit }[] = [
    { path: '/_next/static/chunks/missing.js', init: { status: 404 } },
    { path: '/_next/static/chunks/boom.js', init: { status: 500 } },
    { path: '/icons/icon-192.png', init: { type: 'opaque' } },
    { path: '/icons/icon-512.png', init: { type: 'default' } },
  ]

  for (const { path: assetPath, init } of cases) {
    const worker = loadWorker(async (request) =>
      new FakeResponse(`net:${keyOf(request)}`, init),
    )
    const event = fetchEvent(new FakeRequest(assetPath))
    worker.dispatch('fetch', event)

    // Handed back, so nothing new breaks — a 404 is the server's answer to give.
    assert.equal((await event.responded())?.body, `net:${ORIGIN}${assetPath}`)
    await event.settle()

    // A hashed URL never changes, so a bad response stored against one is
    // permanent: a stylesheet that 404s until the cache name is bumped.
    assert.deepEqual(await cachedUrls(worker), [], `${assetPath} ${JSON.stringify(init)}`)
  }
})

test('src/proxy.ts keeps /offline reachable without a session', () => {
  // sw.js fetches this page at install, which can happen on the login screen before
  // anybody has signed in. The redirect test above is what breaking this costs.
  const source = readFileSync(path.join(ROOT, 'src', 'proxy.ts'), 'utf8')
  const routes = /const PUBLIC_ROUTES = \[([^\]]*)\]/.exec(source)
  assert.ok(routes, 'PUBLIC_ROUTES is no longer an array literal in src/proxy.ts')
  assert.match(routes[1]!, /'\/offline'/)

  // And the matcher has to let the shell files through unauthenticated too.
  for (const asset of ['manifest.webmanifest', 'sw.js', 'icons/']) {
    assert.ok(source.includes(asset), `the proxy matcher no longer exempts ${asset}`)
  }
})

test('every icon the app declares exists, at the size it claims', () => {
  const declared = manifest().icons ?? []
  assert.equal(declared.length, 3)

  // Not in the manifest: iOS ignores that file's icons entirely and reads
  // <link rel="apple-touch-icon">, which src/app/layout.tsx sets. A missing file
  // there is a home-screen icon of a screenshot of the page.
  const files = [
    ...declared.map((icon) => ({ src: String(icon.src), sizes: String(icon.sizes) })),
    { src: '/icons/apple-touch-icon.png', sizes: '180x180' },
  ]

  for (const { src, sizes } of files) {
    const bytes = readFileSync(path.join(ROOT, 'public', src.replace(/^\//, '')))
    assert.equal(
      bytes.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      `${src} is not a PNG`,
    )
    // IHDR is the first chunk by spec: width and height are big-endian at 16 and 20.
    const dimensions = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
    assert.equal(dimensions, sizes, `${src} is ${dimensions}, declared ${sizes}`)
  }
})
