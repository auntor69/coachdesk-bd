/**
 * Which day a register may still be taken for, and how often a mark may change.
 *
 * The owner asked for two things that sound like one: nobody takes attendance for
 * a class that has not happened, and a register may be corrected once — "because
 * like one student can be late a lil bit". The first is a date rule, the second is
 * a counter, and they meet here because the screen has to know both before it
 * draws a single button. A teacher discovering the rule from a red error after
 * tapping thirty rows has been told too late.
 *
 * WHERE EACH HALF IS ENFORCED. The future refusal is in the database as well —
 * 20260811000031_attendance_window.sql — because a register for tomorrow is wrong
 * for every caller, and a Server Action is a public HTTP endpoint that a form is
 * only the politest way to reach. The *window* is here and nowhere else: "today,
 * or your last class" needs the batch's timetable and the centre's own history to
 * evaluate, and a coaching centre correcting last month's book is doing
 * bookkeeping rather than taking attendance. So the database refuses what is never
 * right, and this module decides what is merely closed.
 *
 * Relative import with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import { addDays, dayOfWeekOn } from '../bd/time.ts'

/**
 * How many times a browser session may change a mark it has already written.
 *
 * The twin of `max_revision` in app.guard_attendance_mark(). The database is the
 * one that holds — this constant exists so the register can draw a settled row as
 * a settled row instead of three buttons that would be refused, which is the
 * difference between a rule and a trap. If one of the two ever moves, the trigger
 * is the one that decides what happened.
 */
export const ATTENDANCE_MAX_REVISION = 1

/**
 * 'asCalled'   — the mark as the register was taken. Nobody has changed it.
 * 'corrected'  — changed, by the person who took it. §6.3's sanctioned act: the boy who
 *                walked in at 4:10 moves present → late.
 * 'overridden' — changed by somebody else. The thing §6.3 asks to be visible.
 */
export type MarkHistory = 'asCalled' | 'corrected' | 'overridden'

/**
 * Which of the three a mark is, from the two names on the row.
 *
 * `called_by` is frozen at the insert and `marked_by` moves to whoever last changed the
 * status (20260811000064), so the comparison is the whole rule and no role is read —
 * a teacher fixing their own tick is not an override and a manager doing it is, which is
 * what §6.3 describes and what §6.2 forbids doing with an `if` on rank.
 *
 * WHERE THIS IS SOFTER THAN THE TRIGGER, on purpose. The audit trigger's WHEN clause is
 * `marked_by is distinct from called_by`, so a mark corrected before `called_by` existed
 * — null caller, real corrector — writes a log line. Here it comes back 'corrected'
 * instead, because the screen puts a word next to a person's name and "overridden" is an
 * accusation this row cannot support. The log would rather hold a line too many; the
 * screen would rather not blame the wrong teacher. If they are ever made to agree, the
 * trigger is the one that decides what was recorded.
 */
export function markHistory(mark: {
  revision: number
  markedBy: string | null
  calledBy: string | null
}): MarkHistory {
  if (mark.revision <= 0) return 'asCalled'
  if (mark.calledBy === null || mark.markedBy === null) return 'corrected'
  return mark.markedBy === mark.calledBy ? 'corrected' : 'overridden'
}

/**
 * 'open'   — today, or the batch's last class: take it, correct it once.
 * 'future' — a class that has not happened. Refused for everybody.
 * 'closed' — a real class, long enough ago that changing it is bookkeeping.
 *            Refused for a teacher; an owner may still write, and is told so.
 */
export type AttendanceVerdict = 'open' | 'future' | 'closed'

/** A YYYY-MM-DD that is a day that exists — not merely four digits and two dashes. */
export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const at = Date.parse(`${value}T12:00:00Z`)
  // Date.parse is not strict about the calendar: it reads 2026-02-31 as the 3rd of
  // March and hands back a perfectly good date. So the round trip is the real test.
  // A date that rolls over silently is a date nobody has, and quietly filing a
  // register on the day after it is worse than refusing it.
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value
}

/**
 * The one earlier day this batch may still be marked for, or null.
 *
 * Two sources, and the later of them wins.
 *
 * The timetable says which past days were supposed to be classes, so the walk goes
 * back day by day from yesterday until it lands on one the batch meets. Day by day
 * rather than by arithmetic on the weekday number, because a batch that meets only
 * on Saturday has a six-day gap and Friday's answer is last Saturday, not
 * yesterday.
 *
 * `lastRegister` is the most recent day this batch actually has a register for,
 * strictly before today. It is included because centres hold classes the timetable
 * does not know about — an extra Friday session before an exam — and a teacher who
 * marked one yesterday should be able to fix it today. It also covers the reverse:
 * a batch whose schedule was edited after the class was held.
 *
 * An empty timetable means yesterday, matching what /teach already does with the
 * same absence: "a batch with no schedule rows is treated as meeting every day.
 * Centres set schedules up late, and hiding their batches until they do would look
 * like data loss."
 *
 * Null is possible and means "nothing earlier is open": a schedule holding only
 * numbers no day of the week has, or a genuinely new batch on its first day.
 */
export function lastClassDate(
  today: string,
  meetsOn: readonly number[],
  lastRegister: string | null,
): string | null {
  let scheduled: string | null = null

  if (meetsOn.length === 0) {
    scheduled = addDays(today, -1)
  } else {
    // Seven days and no further. Beyond a week back the answer stops being "your
    // last class" and starts being a month of unmarked registers, and a teacher who
    // has not opened the app in eight days is not a few minutes late.
    for (let back = 1; back <= 7; back += 1) {
      const day = addDays(today, -back)
      if (meetsOn.includes(dayOfWeekOn(day))) {
        scheduled = day
        break
      }
    }
  }

  // Defensive: the caller queries `session_date < today`, but a register dated
  // today or later is not an *earlier* class and must not widen the window.
  const held = lastRegister && lastRegister < today ? lastRegister : null

  if (!scheduled) return held
  if (!held) return scheduled
  return held > scheduled ? held : scheduled
}

/**
 * What may be done with `date`, given today and the batch's last class.
 *
 * Order matters: future is checked before anything else, because a malformed or
 * hostile date must not fall through to a friendlier verdict. Everything that is
 * not today and not the last class is closed, including a date years back.
 */
export function attendanceVerdict(
  date: string,
  today: string,
  lastClass: string | null,
): AttendanceVerdict {
  if (!isDateString(date)) return 'closed'
  if (date > today) return 'future'
  if (date === today) return 'open'
  return date === lastClass ? 'open' : 'closed'
}
