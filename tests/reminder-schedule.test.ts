import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  chaseDecision,
  chaseEmptyReason,
  CHASE_EMPTY_REASONS,
  countChasesDue,
  reminderStage,
  STAGE_ORDER,
  type ChaseTally,
} from '../src/lib/fees/reminder-schedule.ts'

/** Every case here is relative to this one due date, in Dhaka calendar days. */
const DUE = '2026-08-15'

test('nothing is asked of a family before the deadline is in sight', () => {
  // Four days out is not a reminder, it is an interruption. The invoice may not
  // even have been raised yet when the month started.
  assert.equal(reminderStage(DUE, '2026-08-01'), null)
  assert.equal(reminderStage(DUE, '2026-08-11'), null)
})

test('the pre-deadline nudge opens exactly three days out', () => {
  const soon = reminderStage(DUE, '2026-08-12')
  assert.equal(soon?.stage, 'soon')
  // The window opens on the 12th, so a reminder sent that day covers it.
  assert.equal(soon?.since, '2026-08-12')
  assert.equal(reminderStage(DUE, '2026-08-14')?.stage, 'soon')
})

test('the due date is its own stage, and it lasts a week', () => {
  assert.deepEqual(reminderStage(DUE, DUE), { stage: 'due', since: DUE, cycle: 0 })
  // Day six is still 'due': the deadline was missed by less than a week, and the
  // message a family should get is the deadline one, not an escalation.
  assert.equal(reminderStage(DUE, '2026-08-21')?.stage, 'due')
})

test('a week late is a new stage, dated from the day it opened', () => {
  const late = reminderStage(DUE, '2026-08-22')
  assert.equal(late?.stage, 'late')
  assert.equal(late?.since, '2026-08-22')
  assert.equal(late?.cycle, 0)
  // Still cycle 0 thirteen days later — one message, not fourteen.
  const still = reminderStage(DUE, '2026-09-04')
  assert.equal(still?.stage, 'late')
  assert.equal(still?.since, '2026-08-22')
})

test('after that it comes back every fortnight, forever', () => {
  // The stage the masterplan's three touchpoints do not have, and the one that
  // matters most: a family two months behind is on the fee board being counted
  // in the outstanding total, and without this nobody ever contacts them again.
  const first = reminderStage(DUE, '2026-09-05')
  assert.equal(first?.stage, 'owing')
  assert.equal(first?.cycle, 1)
  assert.equal(first?.since, '2026-09-05')

  const second = reminderStage(DUE, '2026-09-19')
  assert.equal(second?.cycle, 2)
  assert.equal(second?.since, '2026-09-19')

  // Half a year late. The cadence has not drifted: every `since` is due + 7 plus
  // a whole number of fortnights, which is what stops a family being chased on
  // two consecutive days as the arithmetic slides.
  const old = reminderStage(DUE, '2027-02-15')
  assert.equal(old?.stage, 'owing')
  assert.equal(old?.cycle, 12)
  assert.equal(old?.since, '2027-02-06')
})

test('the stages are one unbroken series with no day in a gap', () => {
  // The bug this rules out: an invoice that lands between two stages and is
  // therefore never chased at all. Walked day by day, from four days before the
  // deadline to a year after it, every day must belong to a stage whose window
  // opened on or before it.
  let day = '2026-08-12'
  for (let i = 0; i < 370; i++) {
    const window = reminderStage(DUE, day)
    assert.ok(window, `no stage on ${day}`)
    assert.ok(window.since <= day, `${day} claims a window opening ${window.since}`)
    const next = new Date(`${day}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    day = next.toISOString().slice(0, 10)
  }
})

test('a family never chased is chased at the first opportunity', () => {
  const d = chaseDecision({ dueDate: DUE, lastRemindedOn: null }, '2026-08-12')
  assert.equal(d.chase, true)
  assert.equal(d.stage, 'soon')
  assert.equal(d.daysLate, -3)
  assert.equal(d.held, null)
})

test('too early is not a hold — there is nothing to hold back', () => {
  // A screen has to tell "nothing is due today" apart from "something is due and
  // is being withheld", because only one of those is worth a line of
  // explanation. Before the window opens there is no stage and no hold.
  const d = chaseDecision({ dueDate: DUE, lastRemindedOn: null }, '2026-08-01')
  assert.equal(d.chase, false)
  assert.equal(d.stage, null)
  assert.equal(d.since, null)
  assert.equal(d.held, null)
  assert.equal(d.daysLate, -14)
})

test('one reminder per stage, and the same day counts as covered', () => {
  // The owner messaged them this morning; the screen must not ask again this
  // afternoon. This is the check that stops a page refresh from looking like a
  // new instruction.
  const covered = chaseDecision(
    { dueDate: DUE, lastRemindedOn: '2026-08-12' },
    '2026-08-12',
  )
  assert.equal(covered.chase, false)
  assert.equal(covered.held, 'covered')

  // Two days later, still inside the same stage, still covered.
  assert.equal(
    chaseDecision({ dueDate: DUE, lastRemindedOn: '2026-08-12' }, '2026-08-14').held,
    'covered',
  )
})

test('a new stage re-opens the door, and the schedule is never slowed by the cooldown', () => {
  // Chased on the day 'soon' opened; the due date is three days later, which is
  // exactly the cooldown. A schedule followed to the day must not be delayed by
  // the mechanism that exists to catch off-schedule chases.
  const d = chaseDecision({ dueDate: DUE, lastRemindedOn: '2026-08-12' }, DUE)
  assert.equal(d.chase, true)
  assert.equal(d.stage, 'due')
  assert.equal(d.held, null)
})

test('an off-schedule chase defers the next one instead of doubling it', () => {
  // The owner chased them the afternoon before the deadline, on their own
  // initiative. Overnight the 'due' stage opens. Without a cooldown the screen
  // would ask them to message the same family again the next morning — the
  // fastest way to teach a parent that these messages are noise.
  const held = chaseDecision({ dueDate: DUE, lastRemindedOn: '2026-08-14' }, DUE)
  assert.equal(held.chase, false)
  assert.equal(held.held, 'cooldown')

  // Deferred, not dropped. The stage stays open, so the message goes as soon as
  // three days have passed.
  assert.equal(
    chaseDecision({ dueDate: DUE, lastRemindedOn: '2026-08-14' }, '2026-08-16').held,
    'cooldown',
  )
  const later = chaseDecision({ dueDate: DUE, lastRemindedOn: '2026-08-14' }, '2026-08-17')
  assert.equal(later.chase, true)
  assert.equal(later.stage, 'due')
})

test('an invoice raised after its own due date is chased once, not once per stage', () => {
  // Real case, and the one strict day-matching gets wrong twice over: an owner
  // billing August in the middle of the month with a due date of the 10th, or a
  // register imported from paper. The invoice is born ten days late. It must
  // produce exactly one message, at the stage it is actually in — not three
  // catching up, and not none because no day matched.
  const born = chaseDecision({ dueDate: '2026-08-05', lastRemindedOn: null }, DUE)
  assert.equal(born.chase, true)
  assert.equal(born.stage, 'late')
  assert.equal(born.daysLate, 10)

  // Chased on the day it was raised. Nothing more until the fortnight is up.
  const after = { dueDate: '2026-08-05', lastRemindedOn: DUE }
  assert.equal(chaseDecision(after, '2026-08-20').held, 'covered')
  assert.equal(chaseDecision(after, '2026-08-25').held, 'covered')
  // due + 7 + 14 = 2026-08-26, the first day of the next fortnight.
  const next = chaseDecision(after, '2026-08-26')
  assert.equal(next.chase, true)
  assert.equal(next.stage, 'owing')
  assert.equal(next.cycle, 1)
})

test('a fortnight of silence produces one message, not fourteen', () => {
  // Walked across a whole 'owing' cycle: exactly one day in it may chase, and
  // logging that chase closes the rest.
  let chases = 0
  for (let i = 0; i < 14; i++) {
    const day = addDay('2026-09-05', i)
    if (chaseDecision({ dueDate: DUE, lastRemindedOn: '2026-09-05' }, day).chase) chases++
  }
  assert.equal(chases, 0)

  // And with no reminder ever logged, every one of those days would chase —
  // which is why the log, not the calendar, is what closes a stage.
  const unlogged = [...Array(14)].filter(
    (_, i) => chaseDecision({ dueDate: DUE, lastRemindedOn: null }, addDay('2026-09-05', i)).chase,
  ).length
  assert.equal(unlogged, 14)
})

test('a whole year of following the schedule sends a bounded number of messages', () => {
  // The end-to-end property that matters to a parent: simulate the screen being
  // opened every single day for a year and the reminder always being sent when
  // it says to. Three touchpoints plus a fortnightly follow-up caps out in the
  // twenties, and no two land within the cooldown of each other.
  const sent: string[] = []
  let day = '2026-08-01'
  for (let i = 0; i < 365; i++) {
    const d = chaseDecision({ dueDate: DUE, lastRemindedOn: sent.at(-1) ?? null }, day)
    if (d.chase) sent.push(day)
    day = addDay(day, 1)
  }

  // Three touchpoints and then a fortnightly follow-up: 27 messages across a
  // year of a family never paying, the last of them on 2027-07-24. Asserted as
  // an exact number because the useful failure is the one where a change to the
  // cadence quietly doubles what a parent receives.
  assert.equal(sent.length, 27)
  assert.deepEqual(sent.slice(0, 4), ['2026-08-12', '2026-08-15', '2026-08-22', '2026-09-05'])
  for (let i = 1; i < sent.length; i++) {
    const gap = Math.round(
      (Date.parse(`${sent[i]}T12:00:00Z`) - Date.parse(`${sent[i - 1]}T12:00:00Z`)) / 86_400_000,
    )
    assert.ok(gap >= 3, `${sent[i - 1]} then ${sent[i]} is ${gap} days`)
  }
})

test('a malformed due date cannot put a family in the chase list', () => {
  // due_date comes back nullable through the balances view, and the screen
  // substitutes today when it is missing. If a bad value ever reached here, the
  // safe direction is silence: a wrongly-timed message about money is worse than
  // a missed one, and the invoice is still visible on the fee board either way.
  const d = chaseDecision({ dueDate: '', lastRemindedOn: null }, DUE)
  assert.equal(d.daysLate, 0)
  // daysBetween returns 0 for an unparseable date, which lands on 'due' — the
  // one stage that cannot claim a deadline was missed.
  assert.equal(d.stage, 'due')
})

test('the count on the link is the number of rows the list will show', () => {
  // Two screens advertise this figure before the owner taps — the fee board and
  // the dashboard — and the worklist then renders its own rows. A number that
  // promises six and delivers four does not read as "two were unreachable"; it
  // reads as a broken tool. So the counter applies the schedule and the
  // reachability filter together, and this is the case that proves it.
  const today = '2026-08-22'
  const rows = [
    // A week late and never chased: the one row that plainly needs a message.
    { dueDate: DUE, lastRemindedOn: null, reachable: true },
    // Same stage, already dealt with this morning.
    { dueDate: DUE, lastRemindedOn: '2026-08-22', reachable: true },
    // Needs a message and there is no number to send it to. Counted would mean
    // the list is one shorter than the link promised.
    { dueDate: DUE, lastRemindedOn: null, reachable: false },
    // Next month's fee. Nothing is owed of this family yet.
    { dueDate: '2026-09-30', lastRemindedOn: null, reachable: true },
    // Inside 'due', chased yesterday — covered by that same stage.
    { dueDate: '2026-08-20', lastRemindedOn: '2026-08-21', reachable: true },
    // Three days out, never chased: the pre-deadline nudge, and the reason this
    // screen earns its place.
    { dueDate: '2026-08-25', lastRemindedOn: null, reachable: true },
    // A new stage opened overnight, but they were contacted yesterday — deferred
    // by the cooldown, not due today.
    { dueDate: '2026-08-22', lastRemindedOn: '2026-08-21', reachable: true },
  ]

  assert.equal(countChasesDue(rows, today), 2)

  // And row by row it is the same answer chaseDecision gives, which is what the
  // worklist buckets by. If these two ever disagree, one screen is lying.
  const byHand = rows.filter((r) => r.reachable && chaseDecision(r, today).chase)
  assert.equal(byHand.length, 2)
  assert.deepEqual(
    byHand.map((r) => r.dueDate),
    [DUE, '2026-08-25'],
  )
})

test('an empty board asks for nothing', () => {
  assert.equal(countChasesDue([], '2026-08-22'), 0)
})

test('the worklist is ordered oldest debt first', () => {
  // Not the order the stages occur in. An owner with twenty minutes should spend
  // them on the six-week-old debt, not on the friendly pre-deadline nudges.
  assert.deepEqual(STAGE_ORDER, ['owing', 'late', 'due', 'soon'])
})

/** A tally with nothing in it, so each case below only states what it is about. */
function tally(fields: Partial<ChaseTally> = {}): ChaseTally {
  return { owing: 0, due: 0, held: 0, waiting: 0, unreachable: 0, ...fields }
}

test('a worklist with rows in it explains nothing', () => {
  // The card does not appear at all, so there is no sentence to get wrong. Even
  // with every other counter loaded: one sendable row means there is work today.
  assert.equal(chaseEmptyReason(tally({ owing: 1, due: 1 })), null)
  assert.equal(
    chaseEmptyReason(tally({ owing: 40, due: 1, held: 12, waiting: 20, unreachable: 7 })),
    null,
  )
})

test('a centre with every fee paid is told so, plainly', () => {
  assert.equal(chaseEmptyReason(tally()), 'nothingOwed')
})

test('unreachable families are named before the screen says to relax', () => {
  // The bug this function was extracted for. Three families are weeks past their
  // deadline with no guardian number on file, so they were pulled out of the
  // schedule for a data reason — and the screen printed "the fees still owed have
  // not reached their deadline yet" directly above the card listing them by name.
  //
  // The owner's next move differs by answer: 'notDueYet' means close the app,
  // 'allUnreachable' means go and collect three phone numbers.
  assert.equal(
    chaseEmptyReason(tally({ owing: 3, unreachable: 3 })),
    'allUnreachable',
  )

  // And it outranks the other reassuring answer for the same reason.
  assert.equal(
    chaseEmptyReason(tally({ owing: 5, held: 4, unreachable: 1 })),
    'allUnreachable',
  )
  assert.equal(
    chaseEmptyReason(tally({ owing: 9, held: 3, waiting: 5, unreachable: 1 })),
    'allUnreachable',
  )
})

test('a family held back today is more worth saying than one due next month', () => {
  // Both are "nothing to do", but only one of them was due today. An owner who
  // messaged four families on Sunday and opens the screen on Monday wants to hear
  // that those four were counted, not that some other deadline is far off.
  assert.equal(chaseEmptyReason(tally({ owing: 4, held: 4 })), 'allRecent')
  assert.equal(chaseEmptyReason(tally({ owing: 10, held: 2, waiting: 8 })), 'allRecent')
})

test('money owed with no deadline in sight is the quiet case', () => {
  assert.equal(chaseEmptyReason(tally({ owing: 6, waiting: 6 })), 'notDueYet')
})

test('every reason is reachable, and the list of them is complete', () => {
  // CHASE_EMPTY_REASONS is what the dictionary test iterates to prove copy exists
  // for each one, so a reason present in the type but absent from the array would
  // ship a screen with no sentence on it. Each is produced here from a tally a
  // real centre can be in.
  const produced = new Set([
    chaseEmptyReason(tally()),
    chaseEmptyReason(tally({ owing: 2, unreachable: 2 })),
    chaseEmptyReason(tally({ owing: 2, held: 2 })),
    chaseEmptyReason(tally({ owing: 2, waiting: 2 })),
  ])
  assert.deepEqual([...produced].sort(), [...CHASE_EMPTY_REASONS].sort())
})

test('the four counters and the worklist account for every unpaid invoice', () => {
  // The invariant the page has to hold up for any of the above to mean anything:
  // the loop puts each outstanding row in exactly one of due / held / waiting /
  // unreachable, so `owing` is their sum. Rebuilt here from chaseDecision so a
  // change to the schedule that strands a row shows up as a failure.
  const today = '2026-08-22'
  const rows = [
    { dueDate: DUE, lastRemindedOn: null, reachable: true },
    { dueDate: DUE, lastRemindedOn: '2026-08-22', reachable: true },
    { dueDate: DUE, lastRemindedOn: null, reachable: false },
    { dueDate: '2026-09-30', lastRemindedOn: null, reachable: true },
    { dueDate: '2026-08-20', lastRemindedOn: '2026-08-21', reachable: true },
    { dueDate: '2026-08-25', lastRemindedOn: null, reachable: true },
    { dueDate: '2026-08-22', lastRemindedOn: '2026-08-21', reachable: true },
  ]

  const counted = tally({ owing: rows.length })
  for (const row of rows) {
    const decision = chaseDecision(row, today)
    if (!decision.stage) counted.waiting++
    else if (!decision.chase) counted.held++
    else if (!row.reachable) counted.unreachable++
    else counted.due++
  }

  assert.equal(counted.due + counted.held + counted.waiting + counted.unreachable, rows.length)
  assert.equal(counted.due, countChasesDue(rows, today))
  // Two sendable rows, so no card — and the tally the page builds agrees.
  assert.equal(chaseEmptyReason(counted), null)
})

/** Local so these tests do not lean on the module they are checking. */
function addDay(isoDate: string, delta: number): string {
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* And the screen's own shape                                                 */
/* -------------------------------------------------------------------------- */

const ROOT = path.join(import.meta.dirname, '..')
/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const PAGE = read('src', 'app', '(app)', 'fees', 'reminders', 'page.tsx')
const LIST = read('src', 'app', '(app)', 'fees', 'reminder-list.tsx')

/** Each anchor is an assertion: a changed span makes its `indexOf` -1. */
const GRID_AT = PAGE.indexOf(
  '<div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">',
)
const EMPTY_AT = PAGE.indexOf('if (emptyReason !== null) {')

const RENDER = PAGE.slice(GRID_AT)
const EMPTY = PAGE.slice(EMPTY_AT, GRID_AT)

const HEAD_AT = PAGE.indexOf('  const bar = (\n    <PageHeader')
const RAIL_AT = RENDER.indexOf(
  'className="contents lg:sticky lg:top-16 lg:order-2 lg:col-span-4 lg:flex',
)
const WORK_AT = RENDER.indexOf(
  '<div className="order-2 flex flex-col gap-3 lg:order-1 lg:col-span-8">',
)

const RAIL = RENDER.slice(RAIL_AT, WORK_AT)
const WORK = RENDER.slice(WORK_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('the worklist takes eight columns and what is at stake four beside it', () => {
  // Eight and not seven, measured: the English desktop chip trio — copy the message,
  // WhatsApp, copy the number — is about 409px, which wraps inside span-7's 401px at
  // the `lg` boundary and fits span-8's 461px. The rail's figure is a bare count.
  assert.ok(GRID_AT > 0, 'the grid is not the shape it was')
  assert.ok(HEAD_AT > 0, 'the letterhead is not the page bar')
  assert.ok(HEAD_AT < GRID_AT, 'the bar is written after the grid it sits above')
  assert.ok(RAIL_AT >= 0, 'the rail is not the shape it was')
  assert.ok(WORK_AT > RAIL_AT, 'the rail is not written before the list')

  assert.match(RAIL, /lg:col-span-4/)
  assert.match(WORK, /lg:col-span-8/)

  // The letterhead is the bar and the bar is above the grid, so nothing spans twelve
  // any more. A `col-span-12` cell would be a sticky box in a one-row containing block.
  assert.doesNotMatch(PAGE, /col-span-12/)
})

test('the rail is written first and drawn second, so a keyboard reaches it in three tabs', () => {
  // `order` moves nothing for a keyboard or a screen reader — the DOM does. Written
  // after the list, "add numbers" would be a hundred and twenty chips of tabbing away.
  assert.match(RAIL, /lg:order-2/)
  assert.match(WORK, /lg:order-1/)
  // Four blocks, not five: the letterhead was `order-1` and it is the bar now, so the
  // phone sequence renumbered down rather than starting at two.
  assert.deepEqual(ordersIn(RENDER), ['1', '2'])
  assert.deepEqual(ordersIn(PAGE), ['3', '4', '1', '2'])
})

test('the rail sticks, and nothing sticks on a phone', () => {
  // `lg:top-16` is the 56px page bar and 8px of air; the bar paints over this rail, so
  // `top-8` would tuck the count under it. The mobile header that would occlude it is
  // `lg:hidden`, and a second sticky thing on a phone fights the fixed nav.
  assert.match(RAIL, /lg:sticky lg:top-16/)
  assert.doesNotMatch(RENDER, /(?<!lg:)sticky/, 'something sticks on a phone')
})

test('the rail is `contents` on a phone, so its blocks interleave with the list', () => {
  // Below `lg` the wrapper generates no box, so the hero lands above the first row and
  // the two asides below the last one — the phone order, out of the same DOM.
  assert.match(RAIL, /className="contents lg:sticky/)
  assert.equal(PAGE.split('className="order-3 num text-sm text-ink-faint"').length - 1, 1)
  assert.equal(PAGE.split('<Card className="order-4">').length - 1, 1)

  // Drawn from the shared consts, so the empty screen and this one cannot disagree.
  for (const block of ['{counted}', '{missing}']) {
    assert.ok(RAIL.includes(block), `${block} is not in the rail`)
    assert.ok(!WORK.includes(block), `${block} is drawn beside the rows`)
  }
})

test('what is at stake is drawn once, in the rail, and never beside the rows', () => {
  // The fault the rail fixes: an owner working down forty families had the count and
  // the amount scroll away above the list, and the amount is what decides whether the
  // next twenty minutes are worth it.
  assert.match(RAIL, /className="num text-4xl font-bold">\{due\}/)
  assert.match(RAIL, /\{formatTaka\(atStake\)\} \{t\.atStake\}/)
  assert.equal(PAGE.split('{t.dueTitle}').length - 1, 1)
  assert.doesNotMatch(WORK, /t\.dueTitle|atStake|heldCount|unreachableTitle/)
})

test('all three shapes of the screen are titled by the same bar', () => {
  // One `PageHeader`, held in a const and put in each of the three returns — the two
  // refusals and the worklist. Written once is the point: the screen that failed used to
  // be the one whose heading went missing.
  assert.equal(PAGE.split('<PageHeader').length - 1, 1)
  assert.equal(PAGE.split('{bar}').length - 1, 3)
  assert.equal(PAGE.split('<h1').length - 1, 0, 'the bar owns the heading')
  assert.ok(PAGE.includes("back={{ href: '/fees', label: t.backToBoard }}"))
  assert.ok(PAGE.includes('subtitle={t.subtitle}'))

  // Each `{bar}` is a direct child of that screen's own tall column: a sticky box only
  // travels inside its containing block, so a wrapper of its own would pin it for about
  // 90px and then let it leave. The two refusals cap the card instead of the column, so
  // the bar reaches the workspace edges on all three.
  assert.equal(PAGE.split('<div className="flex flex-col gap-5">\n        {bar}').length - 1, 1)
  assert.equal(PAGE.split('<div className="flex flex-col gap-5">\n      {bar}').length - 1, 2)
  assert.doesNotMatch(PAGE, /lg:max-w-2xl/)
  assert.equal(PAGE.split('max-w-2xl').length - 1, 2, 'one cap per refusal, on the card')
})

test('the note about the missing payment number sits with the rows, once, above them', () => {
  // Every tap sends a real message from the owner's own handset, so this is a thing to
  // know before the first one — and in the list's own column, not the rail's.
  assert.ok(WORK.includes('d.chase.payUnreadable'))
  assert.equal(PAGE.split('d.chase.payUnreadable').length - 1, 1)
  assert.ok(WORK.indexOf('payUnreadable') < WORK.indexOf('<ReminderList'))

  // The early return below guarantees rows, so the old `groups.length > 0` guards are
  // gone: a note with no list under it is no longer reachable.
  assert.doesNotMatch(RENDER, /groups\.length > 0/)
})

test('the day with nobody to remind is its own capped screen, not an empty rail', () => {
  // An 8/4 split with one sentence in it is most of a laptop saying nothing, and
  // `chaseEmptyReason` is null exactly when `due` is — so past this return there are rows.
  assert.ok(EMPTY_AT > 0 && EMPTY_AT < GRID_AT, 'the empty screen is not before the grid')
  assert.match(EMPTY, /className="flex flex-col gap-5"/)
  assert.match(EMPTY, /\{t\.noneBecause\[emptyReason\]\}/)
  assert.equal(PAGE.split('{t.noneBecause[emptyReason]}').length - 1, 1)
  assert.doesNotMatch(RENDER, /noneBecause/, 'a reason to stop is drawn inside the grid')

  // The cap is on the card, not on the column: the bar above it reaches the workspace
  // edges on this screen exactly as it does on the worklist.
  assert.match(EMPTY, /<Card className="max-w-2xl">/)

  // Both counted blocks come back, from the same consts the rail draws. They keep the
  // rail's `order-N`, which in a one-column flex parent sorts them to where they were
  // written anyway — so one definition cannot drift from the other.
  assert.ok(EMPTY.includes('{counted}') && EMPTY.includes('{missing}'))
})

test('the list is still frozen on mount, and rows dim instead of vanishing', () => {
  // What the layout must not undo: `logFeeReminder` revalidates the fee board, so fresh
  // props would delete the row under the thumb and pull the next family into its place.
  assert.match(LIST, /const \[shown\] = useState\(groups\)/)
  assert.match(LIST, /opacity-60/)
  assert.match(LIST, /role="status"/)

  // It takes no `className`, which is why the worklist column is a plain grid item
  // rather than a `contents` wrapper like the rail.
  assert.deepEqual(ordersIn(LIST), [])
})

test('§38: the gate, both reads and every figure are the ones that were there', () => {
  assert.match(PAGE, /pageCapability\('fees'\)/)
  assert.equal(PAGE.split(".eq('coaching_center_id', session.active.centerId)").length - 1, 2)
  assert.match(PAGE, /\.is\('voided_at', null\)/)
  assert.match(PAGE, /\.gt\('remaining_bdt', 0\)/)
  assert.match(PAGE, /\.gte\('created_at', `\$\{earliest\}T00:00:00\+06:00`\)/)

  // Both paged: a chase lost past PostgREST's silent thousand would not hide a reminder,
  // it would send a second one to a family messaged this morning.
  assert.equal(PAGE.split('pageAll((from, to) =>').length - 1, 2)
  assert.equal(PAGE.split('return refusal(').length - 1, 2)
  assert.match(PAGE, /if \(!\('rows' in owing\)\) return refusal\(owing\.failed\)/)
  assert.match(PAGE, /if \(!\('rows' in chases\)\) return refusal\(chases\.failed\)/)

  assert.match(PAGE, /addDays\(invoices\[0\]\?\.due_date \?\? today, -3\)/)
  assert.match(PAGE, /todayInDhaka\(new Date\(row\.created_at\)\)/)
  assert.match(PAGE, /chaseDecision\(/)
  assert.match(PAGE, /chaseEmptyReason\(\{/)
  assert.match(PAGE, /STAGE_ORDER\.flatMap/)
  assert.match(PAGE, /normalizeBdMobile\(invoice\.guardian_phone\)/)
  assert.match(PAGE, /b\.daysLate - a\.daysLate \|\| b\.remaining - a\.remaining/)
  assert.match(PAGE, /sumTaka\(groups\.flatMap/)
})
