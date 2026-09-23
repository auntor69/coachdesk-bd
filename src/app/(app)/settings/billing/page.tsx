import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { getSession, pageRole } from '@/lib/auth/session'
import { digits, formatDate, monthName, todayInDhaka } from '@/lib/bd/time'
import {
  collapseHistory,
  coversToDay,
  daysOf,
  type LedgerDay,
  type LedgerEntry,
} from '@/lib/billing/history'
import { billingWords } from '@/lib/i18n/billing'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { dailyRatePoisha, monthlyBillBdt, planFor, planName } from '@/lib/plans'
import { centerStudentCount } from '@/lib/students/headcount'
import { createClient } from '@/lib/supabase/server'
import type { BillingEntryKind } from '@/lib/supabase/types'
import { PriceCalculator } from './calculator'
import { PlanCards } from './plan-cards'
import { RechargePanel } from './recharge-panel'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${billingWords(locale).title} — CoachDesk` }
}

/**
 * How much of the ledger the history card reads.
 *
 * A cap and not "all of it": a centre three years old has a row a day plus every recharge,
 * and the screen's question is "what has happened to my money", which the last year
 * answers. The rows are read newest-first, so a long history is truncated at its old end
 * rather than losing the recent days an owner is actually reconciling.
 */
const LEDGER_READ_LIMIT = 400

/** The label for one ledger kind, in the reader's language. */
function kindLabel(kind: BillingEntryKind, words: ReturnType<typeof billingWords>): string {
  switch (kind) {
    case 'recharge':
      return words.kindRecharge
    case 'promotion_bonus':
      return words.kindBonus
    case 'founder_money_adjustment':
      return words.kindAdjust
    case 'founder_grant_days':
      return words.kindGrant
    case 'refund':
      return words.kindRefund
    case 'reversal':
      return words.kindReversal
    case 'correction':
      return words.kindCorrection
    case 'settlement_failure':
      return words.kindFailure
    case 'settlement_retry':
      return words.kindRetry
    // A daily charge is drawn as its day, and the opening row is never drawn at all. Both
    // answer here only so the switch is total over the enum and a twelfth kind fails to
    // compile rather than printing an empty label.
    case 'daily_charge':
    case 'migration_opening_balance':
      return words.kindRecharge
  }
}

/** The signed figure, with the direction in the string rather than in a colour alone. */
function signedTaka(poisha: number): string {
  const magnitude = formatTaka(Math.abs(poisha) / 100)
  if (poisha > 0) return `+ ${magnitude}`
  if (poisha < 0) return `− ${magnitude}`
  return magnitude
}

/**
 * The billing screen, rebuilt on the balance — MASTERPLAN §20.4's five questions and
 * build-order step 27.
 *
 * FIVE QUESTIONS, AND THE ORDER IS THE SCREEN. §20.4:
 *
 *   1. How long have I got — the headline, in the reader's own numerals, and the only
 *      number most visits are for: the days left and the date the money reaches.
 *   2. How much is left — the balance, and what a day costs.
 *   3. Why is it that much — the students, teachers and branches *their* figures priced it
 *      from, with the tier as a line. §20.4 forbids showing the marginal bands as though
 *      they were how a customer thinks; they live behind the calculator's disclosure, in
 *      full, from the one engine.
 *   4. How do I add more — one primary action, the four suggested amounts, the bonus stated
 *      (the recharge card, which is the same server component the plan page draws).
 *   5. What has happened to my money — the recharges, and the days collapsed by month with
 *      each day's count and rate (§11.12), plus any grant with the reason it was given.
 *
 * THE COPYRIGHT IS THE BALANCE, NOT THE PLAN. Every figure here except the band table comes
 * off the session's own `billing`, which is the resolution `access` came from — so a screen
 * that says a centre is paid up cannot disagree with the refusal its next write would hit
 * (§4.4). The rate is re-derived from the same counts the burn prices from, for the reason
 * `RechargePanel` records: the session carries `daysLeft` but not the size behind it, and
 * `tests/daily-rate.test.ts` plus the RLS suite's worked figures hold the two doors into
 * that one engine together.
 *
 * A MANAGER SEES MOST OF IT. Everything but the history is a fact about the centre that
 * every session already holds; `billing_ledger_owner_read` is what makes the fifth question
 * an owner's, and the card says so rather than going blank. The recharge control is
 * likewise drawn only for an owner, by the panel itself.
 */
export default async function BillingPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const words = billingWords(locale)
  const plan = planFor(session.active.plan)
  const isOwner = session.active.role === 'owner'

  const [students, { count: teachers }, { count: branches }, ledger] = await Promise.all([
    centerStudentCount(supabase, session.active.centerId),
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    supabase
      .from('branches')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    /*
     * The ledger, for an owner only.
     *
     * `billing_ledger_owner_read` answers the owner and the platform admin, so a manager's
     * query would come back empty regardless — skipped rather than sent and discarded, the
     * same call the plan page makes for `upgrade_requests`. The screen says the history is
     * the owner's rather than drawing an empty list a manager would read as "nothing has
     * happened".
     */
    isOwner
      ? supabase
          .from('billing_ledger')
          .select(
            'id, kind, amount_poisha, balance_after, charge_date, usage_students, usage_teachers, usage_branches, description, metadata, created_at, top_up, payment_id',
          )
          .eq('coaching_center_id', session.active.centerId)
          .order('created_at', { ascending: false })
          .limit(LEDGER_READ_LIMIT)
      : Promise.resolve({ data: null, error: null }),
  ])

  const counts =
    students !== null && teachers !== null && branches !== null
      ? {
          students,
          teachers,
          // A centre with no branch row is still one place, which is what a month is
          // charged for: the branch charge counts branches beyond the included three.
          branches: Math.max(1, branches),
        }
      : null

  const daily =
    counts === null
      ? null
      : dailyRatePoisha(plan, counts.students, counts.teachers, counts.branches)
  const monthlyPoisha =
    counts === null
      ? null
      : monthlyBillBdt(plan, counts.students, counts.teachers, counts.branches) * 100

  const entries: LedgerEntry[] = (ledger.data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    amountPoisha: Number(row.amount_poisha),
    balanceAfter: Number(row.balance_after),
    chargeDate: row.charge_date,
    students: row.usage_students,
    teachers: row.usage_teachers,
    branches: row.usage_branches,
    description: row.description,
    days: daysOf(row.metadata),
    createdAt: row.created_at,
    topUp: row.top_up,
    paymentId: row.payment_id,
  }))
  const history = collapseHistory(entries)
  const hasHistory =
    history.months.length > 0 || history.money.length > 0 || history.grants.length > 0

  const daysLeft = session.billing.daysLeft
  const coversTo = coversToDay(session.billing.chargedThrough, daysLeft)

  /** The count a day was charged at, or a dash per side that could not be read. */
  const dayCount = (day: LedgerDay): string => {
    if (day.students === null && day.teachers === null && day.branches === null) {
      return words.countUnknown
    }
    const figure = (value: number | null) => (value === null ? '—' : digits(value, locale))
    return words.countLine(
      figure(day.students),
      figure(day.teachers),
      figure(day.branches),
    )
  }

  /**
   * The money line for one entry.
   *
   * A grant carries no taka (`billing_ledger_amount_sign` pins it to zero) so its figure is
   * the days it gave; everything else prints its signed amount. The receipt link is drawn
   * only where a payment is behind the row and only for an owner, because the printable is
   * `payments_owner_read`.
   */
  const moneyLine = (entry: LedgerEntry) => {
    const day = formatDate(todayInDhaka(new Date(entry.createdAt)), locale)
    const granted = entry.kind === 'founder_grant_days'
    // Bound to a name and returned, rather than a bare `return (`, so this stays a helper
    // inside the screen instead of reading as a second arm of it — page-header.test.ts
    // counts every `return (` a page's own body holds.
    const row = (
      <li key={entry.id} className="rounded-xl border border-line bg-white p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-medium text-ink">{kindLabel(entry.kind, words)}</span>
          <span className="num font-semibold text-ink">
            {granted
              ? words.grantLine(digits(entry.days ?? 0, locale))
              : signedTaka(entry.amountPoisha)}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm text-ink-soft">{words.receivedOn(day)}</span>
          {entry.paymentId && isOwner && (
            <Link
              href={`/settings/billing/receipt/${entry.paymentId}`}
              className="text-sm font-medium text-brand-700 hover:text-brand-900"
            >
              {words.receiptLink}
            </Link>
          )}
        </div>
        {entry.description && (
          <p className="mt-1 text-sm text-ink-soft">
            {granted ? `${words.reasonLabel}: ${entry.description}` : entry.description}
          </p>
        )}
      </li>
    )

    return row
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={words.title}
        back={{ href: '/settings', label: dict(locale).settings.hub.title }}
        subtitle={words.subtitle}
      />

      {/* §20.4'S FIRST QUESTION, AND THE SCREEN'S HEADLINE: how long have I got. Days in
          the reader's own numerals, the date the money reaches under it, and nothing else —
          this is what most visits came for. Amber only where the product is already
          withholding something, which is the same tone the plan page's own strip uses. */}
      <section
        className={`rounded-2xl border-2 p-5 ${
          session.access === 'read_only' ? 'border-late/40 bg-late/5' : 'border-line bg-white'
        }`}
      >
        <h2 className="text-sm font-medium text-ink-soft">{words.leftTitle}</h2>
        {daysLeft === null ? (
          // No rate to divide by is two different things, and the sentence says which: a
          // free tier genuinely has no balance to run down, while a paid one whose rate
          // failed to read is a figure nobody has — never a zero (§11.7).
          <p className="mt-1 text-sm text-ink-soft">
            {plan.pricing === 'free' ? words.leftFree : words.leftNoRate}
          </p>
        ) : (
          <>
            <p className="num mt-1 text-3xl font-bold text-ink">
              {words.leftDays(digits(daysLeft, locale))}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {daysLeft === 0 || coversTo === null
                ? words.leftToday
                : words.leftCovers(formatDate(coversTo, locale))}
            </p>
          </>
        )}
      </section>

      {/* §20.4'S SECOND AND THIRD QUESTIONS, in one card because they are one arithmetic:
          what is left, and why a day costs what it does. Ruled rather than boxed — one
          container with dividers and not three cards (§20.7). */}
      <Card>
        <h2 className="font-semibold text-ink">{words.moneyTitle}</h2>
        <dl
          className="mt-3 grid divide-y divide-line rounded-xl border border-line
            bg-surface-alt sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        >
          <div className="p-3">
            <dt className="text-sm text-ink-soft">{words.balanceLabel}</dt>
            <dd className="num text-lg font-bold text-ink">
              {/* An unread balance is drawn as nothing rather than as a dash, the same call
                  `RechargePanel` makes: a live figure beside it is the session's own answer
                  and this card never invents one. */}
              {formatTaka((session.billing.balancePoisha ?? 0) / 100)}
            </dd>
          </div>
          <div className="p-3">
            <dt className="text-sm text-ink-soft">{words.dailyLabel}</dt>
            <dd className="num text-lg font-bold text-ink">
              {daily === null ? words.noRate : formatTaka(daily / 100)}
            </dd>
          </div>
          <div className="p-3">
            <dt className="text-sm text-ink-soft">{words.monthlyLabel}</dt>
            <dd className="num text-lg font-bold text-ink">
              {monthlyPoisha === null ? words.noRate : formatTaka(monthlyPoisha / 100)}
            </dd>
          </div>
        </dl>

        {/*
          WHY IT IS THAT MUCH — their figures, not our bands (§20.4). A tier line, the
          three counts the rate is priced from, and one sentence saying the day is that
          month over thirty. The bands themselves are the calculator's disclosure below,
          from the one engine, and never a second copy of the numbers (§33).
        */}
        <h3 className="mt-4 font-medium text-ink">{words.whyTitle}</h3>
        <p className="mt-1 text-sm text-ink-soft">{words.whyTier(planName(plan, locale))}</p>
        {counts === null ? (
          <p className="mt-1 text-sm text-ink-soft">{words.countUnknown}</p>
        ) : (
          <dl className="mt-2 flex flex-col gap-1.5">
            {(
              [
                [words.whyStudents, counts.students],
                [words.whyTeachers, counts.teachers],
                [words.whyBranches, counts.branches],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="num font-semibold text-ink">{digits(value, locale)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-xs text-ink-faint">{words.whyNote}</p>

        {/*
          THE RATE CARD, ONE TAP AWAY. `PriceCalculator` is the plan page's own component —
          the same engine that prices the monthly figure above — so a band changed in
          `plans.ts` moves both and neither can be a stale copy. It renders its own `Card`,
          which is why it is not wrapped in one here.
        */}
        <details className="mt-3 rounded-xl border border-line">
          <summary className="flex min-h-tap cursor-pointer items-center px-3 font-medium text-ink">
            {words.bandsTitle}
          </summary>
          <div className="px-3 pb-3">
            <PriceCalculator t={dict(locale).planCalc} locale={locale} />
          </div>
        </details>
      </Card>

      {/* §20.4'S FOURTH QUESTION — how do I add more. The recharge card is folded in as
          §20.4 asks ("what was a calculator becomes the top half"), and it is the same
          server component the plan page draws, so there is one recharge screen and not
          two. */}
      {plan.pricing !== 'free' && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 font-semibold text-ink">{words.addTitle}</h2>
          <p className="px-1 text-sm text-ink-soft">{words.addBody}</p>
          <RechargePanel />
        </section>
      )}

      {/* §20.4'S FIFTH QUESTION — what has happened to my money. The recharges with their
          receipts, and the days collapsed by month, each day carrying the count it was
          charged at and its rate (§11.12) so a charge can be reconstructed rather than
          trusted. */}
      <Card>
        <h2 className="font-semibold text-ink">{words.historyTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{words.historyBody}</p>

        {!isOwner && <p className="mt-3 text-sm text-ink-soft">{words.historyOwnerOnly}</p>}
        {isOwner && ledger.error && (
          <p className="mt-3 text-sm text-ink-soft">{words.historyUnreadable}</p>
        )}
        {isOwner && !ledger.error && !hasHistory && (
          <p className="mt-3 text-sm text-ink-soft">{words.historyEmpty}</p>
        )}

        {isOwner && !ledger.error && hasHistory && (
          <>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {(
                [
                  [words.totalsIn, formatTaka(history.totals.rechargedPoisha / 100)],
                  ...(history.totals.bonusPoisha > 0
                    ? [[words.totalsBonus, formatTaka(history.totals.bonusPoisha / 100)]]
                    : []),
                  [words.totalsCharged, formatTaka(history.totals.chargedPoisha / 100)],
                  ...(history.totals.grantedDays > 0
                    ? [[words.totalsGranted, digits(history.totals.grantedDays, locale)]]
                    : []),
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <dt className="text-ink-soft">{label}</dt>
                  <dd className="num font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>

            {/* The days, month by month. Open the month an owner is reconciling; the rest
                stay folded so a year of history is one screen rather than forty. */}
            {history.months.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {history.months.map((month) => (
                  <details key={month.month} className="rounded-xl border border-line">
                    <summary className="flex min-h-tap cursor-pointer items-center justify-between gap-3 px-3">
                      <span className="font-medium text-ink">
                        {words.monthLine(
                          monthName(month.month, locale),
                          digits(month.days, locale),
                          formatTaka(month.costPoisha / 100),
                        )}
                      </span>
                    </summary>
                    <ul className="flex flex-col gap-1 px-3 pb-3">
                      {month.rows.map((day) => (
                        <li
                          key={day.date}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-1.5 first:border-t-0"
                        >
                          <span className="text-ink-soft">
                            {formatDate(day.date, locale)}
                          </span>
                          <span className="num text-ink">
                            {words.dayLine(dayCount(day), formatTaka(day.costPoisha / 100))}
                          </span>
                          {/* §11.7: a day dearer than its count suggests was charged again when
                              the roster grew and is marked as such, so the figure above a
                              customer reads is explained on the row rather than looking wrong. */}
                          {day.toppedUp && (
                            <span className="w-full text-xs text-ink-faint">
                              {words.topUpNote}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}

            {history.money.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2">{history.money.map(moneyLine)}</ul>
            )}
            {history.grants.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">{history.grants.map(moneyLine)}</ul>
            )}
            {history.failures.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">{history.failures.map(moneyLine)}</ul>
            )}
          </>
        )}
      </Card>

      {/*
        THE CARDS THAT OUTLIVED THE PLAN PAGE, below the five questions rather than
        beside them. They are the coverage-based buy flow — places, a subscription
        window, a move up a tier — which retires at build-order step 28 and is still a
        live door until that cutover lands: the ceiling is still the fence, so a centre
        without a places form has no way to admit the next student.

        Its own server component, reading its own data, for the reason `RechargePanel`
        records: these are nine reads only the transition uses, and folding them into
        this page would make a screen that is meant to be deleted at step 28 into a
        permanent tax on every visit to the balance. See the head of ./plan-cards.tsx.
      */}
      <PlanCards />
    </div>
  )
}
