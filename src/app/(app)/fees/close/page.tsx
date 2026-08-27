import Link from 'next/link'
import { forbidden } from 'next/navigation'

import { Card } from '@/components/ui'
import { pageCenter, getSession, isStaffAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { addMonths, currentPeriodMonth, digits, formatMonth } from '@/lib/bd/time'
import { formatTaka } from '@/lib/money'
import { closeMonths, monthClose, monthMessages } from '@/lib/fees/month-close'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).close.title} — CoachDesk` }
}

/**
 * One line, not a concatenation — see the note on the fee board's own COLUMNS for
 * what splitting a select across two lines does to type inference.
 */
const BALANCE_COLUMNS = 'id, period_month, net_bdt, remaining_bdt'

/**
 * Ditto, and the embed is the load-bearing part. An invoice raised earlier and
 * settled during the month is absent from the balances query — it has no balance
 * left to carry — so the only place its month can be read is off the payment that
 * settled it. `voided_at` rides along because the balances query excludes voided
 * invoices and these two sets must agree about which bills exist.
 */
const PAYMENT_COLUMNS = 'invoice_id, amount_bdt, paid_at, fee_invoices!inner(period_month, voided_at)'

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/**
 * The month, closed: what was owed when it started, what came in, what is left.
 *
 * WHY THIS SCREEN EXISTS. MASTERPLAN §4, "the trial-to-paid mechanics", step 4: on
 * about day 28 you sit down with the owner, show them their own numbers, and then say
 * the price — which should look obviously smaller than what they have just watched
 * arrive. Every other screen in this product helps them run the month. This one is the
 * only screen whose job is to tell them what the month was worth, and it is the
 * argument the business is built on.
 *
 * So it is not a dashboard. A dashboard answers "what should I do now" and can afford
 * to round. This is read out loud to somebody who knows what their own month looked
 * like, sitting across a table, and a figure that is two thousand taka out ends the
 * conversation and the sale. All six figures come from one tested function — see
 * lib/fees/month-close.ts, which also explains how "outstanding at the start of the
 * month" is reconstructed when no table holds it.
 *
 * NO PLAN GATE, deliberately, and it is the one deliberate exception on a screen this
 * capable. The register is Pro-only because reconciling a month is work a paid tier
 * should buy. This is not work — it is the pitch. A free teacher who opens it and sees
 * ৳47,000 collected against a ৳499 price is the most valuable person in the product,
 * and locking the screen that makes that case would be charging admission to our own
 * sales conversation. The precedent is the upgrade-request card, unlocked for the same
 * reason.
 *
 * STAFF ADMIN ONLY, all the same. A teacher's copy of the centre's month is not their
 * number — the same boundary the collection register draws, and for the same reason.
 *
 * THE FIGURES ARE NOT DRAWN AS A BALANCE SHEET, because they do not close. Credit is
 * never netted against another family's debt, and `collected` counts every taka that
 * crossed the desk including money paid ahead. Both are on purpose and both are
 * explained on the screen rather than reconciled away: `advance` sits under the
 * collected figure, the credit line says why it is separate, and the rate divides only
 * what belongs to this month's book. An owner who adds the four columns and finds a gap
 * must find the reason for it on the same screen.
 *
 * ONE CLAIM THIS SCREEN DOES NOT MAKE. The masterplan's own wording for the message
 * count is "how many reminders went out without them lifting a finger", and that is
 * not true yet — every message in this product leaves the owner's own phone when they
 * tap it, because there is no BTRC-registered sender ID to send from. So the card says
 * how many were sent and stops there. The day a gateway is live it can say more; until
 * then the count is impressive enough on its own, and a promise we cannot keep is a
 * bad thing to make on the screen where we ask for money.
 *
 * ALL FOUR KINDS OF MESSAGE, and it used to count one. The card counted fee reminders
 * only, so a centre that chased thirty-four fees and also sent ninety absence messages
 * and twenty-six sets of marks read as "34 reminders sent" — on the one screen whose
 * whole job is to say what the product did, in the one conversation where that is
 * quoted back against a price. The tally is monthMessages in lib/fees/month-close.ts,
 * and its four keys are required rather than optional so a fifth kind of message
 * cannot ship reading zero here.
 */
export default async function MonthClosePage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ month?: string }>
}) {
  const session = await pageCenter()
  if (!isStaffAdmin(session)) forbidden()

  const locale = session.locale
  const d = dict(locale)
  const t = d.close

  const { month: rawMonth } = await searchParams
  // An unparseable month is this month rather than an error, exactly as on the
  // register: the parameter arrives from a URL somebody may have edited or shared,
  // and a screen that refuses to draw is less useful than one that draws the obvious
  // month.
  const month = MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : currentPeriodMonth()
  const nextMonth = addMonths(month, 1)

  const supabase = await createClient()

  const [
    { data: balances },
    { data: payments },
    { count: reminders },
    { count: notes },
    { count: results },
    { count: absences },
    { data: center },
  ] = await Promise.all([
    // Exactly the invoices this month's book is made of, and no more. Every bill
    // raised for the month — needed in full, settled or not, because that is what
    // `billed` counts — plus every earlier bill that still carries a balance either
    // way. An earlier bill that reads zero today either was zero on the 1st as well,
    // or was settled by a payment the query below picks up, so leaving it out costs
    // nothing and keeps the read to a few hundred rows on a phone.
    supabase
      .from('fee_invoice_balances')
      .select(BALANCE_COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
      .is('voided_at', null)
      .lte('period_month', month)
      .or(`period_month.eq.${month},remaining_bdt.neq.0`),
    // Every payment from the first instant of the month onwards, with NO upper
    // bound — and the missing bound is the feature. The ones taken after the month
    // ended are what walk each invoice's balance back to where it stood on the last
    // day; without them a bill settled in September reads as settled in July.
    //
    // The +06:00 offset is load-bearing, exactly as on the register and the board.
    // paid_at is a timestamptz and this is a Dhaka calendar boundary; compared
    // against a bare date the cutoff lands at 6am Dhaka and every payment taken
    // before breakfast on the 1st is counted into a month the owner has already been
    // shown and has already agreed with.
    supabase
      .from('fee_payments')
      .select(PAYMENT_COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
      .gte('paid_at', `${month}T00:00:00+06:00`),
    // The four kinds of message this product puts in front of a guardian, counted
    // one table at a time. Written out four times rather than looped over a list of
    // table names, and that is not laziness: check-scoping.mjs reads `.from('...')`
    // as a literal to prove every query in the app is centre-scoped, and a
    // `.from(table)` with a variable in it would be the first query in the codebase
    // that the check silently cannot see.
    //
    // head:true on all four — the count is the whole answer, and pulling the bodies
    // of a few hundred messages to length an array would be a slow query for a
    // number.
    //
    // Half-open on the same Dhaka offsets, and bounded at the top where the payments
    // deliberately are not: a message sent in September is September's work and
    // belongs to September's conversation.
    supabase
      .from('fee_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .gte('created_at', `${month}T00:00:00+06:00`)
      .lt('created_at', `${nextMonth}T00:00:00+06:00`),
    supabase
      .from('progress_updates')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .gte('created_at', `${month}T00:00:00+06:00`)
      .lt('created_at', `${nextMonth}T00:00:00+06:00`),
    supabase
      .from('result_notices')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .gte('created_at', `${month}T00:00:00+06:00`)
      .lt('created_at', `${nextMonth}T00:00:00+06:00`),
    supabase
      .from('absence_notices')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .gte('created_at', `${month}T00:00:00+06:00`)
      .lt('created_at', `${nextMonth}T00:00:00+06:00`),
    // The letterhead. This page gets screenshotted and sent to a business partner
    // more than any other, and one that does not say whose month it is is a
    // screenshot of nothing.
    supabase
      .from('coaching_centers')
      .select('name')
      .eq('id', session.active.centerId)
      .maybeSingle(),
  ])

  // Every figure on the page, from one tested function. Nothing below this line does
  // arithmetic — the point of the module is that these six numbers cannot be derived
  // two ways, here and in a test that agrees with a different version of them.
  const m = monthClose({ month, balances, payments })

  // The same rule for the message tally, which is why four head counts turn into a
  // total somewhere other than here. All four keys are required by the type, so a
  // fifth kind of message added to the product cannot reach this screen reading zero.
  const sent = monthMessages({ reminders, notes, results, absences })

  const months = closeMonths(currentPeriodMonth()).map((value) => ({
    value,
    label: formatMonth(value, locale),
  }))

  // A month in which nothing was billed, nothing came in and nothing was owed at
  // either end. Drawing six zeroes would look like a broken screen; saying so does
  // not — and on a trial that started mid-month, the month before is exactly this.
  //
  // The messages are deliberately not part of this test. A centre can have a month
  // with no money in it at all and still have told ninety parents their child was not
  // in class, which is the most common shape of a trial that has not yet put its fees
  // in — and that is the one centre this screen most needs to have something to say
  // to. So the card below is drawn either way and this only hides the ledger.
  const nothingHappened
    = m.opening === 0 && m.billed === 0 && m.collected === 0 && m.closing === 0
      && m.credit === 0

  /*
   * The work the product did, counted and not characterised. See the note at the head
   * of this file for why it says no more than this.
   *
   * Four kinds and a total, because the total on its own is the number that gets
   * doubted: "ninety-one messages" invites "ninety-one of what", and the four answers
   * are four different reasons this product is worth paying for. The breakdown is
   * drawn only when more than one kind happened — with one kind it is the total
   * written twice.
   *
   * Held in a variable because it belongs on both sides of the branch below, and
   * copying twenty lines of markup is how the two copies end up saying different
   * things.
   */
  const messagesCard = (
    <Card>
      <p className="text-ink">
        {sent.total > 0 ? t.messagesSent(sent.total) : t.messagesNone}
      </p>
      {sent.lines.length > 1 && (
        <dl className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-sm">
          {sent.lines.map((line) => (
            <div key={line.kind} className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-soft">{t.messageKinds[line.kind]}</dt>
              <dd className="num font-semibold text-ink">{digits(line.n, locale)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  )

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/fees"
        className="inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        ← {t.backToFees}
      </Link>

      {/* A plain GET form, the register's exactly: no client component, no
          JavaScript, and the month ends up in the URL where it can be bookmarked or
          shared. The submit button is not decoration — Android Chrome does not fire a
          navigation on a bare <select> change. */}
      <form method="get" className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-ink">{t.month}</span>
          <select
            name="month"
            defaultValue={month}
            className="min-h-tap w-full rounded-xl border-2 border-line bg-white px-3
              font-medium text-ink"
          >
            {months.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
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

      <header>
        <h1 className="text-xl font-bold text-ink">
          {center?.name ?? session.active.centerName}
        </h1>
        <p className="font-medium text-ink-soft">
          {t.title} · {formatMonth(month, locale)}
        </p>
      </header>

      {nothingHappened ? (
        <>
          <Card>
            <p className="text-ink-soft">{t.empty}</p>
          </Card>
          {/* Only when there is something to report. "Nothing was billed" followed by
              "no messages were sent" is the same sentence twice, and a centre that has
              done neither does not need to be told so in two cards. */}
          {sent.total > 0 && messagesCard}
        </>
      ) : (
        <>
          {/* The figure the conversation turns on, in the largest type on the screen.
              Money in ASCII in both languages — it gets checked against a bKash
              statement, and a total in Bangla numerals is one the owner has to
              translate before they can compare it. */}
          <Card className="border-brand-200 bg-brand-50">
            <p className="text-sm font-medium text-brand-800">{t.collected}</p>
            <p className="num mt-1 text-4xl font-bold text-brand-900">
              {formatTaka(m.collected)}
            </p>
            {/* Only when there is some, and directly under the figure rather than at
                the foot of the card. This is the honest half of the big number: money
                handed over this month against a later month's bill is collection, and
                it is not this month's collection. Without this line the rate below
                looks wrong to the one person who can check it. */}
            {m.advance > 0 && (
              <p className="mt-1 text-sm text-brand-800">
                <span className="num font-semibold">{formatTaka(m.advance)}</span>{' '}
                {t.advance}
              </p>
            )}
            <p className="num mt-2 text-sm font-medium text-brand-800">
              {m.collectionRatePct === null
                ? t.rateNone
                : `${t.rate} ${m.collectionRatePct}%`}
            </p>
          </Card>

          {/* The three that make the big one mean something. A ৳47,000 month is a
              different story depending on whether ৳60,000 was owed at the start. */}
          <Card>
            <dl className="flex flex-col gap-2">
              <Figure label={t.opening} amount={m.opening} />
              <Figure label={t.billed} amount={m.billed} />
              <Figure label={t.closing} amount={m.closing} strong />
            </dl>
            {m.credit > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <dl className="flex flex-col gap-2">
                  <Figure label={t.credit} amount={m.credit} />
                </dl>
                {/* The only reason the four figures above will not add up, said where
                    somebody who has just tried to add them is looking. */}
                <p className="mt-1.5 text-sm text-ink-soft">{t.creditNote}</p>
              </div>
            )}
          </Card>

          {messagesCard}

          {/* Where the two obvious next questions go. "Where did that come from" is
              the register, which is the same month by the same +06:00 boundary, so the
              two pages cannot disagree about what July was. "What does this cost" is
              the plan page, and an owner who has just read their own month is the one
              person for whom that page is worth opening. */}
          <nav className="flex flex-col gap-1">
            <Link
              href={`/fees/register?month=${month}`}
              className="inline-flex min-h-tap items-center font-medium text-brand-700
                underline"
            >
              {t.registerLink} →
            </Link>
            <Link
              href="/settings/plan"
              className="inline-flex min-h-tap items-center font-medium text-brand-700
                underline"
            >
              {t.planLink} →
            </Link>
          </nav>
        </>
      )}
    </div>
  )
}

/**
 * One labelled amount.
 *
 * A `dl` row rather than a table row: three figures with names is a description list,
 * and a screen reader reading "৳3,500" with no idea which of the three it is makes this
 * page useless to anybody using one.
 */
function Figure({
  label,
  amount,
  strong = false,
}: {
  label: string
  amount: number
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`num ${strong ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>
        {formatTaka(amount)}
      </dd>
    </div>
  )
}
