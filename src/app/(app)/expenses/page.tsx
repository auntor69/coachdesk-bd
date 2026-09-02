import Link from 'next/link'

import { Card } from '@/components/ui'
import { Th, Td } from '@/components/table'
import { pageCapability, getSession } from '@/lib/auth/session'
import { branchChoicesFor } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { pageAll, worstFailure } from '@/lib/supabase/page'
import { has, planName, PLANS } from '@/lib/plans'
import {
  currentPeriodMonth,
  addMonths,
  formatDate,
  formatMonth,
  todayInDhaka,
} from '@/lib/bd/time'
import { formatTaka } from '@/lib/money'
import { expenseRows, tallyExpenses } from '@/lib/expenses/tally'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ExpenseForm } from './expense-form'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).expenses.title} — CoachDesk` }
}

/**
 * One line, not a concatenation — see the note on the fee board's own COLUMNS for
 * what splitting this across two lines does to type inference.
 */
const COLUMNS = 'id, voucher_no, category, amount_bdt, spent_on, method, reference, note, recurring'

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/**
 * What the centre paid out this month, and the form that adds to it.
 *
 * THE OTHER HALF OF THE PROFIT FIGURE. §9.8 is `collected − expenses − payroll`, and
 * `center_profit_month` (20260811000049) computes it — but until this screen existed two
 * of those three terms were structurally zero, so the profit line was the collection
 * total wearing a different word. A centre pays rent, electricity and internet whether
 * or not our software has a box for them.
 *
 * THE FORM IS ABOVE THE LIST, unlike the register, because the reason an owner opens
 * this screen is almost always to write something down — a bill just paid, a receipt in
 * their other hand. The register is read; this is written. The list underneath is what
 * turns a form into a record: it is how they check that the rent is not on there twice.
 *
 * NEWEST FIRST, and no running total. Both follow from the same fact: `spent_on` is a
 * date and several expenses share one, so there is no order in which a running column
 * would mean anything — two rows dated the 5th could be totalled either way round. The
 * register's running column works because payments are timestamped to the second and
 * reconciled against a statement in that order. Here the checkable figures are the total
 * and the by-category breakdown, and those are at the foot.
 *
 * A CORRECTION IS A ROW THAT SAYS SO, exactly as on the register. `expenses` revokes
 * DELETE from a browser session and grants UPDATE on three columns that do not include
 * the amount, so a figure typed wrong is corrected by a second row with a minus sign.
 * That row is labelled in words rather than left as one minus sign in a column of
 * right-aligned figures that all look like it.
 *
 * AND THE ONE THING THIS SCREEN MUST SAY OUT LOUD: salary written down here is not
 * subtracted by the profit line. `center_profit_month` takes its expense side as
 * everything except the salary category and its payroll side from `salary_payments` —
 * which is right, because a centre using both screens would otherwise be charged twice
 * for the same wages — but it means a salary row entered only here comes off neither
 * side. `tallyExpenses` names that figure and the foot of the page explains it, in the
 * months where there is one. The arithmetic is in lib/expenses/tally.ts, where it is
 * tested; this file draws it.
 *
 * STAFF ADMIN ONLY, matching `expenses_staff_admin_write` and the read policy beside it.
 * Not teachers, and deliberately not through §6.5's `can_view_fees`: that permission is
 * about a teacher collecting for their own batch, which is not the same act as reading
 * what the centre pays in rent and what it pays its staff.
 *
 * AND `expenses` (§6.2). 20260811000063 narrows the read as well as the write, so a manager
 * whose owner unticked it would get this screen with no rows and a total of ৳0 — a centre
 * that spends nothing, which is a claim rather than an absence. `pageCapability` answers
 * with the same 403 the line below does and makes the two checks one call.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ month?: string }>
}) {
  const session = await pageCapability('expenses')

  const locale = session.locale
  const d = dict(locale)
  const t = d.expenses

  // Before the query, like the register's own plan branch: this return draws none of
  // the month, so reading it would be work for a screen that cannot show it.
  if (!has(session.plan, 'centerWideReporting')) {
    return (
      <div className="flex flex-col gap-4">
        <BackToFees label={t.backToFees} />
        <Card>
          <h1 className="font-semibold text-ink">{t.lockedTitle}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(planName(session.plan, locale), planName(PLANS.center, locale))}
          </p>
        </Card>
      </div>
    )
  }

  const { month: rawMonth } = await searchParams
  // An unparseable month is this month rather than an error, for the reason the
  // register gives: the parameter arrives from a URL somebody may have edited.
  const month = MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : currentPeriodMonth()
  const nextMonth = addMonths(month, 1)

  const supabase = await createClient()

  // Plain dates on both sides, and no +06:00 anywhere — the difference from the
  // register, and the whole reason this comparison is simpler than that one. `spent_on`
  // is a `date`, not a timestamptz: it is already the Dhaka calendar day the owner
  // chose, with no instant inside it to fall on the wrong side of a midnight.
  //
  // Half-open still, for the ordinary reason: >= the 1st of this month, < the 1st of
  // the next, so nothing on either boundary is counted twice or dropped.
  const [spending, branches] = await Promise.all([
    pageAll((from, to) =>
      supabase
        .from('expenses')
        .select(COLUMNS)
        .eq('coaching_center_id', session.active.centerId)
        .gte('spent_on', month)
        .lt('spent_on', nextMonth)
        .order('spent_on', { ascending: false })
        .order('voucher_no', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    // Which building's bill it is, for the head office of an institution with more than
    // one. Only where the form is drawn at all: a read-only centre gets the list and no
    // form, so this would be a query for a control nobody sees. `branchChoicesFor`
    // returns early for every other reader, so nothing is asked of the database unless
    // there is genuinely a question. §8.3's comparison table reads spending by branch,
    // which is this column.
    session.access === 'full' ? branchChoicesFor(supabase, session) : null,
  ])

  // pageAll and not pageOrNull, the register's argument transplanted: a failed read
  // shown as an empty month is a page saying the centre spent nothing, which is a
  // statement about their business rather than about our request.
  const problem = worstFailure(spending)

  const rows = expenseRows('rows' in spending ? spending.rows : null)
  const tally = tallyExpenses(rows)

  // This month and the eleven before it. Backwards only: money that has not gone out
  // yet is not spending, and the form refuses a future date for the same reason.
  const months = Array.from({ length: 12 }, (_, i) => {
    const value = addMonths(currentPeriodMonth(), -i)
    return { value, label: formatMonth(value, locale) }
  })

  return (
    <div className="flex flex-col gap-4">
      <BackToFees label={t.backToFees} />

      <header>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="text-sm text-ink-soft">{t.subtitle}</p>
      </header>

      {/* A read-only centre keeps the list and loses the form. The action would refuse
          the write anyway — `requireWritable` is in front of it — and a form that
          submits into a refusal is a worse way to learn that the subscription lapsed
          than the sentence the shell is already showing. */}
      {session.access === 'full' && (
        <Card>
          <ExpenseForm
            t={d.expenseForm}
            categories={t.categories}
            methods={d.feeRow.methods}
            common={d.common}
            // Computed here, once, on the server: see the form's own note on why a
            // client component must not read the clock in Dhaka.
            today={todayInDhaka()}
            branchPick={d.branchPick}
            branches={branches}
          />
        </Card>
      )}

      {/* A plain GET form, like the register's: no client component, and the month ends
          up in a URL that can be bookmarked or shared. The button is not decoration —
          Android Chrome fires no navigation on a bare <select> change. */}
      <form method="get" className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-ink">{t.month}</span>
          <select
            name="month"
            defaultValue={month}
            className="min-h-tap w-full rounded-xl border-2 border-line bg-white px-3
              font-medium text-ink"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-tap shrink-0 items-center rounded-xl border-2
            border-brand-500 bg-brand-50 px-4 font-medium text-brand-800"
        >
          {t.show}
        </button>
      </form>

      <p className="font-medium text-ink-soft">{formatMonth(month, locale)}</p>

      {problem !== null ? (
        /* Nothing drawn, not even a zero: every figure below would be a claim about
           what the centre spent, and we did not read it. Same call as the register. */
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">
            {problem === 'tooLarge' ? t.tooLarge : t.unreadable}
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-ink-soft">{t.empty}</p>
        </Card>
      ) : (
        <>
          {/* overflow-x-auto on a phone: six columns do not fit 320px, and a table that
              squeezes a taka figure onto two lines is a table nobody checks. */}
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-line text-left align-bottom">
                  <Th>{t.colDate}</Th>
                  <Th num>{t.colVoucher}</Th>
                  <Th>{t.colCategory}</Th>
                  <Th>{t.colNote}</Th>
                  <Th>{t.colMethod}</Th>
                  <Th num right>{t.colAmount}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top">
                    <Td num>{formatDate(r.date, locale)}</Td>
                    {/* The voucher number is the way to the printable, and this is the only
                        way in: the form's action answers with a finished sentence and no id,
                        and every voucher of the month is already here. */}
                    <Td num>
                      <Link
                        href={`/expenses/voucher/${r.id}`}
                        className="font-medium text-brand-700 underline"
                      >
                        {r.voucherNo}
                      </Link>
                    </Td>
                    <Td>
                      {t.categories[r.category]}
                      {/* On the row and not only in the foot: an owner scanning for
                          "what do we pay every month" is reading down this column. */}
                      {r.recurring && (
                        <span className="ml-1.5 text-ink-faint">{t.recurringMark}</span>
                      )}
                    </Td>
                    <Td>{r.note ?? '—'}</Td>
                    <Td>
                      {d.feeRow.methods[r.method]}
                      {r.reference && (
                        <span className="num ml-1.5 text-ink-faint">{r.reference}</span>
                      )}
                    </Td>
                    <Td num right>
                      {/* The word above the figure, not beside it, so a narrow column
                          cannot push it off the end. Words and not a colour: these
                          screens are read on cheap phones in bad light. */}
                      {r.correction && (
                        <span className="block font-medium text-ink-soft">
                          {t.correctionLabel}
                        </span>
                      )}
                      {formatTaka(r.amount)}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-50 font-bold text-brand-900">
                  <td className="px-2 py-2" colSpan={4}>
                    {t.total} · {t.entries(tally.entries)}
                  </td>
                  <td className="num px-2 py-2 text-right" colSpan={2}>
                    {formatTaka(tally.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="font-medium text-ink">{t.byCategory}</h2>
            <dl className="mt-2 flex flex-col gap-1.5">
              {tally.byCategory.map((c) => (
                <div key={c.category} className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-soft">{t.categories[c.category]}</dt>
                  <dd className="num font-semibold text-ink">{formatTaka(c.amount)}</dd>
                </div>
              ))}
              {/* What the profit line takes off and what it leaves to payroll, above the
                  total and only in a month with a salary row in it. Two addends and
                  their sum, in that order, so the split explains itself where it is
                  read. A month without one gets neither line and no note: the total is
                  then the whole answer, and "৳0 left to payroll" is a figure an owner
                  would stop and check for nothing. The register hides "paid back" the
                  same way. */}
              {tally.deferredToPayroll !== 0 && (
                <>
                  <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-2">
                    <dt className="text-ink-soft">{t.counted}</dt>
                    <dd className="num font-semibold text-ink">
                      {formatTaka(tally.counted)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-soft">{t.deferred}</dt>
                    <dd className="num font-semibold text-ink">
                      {formatTaka(tally.deferredToPayroll)}
                    </dd>
                  </div>
                </>
              )}
              <div
                className="mt-1 flex items-baseline justify-between gap-4 border-t
                  border-line pt-2"
              >
                <dt className="font-medium text-ink">{t.total}</dt>
                <dd className="num font-bold text-ink">{formatTaka(tally.total)}</dd>
              </div>
            </dl>
            {/* The sentence the two lines above are not enough on their own to say. Not
                a warning colour: nothing is wrong, and a centre that also uses the
                payroll screen is doing exactly the right thing. What it prevents is an
                owner reading their profit as higher than it was because the wages are
                written down in one place only. */}
            {tally.deferredToPayroll !== 0 && (
              <p className="mt-3 text-sm text-ink-soft">
                {t.deferredNote(formatTaka(tally.deferredToPayroll))}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}

/** The way back, in one place because the locked branch and the screen both need it. */
function BackToFees({ label }: { label: string }) {
  return (
    <Link
      href="/fees"
      className="inline-flex min-h-tap items-center font-medium text-brand-700"
    >
      ← {label}
    </Link>
  )
}
