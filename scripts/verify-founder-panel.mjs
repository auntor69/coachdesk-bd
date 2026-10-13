#!/usr/bin/env node
/**
 * Renders the founder panel as an authenticated platform admin, and says what came back.
 *
 * WHY THIS EXISTS. Every screen in `/founder` is a Server Component behind `pagePlatformAdmin()`,
 * so the only way to know one renders is to fetch it with a real session — a typecheck proves the
 * props line up and nothing about what the database hands back at render time. The signed-out
 * probe (`curl /founder` → 307 to /login) proves the route exists and stops there: middleware
 * answers before the page is ever compiled.
 *
 * WHAT IT DOES, in order:
 *   1. creates a throwaway platform admin with a random password (never printed),
 *   2. signs in with it and mints the cookies `@supabase/ssr` itself would write — the same two
 *      cookies a browser session carries, so the pages see an ordinary authenticated request,
 *   3. fetches every panel path and checks the status, the words each screen has to draw, and the
 *      absence of Next's error shells,
 *   4. deletes the throwaway account in a `finally`, whatever happened.
 *
 * THE ACCOUNT IS ALWAYS DELETED, including when a check fails, and that is not tidiness: it holds
 * `is_platform_admin`, which is the whole door of this panel, and a harness that leaves one behind
 * on a red run leaves a stranger with a key. The failures are printed instead.
 *
 * IT WRITES TO THE DATABASE THE ENVIRONMENT POINTS AT, once, and undoes it. Run it against a
 * preview of the environment you mean to check:
 *
 *     node --env-file=.env.local scripts/verify-founder-panel.mjs
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error(
    'missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY',
  )
  process.exit(2)
}

/** The nav, which every panel screen must draw. `&` is escaped by React in the HTML. */
const NAV = ['Customers', 'Money &amp; growth', 'System health', 'Accounts &amp; staff', 'Audit log']

/** Every check, so one run reports all of them rather than dying on the first. */
const problems = []
const notes = []

const record = (ok, message) => {
  if (!ok) problems.push(message)
}

/**
 * Whether a word is DRAWN, as opposed to present in the page source.
 *
 * A Server Component that hands a dictionary to a client component serialises it into the flight
 * payload embedded in the HTML, so every label the component *could* draw is in the file whether
 * or not it drew it. The first version of this harness matched raw substrings and reported a
 * refusal that was not on the screen — the levers' "the balance could not be read" is passed as a
 * label, so it is in the props of every card that has levers at all.
 *
 * A RENDERED TEXT NODE OPENS WITH `>`, and the text after it is escaped for the browser while a
 * serialised prop is a JSON string (`\"unreadable\":\"…\"`). Matching `>word` rather than
 * `>word<` is what lets a marker be the start of a sentence — "Biggest bill" is the first two
 * words of an option whose text continues — without ever matching the props blob.
 */
const drawn = (html, text) => html.includes(`>${text}`)

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Kept outside the `try` so the `finally` can delete them even when an early step throws. */
const temporaryUserIds = []

/**
 * Creates an account, a profile with the admin flag the caller asks for, and a signed-in cookie
 * header for it. Shared by the two probes below so the non-admin path cannot drift from the admin
 * one — they are the same login, differing by a single column.
 */
async function signInAs({ isPlatformAdmin }) {
  const email = `founder-verify-${isPlatformAdmin ? 'admin' : 'member'}-${Date.now()}@coachdesk.invalid`
  // A uuid, because it never leaves this process: it goes to createUser and signInWithPassword in
  // memory and is never written to stdout, a file or a header.
  const password = `${randomUUID()}-Aa1`

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) {
    throw new Error(`could not create ${email}: ${created.error?.message}`)
  }
  temporaryUserIds.push(created.data.user.id)

  // The profile row is what `getUser()` plus `profiles_self_read` are read into. Without
  // `is_platform_admin` every panel page 404s, and without a row at all `getSession` is null.
  const profile = await admin.from('profiles').upsert({
    id: created.data.user.id,
    full_name: isPlatformAdmin ? 'Panel verification' : 'Ordinary member',
    locale: 'en',
    is_platform_admin: isPlatformAdmin,
  })
  if (profile.error) throw new Error(`could not create the profile row: ${profile.error.message}`)

  const signIn = await createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.session) {
    throw new Error(`sign-in failed for ${email}: ${signIn.error?.message}`)
  }

  // `@supabase/ssr` is the thing that decides the cookie names, the chunking and the encoding, so
  // it is asked to write them rather than imitated: a hand-rolled cookie that is one character of
  // base64 wrong is a request the app reads as signed out.
  const jar = new Map()
  const ssr = createServerClient(SUPABASE_URL, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value)
      },
    },
  })
  await ssr.auth.setSession({
    access_token: signIn.data.session.access_token,
    refresh_token: signIn.data.session.refresh_token,
  })

  // The session has to be one the app will accept, and it verifies the JWT against the auth
  // server rather than trusting the cookie — so this is the same call the pages make.
  const me = await ssr.auth.getUser()
  record(
    me.data.user?.id === created.data.user.id,
    `the minted session does not resolve to ${email}: ${me.error?.message ?? 'wrong user'}`,
  )

  return {
    email,
    cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
    cookieCount: jar.size,
  }
}

try {
  /* ---------------------------------------------------------------- */
  /* 0. Anything the last run left behind                              */
  /* ---------------------------------------------------------------- */


  /*
   * A sweep before the run, because this harness crashes as well as fails: a killed preview makes
   * `fetch` throw, and an account whose owning process died is an account nobody deletes. Emails
   * under this prefix are only ever this script's, so removing them at the start is the one place
   * that can be certain — the `finally` below covers every path that gets that far.
   */
  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const strays = (existing.data?.users ?? []).filter((u) => u.email?.startsWith('founder-verify-'))
  for (const stray of strays) {
    await admin.auth.admin.deleteUser(stray.id)
    notes.push(`removed a leftover account from an earlier run: ${stray.email}`)
  }

  /* ---------------------------------------------------------------- */
  /* 1. A throwaway platform admin, signed in                          */
  /* ---------------------------------------------------------------- */

  const admin_ = await signInAs({ isPlatformAdmin: true })
  const { cookie } = admin_
  record(admin_.cookieCount > 0, 'no auth cookies were written by @supabase/ssr')
  notes.push(`${admin_.email}: ${admin_.cookieCount} auth cookie(s)`)
  notes.push(`the session ${admin_.email} was signed in as the pages will read it`)


  /* ---------------------------------------------------------------- */
  /* 3. A customer with data behind it                                 */
  /* ---------------------------------------------------------------- */

  const centers = await admin.from('coaching_centers').select('id, name').order('name')
  if (centers.error) throw new Error(`could not read centres: ${centers.error.message}`)
  const list = centers.data ?? []

  // The centre with members, when there is one: the record page's staff section is a read of
  // `center_members` plus `profiles`, and a centre with nobody in it would not exercise it.
  const members = await admin.from('center_members').select('coaching_center_id').limit(500)
  const withStaff = new Set((members.data ?? []).map((row) => row.coaching_center_id))
  const center = list.find((row) => withStaff.has(row.id)) ?? list[0] ?? null

  notes.push(
    center === null
      ? 'no centres in this database — the list pages will draw their empty state'
      : `customer under test: ${center.name} (${center.id.slice(0, 8)}…), ${withStaff.size} centre(s) with staff`,
  )

  /*
   * The columns the panel reads, checked against the database this environment actually points
   * at.
   *
   * A LOCAL MIGRATIONS FOLDER IS NOT A DEPLOYED SCHEMA. The panel selects `account_kind` (from
   * 20260811000091) and `platform_settings` (same migration), and against a database that has not
   * had those migrations applied every read of them fails — which the record page draws as "could
   * not read this customer" and the list page swallows. That is a true statement about a broken
   * environment and a useless one about the code, so it is reported in its own words first.
   */
  const columnProbe = await admin
    .from('coaching_centers')
    .select('id, account_kind, balance_poisha, charged_through')
    .limit(1)

  /*
   * The two figures the levers are drawn from, for the customer under test.
   *
   * The card draws its refusal — "the balance and the line could not be read" — whenever either
   * of these is missing, so a red run needs to say whether the read failed or the row is empty.
   * They are a balance and a date, not a secret.
   */
  if (center !== null) {
    const money = await admin
      .from('coaching_centers')
      .select('balance_poisha, charged_through')
      .eq('id', center.id)
      .maybeSingle()
    notes.push(
      money.error
        ? `balance/line read failed: ${money.error.message}`
        : `balance_poisha=${money.data?.balance_poisha}, charged_through=${money.data?.charged_through}`,
    )
  }
  if (columnProbe.error) {
    notes.push(`SCHEMA DRIFT: coaching_centers.account_kind — ${columnProbe.error.message}`)
  }
  // The kind filter is withheld rather than drawn empty when its column is missing; this says
  // which of the two shapes was rendered, so a green run cannot hide a hidden control.
  notes.push(
    columnProbe.error
      ? 'the kind filter is withheld (account_kind unreadable)'
      : 'the kind filter is drawn',
  )
  /*
   * The trial lengths, read out rather than merely reached.
   *
   * THE VALUES ARE THE POINT, not the column names. `readPlatformSettings` answers a missing row
   * with zero days, deliberately, so "the read did not error" is satisfied as well by an empty
   * table as by 091's seeded row — and only one of those gives a signup a trial. The numbers are
   * printed so a green run says which shape it saw.
   */
  const settingsProbe = await admin
    .from('platform_settings')
    .select('teacher_trial_days, center_trial_days, institution_trial_days')
    .maybeSingle()
  if (settingsProbe.error) {
    notes.push(`SCHEMA DRIFT: platform_settings — ${settingsProbe.error.message}`)
  } else if (!settingsProbe.data) {
    notes.push('platform_settings has no row: every signup is granted a zero-day trial')
  } else {
    const s = settingsProbe.data
    notes.push(
      `trial days — teacher ${s.teacher_trial_days}, centre ${s.center_trial_days}, institution ${s.institution_trial_days}`,
    )
  }

  /*
   * The function the founder's money form calls, probed through PostgREST's own OpenAPI document
   * rather than called.
   *
   * CALLING IT WOULD BE THE TEST AND WOULD ALSO BE THE BUG: `founder_record_payment` writes a
   * receipt when its arguments are valid, so a probe with real-looking values would book money
   * against a customer to see whether the wiring compiles — and the service role would be refused
   * anyway, because the platform admin it checks for is a session claim.
   *
   * WHAT THIS HALF-CHECK CANNOT SEE, recorded because it already happened once: being listed is
   * reachability, not working. 20260811000092 shipped the function without the `price_version_id`
   * its `recharge` entry requires, so every real call raised 23514 while this line stayed green —
   * the panel drew, the spec agreed, and no balance ever moved. The write path itself is proven
   * behaviourally, against real Postgres, in `scripts/test-levers.mjs` (the `founder_record_payment`
   * section added with 20260811000093); a regression there fails that suite rather than this line.
   */
  const spec = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  })
  const specText = await spec.text()
  notes.push(
    specText.includes('founder_record_payment')
      ? 'founder_record_payment is reachable through the API (reachability only — the write path is tested in scripts/test-levers.mjs)'
      : 'founder_record_payment is NOT in the API spec — recording a payment will fail',
  )

  /* ---------------------------------------------------------------- */
  /* 4. Every path                                                     */
  /* ---------------------------------------------------------------- */

  await mkdir('/tmp/founder-panel', { recursive: true })

  /*
   * `must` is what the screen has to draw; `never` is what it must NOT fall back to. The second
   * half is the point of this harness as much as the first: every one of these screens has a
   * refusal it draws when a read fails — "the balance could not be read", "could not read this
   * customer" — and a refusals-only screen is a 200 with no error on it. A rendering failure in
   * this panel does not look like a crash, so it has to be looked for.
   */
  const paths = [
    {
      path: '/founder',
      must: [
        'Download CSV',
        'Biggest bill',
        'Gone quiet first',
        // The money card and its two levers, which are drawn from the centre's own columns:
        // these are what a database missing `account_kind` used to take down with it.
        'Money and plan',
        'Give them days',
        'Move the balance',
      ],
      never: [
        'The balance and the line could not be read',
        'No customer matches',
        'Could not read the list',
      ],
    },
    {
      path: '/founder/money',
      // "Money in is what customers recharged" is the first words of the table's own lead, so it
      // is a text node's opening; a marker taken from the middle of a sentence would fail on a
      // page that drew it.
      must: ['Six months', 'Burned', 'Balance held', 'Money in is what customers recharged', 'New'],
      never: ['The ledger could not be read'],
    },
    { path: '/founder/health', must: ['Waiting on us', 'What is waiting on us'], never: [] },
    { path: '/founder/accounts', must: ['Our team', 'Every login on every customer'], never: [] },
    {
      path: '/founder/audit',
      must: ['Every customer', 'This is our side of the record'],
      never: [],
    },
    ...(center === null
      ? []
      : [
          {
            path: `/founder/${center.id}`,
            must: [
              'The account',
              'The balance, entry by entry',
              'Who can get in',
              'What we have done',
              'Money and plan',
            ],
            never: ['Could not read this customer', 'Nothing has touched the balance yet'],
          },
        ]),
  ]

  for (const { path, must, never } of paths) {
    // A refused connection is a report, not a stack trace: the preview is a managed process and
    // "it is not running" is the most useful thing this harness can say about a failed run.
    let response
    let html
    try {
      response = await fetch(`${BASE}${path}`, {
        headers: { cookie, accept: 'text/html' },
        redirect: 'manual',
      })
      html = await response.text()
    } catch (error) {
      record(false, `${path} could not be fetched from ${BASE}: ${error.message}`)
      continue
    }

    record(response.status === 200, `${path} answered ${response.status}`)
    if (response.status !== 200) {
      notes.push(`${path}: ${html.slice(0, 240).replace(/\s+/g, ' ')}`)
      continue
    }

    // Next's error shells. A page that throws in a Server Component still answers 200 in dev, so
    // the status alone is not the check.
    for (const bad of ['Application error', 'Internal Server Error', 'This page could not be found']) {
      record(!html.includes(bad), `${path} rendered "${bad}"`)
    }
    record(
      !(html.includes('__next_error__') && /"digest"\s*:/.test(html)),
      `${path} carries a Next error digest`,
    )

    // The nav on every screen: a section nobody can reach is a section that does not exist.
    for (const word of NAV) record(drawn(html, word), `${path} does not draw the nav entry "${word}"`)
    for (const word of must) record(drawn(html, word), `${path} does not draw "${word}"`)
    for (const word of never) record(!drawn(html, word), `${path} fell back to "${word}"`)

    if (center !== null && path === `/founder/${center.id}`) {
      record(drawn(html, center.name), `the record does not name ${center.name}`)
      record(
        html.includes(`/founder/audit?center=${center.id}`),
        'the record does not link into the audit log for this customer',
      )
    }

    // Dumped to /tmp on every run, so a failure can be read rather than guessed at. It is the
    // rendered HTML of a screen that holds customer names, so it belongs in a scratch directory
    // and not in the repository.
    const dump = `/tmp/founder-panel${path.replaceAll('/', '_')}.html`
    await writeFile(dump, html)

    const links = [...html.matchAll(/href="\/founder\/([0-9a-f-]{36})"/g)].map((m) => m[1])
    notes.push(`${path} → 200, ${html.length} bytes, ${links.length} customer link(s) → ${dump}`)
    if (center !== null && (path === '/founder' || path === '/founder/accounts')) {
      record(links.length > 0, `${path} drew no customer links`)
    }
  }

  /* ---------------------------------------------------------------- */
  /* 5. And the door is still locked for everybody else                */
  /* ---------------------------------------------------------------- */

  const anonymous = await fetch(`${BASE}/founder`, { redirect: 'manual' })
  record(
    anonymous.status === 307 || anonymous.status === 302,
    `signed-out /founder answered ${anonymous.status} instead of redirecting`,
  )

  /*
   * And a signed-in account that is not a platform admin gets the 404 `pagePlatformAdmin`
   * answers — not the panel, and not an error page either. That account exists in the same table
   * as the one above, differing only in the flag, which is what makes this worth checking: the
   * door is the column and nothing else.
   */
  const member = await signInAs({ isPlatformAdmin: false })
  for (const path of ['/founder', '/founder/audit']) {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie: member.cookie, accept: 'text/html' },
      redirect: 'manual',
    })
    record(
      response.status === 404,
      `${path} answered ${response.status} for a signed-in account that is not a platform admin`,
    )
  }
} finally {
  /* ---------------------------------------------------------------- */
  /* 6. Nothing left behind                                            */
  /* ---------------------------------------------------------------- */

  for (const id of temporaryUserIds) {
    const gone = await admin.auth.admin.deleteUser(id)
    record(!gone.error, `could not delete a verification account: ${gone.error?.message}`)
    if (!gone.error) {
      // The profile row cascades with the account; asked anyway, because the cascade is a
      // migration's promise and this run is the only thing that checks it today.
      const left = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
      record(left.data === null, 'a profile row outlived its account')
    }
  }
  if (temporaryUserIds.length > 0 && problems.length === 0) {
    notes.push(`${temporaryUserIds.length} verification account(s) deleted`)
  }
}

for (const note of notes) console.log(`  · ${note}`)
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}
console.log('\nfounder panel: every page rendered for a platform admin')
