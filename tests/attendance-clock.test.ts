import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  ATTENDANCE_GRACE_MINUTES,
  ATTENDANCE_SIGNATURE_VERSION,
  classState,
  classWindow,
  parseClock,
  unlockFor,
} from '../src/lib/attendance/clock.ts'

/**
 * The clock gate: when a register may be taken, and what has to be signed when it may
 * not (20260811000089).
 *
 * WHAT IS BEING PROTECTED HERE. Two of the three rules are about a boundary rather
 * than about a branch, and a boundary is exactly what a screenshot cannot check: an
 * off-by-one on the grace means either that an ordinary save two minutes after the
 * bell is refused, or that the "cancelled class" the owner asked for never appears
 * because the window outlives the evening. So the boundary cases are asserted on the
 * minute, in both directions.
 *
 * The other half is the pair of constants this file mirrors in SQL —
 * `app.attendance_grace_minutes()` and `attendance_unlocks.signature_version` — held
 * to the migration's own text, the way capacity.test.ts holds a trigger and a
 * TypeScript ceiling to one string. A number copied into two languages is a number
 * that drifts, and the drift is invisible until a screen offers a button the database
 * refuses.
 */

const ROOT = path.join(import.meta.dirname, '..')

/** The migration, prose comments stripped — a comment naming a rule is not the rule. */
const MIGRATION = readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260811000089_attendance_clock.sql'),
  'utf8',
).replace(/^\s*--.*$/gm, '')

const CLOCK = readFileSync(path.join(ROOT, 'src', 'lib', 'attendance', 'clock.ts'), 'utf8')

/** The migration that scoped the gate to the centre plans — path only; read where used. */
const SCOPED = path.join(
  ROOT,
  'supabase',
  'migrations',
  '20260811000090_attendance_clock_scope.sql',
)

/* -------------------------------------------------------------------------- */
/* Reading a time off a timetable                                             */
/* -------------------------------------------------------------------------- */

test('postgres times are read as minutes, with and without seconds', () => {
  // Both shapes arrive: `batch_schedules.start_time` as '16:00:00' from PostgREST, and
  // a hand-typed '16:00' from anywhere a person is asked. A parser that only took one
  // of them would leave half the batches in the country unguarded.
  assert.equal(parseClock('16:00:00'), 960)
  assert.equal(parseClock('16:00'), 960)
  assert.equal(parseClock('09:05'), 545)
  assert.equal(parseClock('00:00'), 0)
  assert.equal(parseClock('23:59'), 1439)
})

test('a time that is not a time is no clock at all', () => {
  // Null, and every caller above reads null as "no gate". The other direction would
  // lock a teacher out of their own class over a value the database never wrote.
  assert.equal(parseClock(null), null)
  assert.equal(parseClock(undefined), null)
  assert.equal(parseClock(''), null)
  assert.equal(parseClock('afternoon'), null)
  assert.equal(parseClock('24:00'), null)
  assert.equal(parseClock('16:60'), null)
  assert.equal(parseClock('-1:00'), null)
})

/* -------------------------------------------------------------------------- */
/* The window, mirrored from app.class_window()                               */
/* -------------------------------------------------------------------------- */

const week = (rows: [number, string | null, string | null][]) =>
  rows.map(([day_of_week, start_time, end_time]) => ({ day_of_week, start_time, end_time }))

const NO_BATCH_TIMES = { start_time: null, end_time: null }

test('the day’s own rows are the window, and other days are not', () => {
  // Tuesday is day 2. Thursday's nine o'clock must not become Tuesday's morning.
  const window = classWindow({
    dayOfWeek: 2,
    schedules: week([
      [4, '09:00', '10:00'],
      [2, '16:00', '17:30'],
    ]),
    batch: { start_time: '07:00', end_time: '08:00' },
  })
  assert.deepEqual(window, { startsAt: '16:00', endsAt: '17:30' })
})

test('a day with two sittings is open from the first to the last', () => {
  // batch_schedules is unique on (batch, day, start), and the register is keyed to the
  // day rather than to the sitting — so the earliest start and latest end are the day.
  const window = classWindow({
    dayOfWeek: 1,
    schedules: week([
      [1, '16:00', '17:30'],
      [1, '09:00', '10:30'],
    ]),
    batch: NO_BATCH_TIMES,
  })
  assert.deepEqual(window, { startsAt: '09:00', endsAt: '17:30' })
})

test('a day the timetable does not mention falls back to the batch’s own times', () => {
  const window = classWindow({
    dayOfWeek: 5,
    schedules: week([[2, '16:00', '17:30']]),
    batch: { start_time: '07:00:00', end_time: '08:30:00' },
  })
  assert.deepEqual(window, { startsAt: '07:00:00', endsAt: '08:30:00' })
})

test('a row nobody can read is skipped, and never becomes the window', () => {
  // 'noon' would sort before every real time as a string. The comparison is on
  // minutes for exactly this reason, so the unreadable row is ignored rather than
  // chosen as the earliest start.
  const window = classWindow({
    dayOfWeek: 0,
    schedules: week([
      [0, 'noon', 'late'],
      [0, '16:00', '17:30'],
    ]),
    batch: NO_BATCH_TIMES,
  })
  assert.deepEqual(window, { startsAt: '16:00', endsAt: '17:30' })
})

test('nothing readable at all is no window, which is no gate', () => {
  const window = classWindow({
    dayOfWeek: 3,
    schedules: week([[3, null, null]]),
    batch: NO_BATCH_TIMES,
  })
  assert.deepEqual(window, { startsAt: null, endsAt: null })
  assert.equal(
    classState({ now: '05:00', startsAt: window.startsAt, endsAt: window.endsAt, taken: false, enforced: true }),
    'open',
  )
})

/* -------------------------------------------------------------------------- */
/* The four states of a class day                                             */
/* -------------------------------------------------------------------------- */

const at = (now: string) =>
  classState({ now, startsAt: '16:00', endsAt: '17:30', taken: false, enforced: true })

/** The same class, on the plan that carries no clock: Teacher Free / Teacher Plus. */
const solo = (now: string) =>
  classState({ now, startsAt: '16:00', endsAt: '17:30', taken: false, enforced: false })

test('a register that exists is filed, whatever the hour', () => {
  // First branch on purpose. A register taken on time and corrected at nine at night
  // is a correction — 20260811000031's rule, with its own price — and dragging it back
  // into the clock's hands would ask a teacher to sign for somebody else's afternoon.
  assert.equal(classState({ now: '05:00', startsAt: '16:00', endsAt: '17:30', taken: true, enforced: true }), 'filed')
  assert.equal(classState({ now: '22:00', startsAt: '16:00', endsAt: '17:30', taken: true, enforced: true }), 'filed')
  assert.equal(classState({ now: '16:10', startsAt: '16:00', endsAt: '17:30', taken: true, enforced: true }), 'filed')
})

test('a batch with no timetable is never locked', () => {
  // The same direction /teach takes with an empty schedule: a centre that has not
  // filled in its routine yet must not lose the register. Both halves are checked
  // because they arrive from two different places — the batch's own times and the
  // day's schedule rows.
  assert.equal(classState({ now: '05:00', startsAt: null, endsAt: null, taken: false, enforced: true }), 'open')
  assert.equal(classState({ now: '22:00', startsAt: null, endsAt: null, taken: false, enforced: true }), 'open')
  assert.equal(classState({ now: '22:00', startsAt: undefined, endsAt: '17:30', taken: false, enforced: true }), 'cancelled')
  assert.equal(classState({ now: '05:00', startsAt: '16:00', endsAt: undefined, taken: false, enforced: true }), 'early')
})

/* -------------------------------------------------------------------------- */
/* The solo teacher's plan: no clock, at every hour                            */
/* -------------------------------------------------------------------------- */

test('Teacher Free and Teacher Plus take a register at any hour, like a correction', () => {
  // §3.17 — a solo teacher is the centre; there is nobody to notice if the register
  // is late, and asking him to sign a sentence about a colleague he does not have is
  // the gate the owner drew for somebody else's school. The class is identical to the
  // gated one above: same timetable, same hour, only the plan is different.
  assert.equal(solo('15:59'), 'open')
  assert.equal(solo('05:00'), 'open')
  assert.equal(solo('18:01'), 'open')
  assert.equal(solo('23:30'), 'open')
})

test('and a plan that enforces nothing never asks a teacher for a signature', () => {
  // The state feeds the card's buttons, so an 'early' here would be a signature card
  // on a solo teacher's screen — the bug this flag exists to make impossible.
  assert.equal(unlockFor(solo('15:59')), null)
  assert.equal(unlockFor(solo('23:30')), null)
  // And a register that exists still reads as filed first, gate or no gate.
  assert.equal(
    classState({ now: '05:00', startsAt: '16:00', endsAt: '17:30', taken: true, enforced: false }),
    'filed',
  )
})

test('and the database agrees: both guards read the same plan switch', () => {
  // The TS flag is a courtesy; the SQL is the thing that holds. A solo teacher whose
  // register guard still read the window would be refused at the boundary by the
  // database the screen just promised him — so the switch is pinned on both sides,
  // and pinned to the same two plan ids in both languages.
  const scoped = readFileSync(SCOPED, 'utf8').replace(/--[^\n]*/g, '')

  // One list, written twice: `center` and `institution` in TypeScript...
  assert.match(CLOCK, /return plan\.id === 'center' \|\| plan\.id === 'institution'/)
  // ...and the same two in SQL.
  assert.match(scoped, /select c\.plan in \('center', 'institution'\)/)

  // Both database guards ask it before the clock says anything: the signature guard
  // by name at the top, and the register guard as a condition of its clock block.
  assert.match(scoped, /if not app\.clock_enforced\(new\.coaching_center_id\) then/)
  assert.match(scoped, /and app\.clock_enforced\(new\.coaching_center_id\)/)

  // And the screens ask the same question of the same session plan, so a card is
  // never drawn for a teacher the database will not gate.
  const actions = readFileSync(
    path.join(ROOT, 'src', 'app', '(app)', 'teach', '[batchId]', 'actions.ts'),
    'utf8',
  )
  assert.ok(
    (actions.match(/clockEnforced\(session\.plan\)/g) ?? []).length >= 2,
    'the save and the signature both answer the plan before the window',
  )
  const register = readFileSync(
    path.join(ROOT, 'src', 'app', '(app)', 'teach', '[batchId]', 'page.tsx'),
    'utf8',
  )
  assert.match(register, /clockEnforced\(session\.plan\)/)
})

test('before the class starts, the register is locked', () => {
  assert.equal(at('15:59'), 'early')
  assert.equal(at('05:00'), 'early')
})

test('at the class time it unlocks by itself, which is the whole promise', () => {
  // The owner's own words: "it will unlock automatically at class time". One minute
  // either side of that is the assertion.
  assert.equal(at('15:59'), 'early')
  assert.equal(at('16:00'), 'open')
  assert.equal(at('16:01'), 'open')
  assert.equal(at('17:30'), 'open')
})

test('the grace is inclusive at its own edge and gone one minute later', () => {
  // 17:30 class, 30 minutes of grace: 18:00 is still an ordinary save, 18:01 is the
  // first minute of the state the owner asked to be called cancelled.
  assert.equal(at('17:59'), 'open')
  assert.equal(at('18:00'), 'open')
  assert.equal(at('18:01'), 'cancelled')
  assert.equal(at('23:30'), 'cancelled')
})

test('a class with no end can be taken all day, and one with no start cannot be early', () => {
  // Two half-filled timetables, and they fail in opposite directions on purpose: an
  // end is what makes a class cancellable, a start is what makes it early.
  assert.equal(
    classState({ now: '23:00', startsAt: '16:00', endsAt: null, taken: false, enforced: true }),
    'open',
  )
  assert.equal(
    classState({ now: '05:00', startsAt: null, endsAt: '17:30', taken: false, enforced: true }),
    'open',
  )
})

test('a clock nobody can read leaves the register open', () => {
  // `now` comes from dhakaClock, so an unreadable one is a caller that made it up. The
  // register's own guard reads the server's clock and decides what really happened, and
  // locking a class out on the strength of a value we cannot parse is the worse trade.
  assert.equal(at('half past four'), 'open')
  assert.equal(at(''), 'open')
})

/* -------------------------------------------------------------------------- */
/* What has to be signed                                                      */
/* -------------------------------------------------------------------------- */

test('each locked state names the sentence the teacher signs', () => {
  assert.equal(unlockFor('early'), 'early')
  assert.equal(unlockFor('cancelled'), 'forgot')
  // Nothing to sign for the ordinary path, and nothing for a correction either: that
  // one is charged in a different currency (one change per mark, window.ts).
  assert.equal(unlockFor('open'), null)
  assert.equal(unlockFor('filed'), null)
})

test('there are exactly two reasons a signature can be given, and both are named', () => {
  // The enum in the migration and this module's two returns have to be the same two
  // words: a third reason in SQL would be a signature nothing can ever ask for.
  const labels = [...MIGRATION.matchAll(/create type public\.attendance_unlock_reason as enum \(([^)]*)\)/g)]
  assert.equal(labels.length, 1, 'the reason enum is declared once')
  const reasons = [...labels[0][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(reasons, ['early', 'forgot'])
})

/* -------------------------------------------------------------------------- */
/* The two constants, held to the database that enforces them                 */
/* -------------------------------------------------------------------------- */

test('the grace is the same number in TypeScript and in the guard', () => {
  // The mirror that keeps a screen from offering a button the database refuses. If
  // these ever disagree the SQL is the one that holds, and the failure is a teacher
  // tapping a signature the guard will not accept.
  const declared = /select (\d+)/.exec(MIGRATION)
  assert.ok(declared, 'app.attendance_grace_minutes() returns a literal')
  assert.equal(Number(declared[1]), ATTENDANCE_GRACE_MINUTES)

  // And the constant is what the state machine actually uses, rather than a number
  // written out a second time in the branch above it.
  assert.match(CLOCK, /now > end \+ ATTENDANCE_GRACE_MINUTES/)
  assert.doesNotMatch(CLOCK, /\+ 30\b/, 'the grace is written out by hand somewhere')
})

test('the sentence a signature names is dated, and the date is a real one', () => {
  // Stored as YYYY-MM-DD on every row, so a signature given today can be told apart
  // from one given after the words changed. The check constraint in the migration says
  // the same thing to the database.
  assert.match(ATTENDANCE_SIGNATURE_VERSION, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(MIGRATION, /check \(signature_version ~ '\^\[0-9\]\{4\}/)
})

test('the table this module is the mirror of is audited, and the app can name it', () => {
  // A signature is one of the acts §10's log exists for — a class filed outside its
  // hours by a named person. check-migrations.mjs compares the triggers against
  // AUDITED_TABLES, and this asserts the same pair from the other side, so a
  // migration that dropped the trigger fails here too.
  const audit = readFileSync(path.join(ROOT, 'src', 'lib', 'audit.ts'), 'utf8')
  assert.match(MIGRATION, /create trigger attendance_unlocks_audit/)
  assert.match(audit, /'attendance_unlocks',/)
  assert.match(audit, /attendanceFiledEarly/)
  assert.match(audit, /attendanceFiledLate/)
})
