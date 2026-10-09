/**
 * Whether the clock lets a register be taken yet, and what a teacher has to sign
 * when it does not.
 *
 * THE TWO RULES THIS FILE ADDS TO `window.ts`. That module decides *which day* may
 * still be marked — today, or the batch's last class — and everything about it is a
 * calendar question. This one decides *what time of that day*, and the owner asked
 * for it in their own words:
 *
 *   > we have to lock it until the class time starts, it will unlock automatically at
 *   > class time … suppose teacher is busy tomorrow so he want to take the class
 *   > tomorrow which is not supposed to be, so the teacher can unlock it but he have
 *   > to sign that he wanted it and confirm, and the centre will get notification …
 *   > suppose today class time ended but teacher didnt took a single attendance then
 *   > it will count as a cancelled class, or suppose he forgot to took attendance at
 *   > class time then he will again sign that confirms he legit forgot.
 *
 * So every class that has a timetable is in one of four states on the day it is on:
 *
 *   open       the clock is inside [start, end + grace]. The ordinary path.
 *   early      before the start, with nothing filed. Locked, until a teacher signs
 *              that they are taking it early — and the centre is told that they did.
 *   cancelled  after end + grace, with nothing filed. The owner's "it will count as a
 *              cancelled class". It stays cancelled until a register is in, and
 *              filing it thereafter needs the second signature, the one that says
 *              the class was held and the register is late rather than fabricated.
 *   filed      a register exists. Its hour stops mattering: everything after this is
 *              §6.3's correction, which is a different rule with a different price.
 *
 * A batch with no timetable at all is never locked. That is `window.ts`'s own
 * decision about an empty schedule, one level down, and it is the same reasoning:
 * centres fill their routine in late, and a gate built on a timetable that has not
 * been written yet would refuse every register in the building.
 *
 * WHERE EACH HALF IS ENFORCED. All of it is in the database as well —
 * 20260811000089_attendance_clock.sql, `app.class_window()` and the two guards — and
 * that is the one that holds, because a Server Action is a public endpoint. This file
 * exists so the screen knows before it draws: a teacher who has tapped forty names
 * and is then told the class had not started has been told too late, and that lesson
 * is already written down in window.ts. The grace is therefore a mirror of
 * `app.attendance_grace_minutes()`, and the two must move together.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */

/**
 * How long after a class ends its register may still be taken without a signature.
 *
 * The twin of `app.attendance_grace_minutes()`, and the database is the one that
 * holds. Thirty minutes because the last ten minutes of a class are spent on the
 * room rather than the phone, so a save landing a few minutes after the hour is the
 * ordinary day; and because yesterday's silence must not be allowed to pass as
 * today's diligence, which is what a longer grace buys.
 */
export const ATTENDANCE_GRACE_MINUTES = 30

/**
 * The date the two sentences a teacher signs were last written, as YYYY-MM-DD.
 *
 * Stored on every signature row as `attendance_unlocks.signature_version`, exactly as
 * `policy_acceptances.policy_version` stores a page's. The words themselves live in
 * the dictionaries in both languages — the row names the wording rather than freezing
 * one language's copy of it — so this constant is what makes a signature given today
 * distinguishable from one given after somebody softened the sentence in March.
 *
 * BUMP IT WHEN EITHER SENTENCE CHANGES. That is not housekeeping: an owner reading
 * "he signed that he forgot" in December is entitled to see the words he actually
 * signed, and moving this date is what says the words are different now.
 */
export const ATTENDANCE_SIGNATURE_VERSION = '2026-10-09'

/**
 * The four states, plus the one for a batch the timetable has nothing to say about.
 *
 * 'open' is not "nothing is filed" — a register already taken on time is filed, and
 * 'filed' covers it. The page draws no gate for either of them; the difference
 * matters to the tests and to anybody reading this file.
 */
export type AttendanceState = 'open' | 'early' | 'cancelled' | 'filed'

/**
 * HH:MM:SS or HH:MM as minutes past midnight, or null for anything else.
 *
 * Postgres hands `time` back as a string, so there is no Date to route this through
 * and no timezone to lose — the same reason `formatTime` splits it by hand. Null for
 * a string that is not a clock, and an unreadable clock is treated by every caller
 * below as no clock at all: a batch whose timetable cannot be parsed must not be
 * locked out of taking attendance, which is the direction an unreadable value takes
 * everywhere else in this app.
 */
export function parseClock(time: string | null | undefined): number | null {
  if (!time) return null
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

/** Which signature a locked state needs, or null when nothing is needed. */
export type UnlockReason = 'early' | 'forgot'

/** A `batch_schedules` row as the window lookup reads it. */
export type WindowScheduleRow = {
  day_of_week: number
  start_time: string | null
  end_time: string | null
}

/**
 * The hours a batch's class occupies on one day, mirroring `app.class_window()`.
 *
 * The timetable wins where it speaks, per day of the week, and the batch's own two
 * times are the fallback — a centre that has not filled in a routine yet is holding
 * those instead. Three call sites read this and they have to agree: the register page
 * draws the gate from it, `saveAttendance` refuses on it, and `unlockAttendance`
 * decides which sentence a signature is for.
 *
 * THE WHOLE DAY AND NOT ONE SITTING, exactly as the SQL does it. `batch_schedules`
 * is unique on (batch, day, start), so a batch may meet twice in one afternoon; the
 * register is keyed to the day and not to the sitting, so the window is the earliest
 * start and the latest end of that day's rows. A class at nine and another at four
 * means the register is open from nine until half past four plus the grace — which is
 * the honest shape for a register that records one day.
 *
 * A nonsense clock in a schedule row is skipped rather than sorted on: the comparison
 * is made on `parseClock`'s minutes, and a row that cannot be read must not become
 * either the earliest start or the latest end. The batch's own times are returned when
 * nothing in the timetable can be read, which every caller below treats as no gate.
 */
export function classWindow(input: {
  dayOfWeek: number
  schedules: readonly WindowScheduleRow[]
  batch: { start_time: string | null; end_time: string | null }
}): { startsAt: string | null; endsAt: string | null } {
  const today = input.schedules.filter((s) => s.day_of_week === input.dayOfWeek)

  let startsAt: string | null = null
  let startMinutes = Number.POSITIVE_INFINITY
  let endsAt: string | null = null
  let endMinutes = Number.NEGATIVE_INFINITY

  for (const row of today) {
    const start = parseClock(row.start_time)
    if (start !== null && start < startMinutes) {
      startMinutes = start
      startsAt = row.start_time
    }
    const end = parseClock(row.end_time)
    if (end !== null && end > endMinutes) {
      endMinutes = end
      endsAt = row.end_time
    }
  }

  return {
    startsAt: startsAt ?? input.batch.start_time,
    endsAt: endsAt ?? input.batch.end_time,
  }
}

/**
 * The state of one class, from the clock, the batch's hours and whether a register
 * exists.
 *
 * ORDER OF THE BRANCHES IS THE RULE:
 *
 *   1. A register that exists is filed, whatever the hour. This is first on purpose —
 *      it is what stops a register taken on time from being dragged back into the
 *      clock's hands by an edit five minutes later. Nothing about a correction is
 *      early or cancelled.
 *   2. No hours means no gate. A batch with no timetable is always open.
 *   3. Before the start is early. Only a start is needed for this: a class with a
 *      start and no end can still be taken early.
 *   4. After the end plus the grace, with nothing filed, is cancelled. Only an end is
 *      needed for this, for the same reason.
 *   5. Everything else is open.
 *
 * `now` is Dhaka's wall clock as HH:MM, from `dhakaClock()` in src/lib/bd/time.ts —
 * never `new Date()`, and never the server's own timezone. A page is not allowed to
 * read the clock during render anyway (React refuses the impure call), which is the
 * other half of why every clock read in this app goes through that module.
 *
 * An unparseable `now` leaves the state open rather than closed. The only way to get
 * one is a caller that made it up, and the register's own guard — which reads the
 * server's clock — is what decides what actually happened.
 */
export function classState(input: {
  now: string
  /** The class's start for that day: min(start) of the day's schedule rows, or null. */
  startsAt: string | null | undefined
  /** The class's end for that day: max(end) of the day's schedule rows, or null. */
  endsAt: string | null | undefined
  /** Whether this day already has a register. */
  taken: boolean
}): AttendanceState {
  if (input.taken) return 'filed'

  const now = parseClock(input.now)
  const start = parseClock(input.startsAt)
  const end = parseClock(input.endsAt)

  if (now === null) return 'open'
  if (start === null && end === null) return 'open'

  if (start !== null && now < start) return 'early'
  if (end !== null && now > end + ATTENDANCE_GRACE_MINUTES) return 'cancelled'
  return 'open'
}

/**
 * What a teacher has to sign to write the register in this state, or null.
 *
 * 'cancelled' needs 'forgot', and that pairing is the whole of the vocabulary: the
 * state is what the *centre* calls the day — a class with no register — and the
 * reason is what the *teacher* says about it — that the class was held and they
 * forgot. They are one act seen from two sides, which is why they are the only two
 * names in `attendance_unlock_reason` besides 'early'.
 *
 * 'open' and 'filed' need nothing: one is the ordinary path, and the other is a
 * correction, which 20260811000031 already charges for in a different currency.
 */
export function unlockFor(state: AttendanceState): UnlockReason | null {
  if (state === 'early') return 'early'
  if (state === 'cancelled') return 'forgot'
  return null
}
