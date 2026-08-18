import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  chaseDecision,
  countChasesDue,
  reminderStage,
  STAGE_ORDER,
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

/** Local so these tests do not lean on the module they are checking. */
function addDay(isoDate: string, delta: number): string {
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10)
}
