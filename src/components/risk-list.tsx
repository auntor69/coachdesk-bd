import type { ReactNode } from 'react'
import Link from 'next/link'

import { formatBdMobile } from '@/lib/bd/phone'
import { formatTaka } from '@/lib/money'
import type { RiskReason, RiskStudent } from '@/lib/students/risk'
import type { Dictionary } from '@/lib/i18n'

/**
 * The students who are drifting, rendered once for the two screens that show them.
 *
 * The dashboard card shows the top few and the /at-risk page shows all of them,
 * and they have to say the same thing about the same student in the same words. A
 * card that summarised while the page spelled out would leave an owner comparing
 * two descriptions of one child and wondering which is current — so both import
 * this, and the only difference between them is how many rows they pass.
 *
 * A server component, so it takes `Dictionary['risk']` rather than `T<'risk'>`:
 * `count`, `signalCount`, `days` and `reasons.examsMissed` are functions, because
 * English inflects on counts that Bangla ignores, and `T<>` maps function leaves
 * to `never` to keep them out of client bundles.
 *
 * No locale threading. Every figure here is a percentage, a taka amount, a day
 * count or a phone number, and all four stay ASCII in both languages — a row
 * reading "১২ দিন · 55%" would be two numeral systems in one line, and a number
 * an owner dials must be the digits on their keypad. The rule and the reason are
 * the same as on `AttendanceRates`.
 */

/**
 * Chip styling per level, keyed to `RiskLevel`.
 *
 * Colour never travels alone here either: the chip always carries the word, for
 * the reason spelled out in globals.css. Red for 'call' is the same red as an
 * absence and an error banner, which is the point — an owner has already learnt
 * what that colour means in this app.
 */
const LEVEL_CHIP: Record<RiskStudent['level'], string> = {
  watch: 'border-line bg-surface-alt text-ink-soft',
  talk: 'border-late/40 bg-late/5 text-late',
  call: 'border-absent/30 bg-absent/5 text-absent',
}

/** A figure, in the tabular numerals every number in this app uses. */
function Num({ children }: { children: ReactNode }) {
  return <span className="num font-medium text-ink">{children}</span>
}

/**
 * One reason as one line.
 *
 * The `switch` is exhaustive over `RiskReason` and TypeScript enforces it, which
 * is the whole reason the view exposes an arm per sentence instead of a flag per
 * signal: a fourth thing to say about a student cannot be added to the migration
 * and silently dropped here. There is no `default`, so the missing case is a
 * compile error rather than a blank row.
 *
 * A percentage can be null even on a fired arm — the fee arm fires on a student
 * with nothing marked — so `noFigure` stands in rather than a bare '%'.
 */
function Reason({ reason, t }: { reason: RiskReason; t: Dictionary['risk'] }) {
  const pct = (value: number | null) =>
    value === null ? <span className="text-ink-faint">{t.noFigure}</span> : <Num>{value}%</Num>

  switch (reason.kind) {
    case 'attendanceLow':
      return (
        <>
          {t.reasons.attendanceLow} · {pct(reason.pct)}
        </>
      )
    case 'attendanceFell':
      return (
        <>
          {t.reasons.attendanceFell} · {pct(reason.pct)} · {t.was} {pct(reason.prevPct)}
        </>
      )
    case 'marksLow':
      return (
        <>
          {t.reasons.marksLow} · {pct(reason.pct)}
        </>
      )
    case 'marksFell':
      return (
        <>
          {t.reasons.marksFell} · {pct(reason.pct)} · {t.was} {pct(reason.prevPct)}
        </>
      )
    case 'examsMissed':
      return (
        <>
          <Num>{reason.n}</Num> {t.reasons.examsMissed(reason.n)}
        </>
      )
    case 'feeLate':
      return (
        <>
          {t.reasons.feeLate} · <Num>{formatTaka(reason.owed)}</Num> ·{' '}
          <Num>{reason.daysLate}</Num> {t.days(reason.daysLate)}
        </>
      )
  }
}

/**
 * How loud it is, as a word in a chip.
 *
 * Exported because the student's own page shows the same chip, and a second copy
 * of `LEVEL_CHIP` is how the two screens end up disagreeing about which red means
 * "call today".
 */
export function RiskLevelChip({
  level,
  t,
}: {
  level: RiskStudent['level']
  t: Dictionary['risk']
}) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${LEVEL_CHIP[level]}`}
    >
      {t.levels[level]}
    </span>
  )
}

/**
 * Every reason under one student, as a list.
 *
 * Exported for the student's own profile, which shows these sentences without the
 * name and phone number wrapped round them — it already has both at the top of the
 * page. Sharing the list rather than re-rendering it there is the point: the three
 * screens that tell an owner a child is drifting have to say it in the same words,
 * or the owner is left comparing descriptions and guessing which is current.
 */
export function RiskReasons({
  reasons,
  t,
}: {
  reasons: RiskReason[]
  t: Dictionary['risk']
}) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm text-ink-soft">
      {reasons.map((reason) => (
        <li key={reason.kind}>
          <Reason reason={reason} t={t} />
        </li>
      ))}
    </ul>
  )
}

/**
 * One student: who they are, how loud it is, and every reason spelled out.
 *
 * The reasons are a list and not a summary. "Two signals" tells an owner to open
 * something; "attendance dropped to 55%, fee unpaid 12 days" tells them what to
 * say when the guardian picks up, which is the only work this screen saves.
 *
 * The name is a link to the student's own page, which is where the rest of the
 * picture is — every mark, every bill, and which batch the absences are in. Both
 * screens that render this row are staff-admin, so the link never lands on a
 * refusal. It is the name and not the whole row on purpose: the row also holds a
 * `tel:` link, and a nested anchor is not a thing HTML has.
 *
 * The call link is not suppressed by an SMS opt-out, matching the reminder chips:
 * a family that asked not to be texted has not asked never to be spoken to.
 *
 * THE NUMBER IS PRINTED, not hidden behind the label. `tel:` opens nothing on a
 * laptop, and this row is the one place an owner sees a drifting student without
 * already being on that student's page — so a label alone left them clicking a
 * link that did nothing, with the number they wanted sitting in the href. Unlike
 * the fee and progress chips there is nothing to un-record here, which is why this
 * needs no pointer query: the number is worth showing on a phone too, since it is
 * what the owner reads back to whoever picks up.
 */
export function RiskStudentRow({ student, t }: { student: RiskStudent; t: Dictionary['risk'] }) {
  return (
    <li className="border-t border-line pt-3 first:border-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-medium text-ink">
          <Link
            href={`/students/${student.studentId}`}
            className="underline decoration-line underline-offset-2 hover:decoration-brand-500"
          >
            {student.name}
          </Link>
          {student.code && (
            <span className="num ml-2 text-xs text-ink-faint">{student.code}</span>
          )}
        </p>
        <RiskLevelChip level={student.level} t={t} />
      </div>

      <div className="mt-1">
        <RiskReasons reasons={student.reasons} t={t} />
      </div>

      {student.guardianPhone ? (
        <a
          href={`tel:${student.guardianPhone}`}
          className="mt-1.5 inline-block text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          {t.callGuardian}{' '}
          <span className="num">{formatBdMobile(student.guardianPhone)}</span>
        </a>
      ) : (
        <p className="mt-1.5 text-sm text-ink-faint">{t.noPhone}</p>
      )}
    </li>
  )
}

/** The rows, worst first — `studentsAtRisk` has already put them in order. */
export function RiskList({
  students,
  t,
}: {
  students: RiskStudent[]
  t: Dictionary['risk']
}) {
  return (
    <ul className="flex flex-col gap-3">
      {students.map((student) => (
        <RiskStudentRow key={student.studentId} student={student} t={t} />
      ))}
    </ul>
  )
}
