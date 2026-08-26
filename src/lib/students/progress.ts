/**
 * Turning `student_progress_week` rows into the roster an owner works down.
 *
 * The view counts; this file decides nothing about a child. There is no threshold
 * anywhere in either — the weekly note goes to every family whatever the numbers
 * say, and a parent whose child attended all six classes is exactly the one most
 * worth telling. So the only judgements here are about the *screen*: whether there
 * is anything true to say yet, whether this family was told recently enough that
 * asking again would be noise, and what order 150 names go in.
 *
 * That is the same split student_risk keeps, arrived at from the opposite side.
 * There, every threshold is in SQL because two screens read it and a second copy
 * would drift. Here there are no thresholds to duplicate, and the one number this
 * file does own — how long before offering the same family again — has exactly one
 * reader, so it lives beside it. See SUMMARY_AGAIN_AFTER_DAYS.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import type { OutreachChannel } from '../supabase/types.ts'

/**
 * One row of student_progress_week as PostgREST hands it back.
 *
 * Every column of a view is nullable in the generated types, and several of these
 * genuinely are: a student with no result this week has no last exam, which is a
 * different fact from having scored nothing.
 *
 * `last_exam_obtained` and `last_exam_total` arrive as **strings**. Both are
 * `numeric(6, 2)` in exam_results/exams and PostgREST serialises numeric as text on
 * purpose, so `45` reaches this file as `'45.00'`. Read raw, the message would say
 * "45.00/50.00" — and a ratio a parent reads aloud is the last figure in this
 * product that should have decimal noise in it.
 */
export type ProgressRow = {
  student_id: string | null
  student_name: string | null
  student_code: string | null
  guardian_phone: string | null
  sms_opt_out: boolean | null
  /** YYYY-MM-DD, inclusive. The window the counts beside it were taken over. */
  week_from: string | null
  week_to: string | null
  sessions_counted: number | null
  sessions_present: number | null
  sessions_absent: number | null
  sessions_late: number | null
  sessions_excused: number | null
  exams_taken: number | null
  exams_missed: number | null
  marks_pct: number | null
  last_exam_title: string | null
  last_exam_obtained: string | number | null
  last_exam_total: string | number | null
  last_exam_date: string | null
  last_sent_at: string | null
  /**
   * Last, because that is where `create or replace view` would let it go — see
   * 20260811000026. It rides along for the chase chips and nothing in this file
   * reads it beyond copying it across.
   */
  preferred_channel: OutreachChannel | null
}

/**
 * The columns to select, in one place, because two screens read this view.
 *
 * A page that forgot `sessions_excused` would not fail — PostgREST omits the key,
 * it reads as undefined, and the row renders an excused absence as nothing at all.
 * Silently right-looking and wrong, which is the same reason RISK_COLUMNS exists.
 *
 * One string on one line rather than a concatenation: a line break inside the list
 * reaches PostgREST as part of a column name.
 */
export const PROGRESS_COLUMNS =
  'student_id, student_name, student_code, guardian_phone, sms_opt_out, preferred_channel, week_from, week_to, sessions_counted, sessions_present, sessions_absent, sessions_late, sessions_excused, exams_taken, exams_missed, marks_pct, last_exam_title, last_exam_obtained, last_exam_total, last_exam_date, last_sent_at'

/**
 * The five columns the dashboard's count needs, and nothing else.
 *
 * A door with no number on it is a door an owner learns to walk past — the same
 * argument `ReminderEntry` makes about its own count — so the home screen has to
 * ask this view how much work is waiting. It does not have to ask for the names,
 * the marks or the window to do that, and the dashboard already carries eight
 * queries on a 3G phone.
 *
 * The count comes from `progressToTell`, which shares its decision with the
 * screen. Two ways of counting the same thing is how a door promises twelve and
 * the room behind it delivers three.
 */
export const PROGRESS_COUNT_COLUMNS =
  'student_id, guardian_phone, sessions_counted, exams_taken, exams_missed, last_sent_at'

/** What `PROGRESS_COUNT_COLUMNS` comes back as. */
export type ProgressCountRow = Pick<
  ProgressRow,
  | 'student_id'
  | 'guardian_phone'
  | 'sessions_counted'
  | 'exams_taken'
  | 'exams_missed'
  | 'last_sent_at'
>


/**
 * How soon the same family may be offered a second weekly note.
 *
 * Six days, one short of the seven the window covers, and the gap is the point. An
 * owner who sent on Thursday evening and opens this screen the next Wednesday is
 * looking at a week that overlaps the one they already described by six days — the
 * same register, very often the same exam — so offering that family again would
 * send a parent a near-duplicate of Thursday's message. Seven would mean they had
 * to wait for the exact anniversary of the send, which on a busy Thursday means
 * skipping a whole week.
 *
 * It only ever hides a chip. Nothing here stops an owner messaging a family — the
 * row is still on the screen with the date they were last told, and this feature is
 * one tap from the student's own page.
 *
 * Not in SQL, unlike every threshold student_risk uses, and for the reason that
 * file gives in reverse: a number two screens compare against belongs in the view
 * where neither can drift, and a number with exactly one reader belongs next to its
 * reader. `QUIET_AFTER_DAYS` in ../platform/centers.ts sits here for the same
 * reason.
 */
export const SUMMARY_AGAIN_AFTER_DAYS = 6

const MS_PER_DAY = 86_400_000

/**
 * What the owner does about this row, named after the action rather than the state.
 *
 * 'send' is a family to message now. 'sent' is one already told. The other two are
 * rows that cannot be messaged yet, and they are separate because the fix is
 * different and belongs to a different person: 'nothing' means take the register or
 * mark the exam, 'noNumber' means somebody has to ask the family for a number.
 *
 * A four-way union rather than booleans, so a screen that grows a fifth case gets a
 * non-exhaustive `switch` from TypeScript instead of a row that renders blank.
 */
export type ProgressStatus = 'send' | 'sent' | 'nothing' | 'noNumber'

/** One student's week, and what to do about it. */
export type ProgressStudent = {
  studentId: string
  name: string
  code: string | null
  guardianPhone: string | null
  /** Silences the two message chips, never the call. Same rule as fee reminders. */
  smsOptOut: boolean
  /**
   * Which chip goes first for this family, or null when nobody has said. Carried
   * rather than decided here: this file judges the *week*, and how a family likes
   * to be reached is not a fact about the week. See ./channel.ts.
   */
  preferredChannel: OutreachChannel | null
  /** Carried from the view so the message, the screen and the log agree. */
  weekFrom: string
  weekTo: string
  sessionsCounted: number
  sessionsPresent: number
  sessionsAbsent: number
  sessionsLate: number
  sessionsExcused: number
  /**
   * Present as a share of the sessions that counted, or null when none did.
   *
   * Null and 0 are opposite facts: nobody took the register, versus the child came
   * to none of six classes. Anything that collapses them tells a parent the second
   * when the truth is the first.
   */
  attendancePct: number | null
  examsTaken: number
  examsMissed: number
  marksPct: number | null
  lastExamTitle: string | null
  /** Numbers, not the strings PostgREST sent. See the note on ProgressRow. */
  lastExamObtained: number | null
  lastExamTotal: number | null
  lastExamDate: string | null
  lastSentAt: string | null
  /** Whole days since this family last heard anything; null if they never have. */
  daysSinceSent: number | null
  status: ProgressStatus
}

function count(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** A numeric-as-string mark to a number, or null when there is no mark at all. */
function mark(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The narrow shape both the screen's row and the dashboard's count decide from.
 *
 * Nothing about a child is in it, which is the point: what to do about a row turns
 * only on whether there is anything true to say, whether the family was told
 * recently, and whether there is a number to say it to.
 */
export type ProgressDecisionInput = {
  sessionsCounted: number
  examsTaken: number
  examsMissed: number
  guardianPhone: string | null
  lastSentAt: string | null
}

/**
 * What to do about one row, and how long since this family last heard anything.
 *
 * Extracted rather than inlined into `weeklyProgress` because the dashboard counts
 * the same thing from a narrower select, and a count that disagrees with the list
 * behind it is worse than no count: the owner taps a card promising twelve
 * families and lands on a screen with three. One function, two callers, nothing
 * to keep in step.
 */
export function progressDecision(
  input: ProgressDecisionInput,
  now: Date,
): { status: ProgressStatus; daysSinceSent: number | null } {
  const lastSentMs = input.lastSentAt ? Date.parse(input.lastSentAt) : NaN
  const daysSinceSent = Number.isFinite(lastSentMs)
    ? // Clamped, because a row written by a server whose clock runs ahead of this
      // one would otherwise read as "-1 days ago" on an owner's screen.
      Math.max(0, Math.floor((now.getTime() - lastSentMs) / MS_PER_DAY))
    : null

  // Nothing happened, or nothing was written down — the two are the same fact from
  // this screen's side, and the wording says so. A missed exam counts as something
  // to say: "sat none of this week's tests" is the whole message.
  const nothingToSay =
    input.sessionsCounted === 0 && input.examsTaken === 0 && input.examsMissed === 0

  // Order matters, and it is an order of usefulness rather than of severity.
  // Nothing recorded comes first because it is a hole in the centre's own week and
  // it makes every other question about the row moot. Already-told comes next so a
  // finished family never appears as work. A missing number is last of the three:
  // it is worth surfacing, but only once there is something to send.
  const status: ProgressStatus = nothingToSay
    ? 'nothing'
    : daysSinceSent !== null && daysSinceSent < SUMMARY_AGAIN_AFTER_DAYS
      ? 'sent'
      : input.guardianPhone
        ? 'send'
        : 'noNumber'

  return { status, daysSinceSent }
}

/**
 * The roster, in the order it should be worked down.
 *
 * The families to message first, then the two kinds of row that need fixing before
 * they can be messaged, then the ones already told. An owner opening this screen on
 * a Thursday evening wants to start tapping, not to scroll past their own successes.
 *
 * WITHIN THE SEND GROUP: worst attendance first. Not the best-behaved child and not
 * alphabetical, because the whole reason to send progress rather than only ever
 * sending bills is that a parent finds out their child stopped attending while
 * there is still something to be done about it — and an owner who gets through
 * forty of a hundred and fifty names on a Thursday should have spent those forty on
 * the families where it counts. Where attendance ties, more missed exams first: a
 * child who sat none of the week's tests is drifting whether or not they are in the
 * room.
 *
 * A student with a mark and no attendance figure at all sorts last inside their
 * group rather than first. Nothing recorded is not the same fact as a bad week, and
 * putting them above a measured 2 out of 6 would cost this list its one job — the
 * same call `studentsAtRisk` makes about a missing percentage, for the same reason.
 *
 * Name breaks the last tie so the order is stable across renders: without it two
 * students with identical figures swap places between two loads of the same screen,
 * which reads as the list being recomputed on every tap.
 *
 * `now` is a parameter so the "told recently" window is testable without freezing a
 * clock.
 */
export function weeklyProgress(
  rows: ProgressRow[] | null | undefined,
  unknownName: string,
  now: Date = new Date(),
): ProgressStudent[] {
  const list: ProgressStudent[] = []

  for (const row of rows ?? []) {
    // A row with no student_id cannot be keyed, linked or messaged. PostgREST types
    // it nullable and the view never returns one; skipping is cheaper than
    // rendering a name with nothing behind it.
    if (!row.student_id) continue

    const sessionsCounted = count(row.sessions_counted)
    const sessionsPresent = count(row.sessions_present)
    const examsTaken = count(row.exams_taken)
    const examsMissed = count(row.exams_missed)

    const lastSentAt = row.last_sent_at ?? null
    const { status, daysSinceSent } = progressDecision(
      {
        sessionsCounted,
        examsTaken,
        examsMissed,
        guardianPhone: row.guardian_phone ?? null,
        lastSentAt,
      },
      now,
    )

    list.push({
      studentId: row.student_id,
      name: row.student_name || unknownName,
      code: row.student_code ?? null,
      guardianPhone: row.guardian_phone ?? null,
      smsOptOut: row.sms_opt_out ?? false,
      preferredChannel: row.preferred_channel ?? null,
      // The view always returns both; falling back to the empty string keeps a
      // malformed row off the screen's date formatter rather than crashing it.
      weekFrom: row.week_from ?? '',
      weekTo: row.week_to ?? '',
      sessionsCounted,
      sessionsPresent,
      sessionsAbsent: count(row.sessions_absent),
      sessionsLate: count(row.sessions_late),
      sessionsExcused: count(row.sessions_excused),
      attendancePct:
        sessionsCounted > 0 ? Math.round((sessionsPresent / sessionsCounted) * 100) : null,
      examsTaken,
      examsMissed,
      marksPct: row.marks_pct ?? null,
      lastExamTitle: row.last_exam_title ?? null,
      lastExamObtained: mark(row.last_exam_obtained),
      lastExamTotal: mark(row.last_exam_total),
      lastExamDate: row.last_exam_date ?? null,
      lastSentAt,
      daysSinceSent,
      status,
    })
  }

  const rank: Record<ProgressStatus, number> = {
    send: 0,
    nothing: 1,
    noNumber: 2,
    sent: 3,
  }

  list.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
    // Infinity, so no attendance figure sorts below every measured one. Comparing
    // nulls directly would put them first, silently.
    const attA = a.attendancePct ?? Infinity
    const attB = b.attendancePct ?? Infinity
    if (attA !== attB) return attA - attB
    if (a.examsMissed !== b.examsMissed) return b.examsMissed - a.examsMissed
    return a.name.localeCompare(b.name, 'bn-BD')
  })

  return list
}

/**
 * The line across the top of the screen.
 *
 * `withAttendance` and `withMarks` are here for the sentence that matters most on a
 * quiet week: a centre that took no register at all gets one line saying so instead
 * of a hundred and fifty rows each saying it separately. They count students the
 * view found something for, which is not `students - nothing` — a child with a
 * missed exam and no register has neither figure and is still not `nothing`.
 */
export type ProgressTotals = {
  students: number
  send: number
  sent: number
  nothing: number
  noNumber: number
  withAttendance: number
  withMarks: number
}

export function progressTotals(list: readonly ProgressStudent[]): ProgressTotals {
  const totals: ProgressTotals = {
    students: list.length,
    send: 0,
    sent: 0,
    nothing: 0,
    noNumber: 0,
    withAttendance: 0,
    withMarks: 0,
  }

  for (const s of list) {
    totals[s.status] += 1
    if (s.sessionsCounted > 0) totals.withAttendance += 1
    if (s.examsTaken > 0) totals.withMarks += 1
  }

  return totals
}

/**
 * Why this week's list came out empty.
 *
 * 'noStudents' — nobody on the roster yet. A new centre, and the only one of the
 * four where the fix is not on this screen's own subject.
 *
 * 'nothingRecorded' — the students still to tell have no attendance and no marks
 * this week. A hole in the centre's own week, and the fix is a register.
 *
 * 'noNumbers' — the families still to tell have no guardian number on file. A data
 * problem, and the slowest of the three to fix: somebody has to ask the family.
 *
 * 'allRecent' — every guardian was told within the last few days. The finished one.
 *
 * "Still to tell" is doing real work in two of those sentences, and it is what
 * makes them true rather than merely reassuring. When this function answers
 * 'noNumbers' the families already told are excluded by those two words, so the
 * screen no longer has to claim something universal about a mixed week.
 */
export type ProgressEmptyReason =
  | 'noStudents'
  | 'nothingRecorded'
  | 'noNumbers'
  | 'allRecent'

/**
 * In the order `progressEmptyReason` asks the questions, which is also the order a
 * dictionary and its test iterate. Exported so copy for a fifth reason cannot be
 * forgotten — see tests/i18n.test.ts.
 */
export const PROGRESS_EMPTY_REASONS: readonly ProgressEmptyReason[] = [
  'noStudents',
  'nothingRecorded',
  'noNumbers',
  'allRecent',
]

/**
 * Which of the four situations an empty list is, or null when it is not empty.
 *
 * Returning null rather than leaving the caller to ask `send === 0` for itself is
 * the point: the page then has one value that both decides whether to draw the
 * "nothing to do" card and says what it should read, so the two can never
 * disagree. Its sibling `chaseEmptyReason` in ../fees/reminder-schedule.ts exists
 * for the same reason, after the fee worklist shipped that exact disagreement.
 *
 * 'allRecent' is last, and that is the fix this function was extracted for. The
 * page used to reach it whenever `sent` outnumbered whatever else was going on, so
 * a week with five families told and three with no number on file printed "every
 * guardian was told within the last few days" directly above a card naming the
 * three nobody could tell. It is now reachable only when `sent` accounts for every
 * student, which is the only state that sentence is true in.
 *
 * The two remedies are ordered by size rather than by kind, which is the one
 * judgement here. A centre with a hundred unrecorded weeks and one missing phone
 * number should be told to take the register; the same centre with one unrecorded
 * week and a hundred missing numbers should be sent to the students page. Ties go
 * to 'noNumbers' because collecting a phone number takes days and taking a register
 * takes a minute.
 */
export function progressEmptyReason(totals: ProgressTotals): ProgressEmptyReason | null {
  if (totals.send > 0) return null
  if (totals.students === 0) return 'noStudents'
  if (totals.nothing > totals.noNumber) return 'nothingRecorded'
  if (totals.noNumber > 0) return 'noNumbers'
  return 'allRecent'
}

/**
 * How many families can be told today — the number on the dashboard's door.
 *
 * Takes rows straight off the view, so the caller can select six columns instead of
 * twenty, and decides with `progressDecision`, so it cannot count a different set
 * than the screen lists. Rows missing a `student_id` are skipped for the same
 * reason `weeklyProgress` drops them: there is nothing to message.
 */
export function progressToTell(
  rows: readonly ProgressCountRow[] | null | undefined,
  now: Date = new Date(),
): number {
  let n = 0

  for (const row of rows ?? []) {
    if (!row.student_id) continue
    const { status } = progressDecision(
      {
        sessionsCounted: count(row.sessions_counted),
        examsTaken: count(row.exams_taken),
        examsMissed: count(row.exams_missed),
        guardianPhone: row.guardian_phone ?? null,
        lastSentAt: row.last_sent_at ?? null,
      },
      now,
    )
    if (status === 'send') n += 1
  }

  return n
}
