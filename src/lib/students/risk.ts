/**
 * Turning `student_risk` rows into the worklist an owner reads.
 *
 * The view decides *who* is drifting and why — every threshold lives in
 * 20260811000014_student_risk.sql and nowhere else, so nothing in this file may
 * compare a percentage against a number. What is left is the part that is about
 * the screen rather than about the student: which sentences to write about each
 * one, in what order the rows go, how loudly to say it, and — see `blindArms` —
 * which of the three signals the centre has given the view anything to read.
 *
 * That split is deliberate. A threshold duplicated here would drift the first
 * time one copy was edited, and both screens would keep rendering perfectly while
 * disagreeing about who is at risk. A sort order duplicated in a page would go
 * wrong silently in exactly the same way, which is why it is here and tested
 * rather than inline in a JSX map.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */

/**
 * One row of student_risk as PostgREST hands it back. Every column of a view is
 * nullable in the generated types, and here several of them genuinely are: a
 * student with no marks in the window has no percentage, which is a different
 * fact from having scored zero.
 */
export type RiskRow = {
  student_id: string | null
  student_name: string | null
  student_code: string | null
  guardian_phone: string | null
  att_marks: number | null
  att_pct: number | null
  att_prev_marks: number | null
  att_prev_pct: number | null
  marks_pct: number | null
  marks_prev_pct: number | null
  marks_prev_n: number | null
  exams_missed: number | null
  fee_days_late: number | null
  fee_owed_bdt: number | null
  att_low: boolean | null
  att_fell: boolean | null
  marks_low: boolean | null
  marks_fell: boolean | null
  marks_missed: boolean | null
  /** The fee signal has one arm, so the view exposes no `fee_late` beside it. */
  fee_flag: boolean | null
  signals: number | null
}

/**
 * The columns to select, in one place, because two screens read this view.
 *
 * A page that forgot `att_fell` would not fail — PostgREST omits the key,
 * `reasonsFor` reads it as undefined, and the row renders with the low-attendance
 * sentence instead of the one that mentions last month. Silently right-looking and
 * wrong. Named here so the dashboard card and the /at-risk page cannot diverge.
 *
 * One string on one line rather than a concatenation, the same as the fee board's:
 * a line break inside the list reaches PostgREST as part of a column name.
 */
export const RISK_COLUMNS =
  'student_id, student_name, student_code, guardian_phone, att_marks, att_pct, att_prev_marks, att_prev_pct, marks_pct, marks_prev_pct, marks_prev_n, exams_missed, fee_days_late, fee_owed_bdt, att_low, att_fell, marks_low, marks_fell, marks_missed, fee_flag, signals'

/**
 * How loudly to say it, named after the action rather than the severity.
 *
 * 'watch', 'talk', 'call' — not 'low', 'medium', 'high'. An owner reading a list
 * of severities has to translate each one into something to do, and the whole
 * value of this screen is that it arrives already translated. One signal is worth
 * knowing about; two is worth a conversation at the gate; three means the seat is
 * about to be empty and the phone call is today.
 */
export type RiskLevel = 'watch' | 'talk' | 'call'

/**
 * One line the screen will write about this student, with the figures it needs to
 * write it and nothing else.
 *
 * A discriminated list rather than the three nullable signal objects it replaced,
 * because what every screen actually does with this data is render one sentence
 * per thing that is wrong. Handing over flags and percentages instead would make
 * each page decide which sentence the numbers deserve — and deciding that means
 * comparing a percentage against a threshold, which is the one thing this file is
 * not allowed to do. The view says which arm fired; `kind` carries that across
 * unchanged, and the page's only job is to look up the wording.
 *
 * The upshot is that a fourth signal added to the view is a new `kind`, a new
 * dictionary key, and a `switch` that TypeScript reports as non-exhaustive at
 * every call site — rather than a silently ignored boolean.
 */
export type RiskReason =
  /** Attendance is low, full stop. */
  | { kind: 'attendanceLow'; pct: number | null; marks: number }
  /** Attendance fell against the month before — carries both figures. */
  | { kind: 'attendanceFell'; pct: number | null; prevPct: number | null; marks: number }
  /** The latest mark is low, full stop. */
  | { kind: 'marksLow'; pct: number | null }
  /** The latest mark fell against the earlier ones — carries both, and how many. */
  | { kind: 'marksFell'; pct: number | null; prevPct: number | null; prevN: number }
  /** Sat none of the last several exams. Never averaged in as zeroes. */
  | { kind: 'examsMissed'; n: number }
  /** A fee is past due. `owed` is every unpaid taka, not only the late invoice. */
  | { kind: 'feeLate'; daysLate: number; owed: number }

export type RiskStudent = {
  studentId: string
  name: string
  code: string | null
  guardianPhone: string | null
  /**
   * How many of the three signals fired — attendance, marks, fees. Not
   * `reasons.length`: attendance under 70% *and* twenty points down is two arms of
   * one signal, and a student drifting in one way is not in more trouble than one
   * drifting in three just because their one problem is describable twice.
   */
  signals: number
  level: RiskLevel
  /** In signal order: attendance, then marks, then the fee. Never empty. */
  reasons: RiskReason[]
}

/**
 * Signal count to level. Total over 1–3 by construction: the view only returns
 * rows with at least one flag and there are only three flags to have.
 *
 * A count outside that range means the view and this file have stopped agreeing
 * about how many signals exist, and the honest answer to an impossible number is
 * the loudest level rather than a crash on the owner's home screen.
 */
export function riskLevel(signals: number): RiskLevel {
  if (signals >= 3) return 'call'
  if (signals === 2) return 'talk'
  return 'watch'
}

/** Which of the three signals this screen is able to say anything about. */
export type RiskArm = 'attendance' | 'marks' | 'fees'

/**
 * What the centre has actually recorded for each of the three, as the counts
 * PostgREST hands back. Null is "the query failed", not zero — see below.
 */
export type RiskInputs = {
  /** Registers taken inside the attendance window. */
  sessions: number | null
  /** Exams held inside the marks window. */
  exams: number | null
  /** Invoices ever raised. Not overdue ones — see below. */
  invoices: number | null
}

/**
 * Which of the three signals is blind, because the centre has recorded nothing
 * for it to read.
 *
 * WHY THIS EXISTS. `student_risk` returns a student when one of three things looks
 * wrong, and every one of the three is built from data the centre has to have put
 * in. A centre that has never taken a register produces no attendance signal for
 * anybody; one that has never held an exam produces no marks signal. So an empty
 * worklist has two completely different meanings — nobody is drifting, or nothing
 * was looked at — and the screen said the first one either way: "no student is
 * showing a bad sign in any of the three". That sentence is at its most confident
 * exactly when it knows least, on the screen whose entire job is to be the warning
 * that arrives before a seat goes empty.
 *
 * EXISTENCE, NOT THRESHOLDS. This asks whether anything was recorded, and never
 * how much or how bad. The view's thresholds — four registers, 40%, twenty points,
 * seven days — stay in 20260811000014 where a screen cannot reach them, for the
 * reason at the top of this file. So the claim made here is deliberately the weak
 * one: a centre with two registers in the month still cannot flag anybody on
 * attendance and will not be told so. Saying less than everything is the price of
 * not keeping a second copy of a number that decides who gets a phone call.
 *
 * FEES ARE NOT SYMMETRICAL. No registers does not mean the students were there,
 * and no exams does not mean the marks were fine — but no invoices really does mean
 * nobody owes the centre anything through this product. So the fee arm is blind
 * only when nothing was ever billed at all; invoices that exist and are all paid on
 * time are a genuine all-clear, and reporting that as blindness would be its own
 * kind of lie.
 *
 * A NULL CLAIMS NOTHING. A failed count is not a zero, and treating it as one would
 * put "no registers have been taken" on the screen of a centre that takes one every
 * day. An arm whose count did not arrive is left out of this list, which leaves the
 * screen saying exactly what it said before — the same call setupSteps makes.
 */
export function blindArms({ sessions, exams, invoices }: RiskInputs): RiskArm[] {
  const blind: RiskArm[] = []
  if (sessions === 0) blind.push('attendance')
  if (exams === 0) blind.push('marks')
  if (invoices === 0) blind.push('fees')
  return blind
}

/**
 * The sentences for one row, in the order they should be read.
 *
 * Attendance before marks before fees, matching the order the masterplan lists
 * them and the order they matter in: an empty seat is the thing this screen
 * exists to catch, a falling mark is the reason behind it, and the unpaid fee is
 * the consequence.
 *
 * Where both arms of a signal fired, only the richer sentence is written. A
 * student at 55% who was at 88% gets "55%, was 88%" and not that line plus a bare
 * "55%" above it — the fell wording already contains the low one's only figure,
 * and two lines saying one thing reads as a bug. Missed exams are not an arm of
 * the mark itself, so they get their own line either way: "90%, sat none of the
 * last two" is a real and useful sentence.
 */
function reasonsFor(row: RiskRow): RiskReason[] {
  const reasons: RiskReason[] = []
  const attMarks = Number(row.att_marks ?? 0)

  if (row.att_fell) {
    reasons.push({
      kind: 'attendanceFell',
      pct: row.att_pct ?? null,
      prevPct: row.att_prev_pct ?? null,
      marks: attMarks,
    })
  } else if (row.att_low) {
    reasons.push({ kind: 'attendanceLow', pct: row.att_pct ?? null, marks: attMarks })
  }

  if (row.marks_fell) {
    reasons.push({
      kind: 'marksFell',
      pct: row.marks_pct ?? null,
      prevPct: row.marks_prev_pct ?? null,
      prevN: Number(row.marks_prev_n ?? 0),
    })
  } else if (row.marks_low) {
    reasons.push({ kind: 'marksLow', pct: row.marks_pct ?? null })
  }

  if (row.marks_missed) {
    reasons.push({ kind: 'examsMissed', n: Number(row.exams_missed ?? 0) })
  }

  if (row.fee_flag) {
    reasons.push({
      kind: 'feeLate',
      daysLate: Number(row.fee_days_late ?? 0),
      owed: Number(row.fee_owed_bdt ?? 0),
    })
  }

  return reasons
}

/**
 * The worklist, worst first.
 *
 * Most signals first, and then — within a tie — the student attending least. That
 * second key is the one worth arguing about, because the obvious alternative is
 * the largest debt, and this list is not a collection tool. The masterplan asks
 * for "the owner's early warning before a student quietly drops out"; a family
 * three weeks behind on a fee is usually still coming to class, and a student who
 * has stopped turning up has usually stopped paying too. Attendance is the signal
 * that the seat is going empty, so it breaks the tie.
 *
 * A student whose attendance is not the problem sorts last among their tie rather
 * than first. No attendance signal is not the same fact as a bad one, and neither
 * is nothing recorded — that usually means the batch has not been registered yet.
 * Either way, putting them above a measured 20% would cost this list its one job.
 *
 * Name breaks the final tie so the order is stable across renders. Without it two
 * students with identical figures can swap places between two loads of the same
 * screen, which reads as the list being recomputed on every tap.
 */
export function studentsAtRisk(
  rows: RiskRow[] | null | undefined,
  unknownName: string,
): RiskStudent[] {
  // Sort keys carried alongside rather than on RiskStudent, so that a page cannot
  // reach for a raw percentage instead of the sentence written for it.
  const ranked: { student: RiskStudent; attPct: number; feeLate: number }[] = []

  for (const row of rows ?? []) {
    // A row with no student_id cannot be linked to, phoned, or keyed in a list.
    // PostgREST types it nullable and it never is; skipping is cheaper than
    // rendering a name with nothing behind it.
    if (!row.student_id) continue

    const reasons = reasonsFor(row)

    // No arm fired, so the view would not have returned this row. Reachable only
    // if a caller passes rows from somewhere else, and a student on the worklist
    // with no reason under their name is worse than one line missing.
    if (reasons.length === 0) continue

    const att = reasons.find(
      (r) => r.kind === 'attendanceLow' || r.kind === 'attendanceFell',
    )
    const fee = reasons.find((r) => r.kind === 'feeLate')

    ranked.push({
      student: {
        studentId: row.student_id,
        name: row.student_name || unknownName,
        code: row.student_code ?? null,
        guardianPhone: row.guardian_phone ?? null,
        signals: Number(row.signals ?? 0),
        level: riskLevel(Number(row.signals ?? 0)),
        reasons,
      },
      // Infinity, so a student with no attendance signal sorts below every student
      // who has one whatever else is wrong with them — see the note above.
      // Comparing nulls directly would put them first, silently.
      attPct: att?.pct ?? Infinity,
      feeLate: fee?.daysLate ?? 0,
    })
  }

  ranked.sort((a, b) => {
    if (a.student.signals !== b.student.signals) return b.student.signals - a.student.signals
    if (a.attPct !== b.attPct) return a.attPct - b.attPct
    if (a.feeLate !== b.feeLate) return b.feeLate - a.feeLate
    return a.student.name.localeCompare(b.student.name)
  })

  return ranked.map((r) => r.student)
}
