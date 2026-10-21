import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { AUDITED_TABLES } from '../src/lib/audit.ts'
import {
  AUDIT_OPERATIONS,
  PLATFORM_ENTITIES,
  auditHref,
  isAuditOperation,
  isFiltered,
  isPlatformEntity,
  readAuditFilter,
} from '../src/lib/platform/audit.ts'

/**
 * The founder panel's two new screens: the platform's audit log, and one customer's record.
 *
 * WHAT THIS FILE IS FOR. Both screens read tables a platform admin is allowed to read in full
 * — `audit_log`, `payments`, `billing_ledger` — which means the database will not stop either
 * of them from showing a founder something that belongs to a centre rather than to us. The
 * fence is the entity list in lib/platform/audit.ts, and this file is what keeps it standing:
 * one half asserts the list itself, the other reads the two pages and refuses a `.from()`
 * against a table that is not on it.
 *
 * THE FILTER HALF IS ORDINARY UNIT WORK, and it is here because every value in that URL is
 * passed to PostgREST: an entity that is not a table, or a cursor that is not a timestamp, is
 * not a filter that returns nothing — it is a request the database refuses, which the screen
 * would draw as an unreadable log. The parsing is pure, so it is tested rather than argued.
 *
 * THE SOURCE ASSERTIONS ARE THE BRITTLE HALF, and deliberately narrow: they name the few lines
 * that must survive any rewrite of those pages — the `.in('entity', …)`, the 404, the two
 * client components — rather than the layout around them.
 */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const AUDIT_PAGE = read('src', 'app', 'founder', 'audit', 'page.tsx')
const RECORD_PAGE = read('src', 'app', 'founder', '[centerId]', 'page.tsx')
const LIST_PAGE = read('src', 'app', 'founder', 'page.tsx')
const MONEY_PAGE = read('src', 'app', 'founder', 'money', 'page.tsx')
const HEALTH_PAGE = read('src', 'app', 'founder', 'health', 'page.tsx')
const ACCOUNTS_PAGE = read('src', 'app', 'founder', 'accounts', 'page.tsx')
const NAV = read('src', 'app', 'founder', 'nav.tsx')

/* -------------------------------------------------------------------------- */
/* The fence: which lines a founder's log may hold                             */
/* -------------------------------------------------------------------------- */

test('every platform entity is a table the database actually audits', () => {
  // The other direction is the failure that matters: an entity named here that no trigger
  // writes is a filter option that never returns a line, which reads as "we never did that".
  for (const entity of PLATFORM_ENTITIES) {
    assert.ok(
      (AUDITED_TABLES as readonly string[]).includes(entity),
      `${entity} is not in AUDITED_TABLES — the filter would never match a row`,
    )
  }
  assert.equal(new Set(PLATFORM_ENTITIES).size, PLATFORM_ENTITIES.length)
})

test('and it is the platform relationship, never a centre\'s own classroom', () => {
  // §10's log holds eighteen tables; a founder sees five. The nine below are the ones a
  // centre's owner reads about their own families, and a founder reading them is the leak
  // this panel exists to avoid.
  const theirs = [
    'students',
    'guardians',
    'fee_invoices',
    'fee_payments',
    'fee_scholarships',
    'attendance_records',
    'attendance_unlocks',
    'teachers',
    'teacher_permissions',
  ]
  for (const table of theirs) {
    assert.ok(
      !(PLATFORM_ENTITIES as readonly string[]).includes(table),
      `${table} belongs to a centre's own log`,
    )
  }

  // The positive half, so this test cannot be satisfied by an empty list.
  assert.deepEqual(
    [...PLATFORM_ENTITIES],
    ['coaching_centers', 'payments', 'payment_intents', 'subscriptions', 'center_members'],
  )
})

test('the two closed lists are closed, and say no to everything else', () => {
  assert.ok(isPlatformEntity('payments'))
  assert.ok(!isPlatformEntity('students'))
  assert.ok(!isPlatformEntity(''))
  assert.ok(!isPlatformEntity(7))
  assert.ok(!isPlatformEntity(null))

  assert.deepEqual([...AUDIT_OPERATIONS], ['created', 'updated', 'deleted'])
  assert.ok(isAuditOperation('updated'))
  assert.ok(!isAuditOperation('renamed'))
  assert.ok(!isAuditOperation(undefined))
})

/* -------------------------------------------------------------------------- */
/* The URL                                                                     */
/* -------------------------------------------------------------------------- */

/** A v4-shaped id, which is what a centre's `id` is. */
const CENTER = '3f1c9a2e-5b7d-4c81-9f60-2ab4d8e1c3f7'

test('a well-formed filter is read as written', () => {
  const filter = readAuditFilter({
    center: CENTER,
    entity: 'payment_intents',
    operation: 'created',
    before: '2026-10-10T04:31:12.481Z',
  })

  assert.deepEqual(filter, {
    centerId: CENTER,
    entity: 'payment_intents',
    operation: 'created',
    before: '2026-10-10T04:31:12.481Z',
  })
  assert.ok(isFiltered(filter))
})

test('a uuid is accepted whatever case it arrives in, and lower-cased', () => {
  // Postgres compares uuids case-insensitively, but the query string is compared by nothing:
  // the id is echoed back into the `<select>` and into the pager's links, and two spellings of
  // one customer in one form is how a filter appears not to stick.
  const filter = readAuditFilter({ center: CENTER.toUpperCase() })
  assert.equal(filter.centerId, CENTER)
})

test('junk in any one key is dropped, not refused', () => {
  // A bookmark somebody edited, and the failure that has to stay cheap: the whole log rather
  // than an error page.
  const filter = readAuditFilter({
    center: 'not-a-uuid',
    entity: 'students',
    operation: 'renamed',
    before: 'yesterday',
  })

  assert.deepEqual(filter, {
    centerId: null,
    entity: null,
    operation: null,
    before: null,
  })
  // Nothing is narrowed, so the Clear link is not drawn — a control that does nothing is worse
  // than no control.
  assert.ok(!isFiltered(filter))

  // And each key is independent: one bad value does not take the good ones with it.
  const mixed = readAuditFilter({ center: 'nope', entity: 'payments' })
  assert.equal(mixed.centerId, null)
  assert.equal(mixed.entity, 'payments')
})

test('an empty string is no filter, and a repeated key takes the first value', () => {
  assert.equal(readAuditFilter({ center: '', entity: '', before: '' }).centerId, null)
  assert.equal(readAuditFilter({ entity: ['payments', 'students'] }).entity, 'payments')
  assert.equal(readAuditFilter({}).before, null)
})

test('the cursor only ever moves the pager, so it does not count as a filter', () => {
  // `isFiltered` decides the Clear link. Being one page deep is not a narrowed list, and a
  // Clear beside it would throw away the customer the founder was looking at.
  const paged = readAuditFilter({ before: '2026-10-10T04:31:12.481Z' })
  assert.equal(paged.before, '2026-10-10T04:31:12.481Z')
  assert.ok(!isFiltered(paged))
})

test('the link builder round-trips through the parser it is read by', () => {
  const filter = readAuditFilter({
    center: CENTER,
    entity: 'coaching_centers',
    operation: 'updated',
  })

  assert.equal(
    auditHref(filter),
    `/founder/audit?center=${CENTER}&entity=coaching_centers&operation=updated`,
  )

  // A cursor is added without losing the filters — fifty lines deeper, still that customer.
  const older = auditHref(filter, { before: '2026-10-10T04:31:12.481Z' })
  const parsed = readAuditFilter(Object.fromEntries(new URL(older, 'https://x').searchParams))
  assert.deepEqual(parsed, { ...filter, before: '2026-10-10T04:31:12.481Z' })

  // And dropping it is "back to newest", which keeps everything else.
  assert.equal(auditHref(filter, { before: null }), auditHref(filter))

  // Nothing set is the bare address, so Clear is a link rather than a special case.
  assert.equal(auditHref(readAuditFilter({})), '/founder/audit')
})

/* -------------------------------------------------------------------------- */
/* The two pages, against the fence                                            */
/* -------------------------------------------------------------------------- */

test('the audit browser asks for the five entities and nothing else', () => {
  assert.match(AUDIT_PAGE, /\.in\('entity', \[\.\.\.PLATFORM_ENTITIES\]\)/)
  assert.match(AUDIT_PAGE, /pagePlatformAdmin\(\)/)
  // Every key the form offers reaches the query, and the cursor is strictly less-than so a
  // line is never repeated at the top of the next page.
  assert.match(AUDIT_PAGE, /\.eq\('coaching_center_id', filter\.centerId\)/)
  assert.match(AUDIT_PAGE, /\.eq\('entity', filter\.entity\)/)
  assert.match(AUDIT_PAGE, /\.eq\('operation', filter\.operation\)/)
  assert.match(AUDIT_PAGE, /\.lt\('created_at', filter\.before\)/)
  assert.match(AUDIT_PAGE, /readAuditFilter\(await searchParams\)/)
})

test('and reads no relation outside the fence', () => {
  // The names a founder may be shown on the browser: the log itself, the centres it names, and
  // the profiles behind an actor.
  assert.deepEqual(relationsIn(AUDIT_PAGE).sort(), [
    'audit_log',
    'coaching_centers',
    'profiles',
  ])
})

test('the record page reads one customer, and nothing of that customer\'s own', () => {
  assert.match(RECORD_PAGE, /pagePlatformAdmin\(\)/)
  // The 404 and the unreadable branch are different answers — see the note in the page.
  assert.match(RECORD_PAGE, /notFound\(\)/)
  // Every table it reads, and none of them is a student, a register or a fee board. The centre
  // table is here twice because the record reads it twice on purpose: the row, and then the one
  // optional column the chip needs. See the note on the read in the page — named together, a
  // database one migration behind fails the read the whole record depends on.
  assert.deepEqual(relationsIn(RECORD_PAGE).sort(), [
    'audit_log',
    'billing_ledger',
    'center_members',
    'coaching_centers',
    'coaching_centers',
    'profiles',
  ])
  assert.match(RECORD_PAGE, /select\(\s*'id, name, phone, bd_area, status, plan, created_at/)
  assert.doesNotMatch(RECORD_PAGE, /created_at, balance_poisha, charged_through, sms_credit_balance, trial_plan, trial_ends_at, account_kind/)
  // The trail behind one customer is fenced the same way the browser's is, not by a second
  // list that could drift from it.
  assert.match(RECORD_PAGE, /\.in\('entity', \[\.\.\.PLATFORM_ENTITIES\]\)/)
})

test('the record is reachable, and the actions on it are the panel\'s own', () => {
  // A customer's name opens the record — without this link the page is unreachable, which is
  // the one defect a source assertion can catch that a typecheck cannot.
  assert.match(LIST_PAGE, /href=\{`\/founder\/\$\{c\.centerId\}` as Route\}/)
  // And the money levers and the lockout form are the same two components the list mounts,
  // on the same id: a second implementation is a second thing to keep in step.
  assert.match(RECORD_PAGE, /<CenterBilling/)
  assert.match(RECORD_PAGE, /<StaffReset/)
  assert.match(RECORD_PAGE, /auditHrefFor\(account\.centerId\)/)
})

test('the three newer sections are panel reads, and the nav reaches all five', () => {
  // Growth is the roster plus the ledger plus the balances it holds; health is the
  // reconciliation, two queues and a call list; accounts is logins, centres and profiles.
  assert.deepEqual(relationsIn(MONEY_PAGE).sort(), [
    'billing_ledger',
    'coaching_centers',
  ])
  assert.deepEqual(relationsIn(HEALTH_PAGE).sort(), ['payment_intents'])
  assert.deepEqual(relationsIn(ACCOUNTS_PAGE).sort(), [
    'center_members',
    'coaching_centers',
    'profiles',
  ])

  // Every page is behind the panel's own door, and every one of them draws the nav — a section
  // nobody can reach is a section that does not exist.
  for (const page of [MONEY_PAGE, HEALTH_PAGE, ACCOUNTS_PAGE]) {
    assert.match(page, /pagePlatformAdmin\(\)/)
    assert.match(page, /<FounderNav here="(money|health|accounts)"/)
  }

  // The five sections and the five addresses are one list, so a renamed route cannot leave a
  // link behind pointing at a page that no longer exists.
  for (const href of ['/founder', '/founder/money', '/founder/health', '/founder/accounts', '/founder/audit']) {
    assert.ok(NAV.includes(`href: '${href}'`), `the nav does not offer ${href}`)
  }
  assert.equal([...NAV.matchAll(/href: '/g)].length, 5)
})

/** Every `.from('…')` in a file, as its relation name. Comments are not queries. */
function relationsIn(src: string): string[] {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...withoutComments.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]!)
}
