import type { Route } from 'next'
import Link from 'next/link'

import { Card } from '@/components/ui'
import { formatMonth } from '@/lib/bd/time'
import type { CategoryBills, MonthBills, MonthMoney, PayrollState } from '@/lib/finance/profit'
import type { Dictionary } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n/locale'
import { formatTaka } from '@/lib/money'

/**
 * The profit line — MASTERPLAN.md §9.8 on the owner's home screen, and §9.10's first
 * five figures.
 *
 * WHY IT IS A SUM WRITTEN OUT AND NOT A NUMBER. `collected − expenses − payroll` is
 * three facts an owner already half-knows and one they cannot get from anywhere else,
 * and the reason to show the working is that the answer is the number they will act on.
 * A single ৳23,000 labelled "profit" invites exactly one question — from what? — and a
 * screen that cannot answer it gets checked against a paper notebook once and then
 * ignored. Four lines and a rule cost nothing and settle it.
 *
 * WHY THE WARNINGS ARE THE POINT OF THE CARD. The arithmetic is the view's and cannot
 * be wrong. What can be wrong is the payroll term, in the one direction that flatters:
 * a centre that has not recorded December's salaries reads a profit too high by its
 * whole wage bill, and 20260811000049's header names this screen as the place that has
 * to say so. So the amber blocks below are not edge-case handling — they are the reason
 * an owner is allowed to trust the figure on the days they are absent.
 *
 * STAFF ADMIN AND THE CENTRE TIERS, gated by the caller twice over and by
 * `center_profit_month`'s own `app.is_staff_admin` a third time. The SQL gate is the one
 * that counts and its header explains why it is the intersection of three audiences
 * rather than the union: a fee-visible teacher outside it would be handed their own
 * students' payments against zero expenses and zero payroll, which is a wrong number
 * rather than a partial one.
 *
 * A server component: it holds functions from the dictionary, and `T<K>` maps those to
 * `never`. Same as AttendanceRates next door.
 */
export function ProfitCard({
  month,
  locale,
  money,
  bills,
  billedFor,
  categories,
  payroll,
  salaryEntries,
  t,
}: {
  /** YYYY-MM-01 — the month all four figures describe. */
  month: string
  locale: Locale
  money: MonthMoney
  /**
   * What the month BILLED, or null when that read alone did not arrive. Separate from
   * `money` because it is a separate view and a separate question: this one is money
   * against the month's own bills whenever it arrived, and `money.collected` is cash
   * that arrived in the month whatever it was for. §9.1 says a screen showing both must
   * label both, so the card does not print them as a pair.
   */
  bills: MonthBills | null
  /**
   * The same figure split by what it was for (§9.7), or empty when that read did not
   * arrive or the month has nothing in it. Never added up here — it sums to `bills` in
   * Postgres and would disagree with it in the paisa if it were summed again in floats.
   */
  billedFor: CategoryBills[]
  /**
   * The category labels. Off `fees` rather than `dashboard.money`, because the select on
   * the charge form and the rows of this breakdown must name the same thing the same way
   * — an owner who raises an "Exam fee" and then reads "Examination" here has two
   * products in front of them.
   */
  categories: Dictionary['fees']['categories']
  payroll: PayrollState
  /**
   * How many spending entries this month were filed under the salary category — which
   * the profit view deliberately drops, so that a centre paying staff through both books
   * is not subtracted twice. Null when the count did not arrive.
   *
   * A count and not a sum: the sentence it produces asks the owner to move that money to
   * the payroll book, and the figure they need for that is on the spending screen next to
   * the entries themselves.
   */
  salaryEntries: number | null
  t: Dictionary['dashboard']['money']
}) {
  const loss = money.profit < 0

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-ink">{t.title}</h2>
        <p className="shrink-0 text-sm text-ink-faint">{formatMonth(month, locale)}</p>
      </div>

      {/* The operators are in the markup rather than the dictionary, like the `·` and
          the `→` everywhere else in this app: a minus sign is not a translation, and a
          Bangla reader who saw it as anything else would be reading a different sum.
          Audible on purpose — "minus spending, twenty-one thousand" is how the line
          reads aloud, and hiding it would leave a screen reader listing three amounts
          and a total with nothing joining them. */}
      <dl className="mt-3 flex flex-col gap-1.5">
        <Row label={t.collected} amount={money.collected} />
        <Row op="−" label={t.expenses} amount={money.expenses} />
        <Row op="−" label={t.payroll} amount={money.payroll} />
        <Row
          op="="
          label={t.profit}
          amount={money.profit}
          // Words as well as colour, the house rule: the sentence below says what a
          // red figure means, because these screens are read on cheap phones in bad
          // light and about 8% of men cannot tell this red from the ink beside it.
          tone={loss ? 'text-absent' : 'text-ink'}
          strong
        />
      </dl>

      {loss && <p className="mt-2 text-sm text-ink-soft">{t.lossNote}</p>}

      {/*
        WHAT THE MONTH BILLED, under the sum rather than in it, because it is not one of
        its terms. `charged > 0` gates it: a month a centre has not billed for yet — the
        first days of every month, before the generator is run — would otherwise carry
        "৳0 billed", which reads as a centre that has stopped charging.
      */}
      {bills !== null && bills.charged > 0 && (
        <p className="num mt-3 text-sm text-ink-soft">
          {t.billed(formatTaka(bills.charged))} ·{' '}
          {bills.outstanding > 0
            ? t.stillOwed(formatTaka(bills.outstanding))
            : t.allBilledPaid}
        </p>
      )}

      {/*
        AND WHAT IT WAS BILLED FOR — §9.7's whole reason for existing: "an owner who wants
        to know whether admission season carried the year needs those separable from
        monthly tuition."

        Only past one line. A centre that billed nothing but monthly fees this month —
        which is most centres in most months — would otherwise read a breakdown whose one
        row repeats the figure directly above it, and a table that only ever says what the
        line above said is furniture an owner learns to skip past.

        Indented under the billed line rather than made its own card, because it is that
        line's working and not a fifth figure. The amount is what was charged; the faint
        second half is what has not arrived yet, which is the question an owner asks next
        and the one the total line cannot answer per category.
      */}
      {billedFor.length > 1 && (
        <dl className="mt-2 flex flex-col gap-1 border-l-2 border-line pl-3">
          {billedFor.map((line) => (
            <div key={line.category} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-sm text-ink-soft">{categories[line.category]}</dt>
              <dd className="num shrink-0 text-right text-sm">
                <span className="font-medium text-ink">{formatTaka(line.charged)}</span>
                {line.outstanding > 0 && (
                  <span className="block text-xs text-ink-faint">
                    {t.stillOwed(formatTaka(line.outstanding))}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/*
        THE PAYROLL TERM, AND WHETHER IT IS IN THERE. Three of the four states say
        something and the fourth is silent — see `payrollState` for why a centre with
        nobody on a salary must not be warned about salaries every month.

        `unpaid` and `unknown` are amber because the figure above is wrong or unverified.
        `recorded` is a plain faint line: the term is real, and the qualification it
        carries — that anybody still unpaid is outside it — is true of every month and
        never stops being true, so it must not look like a fault.
      */}
      {payroll.kind === 'unpaid' && (
        <Warning title={t.payrollMissing(payroll.people)} body={t.payrollMissingNote} />
      )}
      {payroll.kind === 'unknown' && (
        <Warning title={t.payrollUnknown} body={t.payrollUnknownNote} />
      )}
      {payroll.kind === 'recorded' && (
        <p className="num mt-3 text-sm text-ink-soft">
          {t.payrollRecorded(payroll.payments)}
        </p>
      )}

      {/*
        And the money that is in neither line. 20260811000045 kept `salary` in the
        expense categories on purpose — a centre with no per-person terms still knows it
        paid the staff, and refusing the category would send that money to
        `miscellaneous` where it is invisible instead of merely awkward — and
        20260811000049 then had to exclude it so that a centre using both books is not
        subtracted twice. The cost of those two correct decisions lands here: a centre
        using only the expense category has staff pay in neither term above, and the
        profit reads high by all of it. This is the only place in the product that says
        so.
      */}
      {salaryEntries !== null && salaryEntries > 0 && (
        <Warning title={t.salaryExpense(salaryEntries)} body={t.salaryExpenseNote} />
      )}

      {/* The two books behind the two subtracted terms. Both doors rather than one on
          each warning: the warnings say what is wrong with the figure, and an owner who
          reads one is going to the same two screens as an owner who reads neither. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 border-t border-line pt-2">
        <Door href="/expenses" label={t.expensesLink} />
        <Door href="/payroll/pay" label={t.payrollLink} />
      </div>
    </Card>
  )
}

/**
 * One line of the sum.
 *
 * The amount is printed as it stands rather than negated under a minus label: an owner
 * who reads "−৳21,000" beside "spending" has to work out whether the centre spent
 * twenty-one thousand or was owed it. The operator says what is being done to the
 * figure and the figure says what it is.
 */
function Row({
  op = '',
  label,
  amount,
  tone = 'text-ink',
  strong = false,
}: {
  op?: string
  label: string
  amount: number
  tone?: string
  strong?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        // The rule under the two subtractions, on the row that answers them.
        strong ? 'mt-1 border-t border-line pt-2' : ''
      }`}
    >
      <dt className={strong ? 'font-semibold text-ink' : 'text-ink-soft'}>
        <span className="mr-1 inline-block w-3 text-ink-faint">{op}</span>
        {label}
      </dt>
      <dd className={`num shrink-0 ${strong ? 'text-lg font-bold' : 'font-medium'} ${tone}`}>
        {formatTaka(amount)}
      </dd>
    </div>
  )
}

/** Something wrong with the figure above, in the one colour this card uses for a fault. */
function Warning({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-3 rounded-lg border border-late/30 bg-late/5 p-3">
      <p className="num font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>
    </div>
  )
}

/** The house forward link, twice. `Route` and not `string`, so a renamed folder is a
 *  compile error here rather than a 404 an owner finds. */
function Door({ href, label }: { href: Route; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-tap items-center font-medium text-brand-800 underline"
    >
      {label} →
    </Link>
  )
}
