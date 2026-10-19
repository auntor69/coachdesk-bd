import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { AUTH_COOKIE_MARKER, hasSessionCookie } from '../src/lib/auth/session-cookie.ts'

/**
 * The gate every request passes through, and the change that made it answer most of them
 * without a network call: a request with no session cookie is decided from the cookie list
 * alone, and one *with* a cookie still asks Supabase.
 *
 * WHY THIS FILE IS HALF UNIT TEST AND HALF SOURCE CHECK. `src/proxy.ts` imports
 * `next/server`, whose subpath does not resolve under `node --test` — the same reason the
 * other tests that care about that file (legal.test.ts, service-worker.test.ts) read it as
 * text. So the predicate is tested directly, and the wiring that makes it worth having —
 * the decision coming *before* the client is built — is asserted where it lives.
 *
 * AND THE THIRD CLAIM, which is the one that matters most and cannot be tested here at all:
 * a request that *does* carry a session behaves exactly as it did before, because it goes
 * down the untouched path (build the client, `getUser()`, refresh if expiring, redirect if
 * signed out). Nothing in this change can reach it: the new branch returns early only when
 * the cookie list says there is no session to find.
 */

const PROXY = readFileSync(path.join(process.cwd(), 'src', 'proxy.ts'), 'utf8')

test('a session cookie is recognised however @supabase/ssr chunks it', () => {
  // `sb-<ref>-auth-token`, and `.0`/`.1` once the blob outgrows one cookie. A whole-name
  // comparison passes every hand test and fails in production the first time a session
  // grew — which is to say, the first time somebody signed in properly.
  assert.equal(hasSessionCookie([{ name: 'sb-abcdefghijklmnop-auth-token' }]), true)
  assert.equal(hasSessionCookie([{ name: 'sb-abcdefghijklmnop-auth-token.0' }]), true)
  assert.equal(
    hasSessionCookie([{ name: 'cd_center' }, { name: 'sb-abcdefghijklmnop-auth-token.1' }]),
    true,
  )

  // And the other direction, which is the one that costs money when it is wrong in the
  // permissive direction: the app's own cookies are not credentials, and neither is a
  // cookie somebody invented.
  assert.equal(hasSessionCookie([]), false)
  assert.equal(hasSessionCookie([{ name: 'cd_center' }]), false)
  assert.equal(hasSessionCookie([{ name: 'auth' }]), false)
  assert.equal(AUTH_COOKIE_MARKER, '-auth-token')
})

test('the proxy decides from the cookie before it builds a client or calls Supabase', () => {
  // The whole saving, stated as an order: the predicate and its branch have to come
  // *before* `createServerClient(` and the `getUser()` under it. Moving the branch below
  // them would leave every signed-out request paying for the round trip it exists to skip,
  // and nothing else in the app would notice.
  const decided = PROXY.indexOf('hasSessionCookie(request.cookies.getAll())')
  const client = PROXY.indexOf('createServerClient(')
  const call = PROXY.indexOf('supabase.auth.getUser()')

  assert.ok(decided > -1, 'the proxy no longer asks whether a session cookie is present')
  assert.ok(client > -1 && call > -1, 'the proxy no longer builds the client / calls getUser')
  assert.ok(decided < client, 'the cookie decision comes after the client is built')
  assert.ok(client < call, 'getUser is called before the client that makes it exists')
})

test('a prefetch is answered without asking Supabase', () => {
  /*
   * The second cost lever in this file, and the same shape as the first: a request that
   * cannot learn anything from `getUser()` is decided without it. A prefetch is such a
   * request — Next issues it on its own for a `<Link>` that scrolled into view, and the
   * layout that renders it still verifies the session and still redirects. What the call
   * bought on that path was nothing; what it cost was one auth round trip per menu row,
   * in parallel with the navigation the reader actually asked for.
   *
   * ORDER MATTERS TWICE HERE. The branch has to come after the cookie decision (a request
   * with no cookie is already answered, and needs no client) and before `createServerClient`
   * — a branch below it would leave the round trip it exists to refuse.
   */
  const prefetch = PROXY.indexOf("headers.get('next-router-prefetch')")
  const client = PROXY.indexOf('createServerClient(')

  assert.ok(prefetch > -1, 'the proxy no longer looks for the prefetch header')
  assert.ok(
    PROXY.indexOf('hasSessionCookie(request.cookies.getAll())') < prefetch,
    'the prefetch branch has to come after the cookie decision, not replace it',
  )
  assert.ok(prefetch < client, 'the prefetch branch comes after the client is built')

  const branch = PROXY.slice(prefetch, client)
  assert.match(branch, /return NextResponse\.next\(\{ request \}\)/, 'a prefetch is served')

  // AND NEVER A REDIRECT. A 307 answering a prefetch is a redirect the router caches
  // against a destination nobody asked for, and the layout is what refuses a session on
  // this path — it does it in the same response, with a page that says so.
  assert.doesNotMatch(branch, /loginRedirect/, 'a prefetch must not be redirected from here')

  // The header Next actually sends, checked against this install rather than against a
  // memory of it: a Next upgrade that renamed it would turn the saving off silently, and
  // nothing else in the product would notice.
  const headers = readFileSync(
    path.join(process.cwd(), 'node_modules', 'next', 'dist', 'esm', 'client', 'components', 'app-router-headers.js'),
    'utf8',
  )
  assert.match(headers, /NEXT_ROUTER_PREFETCH_HEADER = 'next-router-prefetch'/, 'Next renamed the prefetch header')
})

test('both answers of that branch are the answers the round trip used to produce', () => {
  // A public route is served, and a private one goes to the login form carrying the page
  // that was asked for — the same two outcomes `!user && !isPublic` produced, which is the
  // only reason skipping the call is safe at all.
  assert.match(
    PROXY,
    /if \(!hasSession\) \{\s*return isPublic \? NextResponse\.next\(\{ request \}\) : loginRedirect\(request, pathname\)/,
  )

  // And the signed-out redirect is shared with the path that *does* ask Supabase, so the
  // two cannot drift: one helper builds the URL, including the query string the export
  // link needs.
  const helper = PROXY.indexOf('function loginRedirect(')
  assert.ok(helper > -1, 'loginRedirect is gone')
  assert.match(PROXY, /if \(!user && !isPublic\) return loginRedirect\(request, pathname\)/)
})
