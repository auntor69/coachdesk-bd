import Link from 'next/link'

import { Card } from '@/components/ui'
import { pagePlatformAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { transferReference } from '@/lib/billing/receipt'
import { formatBdMobile } from '@/lib/bd/phone'
import { digits, formatDate, formatMonth, hasPassed, todayInDhaka } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { PLANS, planFor, planName, type PlanId } from '@/lib/plans'
import { MONTHS_COVERED, periodChoices } from '@/lib/platform/billing'
import {
  billLabel,
  customers,
  platformTotals,
  sizeLine,
  type CenterStatus,
} from '@/lib/platform/centers'
import { CenterBilling } from './center-billing'
import { CenterPurchases, type OpenPurchase } from './center-purchases'
import { AskedToUpgrade } from './asked-to-upgrade'
import { StaffReset } from './staff-reset'

/*
 * NO generateMetadata, on purpose.
 *
 * Every other screen exports one. This page inherits the root layout's title
 * instead, so a browser tab, a history entry or a shared screenshot says
 * "CoachDesk" rather than naming an admin panel. Same reasoning as the 404 in
 * pagePlatformAdmin: there is nothing secret here that the database is not already
 * protecting, but the panel lists every customer by name and it should not
 * introduce itself to anyone who has not been told about it.
 */

/** Badge colours per center_status. Cancelled is grey — it is over, not urgent. */
const STATUS_STYLE: Record<CenterStatus, string> = {
  active: 'border-brand-200 bg-brand-50 text-brand-800',
  trial: 'border-amber-200 bg-amber-50 text-amber-800',
  suspended: 'border-red-200 bg-red-50 text-red-700',
  cancelled: 'border-line bg-surface-alt text-ink-soft',
}

/** The order the plan dropdown offers, cheapest first — an upgrade path read down. */
const PLAN_ORDER = Object.keys(PLANS) as PlanId[]

/** The order the status dropdown offers, matching center_status. */
const STATUS_ORDER: CenterStatus[] = ['trial', 'active', 'suspended', 'cancelled']

/**
 * The founder's own screen: every centre, what it costs them, and whether they
 * are still using it.
 *
 * OUTSIDE THE (app) GROUP, and that is structural rather than tidiness. `(app)`'s
 * layout redirects anyone without an active membership to /onboarding — correct for
 * every screen in the product and wrong for this one, because `is_platform_admin`
 * is a property of a person and not of a centre. A founder whose own demo centre is
 * suspended must still be able to read the panel that says so.
 *
 * It also means there is no AppShell: no bottom nav, no centre switcher, no
 * language toggle. Those all belong to somebody running a coaching centre, and the
 * one thing this page needs from a shell is the way back, which is the link at the
 * top.
 *
 * TWO QUERIES, and the first is an RPC rather than a table read.
 * `platform_centers()` is security definer and computes the counts on the far side of
 * the RLS line the founder is deliberately not allowed to cross — see the migration for
 * why that is the privacy-preserving option rather than the lazy one. Nothing on this
 * screen touches a student row, because nothing here can. The second is the open
 * purchases, which is a plain read: `payment_intents_owner_read` already answers
 * `app.is_platform_admin()`, so there is nothing for a function to do.
 *
 * WHAT IT DOES NOT HAVE: filters, sorting, a search box, or a link into any
 * centre's data. With a customer list this size every control would be a way to
 * arrive at a worse view of it, and a link inward would be a founder reading a
 * child's marks. The CSV button covers the one thing a page cannot: taking the
 * numbers somewhere they can be added up.
 */
export default async function FounderPage() {
  const session = await pagePlatformAdmin()
  const locale = session.locale
  const d = dict(locale)
  const t = d.founder

  const supabase = await createClient()

  // Not scoped by coaching_center_id, and neither can be: the whole point is every
  // centre. The gate on the first is app.is_platform_admin() inside the function, and on
  // the second it is the same call inside the policy.
  const [{ data, error }, { data: intents }] = await Promise.all([
    // scoped-by: platform_centers() is a security definer RPC over all centres,
    // gated on app.is_platform_admin(). See 20260811000020_platform_panel.sql.
    supabase.rpc('platform_centers'),
    // Everything a customer has started paying for and not finished. Capped, because a
    // panel is not a queue processor: if this ever runs long the answer is a screen of
    // its own, not a longer card.
    // scoped-by: payment_intents_owner_read allows a platform admin every centre's
    // rows, which is what this list is. See 20260811000057_payment_intents.sql.
    supabase
      .from('payment_intents')
      .select(
        'id, coaching_center_id, purpose, quantity, amount_bdt, state, provider, created_at, expires_at, target_plan',
      )
      .in('state', ['pending', 'initiated'])
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  const list = customers(data, t.unnamed)
  const totals = platformTotals(list)

  // A Dhaka calendar date from a UTC timestamp. A centre that signed up at 1am
  // local is stamped the previous day in UTC, and a founder checking "who joined
  // yesterday" against their own memory should not have to allow for six hours.
  const dhakaDay = (iso: string | null) =>
    iso ? formatDate(todayInDhaka(new Date(iso)), locale) : null

  /*
   * The open purchases, per centre, with every sentence composed here.
   *
   * `lapsed` is computed rather than stored: nothing sweeps for an expired quote — the
   * migration says why — so `state` alone would have the founder confirming a purchase
   * `settle_payment_intent` is about to refuse.
   *
   * `target_plan` is in the line and not the meta, because it is not detail about the
   * purchase — it is the other half of what confirming it does. The settlement moves the
   * plan, and a founder checking a bKash transfer against an amount needs to know they
   * are also putting this centre on Institution.
   *
   * `transferReference` is read as a pure function, not asked of the provider:
   * `createPayment` is what hands a customer their reference and it writes a state
   * transition, which a page rendering a list must not do.
   */
  const purchases = new Map<string, OpenPurchase[]>()

  for (const intent of intents ?? []) {
    const lapsed = hasPassed(intent.expires_at)
    const quoted = dhakaDay(intent.created_at)
    const until = dhakaDay(intent.expires_at)
    const moves = intent.target_plan
      ? ` ${t.boughtMovesTo(planName(planFor(intent.target_plan), locale))}`
      : ''

    const open = purchases.get(intent.coaching_center_id) ?? []
    open.push({
      id: intent.id,
      line: `${t.bought[intent.purpose](intent.quantity)}${moves} — ${formatTaka(intent.amount_bdt)}`,
      meta: [
        quoted && t.quotedOn(quoted),
        until && (lapsed ? t.quoteLapsed(until) : t.quoteGood(until)),
        intent.provider === 'manual' && transferReference(intent.id),
      ]
        .filter(Boolean)
        .join(' · '),
      told: intent.state === 'initiated',
      lapsed,
    })
    purchases.set(intent.coaching_center_id, open)
  }

  /*
   * The dropdown contents, built once for the whole list rather than per card.
   *
   * All four are localised here and travel as `{ value, label }`, so the client
   * component that renders them holds no dictionary and no formatter — see the note at
   * the top of ./center-billing.tsx. The months a payment may cover are re-derived
   * inside the action from the same function, which is what makes the `<select>`
   * unnecessary to trust.
   */
  const periods = periodChoices().map((month) => ({
    value: month,
    label: formatMonth(month, locale),
  }))

  // Just the numeral. The control's own label says "how many months", so repeating the
  // unit in every option would be four words of noise — and it sidesteps English
  // needing "1 month" against "3 months" for no gain.
  const months = MONTHS_COVERED.map((n) => ({ value: n, label: digits(n, locale) }))

  const plans = PLAN_ORDER.map((id) => ({
    value: id,
    label: planName(PLANS[id], locale),
  }))

  const statuses = STATUS_ORDER.map((s) => ({ value: s, label: t.status[s] }))

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
      <div>
        {/* The only way back, since this page has no shell around it. */}
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.lead}</p>
      </div>

      {/* The error branch says so rather than rendering an empty list. A founder
          who reads "no centres yet" on a day they have eleven would go looking for
          the customers rather than for the bug. */}
      {error ? (
        <Card>
          <p className="font-medium text-ink">{t.unreadable}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.unreadableHint}</p>
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <p className="font-medium text-ink">{t.empty}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyHint}</p>
        </Card>
      ) : (
        <>
          {/*
           * The business in one strip. Money figures are ASCII through formatTaka
           * and counts are bare numerals, the same split every other screen uses:
           * a taka figure gets checked against a bKash statement, a tally gets
           * read off at a glance.
           */}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label={t.totals.centers} value={String(totals.centers)} />
            <Stat label={t.totals.active} value={String(totals.active)} />
            <Stat label={t.totals.trial} value={String(totals.trial)} />
            <Stat label={t.totals.quiet} value={String(totals.quiet)} />
            {/* The only tile that is a to-do rather than a measurement, and the
                only one whose useful reading is zero. First row on purpose: a
                customer waiting to be sold to outranks every figure below it. */}
            <Stat label={t.totals.asking} value={String(totals.asking)} />
            {/* The third of the same kind, and the one nobody has to answer for
                the customer: an owner buys places themselves. It is up here
                because a branch at the ceiling is a centre that is growing. */}
            <Stat label={t.totals.outOfPlaces} value={String(totals.outOfPlaces)} />
            {/* The other to-do, kept beside it: both tiles mean "ring somebody",
                and this is the one with a date on it. Trials in their last week
                and trials already over are counted together on purpose — see the
                note on TRIAL_ENDING_SOON_DAYS. */}
            <Stat label={t.totals.ending} value={String(totals.ending)} />
            <Stat label={t.totals.mrr} value={formatTaka(totals.mrrBdt)} />
            <Stat label={t.totals.pipeline} value={formatTaka(totals.pipelineBdt)} />
            <Stat label={t.totals.paid} value={formatTaka(totals.paidBdt)} />
            {/* The call list, and what it is worth. Beside "we have received"
                rather than beside the billing figure on purpose: monthly billing
                is what the customers are worth, these two are what is missing. */}
            <Stat label={t.totals.owing} value={String(totals.owing)} />
            <Stat label={t.totals.owed} value={formatTaka(totals.owedBdt)} />
            <Stat
              label={t.totals.collected}
              value={formatTaka(totals.collected30d)}
            />
            <Stat label={t.totals.students} value={String(totals.students)} />
            <Stat label={t.totals.teachers} value={String(totals.teachers)} />
            <Stat label={t.totals.taps} value={String(totals.taps30d)} />
            <Stat label={t.totals.notes} value={String(totals.notes30d)} />
            {/* All four tap-to-send counts, never a sum. The absence figure is the
                one to watch: it is the only message that happens every day, so it
                is the closest thing this panel has to "have they adopted it". */}
            <Stat label={t.totals.results} value={String(totals.results30d)} />
            <Stat label={t.totals.absences} value={String(totals.absences30d)} />
          </dl>

          <p>
            {/* A plain anchor, like the centre exports: a download is a navigation
                the browser handles, not a route the app renders. */}
            <a
              href="/api/founder"
              className="inline-flex min-h-tap items-center rounded-xl bg-brand-600
                px-5 font-semibold text-white"
            >
              {t.download}
            </a>
          </p>

          <ul className="flex flex-col gap-3">
            {list.map((c) => {
              const signedUp = dhakaDay(c.createdAt)
              const lastActive = dhakaDay(c.lastActiveAt)
              const waitingSince = dhakaDay(c.asksSince)
              const open = purchases.get(c.centerId)

              return (
                <li key={c.centerId}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold text-ink">{c.name}</h2>
                        <p className="truncate text-sm text-ink-soft">
                          {[c.area, planName(planFor(c.plan), locale)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      {/* The bill, right-aligned and the largest thing on the row
                          after the name. It is the reason this screen exists. */}
                      <div className="shrink-0 text-right">
                        <p className="num text-lg font-bold text-ink">
                          {billLabel(c)}
                        </p>
                        <p className="text-xs text-ink-soft">{t.bill}</p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-medium
                          ${STATUS_STYLE[c.status]}`}
                      >
                        {t.status[c.status]}
                      </span>
                      {/*
                       * The trial clock, right beside the word "trial" because it
                       * qualifies it. Null on everything that is not a trial, so
                       * there is no status check here — see `trialDaysLeft`.
                       *
                       * TWO TREATMENTS, BOTH ALREADY IN USE HERE. A running trial
                       * gets the same amber tint as the status chip it follows, so
                       * the pair reads as one fact. An overrun gets the filled red
                       * of the money chip, which is free on a trial card: `owes` is
                       * deliberately narrow to `active` centres, so the two filled
                       * chips can never appear together. It is also why an overrun
                       * is NOT tinted red — `quiet` owns that, a dead trial is
                       * usually quiet too, and the two side by side would read as
                       * one vague alarm rather than a deadline and a silence.
                       */}
                      {c.trialDaysLeft !== null && (
                        <span
                          className={`rounded-lg border px-2 py-0.5 text-xs
                            ${
                              c.trialDaysLeft < 0
                                ? 'border-red-600 bg-red-600 font-semibold text-white'
                                : 'border-amber-200 bg-amber-50 font-medium text-amber-800'
                            }`}
                        >
                          {c.trialDaysLeft < 0
                            ? t.trialOver(-c.trialDaysLeft)
                            : c.trialDaysLeft === 0
                              ? t.trialToday
                              : t.trialLeft(c.trialDaysLeft)}
                        </span>
                      )}
                      {/* The one chip on this screen that is filled rather than
                          tinted, because it is the only one about money. Two
                          red-on-pink chips side by side — this and "gone quiet" —
                          would read as one vague alarm, and they are different
                          problems: a centre can be paid up and idle, or busy and
                          three weeks late. */}
                      {c.owes && (
                        <span
                          className="rounded-lg border border-red-600 bg-red-600
                            px-2 py-0.5 text-xs font-semibold text-white"
                        >
                          {t.owed.badge}
                        </span>
                      )}
                      {/* Marked, not moved — see the note on `customers`. */}
                      {c.quiet && (
                        <span
                          className="rounded-lg border border-red-200 bg-red-50 px-2
                            py-0.5 text-xs font-medium text-red-700"
                        >
                          {c.daysQuiet === null
                            ? t.neverActive
                            : t.quiet(c.daysQuiet)}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-sm text-ink-soft">
                      {sizeLine(c, locale, t.size)}
                    </p>

                    {/* Under the size line because that is what it is about: this
                        centre is bigger than what it pays for. A sentence and not a
                        chip with a button — the owner answers it on their own plan
                        screen, and there is nothing here for the founder to press. */}
                    {c.asksOpen > 0 && (
                      <p className="num mt-1 text-sm font-medium text-amber-800">
                        {[
                          t.outOfPlaces(c.asksOpen, c.asksPlaces),
                          waitingSince && t.outOfPlacesSince(waitingSince),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}

                    {/* Above a plan request, because money already sent outranks money
                        somebody is thinking about. Both are the customer waiting on us;
                        only one of them has a transfer in our own bKash app with nothing
                        recorded against it. */}
                    {open && (
                      <CenterPurchases
                        centerId={c.centerId}
                        items={open}
                        words={t.purchases}
                        methods={d.feeRow.methods}
                      />
                    )}

                    {/* Above the phone number, because the two are read together:
                        they asked for this, ring that. Only when there is an open
                        request — a handled one is history and this panel is a
                        working list. */}
                    {c.wantsPlan && (
                      <AskedToUpgrade
                        centerId={c.centerId}
                        // Composed here, not in the component: `askedFor` is a
                        // function and `t.asked` crosses into a client component
                        // whole, so the two cannot live in the same group.
                        line={[
                          t.askedFor(planName(planFor(c.wantsPlan), locale)),
                          c.wantsSince && dhakaDay(c.wantsSince),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        note={c.wantsNote}
                        words={t.asked}
                      />
                    )}

                    {/* Who to ring, as a link that dials on the phone the founder
                        is holding. The one contact detail this panel carries, and
                        the founder already has it — they signed them up. */}
                    <p className="mt-1 text-sm text-ink-soft">
                      {c.ownerName ?? t.noOwner}
                      {c.ownerPhone && (
                        <>
                          {' — '}
                          <a
                            href={`tel:${c.ownerPhone}`}
                            className="num font-medium text-brand-700"
                          >
                            {formatBdMobile(c.ownerPhone)}
                          </a>
                        </>
                      )}
                    </p>

                    <dl
                      className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t
                        border-line pt-2 text-sm sm:grid-cols-3"
                    >
                      <Usage label={t.usage.attendance} value={c.attendance30d} />
                      <Usage label={t.usage.exams} value={c.exams30d} />
                      <Usage label={t.usage.payments} value={c.feePayments30d} />
                      <Usage
                        label={t.usage.collected}
                        value={formatTaka(c.collected30d)}
                      />
                      <Usage label={t.usage.taps} value={c.taps30d} />
                      {/* All four taps, separately. A centre chasing fees, a
                          teacher keeping parents, a marks message after a test
                          and a same-evening absence are four different
                          customers, and one "messages" figure would hide which
                          of them this is. */}
                      <Usage label={t.usage.notes} value={c.notes30d} />
                      <Usage label={t.usage.results} value={c.results30d} />
                      <Usage label={t.usage.absences} value={c.absences30d} />
                      {/* Kept beside the taps rather than added to them: one is
                          free and one costs us money. See the migration. */}
                      <Usage label={t.usage.sms} value={c.sms30d} />
                    </dl>

                    <p className="mt-2 text-xs text-ink-faint">
                      {[
                        signedUp && t.signedUp(signedUp),
                        lastActive ? t.lastActive(lastActive) : t.neverActive,
                        c.paidBdt > 0
                          ? t.paidTotal(formatTaka(c.paidBdt))
                          : t.paidNothing,
                        // What the money bought, which is the fact the badge above
                        // is derived from. Shown even when the date is past, so a
                        // founder on the phone can say "you are covered to the end
                        // of June" instead of only "you owe".
                        c.paidThrough &&
                          t.paidThrough(formatDate(c.paidThrough, locale)),
                        // And the same fact for somebody who has not paid at all:
                        // the chip above is the nudge, this is the date to say out
                        // loud. Last, so a trial card reads as a sentence — joined
                        // then, last seen then, no money yet, and this is when the
                        // conversation has to happen.
                        c.trialEndsOn &&
                          t.trialEnds(formatDate(c.trialEndsOn, locale)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>

                    <CenterBilling
                      centerId={c.centerId}
                      plan={c.plan}
                      status={c.status}
                      suggestedAmount={c.billBdt}
                      periods={periods}
                      months={months}
                      plans={plans}
                      statuses={statuses}
                      words={t.money}
                      // The fee board's own wallet names, not a second copy.
                      methods={d.feeRow.methods}
                    />

                    {/* Below the money, because that is the order of the calls: most
                        are about a bill and a few are about somebody locked out of
                        their own centre. Nothing here is scoped by what the founder
                        can see — the number is typed in and checked against this
                        centre's staff on the server. See ./staff-reset.tsx. */}
                    <StaffReset centerId={c.centerId} words={t.lockout} />
                  </Card>
                </li>
              )
            })}
          </ul>

          {/* The two things easiest to misread, stated once at the bottom. */}
          <p className="text-xs text-ink-faint">{t.window}</p>
          <p className="text-xs text-ink-faint">{t.gatewayNote}</p>
        </>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="num mt-0.5 text-lg font-bold text-ink">{value}</dd>
    </div>
  )
}

function Usage({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="num font-medium text-ink">{value}</dd>
    </div>
  )
}
