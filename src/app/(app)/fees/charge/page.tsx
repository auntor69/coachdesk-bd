import Link from 'next/link'

import { Button, Card } from '@/components/ui'
import { pageCapability, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageAll, type PageFailure, type Paged } from '@/lib/supabase/page'
import { currentPeriodMonth, addMonths, formatMonth } from '@/lib/bd/time'
import {
  byRegisterOrder,
  chargeRoster,
  EVERY_BATCH,
  type ChargeStudent,
} from '@/lib/fees/charge'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ChargeForm } from './charge-form'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).charge.title} — CoachDesk` }
}

const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base ' +
  'outline-none focus:border-brand-500'

/**
 * The income that is not a monthly fee: admission, registration, exam and form fees.
 *
 * WHY THE PICKER IS A PLAIN GET AND NOT A DEPENDENT SELECT. Choosing a batch has to
 * re-read the roster from the server, and doing that from inside the form would either
 * unmount the boxes the owner has already unticked or leave hidden-but-checked boxes
 * behind to be submitted. So the batch lives in the URL, the roster is server-rendered
 * against it, and the form below never changes shape while it is being filled — the
 * same split /hq uses for its month.
 *
 * WHY A BATCH FILTER AT ALL. An exam fee is charged to the students who sat the exam,
 * which is a batch; offering 250 checkboxes for it would make unticking the wrong ones
 * the whole job. "Everyone in the centre" is there because an admission-season
 * registration fee genuinely is everybody.
 *
 * STAFF ADMIN ONLY, AND `fees` (§6.2). It raises bills for a whole batch in one press,
 * which is what 20260811000063 takes away from a narrowed manager.
 */
export default async function ChargePage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  const session = await pageCapability('fees')

  const locale = session.locale
  const d = dict(locale)
  const t = d.charge

  const supabase = await createClient()

  const { batch: rawBatch } = await searchParams

  // The batch list is both the picker's options and the guard on the parameter: a uuid
  // out of the address bar goes into `.eq('batch_id', …)`, and RLS would refuse another
  // centre's batch with an empty list rather than a sentence. Checked against what this
  // session could read for itself instead.
  const { data: batches } = await supabase
    .from('batches')
    .select('id, name')
    .eq('coaching_center_id', session.active.centerId)
    .eq('active', true)
    .order('name', { ascending: true })

  const wanted = typeof rawBatch === 'string' ? rawBatch : ''

  const chosen: string | null =
    wanted === EVERY_BATCH
      ? EVERY_BATCH
      : (batches ?? []).some((b) => b.id === wanted)
        ? wanted
        : null

  /**
   * The roster, read in the branch the choice picked.
   *
   * Two awaited branches rather than a ternary inside one `Promise.all` slot: TypeScript
   * reduces a ternary between two differently-shaped PostgREST reads to the narrower row
   * type, and the enrolment read's embed is the half that would be lost.
   *
   * Both paged. A whole centre is past PostgREST's silent thousand-row ceiling at the
   * size this product is priced for, and a short read here is a student who cannot be
   * charged and is not listed as missing either.
   */
  let roster: Paged<ChargeStudent> | null = null

  if (chosen === EVERY_BATCH) {
    const read = await pageAll((from, to) =>
      supabase
        .from('students')
        .select('id, name, student_code')
        .eq('coaching_center_id', session.active.centerId)
        .order('student_code', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
        .order('id')
        .range(from, to),
    )
    roster =
      'rows' in read
        ? {
            rows: read.rows
              .map((s) => ({ id: s.id, name: s.name, code: s.student_code }))
              // Sorted again through the comparator the batch path uses, so both lists
              // come out in one order rather than in Postgres's collation and ICU's.
              .sort(byRegisterOrder),
          }
        : read
  } else if (chosen !== null) {
    // Through the enrolments, because that is where batch membership lives. One row per
    // student afterwards: a child holding two active enrolments in the same batch would
    // otherwise get two boxes, and two boxes for one child is two rows in one insert
    // with the same idempotency key — which the unique index refuses, rolling back a run
    // whose list looked correct.
    const read = await pageAll((from, to) =>
      supabase
        .from('enrollments')
        .select('id, students (id, name, student_code)')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', chosen)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    )
    roster = 'rows' in read ? { rows: chargeRoster(read.rows) } : read
  }

  // Backwards, now, and forwards one. Unlike the arrears loader this may write into the
  // current month: a non-tuition bill carries no enrolment, so it sits outside the
  // `(enrollment_id, period_month)` slot the generator needs and cannot steal one.
  const months = [-1, 0, 1].map((delta) => {
    const value = addMonths(currentPeriodMonth(), delta)
    return { value, label: formatMonth(value, locale) }
  })

  const header = (
    <>
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

      {/* A plain GET, so the chosen batch is in the URL and the roster below is what the
          server read for it. Its own form element: this cannot be nested inside the
          charge form, and it must not submit it either. */}
      <Card>
        <form method="get" className="flex flex-col gap-1.5">
          <label htmlFor="batch" className="font-medium text-ink">
            {t.who}
          </label>
          <span className="text-sm text-ink-soft">{t.whoHint}</span>
          <select
            id="batch"
            name="batch"
            defaultValue={chosen ?? ''}
            className={SELECT_CLASS}
          >
            <option value={EVERY_BATCH}>{t.everyone}</option>
            {(batches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {batches !== null && batches.length === 0 && (
            <span className="text-sm text-ink-soft">{t.noBatches}</span>
          )}
          <div className="mt-3">
            <Button type="submit" variant="secondary">
              {t.show}
            </Button>
          </div>
        </form>
      </Card>
    </>
  )

  /** The screen with no form on it. See arrears/page.tsx's own for why a read failing takes it away. */
  const refusal = (problem: PageFailure) => (
    <div className="flex flex-col gap-4">
      {header}
      <Card className="border-late/30 bg-late/5">
        <p className="font-medium text-ink">
          {problem === 'tooLarge' ? t.tooLarge : t.unreadable}
        </p>
      </Card>
    </div>
  )

  if (roster !== null && 'failed' in roster) return refusal(roster.failed)

  return (
    <div className="flex flex-col gap-4">
      {header}

      {roster === null ? (
        <Card>
          <p className="text-sm text-ink-soft">{t.pickFirst}</p>
        </Card>
      ) : roster.rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
        </Card>
      ) : (
        <ChargeForm
          students={roster.rows}
          months={months}
          defaultMonth={currentPeriodMonth()}
          categories={d.fees.categories}
          locale={locale}
          t={t}
          common={d.common}
        />
      )}
    </div>
  )
}
