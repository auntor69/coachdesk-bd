import Link from 'next/link'
import { forbidden } from 'next/navigation'

import { Card } from '@/components/ui'
import { pageCenter, getSession, isStaffAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { currentPeriodMonth, addMonths, formatMonth } from '@/lib/bd/time'
import { oldestEnrollments } from '@/lib/fees/arrears'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ArrearsForm, type ArrearsTaken } from './arrears-form'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
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
 * STAFF ADMIN ONLY. It writes invoices for the entire centre in one press.
 */
export default async function ArrearsPage() {
  const session = await pageCenter()
  if (!isStaffAdmin(session)) forbidden()

  const locale = session.locale
  const d = dict(locale)
  const t = d.arrears

  const supabase = await createClient()

  // Read in parallel, then intersect. Which students get a box is decided by the
  // enrolments, not by this list — a student with no active enrolment has nowhere to
  // hang a debt, because `unique (enrollment_id, period_month)` is what makes the
  // write safe to repeat and an unattached row has no unique key at all.
  //
  // Students are not filtered by status. Somebody marked inactive who still holds an
  // active enrolment is a family the owner is still chasing, and the enrolment is
  // already the narrower of the two conditions.
  const [{ data: enrollments }, { data: students }] = await Promise.all([
    supabase
      .from('enrollments')
      .select('id, student_id, enrolled_at')
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
    supabase
      .from('students')
      .select('id, name, student_code')
      .eq('coaching_center_id', session.active.centerId)
      .order('student_code', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true }),
  ])

  const enrollmentByStudent = oldestEnrollments(enrollments ?? [])

  const rows = (students ?? [])
    .filter((s) => enrollmentByStudent.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, code: s.student_code }))

  // Backwards only, and this month is not among them: the current month's slot
  // belongs to the invoice generator, and a row written into it would make the
  // generator skip that family so their real monthly fee would never be billed. Last
  // month is the default because a centre signing up in the last week of August is
  // being handed a board that has not billed August yet, and July is the month their
  // register's arrears column was closed against.
  const months = Array.from({ length: 12 }, (_, i) => {
    const value = addMonths(currentPeriodMonth(), -(i + 1))
    return { value, label: formatMonth(value, locale) }
  })

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
  const { data: billed } = await supabase
    .from('fee_invoices')
    .select('enrollment_id, period_month, amount_bdt, voided_at')
    .eq('coaching_center_id', session.active.centerId)
    .in('period_month', months.map((m) => m.value))

  // Keyed by the enrolment this screen would actually use, not by the student. A
  // monthly invoice sitting on the second batch a child attends does not block an
  // arrears row on their oldest enrolment, and telling the owner it did would be a
  // refusal they could do nothing about and did not need.
  const chosenEnrollments = new Map(
    rows.map((r) => [enrollmentByStudent.get(r.id) as string, r.id]),
  )

  const taken: Record<string, Record<string, ArrearsTaken>> = {}
  for (const invoice of billed ?? []) {
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
    <div className="flex flex-col gap-4">
      <Link
        href="/fees"
        className="inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        ← {t.backToFees}
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.subtitle}</p>
      </div>

      {rows.length === 0 ? (
        <Card>
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
