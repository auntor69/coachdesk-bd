/**
 * Whether a batch would put its teacher in two rooms at once.
 *
 * §7.3 has said "nothing stops one teacher being scheduled in two places" since the
 * audit, and the reason it went unbuilt is not that the data was missing — the day, the
 * hours and the teacher have all been stored since the first migration. It is that the
 * answer needs the whole proposal at once: a batch is a teacher, a set of days and a pair
 * of times, and any one of the three read on its own is not a routine.
 *
 * WHY THIS IS HERE AND NOT ONLY IN THE DATABASE. 20260811000071 puts a trigger on
 * `batch_schedules` which is the enforcement, and it fires on one day row at a time
 * because that is where the picture is whole — see that file's header. Two things it
 * cannot do, and both matter to the person at the desk:
 *
 *   A batch with no chosen days meets every day, and writes no day row at all, so nothing
 *   fires. That batch is the likeliest double-booking in the product, because the centres
 *   that skip the day picker are the ones building a routine by memory.
 *
 *   A refusal from a trigger is a SQLSTATE. What an owner needs is "Rahim sir already
 *   teaches Physics 1 on Monday at 4:00pm", in Bangla, on the field they just filled in.
 *
 * So the form asks first and the database refuses last, which is the same division
 * `limitRefusal` and the CD001 capacity trigger already make.
 *
 * No imports. The rule is arithmetic on numbers and strings; the naming of the days and
 * the clock belongs to the caller, which has the locale.
 */

/**
 * One hour of one teacher's week, and the batch it belongs to.
 *
 * `day` is Sunday-based like `extract(dow)` and `dhakaDayOfWeek`, or **null for a batch
 * that meets every day** — which is what no rows in `batch_schedules` means, on the form
 * ("leave these untouched and the batch counts as meeting every day"), on the teacher
 * panel, and here.
 *
 * `start` and `end` are 'HH:MM' or 'HH:MM:SS'. Both arrive: the form's own `parseTime`
 * hands over the first, a `time` column read back through PostgREST the second.
 */
export type Booking = {
  batchId: string
  name: string
  day: number | null
  start: string
  end: string
}

/** The hour being proposed, before it belongs to anything. */
export type ProposedHour = {
  day: number | null
  start: string
  end: string
}

/**
 * Minutes since midnight, or null for anything not a clock.
 *
 * Not lexicographic string comparison, which is what this was first: '9:00' sorts after
 * '16:00' and the whole rule inverts for every batch whose form was filled in without a
 * leading zero. `parseTime` pads, a `time` column always comes back padded, and neither
 * fact is worth relying on in the one function the rule is made of.
 */
function minutes(clock: string): number | null {
  const [h, m] = clock.split(':')
  const hours = Number(h)
  const mins = Number(m)
  if (!Number.isInteger(hours) || !Number.isInteger(mins)) return null
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null
  return hours * 60 + mins
}

/**
 * Whether two days of the week are the same occasion.
 *
 * Null is every day and therefore meets everything, including another null. It is not a
 * wildcard that matches nothing, which is how a missing value usually behaves here — a
 * batch with no days is not a batch with no schedule, it is a batch that turns up
 * whenever the centre is open.
 */
function sameDay(a: number | null, b: number | null): boolean {
  return a === null || b === null || a === b
}

/**
 * Whether two hours run into each other.
 *
 * Half-open on purpose: a class ending at 16:00 and one starting at 16:00 do not clash,
 * because back-to-back batches are how a coaching centre actually runs and a rule that
 * refused them would be worked around within a week. Identical hours do clash, being the
 * same hour twice.
 *
 * An unreadable clock on either side is not an overlap. The form has already refused a
 * malformed time with its own message by the time this is reached, and guessing here
 * would turn a typo into a refusal naming an innocent batch.
 */
function overlaps(a: ProposedHour, b: ProposedHour): boolean {
  const aFrom = minutes(a.start)
  const aTo = minutes(a.end)
  const bFrom = minutes(b.start)
  const bTo = minutes(b.end)
  if (aFrom === null || aTo === null || bFrom === null || bTo === null) return false
  return sameDay(a.day, b.day) && aFrom < bTo && bFrom < aTo
}

/**
 * The first booking of this teacher's that the proposal runs into, or null.
 *
 * `proposed` is every hour the batch would occupy — one per chosen day, or a single entry
 * with `day: null` for a batch that meets every day. `busy` is every hour the teacher's
 * *other* running batches occupy; the caller excludes the batch being saved, because
 * every save rewrites its own days and a batch compared with itself refuses every edit.
 *
 * FIRST AND NOT ALL. The answer is a refused save, and one collision an owner can go and
 * look at is more use than a list of five. Ordered so the answer is stable rather than
 * whatever the read happened to return: the earliest day, then the earliest hour, then
 * the name — otherwise two saves of the same clashing batch name different batches and
 * the owner thinks something changed.
 */
export function firstClash(proposed: ProposedHour[], busy: Booking[]): Booking | null {
  const hits = busy.filter((booked) => proposed.some((hour) => overlaps(hour, booked)))
  if (hits.length === 0) return null

  return hits.sort((x, y) => {
    const day = (x.day ?? -1) - (y.day ?? -1)
    if (day !== 0) return day
    const from = (minutes(x.start) ?? 0) - (minutes(y.start) ?? 0)
    if (from !== 0) return from
    return x.name.localeCompare(y.name)
  })[0]
}

/**
 * The hours a batch would occupy, from what the form posted.
 *
 * No days is one booking on every day, which is the reading the rest of the product
 * already takes. No hours is no booking at all: a batch carrying only a slot — "evening"
 * — has nothing to overlap, and inventing hours for it would refuse saves on a routine
 * that was never written down.
 */
export function proposedHours(
  days: number[],
  start: string | null,
  end: string | null,
): ProposedHour[] {
  if (!start || !end) return []
  if (days.length === 0) return [{ day: null, start, end }]
  return days.map((day) => ({ day, start, end }))
}

/**
 * The SQLSTATE `app.guard_teacher_clash()` raises when a day row would double-book.
 *
 * Ours, not Postgres's, for the reason `CAPACITY_EXCEEDED` sets out at length: the
 * standard codes all say something else, and a manager IS allowed to save this batch —
 * the clock is what is wrong. `CD` is not a class Postgres allocates. The migration names
 * the same five characters next to the `raise`, and a grep finds both halves.
 */
export const TEACHER_CLASH = 'CD002'

/**
 * Whether a failed write failed because the teacher was already booked.
 *
 * `unknown` rather than PostgrestError because the callers are error branches, and a
 * Supabase error object is not a type worth trusting. False on anything unrecognised: a
 * true here would tell somebody to move a class to fix an error that had nothing to do
 * with the timetable, and they would move it, and it would still be broken.
 */
export function isClashRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { code?: unknown }).code === TEACHER_CLASH
}
