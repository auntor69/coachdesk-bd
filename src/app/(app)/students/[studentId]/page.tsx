import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { RiskLevelChip, RiskReasons } from '@/components/risk-list'
import { pageRole, isStaffAdmin, canReadFees, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { has } from '@/lib/plans'
import { formatBdMobile } from '@/lib/bd/phone'
import { addDays, formatDate, formatMonth, todayInDhaka } from '@/lib/bd/time'
import { formatTaka } from '@/lib/money'
import { RISK_COLUMNS, studentsAtRisk } from '@/lib/students/risk'
import {
  attendanceByBatch,
  examMarks,
  feeHistory,
  PROFILE_ATTENDANCE_DAYS,
  PROFILE_EXAM_LIMIT,
  PROFILE_INVOICE_LIMIT,
  type EnrolledBatch,
} from '@/lib/students/profile'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).studentProfile.title} — CoachDesk` }
}

/**
 * One student, whole — the screen the masterplan asks for and the app did not have.
 *
 * FOUNDATION workflow 7: "owner opens a student → sees attendance rate, marks
 * across exams, fee status, and flags in one screen". Until this page the only
 * per-student route was the edit form, so answering a parent on the phone meant
 * opening four screens and holding three numbers in your head.
 *
 * READ-ONLY, AND THAT IS THE FEATURE. There is no button here that changes
 * anything: no fee entry, no attendance correction, no message. Every one of those
 * exists on the screen built for doing it in bulk, which is where the guardrails
 * and the confirmations are. A page that both answers a question and takes an
 * action gets tapped while its reader is talking to somebody.
 *
 * WHO MAY OPEN IT. `pageRole('teacher')`, which is a floor rather than the answer:
 * RLS decides *which* student each reader can see, and it narrows differently for
 * each of them. A staff-admin reads the whole centre. A teacher reads only the
 * students in the batches they teach (students_teacher_read), or the whole roster
 * if their owner ticked can_manage_students (20260811000019). A student or guardian
 * clears none of it and gets /me, which is the same facts written for them.
 *
 * So an unreadable student is a 404 and not a 403, because those two are the same
 * event here: `maybeSingle` returns nothing whether the row does not exist or the
 * policy hid it, and a page that said "you may not see this student" would confirm
 * the student exists to somebody who cannot see them.
 *
 * THE PARTIAL-VISIBILITY TRAP, which is why the attendance panel is per batch. A
 * teacher's read of enrollments, attendance and exams is narrowed to their own
 * batches, so a single "attendance 62%" printed here would be that teacher's
 * batches' share of the student wearing the whole student's name — and nothing on
 * screen would say so. Per batch is honest for every reader and is the better
 * answer anyway: "fine in Physics, stopped coming to Chemistry" is a sentence worth
 * saying to a parent, and one averaged figure is not.
 *
 * Two panels are hidden rather than emptied, for the same reason. `student_risk` is
 * staff-admin-only, so a teacher reading it gets no rows — and an empty flags panel
 * reads as "nothing is wrong", which would be a claim this page cannot support. A
 * missing panel claims nothing. Fees do get a line saying who keeps them, because a
 * teacher already knows fees exist and is owed the name of the person to ask.
 */
export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ studentId: string }>
}) {
  const session = await pageRole('teacher')
  const { studentId } = await params
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.studentProfile
  const today = todayInDhaka()
  const centerId = session.active.centerId

  /*
   * One check, three consequences, because all three follow from the same fact: a
   * teacher's read of this student is narrower than an owner's. They may not edit the
   * record, `student_risk` returns them nothing, and RLS trims their enrolments,
   * sessions and results to the batches they teach. The third is the one worth a
   * sentence on the screen — the other two are handled by leaving things out.
   */
  const staffAdmin = isStaffAdmin(session)
  const mayEdit = staffAdmin
  const mayReadFlags = staffAdmin
  const mayReadFees = await canReadFees()

  /*
   * Whether a slip in the fee panel is a link, and whether the thing at the other
   * end of it is paper.
   *
   * The receipt page is staff-admin-only — issuing a receipt is the act of the person
   * who took the money — so a permitted teacher gets the slip's number, date and
   * amount as text and no tap that would land them on a 403. The plan check is only
   * about the sentence under the list: on a free tier the same link reaches the
   * receipt number and an upgrade rather than a printable sheet, which is worth
   * reaching and is not worth promising a print for.
   */
  const mayOpenReceipts = staffAdmin
  const receiptsPrint = staffAdmin && has(session.plan, 'printedReceipts')

  const { data: student } = await supabase
    .from('students')
    .select(
      `id, name, student_code, phone, guardian_name, guardian_phone,
       class_level, institution, status,
       enrollments (id, status, batch_id, batches (name))`,
    )
    // RLS decides which students this reader may see at all; this decides which
    // centre's student is being asked for. An owner of two centres passes
    // students_staff_admin_read at both, so without it a student id from the other
    // centre would render under this centre's name.
    .eq('coaching_center_id', centerId)
    .eq('id', studentId)
    .maybeSingle()

  if (!student) notFound()

  /*
   * Every enrolment, and then the active ones. Both are needed and they answer
   * different questions: attendance is only meaningful for a batch the student is
   * currently on the roll of, while a mark from a batch they left in April is still
   * their mark and still belongs on the page. So results are fetched against every
   * enrolment and the attendance panel is built from the active ones.
   */
  const enrollments = student.enrollments ?? []
  const enrollmentIds = enrollments.map((e) => e.id)

  const batchNameOf = (e: (typeof enrollments)[number]) => {
    const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches
    return batch?.name ?? ''
  }

  // Labels for every batch behind an enrolment, including ended ones, so an old
  // result still says which class it was sat in.
  const batchLabels = new Map<string, string>()
  for (const e of enrollments) {
    const name = batchNameOf(e)
    if (name) batchLabels.set(e.batch_id, name)
  }

  const activeBatches: EnrolledBatch[] = enrollments
    .filter((e) => e.status === 'active')
    .map((e) => ({ batchId: e.batch_id, label: batchNameOf(e) || d.dashboard.unknownBatch }))

  const batchIds = [...new Set(activeBatches.map((b) => b.batchId))]
  const from = addDays(today, -(PROFILE_ATTENDANCE_DAYS - 1))

  const [{ data: sessions }, { data: results }, { data: invoices }, { data: riskRows }] =
    await Promise.all([
      /*
       * Sessions first and marks second, rather than one query with an embedded
       * filter on attendance_records. An `!inner` embed would drop every session
       * this student was not marked for — which is precisely the gap the panel
       * exists to show — and it also loses the row types, for the reason set out at
       * length in lib/export/reports.ts. Two plain column filters instead.
       */
      batchIds.length > 0
        ? supabase
            .from('attendance_sessions')
            .select('id, batch_id, session_date')
            .eq('coaching_center_id', centerId)
            .in('batch_id', batchIds)
            .gte('session_date', from)
            .lte('session_date', today)
        : { data: [] },
      /*
       * By enrolment, because exam_results has no student_id — a result hangs off
       * the enrolment that sat it. Ordered by entry rather than by exam date, which
       * is a compromise: PostgREST cannot order a top-level list by an embedded
       * column without the kind of cleverness this codebase has already decided
       * against, so the twelve newest *entered* results are fetched and `examMarks`
       * puts them in exam-date order for the screen. The two differ only when a
       * teacher back-enters an old test, and then only in which one falls off the
       * bottom. Same shape as /me's own results query.
       */
      enrollmentIds.length > 0
        ? supabase
            .from('exam_results')
            .select(
              'id, obtained_marks, is_absent, exams (title, total_marks, exam_date, batch_id)',
            )
            .eq('coaching_center_id', centerId)
            .in('enrollment_id', enrollmentIds)
            .order('created_at', { ascending: false })
            .limit(PROFILE_EXAM_LIMIT)
        : { data: [] },
      /*
       * The balance comes from the view and never from invoices minus payments
       * here: numeric(10,2) through a JS float can leave a paid-up invoice owing
       * about 2e-13, which is greater than zero. See lib/money's header and the
       * same note on /me.
       *
       * `amount_bdt`, `discount_bdt` and `discount_reason` are the fee before any
       * waiver, the waiver, and why it was granted. All three are read and none is
       * computed: a bill with ৳৫০০ waived off it used to arrive here as a plain
       * ৳১,৫০০ net, so the one screen an owner opens with a parent on the phone was
       * the one screen that could not answer "why is our bill smaller".
       */
      mayReadFees
        ? supabase
            .from('fee_invoice_balances')
            .select('id, period_month, due_date, amount_bdt, discount_bdt, discount_reason, net_bdt, paid_bdt, remaining_bdt')
            .eq('coaching_center_id', centerId)
            .eq('student_id', studentId)
            .is('voided_at', null)
            .order('period_month', { ascending: false })
            .limit(PROFILE_INVOICE_LIMIT)
        : { data: null },
      // The same view the dashboard card and /at-risk read, asked about one student.
      // Returns nothing when no signal has fired, which is the good case.
      mayReadFlags
        ? supabase
            .from('student_risk')
            .select(RISK_COLUMNS)
            .eq('coaching_center_id', centerId)
            .eq('student_id', studentId)
        : { data: null },
    ])

  const sessionIds = (sessions ?? []).map((s) => s.id)
  // The bills the panel will actually draw, which is what bounds the receipts query
  // below. Taken from the rows that came back rather than from the limit, so a
  // student with three invoices does not ask about twelve.
  const invoiceIds = (invoices ?? []).map((i) => i.id).filter((id): id is string => !!id)

  const [{ data: marks }, { data: paymentRows }] = await Promise.all([
    // scoped-by: session ids and enrolment ids, both already filtered to this centre
    // by the queries above — a record can only be reached through one of them.
    sessionIds.length > 0 && enrollmentIds.length > 0
      ? supabase
          .from('attendance_records')
          .select('session_id, status')
          .eq('coaching_center_id', centerId)
          .in('session_id', sessionIds)
          .in('enrollment_id', enrollmentIds)
      : { data: [] },
    /*
     * Every slip raised against the bills above, so each one can be tapped and
     * printed again.
     *
     * THIS IS WHY THE PANEL EXISTS IN THIS SHAPE. A receipt is reachable from the fee
     * board only while its bill is this month's, and from the collection register only
     * for the month it fell in and only on a paid plan by a staff admin. So a parent
     * asking in October for the slip they were handed in July was asking for something
     * the app still held and could not show. The payment was never lost — nothing here
     * deletes money — it had no route to it.
     *
     * Bounded by `in(invoice_id, …)` and deliberately not limited. The figures on each
     * row must add up to the view's `paid_bdt`, which is `sum(amount_bdt)` over exactly
     * these payments, and a truncated list beside that total would read as money gone
     * missing. Twelve bills' worth of instalments is a couple of dozen rows.
     */
    mayReadFees && invoiceIds.length > 0
      ? supabase
          .from('fee_payments')
          .select('id, receipt_no, amount_bdt, paid_at, invoice_id')
          .eq('coaching_center_id', centerId)
          .in('invoice_id', invoiceIds)
      : { data: null },
  ])

  const attendance = attendanceByBatch(activeBatches, sessions, marks)
  const exams = examMarks(results, batchLabels)
  const fees = mayReadFees ? feeHistory(invoices, today, paymentRows) : null
  const risk = studentsAtRisk(riskRows, d.risk.noName)[0] ?? null

  const guardianPhone = student.guardian_phone
  const studentPhone = student.phone

  return (
    <div className="flex flex-col gap-4">
      <div>
        {/* Back to the list, labelled with where it goes, like every other back
            link in the app. The roster lives under settings because that is where
            a centre manages it; this page is where they read it. */}
        <Link
          href="/settings/students"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.roster}
        </Link>

        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink">
              {student.name}
              {student.status !== 'active' && (
                <span className="ml-2 align-middle text-sm font-normal text-ink-faint">
                  {t.inactive}
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-sm text-ink-soft">
              {[student.class_level, student.institution].filter(Boolean).join(' · ')}
            </p>
            {student.student_code && (
              <p className="num text-xs text-ink-faint">{student.student_code}</p>
            )}
          </div>

          {/* Only for an owner or manager. A permitted teacher may read this page
              and may not edit the record — 20260811000019 grants that box SELECT
              and INSERT and no UPDATE — and a button to a screen that refuses them
              is worse than no button. */}
          {mayEdit && (
            <Link
              href={`/settings/students/${student.id}`}
              className="inline-flex min-h-tap shrink-0 items-center justify-center
                rounded-xl border-2 border-line bg-white px-4 font-semibold text-ink
                hover:border-brand-300"
            >
              {t.edit}
            </Link>
          )}
        </div>
      </div>

      {/*
        Said once, above the panels it applies to, and only to the reader it applies
        to. A teacher seeing one batch of a three-batch student has no other way to
        know the other two exist — and a student in none of their batches would
        otherwise read "not enrolled in a batch", which is false about the student.
      */}
      {!staffAdmin && <p className="text-sm text-ink-faint">{t.teacherScope}</p>}

      {/*
        The numbers to ring, printed and not only linked. `tel:` opens nothing on a
        laptop, and an owner reads the digits back to whoever picks up — the same
        call RiskStudentRow makes and for the same reason.
      */}
      {(guardianPhone || studentPhone) && (
        <Card className="flex flex-col gap-2">
          {guardianPhone && (
            <a
              href={`tel:${guardianPhone}`}
              className="flex min-h-tap items-center justify-between gap-3"
            >
              <span className="min-w-0 truncate text-ink-soft">
                {t.contact.guardian}
                {student.guardian_name && (
                  <span className="ml-2 text-ink">{student.guardian_name}</span>
                )}
              </span>
              <span className="num shrink-0 font-semibold text-brand-700 underline underline-offset-2">
                {formatBdMobile(guardianPhone)}
              </span>
            </a>
          )}
          {studentPhone && (
            <a
              href={`tel:${studentPhone}`}
              className="flex min-h-tap items-center justify-between gap-3"
            >
              <span className="text-ink-soft">{t.contact.student}</span>
              <span className="num shrink-0 font-semibold text-brand-700 underline underline-offset-2">
                {formatBdMobile(studentPhone)}
              </span>
            </a>
          )}
        </Card>
      )}

      {/*
        The at-risk sentences, in the same words as the dashboard card and
        /at-risk — imported rather than rewritten, so the three cannot drift. Hidden
        entirely from a teacher, because student_risk returns them nothing and an
        empty panel would read as "nothing is wrong".
      */}
      {mayReadFlags && (
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-ink">{t.flags.title}</h2>
            {risk && <RiskLevelChip level={risk.level} t={d.risk} />}
          </div>
          {risk ? (
            <div className="mt-2">
              <RiskReasons reasons={risk.reasons} t={d.risk} />
              <p className="mt-2 text-xs text-ink-faint">{d.risk.windows}</p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">{t.flags.none}</p>
          )}
        </Card>
      )}

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-ink">{t.attendance.title}</h2>
          <p className="shrink-0 text-xs text-ink-faint">
            {t.attendance.window(PROFILE_ATTENDANCE_DAYS)}
          </p>
        </div>

        {attendance.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">{t.attendance.noBatches}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {attendance.map((row) => (
              <li key={row.batchId} className="border-t border-line pt-3 first:border-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate font-medium text-ink">{row.label}</p>
                  <p className="num shrink-0 font-semibold text-ink">
                    {row.ratePct === null ? (
                      <span className="text-sm font-normal text-ink-faint">
                        {d.dashboard.noRate}
                      </span>
                    ) : (
                      `${row.ratePct}%`
                    )}
                  </p>
                </div>

                {row.sessions === 0 ? (
                  <p className="mt-0.5 text-sm text-ink-faint">{t.attendance.noClasses}</p>
                ) : (
                  <>
                    {/* Marked out of held, always both. The gap between them is a
                        register that stopped being taken, which needs a different
                        conversation from a student who stopped turning up. */}
                    <p className="mt-0.5 text-sm text-ink-soft">
                      <span className="num">
                        {row.marked} / {row.sessions}
                      </span>{' '}
                      {t.attendance.marked}
                    </p>
                    {/* Every state on its own, so an owner who counts 'late'
                        differently from us can redo the sum from the same row. */}
                    <p className="mt-0.5 text-sm text-ink-soft">
                      <span className="num">{row.present}</span> {d.attendance.present} ·{' '}
                      <span className="num">{row.late}</span> {d.attendance.late} ·{' '}
                      <span className="num">{row.absent}</span> {d.attendance.absent}
                      {row.excused > 0 && (
                        <>
                          {' · '}
                          <span className="num">{row.excused}</span> {d.attendance.excused}
                        </>
                      )}
                    </p>
                    {row.marked < row.sessions && (
                      <p className="mt-0.5 text-sm text-late">{t.attendance.unmarkedNote}</p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-ink">{t.marks.title}</h2>

        {exams.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">{t.marks.none}</p>
        ) : (
          <>
            <ul className="mt-3 flex flex-col gap-2">
              {exams.map((mark) => (
                <li
                  key={mark.resultId}
                  className="flex items-start justify-between gap-3 border-t border-line
                    pt-2 first:border-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{mark.title}</p>
                    <p className="truncate text-sm text-ink-faint">
                      {[formatDate(mark.on, locale), mark.batchLabel]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <p className="shrink-0 text-right">
                    {mark.absent ? (
                      <span className="text-sm font-medium text-absent">
                        {d.attendance.absent}
                      </span>
                    ) : mark.obtained === null ? (
                      <span className="text-sm text-ink-faint">{t.marks.noMark}</span>
                    ) : (
                      <>
                        <span className="num font-semibold text-ink">
                          {mark.obtained}
                          {mark.total !== null && `/${mark.total}`}
                        </span>
                        {mark.pct !== null && (
                          <span className="num block text-xs text-ink-soft">{mark.pct}%</span>
                        )}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            {exams.length >= PROFILE_EXAM_LIMIT && (
              <p className="mt-2 text-xs text-ink-faint">
                {t.marks.limitNote(PROFILE_EXAM_LIMIT)}
              </p>
            )}
          </>
        )}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-ink">{t.fees.title}</h2>
          {/* Only where the figure is worth putting at the top of the panel. */}
          {fees && fees.outstanding > 0 && (
            <p className="num shrink-0 font-semibold text-absent">
              {formatTaka(fees.outstanding)}
            </p>
          )}
        </div>

        {!fees ? (
          <p className="mt-1 text-sm text-ink-soft">{t.fees.hidden}</p>
        ) : fees.lines.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">{t.fees.none}</p>
        ) : (
          <>
            {fees.outstanding === 0 && (
              <p className="mt-1 font-medium text-brand-800">{t.fees.allPaid}</p>
            )}
            {fees.overdueSince && (
              <p className="mt-1 text-sm font-medium text-absent">
                {t.fees.overdueSince(formatDate(fees.overdueSince, locale))}
              </p>
            )}
            {/* A credit is kept apart from the debt and never netted off it: a
                family that overpaid in June and skipped July owes July in full.
                See tallyOutstanding. */}
            {fees.credit > 0 && (
              <p className="mt-1 text-sm text-brand-800">
                <span className="num font-semibold">{formatTaka(fees.credit)}</span>{' '}
                {d.fees.inCredit}
              </p>
            )}

            <ul className="mt-3 flex flex-col gap-2">
              {fees.lines.map((line) => (
                <li
                  key={line.invoiceId}
                  className="border-t border-line pt-2 first:border-0 first:pt-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {line.periodMonth ? formatMonth(line.periodMonth, locale) : ''}
                      </p>
                      <p className="truncate text-sm text-ink-faint">
                        {line.dueDate && (
                          <>
                            {t.fees.due} {formatDate(line.dueDate, locale)}
                          </>
                        )}
                        {line.late && (
                          <span className="font-medium text-absent">
                            {' · '}
                            <span className="num">{line.daysLate}</span>{' '}
                            {t.fees.lateDays(line.daysLate)}
                          </span>
                        )}
                      </p>
                      {/* The waiver, under the month it was granted on and only when
                          there is one. The figure on the right of this row is what the
                          family owes today; these two lines are why it is not the
                          batch's fee, which is the question this screen gets opened to
                          answer. Not truncated, unlike the lines above it: an owner
                          reading the arrangement back to a parent needs the whole of
                          it, and the reason is at most MAX_TEXT characters. */}
                      {line.discount > 0 && (
                        <div className="mt-1">
                          <p className="num text-sm text-ink-soft">
                            {t.fees.waived(formatTaka(line.billed), formatTaka(line.discount))}
                          </p>
                          {line.discountReason && (
                            <p className="mt-0.5 text-sm text-ink-soft">
                              <span className="text-ink-faint">
                                {d.discount.reasonLabel}:
                              </span>{' '}
                              {line.discountReason}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="shrink-0 text-right text-sm">
                      {line.remaining > 0 ? (
                        <>
                          <span className="num font-semibold text-absent">
                            {formatTaka(line.remaining)}
                          </span>
                          <span className="block text-xs text-ink-faint">
                            {t.fees.remaining}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="num font-medium text-ink">
                            {formatTaka(line.paid)}
                          </span>
                          <span className="block text-xs text-ink-faint">
                            {t.fees.settled}
                          </span>
                        </>
                      )}
                    </p>
                  </div>

                  {/* Every slip raised against this bill, under it, oldest first.
                      This is the route to a receipt for a month that has left the
                      fee board — which until now was no route at all, so a parent
                      asking in October about July's payment was asking for
                      something the app held and could not show.

                      The figure keeps its sign, like the register's and unlike the
                      slip's own: these rows sit in a column somebody reads down
                      against a total, and a refund printed as a positive would make
                      the arithmetic wrong on the one screen it can be checked on.

                      A tap target rather than a line of text, because it is one:
                      min-h-tap on every row, the same floor as every other tappable
                      thing in the app. A teacher gets the same facts without the
                      link — see mayOpenReceipts. */}
                  {line.receipts.length > 0 && (
                    <ul className="mt-1 flex flex-col">
                      {line.receipts.map((receipt) => {
                        const label = (
                          <>
                            <span>
                              {receipt.refund ? t.fees.refundReceipt : t.fees.receipt}
                            </span>{' '}
                            <span className="num font-semibold">{receipt.receiptNo}</span>
                            <span aria-hidden> · </span>
                            <span className="num">{formatDate(receipt.on, locale)}</span>
                            <span aria-hidden> · </span>
                            <span className="num">{formatTaka(receipt.amount)}</span>
                          </>
                        )

                        return (
                          <li key={receipt.paymentId} className="text-sm">
                            {mayOpenReceipts ? (
                              <Link
                                href={`/fees/receipt/${receipt.paymentId}`}
                                className="inline-flex min-h-tap items-center font-medium
                                  text-brand-700 underline"
                              >
                                {label}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center py-1 text-ink-soft">
                                {label}
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            {/* Said once, under the whole list, and only where the tap really does
                reach paper. An owner who watched a receipt seem to disappear after
                the second printing needs telling that there is no limit — which is
                the truth, because a slip is rendered from a payment row that nothing
                in this product ever deletes. */}
            {receiptsPrint && fees.lines.some((l) => l.receipts.length > 0) && (
              <p className="mt-2 text-xs text-ink-faint">{t.fees.receiptHint}</p>
            )}

            {fees.lines.length >= PROFILE_INVOICE_LIMIT && (
              <p className="mt-2 text-xs text-ink-faint">
                {t.fees.limitNote(PROFILE_INVOICE_LIMIT)}
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
