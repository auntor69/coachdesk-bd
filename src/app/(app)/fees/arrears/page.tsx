import { PageHeader } from '@/components/page-header'
import { ReadOnlyNote } from '@/components/read-only-note'
import { Card } from '@/components/ui'
import { pageCapability, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageAll, type PageFailure, worstFailure } from '@/lib/supabase/page'
import { currentPeriodMonth, addMonths, formatMonth } from '@/lib/bd/time'
import { oldestEnrollments } from '@/lib/fees/arrears'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ArrearsForm, type ArrearsTaken } from './arrears-form'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).arrears.title} — CoachDesk` }
}

/**
 * The opening balance: one box per student, for what their family already owed on the
 * day the centre started using this product.
 *
 * WHY A WHOLE SCREEN. A centre is signed up by loading their paper register in and
 * then opening the fee board in front of the owner so they can look at their own
 * outstanding total — most owners do not know that figure precisely, and seeing it is
 * the moment they buy. The importer loads names, guardian numbers and batches; it
 * deliberately refuses to read an amount off a register line, because a serial number
 * would become a debt and nobody would ever find out. So the arrears have to be typed,
 * and typing three hundred of them one invoice screen at a time is not something
 * anybody will finish. One screen, one column of boxes, one submit.
 *
 * ONE BOX PER STUDENT, NOT PER ENROLMENT, and that is the whole reason this looks
 * nothing like the invoice generator. An owner reading their register sees one figure
 * against a family — "৩,০০০ বাকি" — not a figure per subject. Asking them to split it
 * across the two batches a child sits in would be asking them to invent numbers. Which
 * enrolment the debt is filed against is the software's problem, decided in
 * lib/fees/arrears.ts, and it picks the oldest active one so the answer cannot move.
 *
 * NO SEARCH BOX, on the one long list in the product that has one. Everywhere else a
 * filter throws away nothing; here every row holds something the owner typed and has
 * not saved yet, and a list that re-renders down to four rows has unmounted the other
 * two hundred and ninety-six inputs along with an afternoon's work. The list is in
 * register order — code, then name — which is the order the paper is in.
 *
 * NOT PLAN-GATED, unlike the collection register. A free-tier board that says ৳0 while
 * the teacher is owed ৳9,000 is a board that lies, and a lie is not a feature anybody
 * can sell. The whole argument for this screen is that the number on the fee board
 * should be the number in the owner's head.
 *
 * STAFF ADMIN ONLY, AND `fees` (§6.2). It writes invoices for the entire centre in one
 * press, and it reads what each family owes to decide whether to offer the box at all —
 * both halves are what 20260811000063 takes away from a narrowed manager, and the read half
 * would come back as a centre where nobody owes anything.
 */
export default async function ArrearsPage() {
  const session = await pageCapability('fees')

  const locale = session.locale
  const d = dict(locale)
  const t = d.arrears

  const supabase = await createClient()

  // Backwards only, and this month is not among them: the current month's slot
  // belongs to the invoice generator, and a row written into it would make the
  // generator skip that family so their real monthly fee would never be billed. Last
  // month is the default because a centre signing up in the last week of August is
  // being handed a board that has not billed August yet, and July is the month their
  // register's arrears column was closed against.
  //
  // Above the reads rather than between them, because the invoice query needs the list
  // and nothing else does — which is what lets all three run at once instead of two
  // and then the largest.
  const months = Array.from({ length: 12 }, (_, i) => {
    const value = addMonths(currentPeriodMonth(), -(i + 1))
    return { value, label: formatMonth(value, locale) }
  })

  const back = { href: '/fees' as const, label: t.backToFees }

  /*
   * §4.4, above all three reads — and this is the screen where the arm is worth the most.
   * `recordArrears` runs requireWritable, and the whole point of this screen is that
   * nobody will type three hundred opening balances twice: an owner working down a paper
   * register box by box and being refused on submit loses the afternoon, not a form.
   */
  if (session.access !== 'full') {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t.title} back={back} />
        <ReadOnlyNote t={d.readOnly} className="max-w-2xl" />
      </div>
    )
  }

  /** The screen with no form on it. See the guard below for why all three refuse. */
  const refusal = (problem: PageFailure) => (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.title} back={back} />
      <Card className="max-w-2xl border-late/30 bg-late/5">
        <p className="font-medium text-ink">
          {problem === 'tooLarge' ? t.tooLarge : t.unreadable}
        </p>
      </Card>
    </div>
  )

  // Read in parallel, then intersect. Which students get a box is decided by the
  // enrolments, not by this list — a student with no active enrolment has nowhere to
  // hang a debt, because `unique (enrollment_id, period_month)` is what makes the
  // write safe to repeat and an unattached row has no unique key at all.
  //
  // Students are not filtered by status. Somebody marked inactive who still holds an
  // active enrolment is a family the owner is still chasing, and the enrolment is
  // already the narrower of the two conditions.
  //
  // Both paged. PostgREST answers 1000 rows and does not mention the rest, and this
  // screen is the one place an owner types in what a family already owed before the
  // product existed — so a short read here is a student who cannot be given their
  // opening balance at all, silently missing from a list of the whole centre. Four
  // hundred students taking three subjects have 1200 enrolments, well past it.
  const [enrollments, students, billed] = await Promise.all([
    pageAll((from, to) =>
      supabase
        .from('enrollments')
        .select('id, student_id, enrolled_at')
        .eq('coaching_center_id', session.active.centerId)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    ),
    pageAll((from, to) =>
      supabase
        .from('students')
        .select('id, name, student_code')
        .eq('coaching_center_id', session.active.centerId)
        .order('student_code', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
        .order('id')
        .range(from, to),
    ),
    // WHICH BOXES ARE ALREADY SPOKEN FOR, and this is not a nicety. `fee_invoices` is
    // unique on (enrollment_id, period_month), and the write below ignores a row whose
    // slot is taken — which is what makes it safe to replay, and also what would let an
    // owner type ৳3,000 against a family, press submit, and be told only that nothing
    // was added. Naming the taken boxes before they are typed into is the difference
    // between a screen that refuses work and a screen that explains itself.
    //
    // A CANCELLED BILL STILL HOLDS ITS SLOT, deliberately — see migration 28. So this
    // query does not filter `voided_at`: both kinds block, and the row says which,
    // because the way out of each is different. A live bill means this family is already
    // on the board for that month. A cancelled one means somebody undid it, and the
    // amount has to go against a different month.
    //
    // Twelve months of a whole centre's invoices is the largest read in the app, and the
    // only one where a thousand-row cut is close to certain: a 250-student centre taking
    // four subjects raises twelve thousand of these a year. Cut short, the screen would
    // offer a box that is already spoken for, the owner would type a figure into it, and
    // the write would ignore the row and report that nothing was added — which is the
    // exact refusal the paragraph above exists to prevent — and the guard below is
    // there because a dropped read arrives at the same place.
    pageAll((from, to) =>
      supabase
        .from('fee_invoices')
        .select('enrollment_id, period_month, amount_bdt, voided_at')
        .eq('coaching_center_id', session.active.centerId)
        .in('period_month', months.map((m) => m.value))
        .order('id')
        .range(from, to),
    ),
  ])

  /*
   * All three or none of them, because of the two sentences this screen prints when a
   * read comes back empty-handed.
   *
   * Without the enrolments or the students there are no rows, and no rows draws
   * `emptyTitle` — “nobody is enrolled in a batch yet” — to an owner who is looking at
   * the register three hundred of those names were just loaded from.
   *
   * Without the invoices it is worse, because the screen still works. `taken` would be
   * empty, every box would be offered, and the write leaves a row alone whose slot is
   * filled: the owner types ৳3,000 against a family already billed for July, presses
   * submit, and is told only that nothing was added. That is the refusal the note above
   * says this query exists to prevent, reached by the other road.
   *
   * One question of three reads rather than three questions, so an unreadable first
   * read cannot answer for a third that is past the ceiling — no retry brings that one
   * back. The `in` checks are what let `.rows` be read below without an assertion; TS
   * cannot see the answer through a helper, and inside them `problem` is never null.
   */
  const problem = worstFailure(enrollments, students, billed)

  if (!('rows' in enrollments) || !('rows' in students) || !('rows' in billed)) {
    return refusal(problem ?? 'unreadable')
  }

  const enrollmentByStudent = oldestEnrollments(enrollments.rows)

  const rows = students.rows
    .filter((s) => enrollmentByStudent.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, code: s.student_code }))

  // Keyed by the enrolment this screen would actually use, not by the student. A
  // monthly invoice sitting on the second batch a child attends does not block an
  // arrears row on their oldest enrolment, and telling the owner it did would be a
  // refusal they could do nothing about and did not need.
  const chosenEnrollments = new Map(
    rows.map((r) => [enrollmentByStudent.get(r.id) as string, r.id]),
  )

  const taken: Record<string, Record<string, ArrearsTaken>> = {}
  for (const invoice of billed.rows) {
    const studentId = invoice.enrollment_id
      ? chosenEnrollments.get(invoice.enrollment_id)
      : undefined
    if (!studentId) continue
    const month = invoice.period_month
    taken[month] ??= {}
    taken[month][studentId] = {
      amount: Number(invoice.amount_bdt),
      cancelled: invoice.voided_at !== null,
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageHeader title={t.title} back={back} subtitle={t.subtitle} />

      {rows.length === 0 ? (
        // Capped, like the at-limit shape of the add-student screen: one sentence
        // stretched across a laptop is a card that looks like a mistake.
        <Card className="lg:max-w-2xl">
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
        </Card>
      ) : (
        <ArrearsForm
          rows={rows}
          months={months}
          defaultMonth={months[0].value}
          taken={taken}
          locale={locale}
          t={t}
          common={d.common}
        />
      )}
    </div>
  )
}
