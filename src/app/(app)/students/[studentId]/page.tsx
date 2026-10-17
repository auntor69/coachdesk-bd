import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, LinkButton } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { RiskLevelChip, RiskReasons } from '@/components/risk-list'
import {
  pageRole,
  isStaffAdmin,
  canReadFees,
  canManageStudents,
  getSession,
} from '@/lib/auth/session'
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
  studentTransfers,
  PROFILE_ATTENDANCE_DAYS,
  PROFILE_EXAM_LIMIT,
  PROFILE_INVOICE_LIMIT,
  PROFILE_TRANSFER_LIMIT,
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
 * So a student this reader may not see is a 404 and not a 403, because those two are
 * the same event here: `maybeSingle` returns nothing whether the row does not exist or
 * the policy hid it, and a page that said "you may not see this student" would confirm
 * the student exists to somebody who cannot see them.
 *
 * A READ THAT FAILED IS A THIRD THING, and it used to come out as that same 404. Every
 * panel below had the same fault in its own words — `?? []` on each of six reads, each
 * one landing on the sentence written for an honest empty answer. "No class on record
 * for this batch" on every batch at once, "no marks entered yet" over a term of them,
 * and on the panel this screen is most often opened for, "no invoice has been raised",
 * to an owner with the parent of a four-month debtor on the phone. Each is now the
 * failure said out loud, panel by panel: the name, the code and the two numbers to ring
 * are true whatever else did not arrive, and ringing the guardian is half of why
 * anybody opens this page.
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
 *
 * TWO LAYOUTS OUT OF ONE DOM, as on the dashboard, the plan screen and the roster:
 * `order-N` on every block, two wrappers that are `display: contents` below `lg`. The
 * phone keeps the column it has always had, in the order it has always had it. From `lg`
 * the three panels with rows in them — eight weeks of attendance, a term of marks, every
 * invoice — take seven columns, and the short facts move into a five-column rail: the
 * teacher-scope note, the numbers to ring, the moves, the flags.
 *
 * Which is the whole point on this screen rather than a tidiness: the answer to "how is
 * my child doing" is the attendance panel and the marks panel, and stacked full-width
 * they were two screens apart. Beside each other they are one glance. The rail is
 * everything an owner reads *while* saying it — the guardian's number most of all, which
 * is why it stays visible instead of scrolling away above the fee list.
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
   * Whether to ask where this child has been.
   *
   * `student_transfers` is staff-admin-only in SQL (20260811000042) and the plan check is
   * the branches screen's own: an organisation on a tier without buildings has no move to
   * show, so the read is skipped rather than asked and answered with nothing. Neither of
   * these is the boundary — the policy is — and the panel below only draws when there is
   * a move, so a student who has never left one building gets nothing.
   */
  const mayReadMoves = staffAdmin && has(session.plan, 'multipleBranches')

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

  /*
   * WHERE THE CRUMB GOES, WHICH IS NOT ALWAYS THE ROSTER.
   *
   * This screen's floor is a teacher; the roster behind `← Student roster` is
   * `can_manage_students`, a box an owner ticks per teacher. So a teacher without it —
   * who reaches this child from the dashboard's at-risk card, which is drawn for whoever
   * the risk view returns rows to — was being offered a crumb that answers with "you do
   * not have access to this". Same rule as the receipt link above, on the same page: no
   * tap on this screen lands on a door that refuses the reader who was shown it.
   *
   * The dashboard is where that card is, and it is the one screen every reader who clears
   * this floor can open. Free for a staff-admin, and for a teacher it is the query
   * `canReadFees` already paid for.
   */
  const back = (await canManageStudents())
    ? { href: '/settings/students' as const, label: t.roster }
    : { href: '/dashboard' as const, label: d.shell.nav.home }

  const { data: student, error: studentError } = await supabase
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

  /*
   * The failed read, ahead of the 404 — because `notFound()` was answering it as well.
   *
   * "Student not found / not on the roster, or not one of your batches" is a sentence
   * about a record that is not there, or is not this reader's. Put over a record that
   * is both, it reads as the child having been taken off the roll: what happens next is
   * a search of the roster for a name that is on it, and then a question to whoever was
   * last in the edit screen. So the failure says so, and denies the removal out loud,
   * which is the inference to head off rather than a politeness.
   *
   * The whole page rather than a panel, because the name at the top of it is exactly
   * what did not arrive. The back link stays, so the reader is not stranded on it.
   */
  if (studentError) {
    return (
      // One column, and the cap is on the card: a 7/5 split with an empty rail beside a
      // single sentence is a third of a laptop screen saying nothing, while a cap on the
      // column would pull the bar's background in off the workspace edges.
      //
      // The bar carries the screen's generic name rather than the student's, because the
      // student's name is exactly what did not arrive.
      <div className="flex flex-col gap-5">
        <PageHeader title={t.title} back={back} />
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

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

  // `?? []` on purpose here, and it is not the fault the rest of this file is about: a
  // sessions read that failed leaves no ids, so the marks query below is skipped rather
  // than asked about nothing — and the panel is withheld either way.
  const sessionIds = (sessions ?? []).map((s) => s.id)
  // The bills the panel will actually draw, which is what bounds the receipts query
  // below. Taken from the rows that came back rather than from the limit, so a
  // student with three invoices does not ask about twelve. `?? []` for the same reason
  // as above: no invoices means nothing to ask for receipts against, and a fee panel
  // whose bills did not arrive is refused whole.
  const invoiceIds = (invoices ?? []).map((i) => i.id).filter((id): id is string => !!id)

  const [{ data: marks }, { data: paymentRows }, { data: moveRows }] = await Promise.all([
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
    /*
     * Where this child has been, which is the half of §7.2 the app did not have.
     *
     * The move itself already works — `updateStudent` writes `branch_id` on the one row,
     * so the enrolments, marks and bills go with them rather than being recreated — and
     * 20260811000042's trigger has been writing a row here on every one of those saves.
     * Nothing read it, so "the transfer is auditable" was true of the database and false
     * of the product, and the first question after a transfer goes wrong is always who
     * moved this child.
     *
     * In the second round rather than a third, because it depends on nothing above: it is
     * here to share a round trip on a page opened mid-phone-call.
     */
    mayReadMoves
      ? supabase
          .from('student_transfers')
          .select(
            'id, from_branch_id, from_branch_name, to_branch_id, to_branch_name, moved_by, created_at',
          )
          .eq('coaching_center_id', centerId)
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(PROFILE_TRANSFER_LIMIT)
      : { data: null },
  ])

  /*
   * WHICH PANELS MAY SPEAK — one flag each, and the permission tested beside the null.
   *
   * `null` off any of these reads means the read failed. `[]` means the question was
   * asked and the answer is nothing. The four conditional queries above are careful to
   * return whichever of the two is true of a skip — `[]` where nothing could match, and
   * `null` where the reader is not allowed to ask — so the permission that owns each
   * null is checked alongside it. A teacher's fee panel says who keeps the fees, and
   * that is an answer rather than a failure.
   *
   * Six flags and not one, because each denies a different sentence. A single "some of
   * this could not be read" across the lot would be true and would lose the only part
   * that matters: which claim on the screen is not being made.
   */
  const attendanceUnreadable = sessions === null || marks === null
  const marksUnreadable = results === null
  const feesUnreadable = mayReadFees && invoices === null
  const flagsUnreadable = mayReadFlags && riskRows === null
  const movesUnreadable = mayReadMoves && moveRows === null
  /*
   * The slips on their own, which is the one case that withholds nothing. `paid` and
   * `remaining` under each bill are the view's own arithmetic and arrive with the
   * invoices, so every figure in the panel stays exact and only the list of receipts
   * beneath them is missing. A note added, not a panel taken away.
   *
   * Never raised when the invoices themselves failed: `invoiceIds` is empty then, the
   * payments query is skipped, and the panel is already refused whole above.
   */
  const receiptsUnreadable = mayReadFees && invoiceIds.length > 0 && paymentRows === null

  const attendance = attendanceByBatch(activeBatches, sessions, marks)
  const exams = examMarks(results, batchLabels)
  // Null for a reader who may not see fees, and null again when the read for them did
  // not arrive: `feeHistory(null, …)` answers a dropped read with `outstanding: 0`, and
  // that zero would have gone into the total beside the panel heading as a figure.
  const fees =
    mayReadFees && !feesUnreadable ? feeHistory(invoices, today, paymentRows) : null
  const risk = studentsAtRisk(riskRows, d.risk.noName)[0] ?? null
  // Head office and an unnamed building borrow the head-office screen's words rather than
  // getting their own: two spellings of "head office" in one product is one too many.
  const moves = studentTransfers(moveRows, {
    viewerId: session.userId,
    headOffice: d.hq.headOffice,
    unnamedBranch: d.hq.unnamedBranch,
  })

  const guardianPhone = student.guardian_phone
  const studentPhone = student.phone

  return (
    <div className="flex flex-col gap-5">
      {/* The name in the bar, so it is still on screen forty rows into the fee list —
          which is where somebody on the phone to a guardian actually is. The roster lives
          under settings because that is where a centre manages it; this page is where
          they read it. */}
      <PageHeader
        title={
          <>
            {student.name}
            {student.status !== 'active' && (
              <span className="ml-2 align-middle text-sm font-normal text-ink-faint">
                {t.inactive}
              </span>
            )}
          </>
        }
        back={back}
        subtitle={
          <>
            {[student.class_level, student.institution].filter(Boolean).join(' · ')}
            {student.student_code && (
              <>
                {[student.class_level, student.institution].some(Boolean) && ' · '}
                <span className="num">{student.student_code}</span>
              </>
            )}
          </>
        }
        /* Only for an owner or manager. A permitted teacher may read this page and may
           not edit the record — 20260811000019 grants that box SELECT and INSERT and no
           UPDATE — and a button to a screen that refuses them is worse than no button. */
        actions={
          mayEdit && (
            <LinkButton
              href={`/settings/students/${student.id}`}
              variant="secondary"
              className="shrink-0"
            >
              {t.edit}
            </LinkButton>
          )
        }
      />

      {/* The grid is nested under the bar rather than holding it as a twelfth-column
          cell: a sticky box only travels inside its containing block, and a grid cell's
          block is one grid row. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        {/*
          THE RAIL, written before the panels because that is the order a phone reads it
          in: `contents` below `lg` puts these four straight into the page column, and
          `order` moves nothing for a keyboard or a screen reader. The guardian's number
          is a `tel:` link, so a rail written last would be four taps past the fee list.
        */}
        <div className="contents lg:order-3 lg:col-span-5 lg:flex lg:flex-col lg:gap-5">
          {/*
            Said once, above the panels it applies to, and only to the reader it applies
            to. A teacher seeing one batch of a three-batch student has no other way to
            know the other two exist — and a student in none of their batches would
            otherwise read "not enrolled in a batch", which is false about the student.
          */}
          {!staffAdmin && (
            <p className="order-2 text-sm text-ink-faint">{t.teacherScope}</p>
          )}

          {/*
            The numbers to ring, printed and not only linked. `tel:` opens nothing on a
            laptop, and an owner reads the digits back to whoever picks up — the same
            call RiskStudentRow makes and for the same reason.
          */}
          {(guardianPhone || studentPhone) && (
            <Card className="order-3 flex flex-col gap-2">
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
            Which building, and when it changed — above the panels whose figures have to be
            read against it. Eight weeks of attendance across a July move is two registers in
            two buildings, and an owner who does not know the child moved reads the gap as a
            student who stopped turning up.

            Drawn only when there is something to say. An empty flags panel below is a claim
            worth printing — nothing is wrong — but "this student has never been moved" is not
            a sentence anybody opens a screen for, and a panel of it on every profile in a
            single-building centre would be furniture.
          */}
          {mayReadMoves && (movesUnreadable || moves.length > 0) && (
            <Card className="order-4">
              <h2 className="font-semibold text-ink">{t.moves.title}</h2>

              {movesUnreadable ? (
                <p className="mt-1 text-sm text-ink-soft">{t.moves.unreadable}</p>
              ) : (
                <>
                  <ul className="mt-2 flex flex-col gap-2">
                    {moves.map((move) => (
                      <li
                        key={move.id}
                        className="border-t border-line pt-2 first:border-0 first:pt-0"
                      >
                        <p className="font-medium text-ink">
                          {move.from} <span aria-hidden>→</span> {move.to}
                        </p>
                        <p className="text-sm text-ink-faint">
                          {[move.on ? formatDate(move.on, locale) : null, t.moves.by[move.by]]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-ink-soft">{t.moves.note}</p>
                  {moves.length >= PROFILE_TRANSFER_LIMIT && (
                    <p className="mt-2 text-xs text-ink-faint">
                      {t.moves.limitNote(PROFILE_TRANSFER_LIMIT)}
                    </p>
                  )}
                </>
              )}
            </Card>
          )}

          {/*
            The at-risk sentences, in the same words as the dashboard card and
            /at-risk — imported rather than rewritten, so the three cannot drift. Hidden
            entirely from a teacher, because student_risk returns them nothing and an
            empty panel would read as "nothing is wrong".

            Which is what a dropped read used to make it say to the one reader it is drawn
            for. `t.flags.none` is a verdict on three things at once, and a failure to reach
            any of them is not a clean bill of health.

            Grey, here and in the three panels below. Amber on this page is a warning about
            the centre's own data — an overdue bill, a register with gaps in it — and a read
            that did not arrive is not one of those. The sentence stands inside the panel
            whose claim it replaces, which is where the reader is already looking.
          */}
          {mayReadFlags && (
            <Card className="order-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold text-ink">{t.flags.title}</h2>
                {risk && <RiskLevelChip level={risk.level} t={d.risk} />}
              </div>
              {flagsUnreadable ? (
                <p className="mt-1 text-sm text-ink-soft">{t.flags.unreadable}</p>
              ) : risk ? (
                <div className="mt-2">
                  <RiskReasons reasons={risk.reasons} t={d.risk} />
                  <p className="mt-2 text-xs text-ink-faint">{d.risk.windows}</p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">{t.flags.none}</p>
              )}
            </Card>
          )}
        </div>

        {/* The three panels that carry rows: eight weeks of attendance, a term of marks,
            every invoice. Seven columns from `lg`, because these are the ones with a
            table inside them and the rail is short facts. */}
        <div className="contents lg:order-2 lg:col-span-7 lg:flex lg:flex-col lg:gap-5">
          <Card className="order-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-ink">{t.attendance.title}</h2>
              <p className="shrink-0 text-xs text-ink-faint">
                {t.attendance.window(PROFILE_ATTENDANCE_DAYS)}
              </p>
            </div>

            {/* Both reads behind this panel, ahead of the honest empty. A dropped sessions
                read put every batch on `noClasses`; a dropped marks read left them reading
                "0 / 20 classes marked" with the amber note under each one. Both say the
                register has stopped being kept, which is the most actionable thing this
                panel can say and so the worst thing for it to invent. */}
            {attendanceUnreadable ? (
              <p className="mt-1 text-sm text-ink-soft">{t.attendance.unreadable}</p>
            ) : attendance.length === 0 ? (
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

          <Card className="order-7">
            <h2 className="font-semibold text-ink">{t.marks.title}</h2>

            {/* `none` below is "no exam marks have been entered yet", which is what a
                dropped read used to draw over a term of them — on the screen a result is
                read down the phone from. */}
            {marksUnreadable ? (
              <p className="mt-1 text-sm text-ink-soft">{t.marks.unreadable}</p>
            ) : exams.length === 0 ? (
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

          <Card className="order-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-ink">{t.fees.title}</h2>
              {/* Only where the figure is worth putting at the top of the panel. */}
              {fees && fees.outstanding > 0 && (
                <p className="num shrink-0 font-semibold text-absent">
                  {formatTaka(fees.outstanding)}
                </p>
              )}
            </div>

            {/* First, ahead of both the permission line and the honest empty. `hidden` is
                "the owner or a manager keeps these", which is the wrong sentence for a
                staff-admin whose read failed; `none` is "no invoice has been raised", which
                is the wrong sentence about a family four months behind. The total above
                comes off the same rows, so it went absent rather than wrong — and an absent
                total on a fee panel reads as nothing owed, which is why this says the
                opposite out loud. */}
            {feesUnreadable ? (
              <p className="mt-1 text-sm text-ink-soft">{t.fees.unreadable}</p>
            ) : !fees ? (
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

                {/* The slips did not arrive, but the money above them did. Said under the
                    list rather than in place of it, because every figure in this panel is
                    still exact — and a bill marked paid with nothing under it reads as a
                    receipt never having been issued, which is the one thing this panel was
                    added to disprove. */}
                {receiptsUnreadable && (
                  <p className="mt-2 text-sm text-ink-soft">{t.fees.receiptsUnreadable}</p>
                )}

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
      </div>
    </div>
  )
}
