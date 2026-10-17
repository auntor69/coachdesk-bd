import { PageHeader } from '@/components/page-header'
import { PaperLink } from '@/components/paper-link'
import { buttonClass, Card } from '@/components/ui'
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
 * THE FORM IS BESIDE THE LIST, in a rail on the right from xl and above it on anything
 * narrower, because the reason an owner opens this screen is almost always to write
 * something down — a bill just paid, a receipt in their other hand. The register is read;
 * this is written. The list underneath is what turns a form into a record: it is how they
 * check that the rent is not on there twice.
 *
 * NEWEST FIRST, and no running total. Both follow from the same fact: `spent_on` is a
 * date and several expenses share one, so there is no order in which a running column
 * would mean anything — two rows dated the 5th could be totalled either way round. The
 * register's running column works because payments are timestamped to the second and
 * reconciled against a statement in that order. Here the checkable figures are the total
 * and the by-category breakdown, and those are above the rows: the rows are the working,
 * and an owner who arrives asking what rent cost should not have to scroll past sixty
 * vouchers to be told. The total is drawn once, in that band, and not again in a table
 * foot — two renderings of one figure is one that can disagree with itself.
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

  /** The way out, in one place because the locked branch and the screen both need it. */
  const back = { href: '/fees' as const, label: t.backToFees }

  // Before the query, like the register's own plan branch: this return draws none of
  // the month, so reading it would be work for a screen that cannot show it.
  if (!has(session.plan, 'centerWideReporting')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t.title} back={back} />
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.lockedTitle}</h2>
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
      <PageHeader
        title={t.title}
        back={back}
        subtitle={t.subtitle}
        /* The month being read, in the bar's own slot for it. A plain GET form, like the
           register's: no client component, and the month ends up in a URL that can be
           bookmarked or shared. The button is not decoration — Android Chrome fires no
           navigation on a bare <select> change.

           Label-less with an `aria-label`: the select says "August 2026" in the reader's
           own script, so a "Month" caption above it was the same fact twice, and the bar
           is one line deep. The register keeps its printed month line because that one
           prints and this select does not. */
        actions={
          <form method="get" className="flex items-center gap-2">
            <select
              name="month"
              aria-label={t.month}
              defaultValue={month}
              className="min-h-tap max-w-44 rounded-xl border-2 border-line bg-white px-3
                font-medium text-ink sm:max-w-56"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              // The shared tinted styles: this apply button had drifted to px-4 against
              // the sheet's own px-5, and it never answered a tap.
              className={buttonClass('tinted', false, 'shrink-0')}
            >
              {t.show}
            </button>
          </form>
        }
      />

      {/* One column to xl, then eight of the month beside four of the form. `xl` and not
          `lg`, unlike every other split screen here: the table below needs 36rem and eight
          of twelve columns is 469px at `lg`, so a rail there would hand a laptop a
          horizontal scrollbar it does not have today. See the roster, which gates its own
          table the same way and for the same arithmetic.

          Nested under the bar rather than holding it as a twelfth-column cell: a sticky
          box only travels inside its containing block, and a grid cell's block is one grid
          row. */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">
        {/* The form's column, written before the month it adds to, because `order` moves
            nothing for a keyboard or a screen reader and the other column is a table of
            voucher links. A read-only centre keeps the list and loses the form: the action
            would refuse the write anyway — `requireWritable` is in front of it — and a form
            that submits into a refusal is a worse way to learn that the subscription lapsed
            than the sentence the shell is already showing. */}
        <div className="contents xl:order-3 xl:col-span-4 xl:flex xl:flex-col xl:gap-4">
          {session.access === 'full' && (
            <Card className="order-3">
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
        </div>

        <div className="contents xl:order-2 xl:col-span-8 xl:flex xl:flex-col xl:gap-4">
          {/* One ordered block and a ternary inside it, not three blocks sharing a number:
              the month is either a failed read, an empty month or a list with figures over
              it, and all three land in the same place. */}
          <div className="order-4 flex flex-col gap-4">
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
                {/* THE FIGURES ABOVE THE ROWS, which is the change on this screen. The
                    by-category breakdown is the only part of this page that answers a
                    question an owner actually arrives with — "what is rent costing us",
                    "why was this month dearer" — and it used to be under the table, so on a
                    month with sixty vouchers it was two screens of scrolling past the
                    evidence to reach the summary of it. The rows are the working; this is
                    the answer, and the answer goes first.

                    A grid and not the register's wrapped band: twelve categories with names
                    like "printing and photocopying" would wrap into a ragged four-line
                    block, where a grid puts them in even columns whatever their names. */}
                <section className="rounded-xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                    <h2 className="font-medium text-ink-soft">{t.total}</h2>
                    <p className="num text-3xl font-bold text-ink">{formatTaka(tally.total)}</p>
                  </div>
                  <p className="text-sm text-ink-faint">{t.entries(tally.entries)}</p>

                  {/* What the profit line takes off and what it leaves to payroll, under the
                      sum they make, and only in a month with a salary row in it. A month
                      without one gets neither line and no note: the total is then the whole
                      answer, and "৳0 left to payroll" is a figure an owner would stop and
                      check for nothing. The register hides "paid back" the same way. */}
                  {tally.deferredToPayroll !== 0 && (
                    <>
                      <dl
                        className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-line
                          pt-2 text-sm"
                      >
                        <div className="flex items-baseline gap-2">
                          <dt className="text-ink-soft">{t.counted}</dt>
                          <dd className="num font-semibold text-ink">
                            {formatTaka(tally.counted)}
                          </dd>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <dt className="text-ink-soft">{t.deferred}</dt>
                          <dd className="num font-semibold text-ink">
                            {formatTaka(tally.deferredToPayroll)}
                          </dd>
                        </div>
                      </dl>
                      {/* The sentence those two lines are not enough on their own to say,
                          beside them rather than at the foot of the section. Not a warning
                          colour: nothing is wrong, and a centre that also uses the payroll
                          screen is doing exactly the right thing. What it prevents is an
                          owner reading their profit as higher than it was because the wages
                          are written down in one place only. */}
                      <p className="mt-2 text-sm text-ink-soft">
                        {t.deferredNote(formatTaka(tally.deferredToPayroll))}
                      </p>
                    </>
                  )}

                  <h3 className="mt-3 border-t border-line pt-3 font-medium text-ink">
                    {t.byCategory}
                  </h3>
                  {/* No boxes inside the box (§20.7): a bordered tile in a bordered section
                      is the nested container the directive names, and there would be up to
                      twelve of them. The count under each figure is what makes it checkable
                      — ৳9,000 of transport is one hired bus or nine rickshaw fares, and the
                      owner knows which of those they expected. */}
                  <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
                    {tally.byCategory.map((c) => (
                      <div key={c.category}>
                        <dt className="text-sm text-ink-soft">{t.categories[c.category]}</dt>
                        <dd className="num font-semibold text-ink">{formatTaka(c.amount)}</dd>
                        <dd className="text-xs text-ink-faint">{t.entries(c.entries)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                {/* overflow-x-auto on a phone: six columns do not fit 320px, and a table that
                    squeezes a taka figure onto two lines is a table nobody checks. The
                    negative margin takes it to the screen edge below xl and is given back
                    inside the column, where bleeding 16px would put its border in the gap. */}
                <div className="-mx-4 overflow-x-auto px-4 xl:mx-0 xl:px-0">
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
                          {/*
                            The voucher number, drawn as the control it is. It is no longer
                            the only way to a voucher — the form offers the sheet the moment
                            the action returns its id — but it is the way back to one from
                            before, and a column of underlined numbers is a column nobody
                            reads as tappable.
                          */}
                          <Td num>
                            <PaperLink
                              dense
                              href={`/expenses/voucher/${r.id}`}
                              label={`${t.colVoucher} ${r.voucherNo}`}
                            >
                              {r.voucherNo}
                            </PaperLink>
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
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
