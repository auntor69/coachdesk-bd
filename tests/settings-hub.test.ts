/**
 * The settings hub: four groups, two columns, and fourteen rows that each still know
 * who is allowed to see them.
 *
 * WHAT THIS FILE IS GUARDING. The screen was thirteen identical rows in one column
 * 1,216px wide, in the order they had been written in — the payment number, the roster,
 * the batches, the subjects, the teachers, the log, the plan, all weighted the same and
 * all apparently unrelated. §20.2 asks for two levels and no more: a group, and the
 * pages inside it. So each row now carries a `group`, four headings draw the ones that
 * have rows, and the list is two columns from `xl`.
 *
 * `xl` and not `lg`: two columns at `lg` are 340px, less the row's own 32px of padding,
 * and the longest hint on the page wants more than the 308px that leaves.
 *
 * THE GATES ARE THE REAL SUBJECT. Every row on this screen is a door to something a
 * particular reader may or may not touch, and the redesign moved all of them.
 * §38: a `group` field must not have cost a single one of those conditions, and the
 * per-row `count: null` decisions — a dropped count draws no chip rather than a nought —
 * must survive too.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const PAGE = read('src', 'app', '(app)', 'settings', 'page.tsx')
const NAV = read('src', 'components', 'app-nav.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('the groups are two columns from xl and never from lg', () => {
  assert.ok(
    PAGE.includes('<div className="grid gap-5 xl:grid-cols-2 xl:items-start">'),
    'two columns, and the shorter group not stretched by the taller',
  )
  assert.doesNotMatch(PAGE, /lg:grid-cols-2/, '308px of hint is a squeeze, not a column')
  assert.doesNotMatch(PAGE, /grid-cols-3/, 'three of 1,216px is the lg squeeze again')

  // Source order is reading order, so nothing needs an `order-N` to be placed.
  assert.doesNotMatch(PAGE, /(?<=["\s`])order-\d/)
})

test('the four headings are drawn in one place and in one hand', () => {
  assert.deepEqual(
    [...PAGE.matchAll(/<HubSection heading=\{t\.groups\.(\w+)\}/g)].map((m) => m[1]),
    ['centre', 'people', 'teaching', 'records'],
    'what this centre is, who is in it, what is taught, what was written down',
  )
  assert.deepEqual(
    [...PAGE.matchAll(/items=\{inGroup\('(\w+)'\)\}/g)].map((m) => m[1]),
    ['centre', 'people', 'teaching', 'records'],
    'and each heading over its own rows, not the one beside it',
  )

  // THE TYPE TREATMENT IS THE SIDEBAR'S. Two voices for "this is a group of
  // destinations" is one voice too many, and nothing but this line notices the
  // sidebar's changing. Whitespace flattened, because both class lists wrap and
  // neither wraps in the same place.
  const flat = (source: string) => source.replaceAll(/\s+/g, ' ')
  const TYPE = 'text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint'
  assert.ok(flat(PAGE).includes(TYPE))
  assert.ok(flat(NAV).includes(TYPE), 'app-nav.tsx is where this came from')
  assert.ok(PAGE.includes('px-4 pb-1.5 text-[0.6875rem]'), 'inset to this screen rows')
})

test('a heading with nothing under it is not drawn at all', () => {
  // A teacher handed admissions holds rows in one of the four groups. Three headings
  // over nothing reads as three features being withheld.
  assert.equal(count(PAGE, 'if (items.length === 0) return null'), 2)

  const rows = PAGE.indexOf('function HubRows(')
  const section = PAGE.indexOf('function HubSection(')
  assert.ok(rows > 0 && section > rows, 'the rows, then the heading that wraps them')

  // The empty check in HubRows is what keeps the founder list from adding a gap to the
  // page of every customer, who has no founder row.
  assert.ok(PAGE.includes("<HubRows items={items.filter((item) => item.group === null)} />"))
  assert.ok(PAGE.includes('const inGroup = (group: HubGroup) =>'))
})

test('the row is one component now, and it is the row that was there before', () => {
  // Five call sites — four groups and the founder — and one piece of markup, so a
  // change to the row cannot reach four of them and miss the fifth.
  assert.equal(count(PAGE, '<li key={item.href}>'), 1)
  assert.ok(
    PAGE.includes(`className="flex items-center gap-3 rounded-xl border border-line
              bg-white px-4 py-3 transition-colors hover:border-brand-300"`),
  )

  // The chip is still absent rather than nought when a count did not arrive, and the
  // arrow is still hidden from a screen reader that has just read the label.
  assert.ok(PAGE.includes('{item.count !== null && ('))
  assert.ok(PAGE.includes('<span aria-hidden className="shrink-0 text-ink-faint">'))
  assert.ok(PAGE.includes('<p className="truncate text-sm text-ink-soft">{item.hint}</p>'))
})

test('the heading is the page bar, and the centre is named under it', () => {
  // One bar, and it owns the h1: the hub is where the nav sends people, so there is no
  // level above it and no crumb. `subtitle` rather than a second line inside a
  // hand-rolled band, because on a phone the title and the centre name on one line left
  // about nine characters for each.
  assert.equal(count(PAGE, '<PageHeader'), 1, 'one screen, one bar')
  assert.equal(count(PAGE, '<h1'), 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
  assert.ok(PAGE.includes('subtitle={session.active.centerName}'))

  // And the letterhead row it replaced is gone rather than left under the bar.
  assert.doesNotMatch(PAGE, /flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between/)
})

test('the credit balance is a fact in the bar, not a card of its own', () => {
  // One number in a white box 1,216px wide was the widest thing on the screen saying
  // the least. In the bar it reads as another fact about the centre, which it is.
  assert.doesNotMatch(PAGE, /<Card/, 'and the import went with it')
  assert.doesNotMatch(PAGE, /from '@\/components\/ui'/)

  assert.ok(PAGE.includes('{t.smsCredits}'))
  assert.ok(PAGE.includes('{session.active.smsCreditBalance}'))

  // Label and figure on one line: the bar is one line deep at `lg:min-h-14`, and every
  // sticky rail in the app starts at `top-16` below it.
  assert.ok(PAGE.includes('<p className="flex items-baseline gap-2">'))
  assert.ok(PAGE.includes('className="num text-xl font-bold text-ink"'), 'not 2xl — the h1')

  // Still the one door to the ledger, because that is where credits are bought, and
  // still tall enough to hit with a thumb on a phone.
  assert.equal(count(PAGE, 'href="/settings/sms"'), 1)
  assert.ok(PAGE.includes('{t.details}'))
  assert.ok(PAGE.includes('inline-flex min-h-tap items-center text-sm font-medium'))

  // And the whole block only for a reader who can spend them, in the bar's own slot. A
  // teacher is told the cost of the message in front of them on the send screen, which
  // is the only balance question they have.
  assert.match(PAGE, /actions=\{\s+staff && \(/)
  const band = PAGE.indexOf('staff && (')
  assert.ok(band > 0 && band < PAGE.indexOf('{t.smsCredits}'))
})

/* -------------------------------------------------------------------------- */
/* §38: thirteen rows, thirteen gates                                         */
/* -------------------------------------------------------------------------- */

test('every row carries a group and every group is one of the four', () => {
  const groups = [...PAGE.matchAll(/group: '(\w+)' as HubGroup/g)].map((m) => m[1])

  // Source order, which is also the order inside each group: the centre's own record
  // first, then the roster, and billing last of the four in `centre` — the balance is
  // what a dry centre opens. It is the only money row now: the plan row went with the
  // plan screen at §16.1 step 27, since two rows leading to one destination is not a hub.
  assert.deepEqual(groups, [
    'centre', // center
    'people', // students
    'teaching', // batches
    'teaching', // subjects
    'people', // teachers
    'people', // staff
    'people', // managers
    'centre', // branches
    'teaching', // exam-types
    'centre', // sms
    'records', // export
    'records', // activity
    'centre', // billing
  ])

  // Thirteen rows and thirteen groups, plus the founder's explicit null. A row that
  // slipped through without one would be filtered into no column and vanish. The billing
  // row's label comes from its own fragment (`billing.hubLabel`), which is why this stays
  // at thirteen rather than fourteen.
  assert.equal(count(PAGE, 'label: t.'), 13)
  assert.equal(count(PAGE, 'group: '), 16, 'thirteen, the null, the field and the helper')
  assert.equal(count(PAGE, 'group: null'), 1)
})

test('the billing row leads to the balance screen, and it is the only money row', () => {
  // §20.4 / step 27: the money screen is one screen now. It is a plain row in the centre
  // group with no count, and its words come from the screen's own fragment
  // (src/lib/i18n/billing.ts) so the two dictionaries are not touched — see that module
  // on why.
  assert.ok(PAGE.includes("href: '/settings/billing' as Route,"))
  assert.ok(PAGE.includes('label: billing.hubLabel,'))
  assert.ok(PAGE.includes('const billing = billingWords(locale)'))

  // And there is no plan row behind it. `settings/plan` is a redirect rather than a
  // screen (src/app/(app)/settings/plan/page.tsx), so a row pointing at it would be a
  // second door to this room.
  assert.ok(!PAGE.includes("href: '/settings/plan'"), 'the plan row outlived its screen')
})

test('the guard, the union and the two teacher permissions are unchanged', () => {
  assert.ok(PAGE.includes('const session = await pageCenter()'))
  assert.ok(PAGE.includes('const staff = isStaffAdmin(session)'))
  assert.ok(PAGE.includes('if (!staff && !mayStudents && !mayBatches) forbidden()'))
  assert.ok(PAGE.includes("const mayStaff = staff && can(session.active.capabilities, 'staff')"))

  // The two rows a teacher can be handed, each still gated on its own permission.
  assert.ok(PAGE.includes('...(mayStudents'))
  assert.ok(PAGE.includes('...(mayBatches'))

  // And the rest of the list still inside the manager-only spread.
  assert.ok(PAGE.includes('...(staffOnly'))
  assert.ok(PAGE.includes('staff ? staffCounts(supabase, session.active.centerId) : null'))
})

test('the plan and role gates on the six conditional rows are unchanged', () => {
  // Teachers: on the plan, or over its seats after a downgrade, or unreadable — the
  // last because a failed count cannot rule out the state the row exists for.
  assert.ok(
    PAGE.includes(`...(mayStaff &&
          (hasStaff(session.plan) ||
            staffOnly.teacherCount === null ||
            overStaffSeats(session.plan, staffOnly.teacherCount))`),
  )

  assert.ok(PAGE.includes("...(mayStaff && has(session.plan, 'staffManagement')"))
  assert.ok(
    PAGE.includes("...(has(session.plan, 'staffManagement') && session.active.role === 'owner'"),
    'managers: 20260811000061 made those rows writable by app.is_owner alone',
  )
  assert.ok(PAGE.includes("...(has(session.plan, 'multipleBranches')"))
  assert.ok(PAGE.includes("...(session.active.role === 'owner'"), 'the log is the owner own')
  assert.ok(PAGE.includes('...(session.isPlatformAdmin'))

  // The export row is shown to everybody and says which it is, because it can be
  // bought. The staff row is hidden, because a teacher plan will never have
  // colleagues at any price.
  assert.ok(PAGE.includes("hint: has(session.plan, 'exportReports')"))
  assert.ok(PAGE.includes('? t.exportsHint'))
  assert.ok(PAGE.includes(': t.exportsLocked,'))
})

test('the reads, the counts and the three payment answers are unchanged', () => {
  // Four queries in one round for a manager, none of them for a teacher.
  assert.equal(count(PAGE, ".eq('coaching_center_id', centerId)"), 3)
  assert.equal(count(PAGE, ".eq('coaching_center_id', session.active.centerId)"), 2)
  assert.ok(PAGE.includes("from('coaching_centers')"))
  assert.ok(PAGE.includes(".select('payment_wallet, payment_number')"))

  // A count as it came, `null` and all: a chip reading 0 beside Students on the hub of
  // a centre with three hundred is the one figure here an owner would act on.
  assert.ok(PAGE.includes('count: studentCount,'))
  assert.ok(PAGE.includes('count: batchCount,'))
  assert.ok(PAGE.includes('count: staffOnly.subjectCount,'))
  assert.ok(PAGE.includes('count: staffOnly.examTypeCount,'))
  assert.ok(PAGE.includes('count: staffOnly.teacherCount,'))
  assert.doesNotMatch(PAGE, /count: \w+ \?\? 0/)

  // And the payment hint still has an answer for a dropped read, distinct from the
  // answer for a centre that never set a number.
  assert.ok(PAGE.includes('const payHint = staffOnly?.centerError'))
  assert.ok(PAGE.includes('? t.payUnreadable'))
  assert.ok(PAGE.includes('t.feesGoTo(formatBdMobile(staffOnly.center.payment_number))'))
  assert.ok(PAGE.includes(': t.noPaymentNumber'))

  // §33: the batch cap was a sentence about the plan rather than the ceiling behind it,
  // and it left with the plan row. Asserted as an absence, so re-adding one without a
  // destination to put it on fails here instead of quietly reappearing.
  assert.ok(!PAGE.includes('capIsQuota'), 'the plan sentence is back')
  assert.ok(!PAGE.includes('planUnlimited'), 'the plan sentence is back')
})

/* -------------------------------------------------------------------------- */
/* And the words                                                              */
/* -------------------------------------------------------------------------- */

test('the four headings are written in both languages and are four things', () => {
  for (const d of [bn, en]) {
    const groups = [d.settings.hub.groups.centre, d.settings.hub.groups.people,
      d.settings.hub.groups.teaching, d.settings.hub.groups.records]
    for (const heading of groups) assert.ok(heading.length > 0)
    assert.equal(new Set(groups).size, 4, 'four headings, four nouns')
  }

  assert.notEqual(bn.settings.hub.groups.centre, en.settings.hub.groups.centre)
  assert.notEqual(bn.settings.hub.groups.records, en.settings.hub.groups.records)
})
