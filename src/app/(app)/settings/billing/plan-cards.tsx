import { Card } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import {
  currentPeriodMonth,
  digits,
  formatDate,
  todayInDhaka,
} from '@/lib/bd/time'
import { openAsks } from '@/lib/billing/asks'
import { priceIntent } from '@/lib/billing/price'
import { dict } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { MONTHS_COVERED, coverageStart } from '@/lib/platform/billing'
import { centerStudentCount } from '@/lib/students/headcount'
import {
  PLANS,
  CENTER_MONTHLY_FLOOR_BDT,
  PLAN_RANK,
  has,
  planFor,
  planName,
  studentCeiling,
  type FeatureKey,
  type PlanId,
  type PlanLimits,
} from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import { AskRow } from './ask-row'
import { BuyPlaces } from './buy-places'
import {
  BuySubscription,
  type MonthChoice,
  type SubscribeChoice,
} from './buy-subscription'
import { OpenPurchase } from './open-purchase'
import { UpgradeRequest } from './upgrade-request'

/**
 * The transactions the plan page used to draw, under the screen that replaced it.
 *
 * WHY THIS FILE EXISTS. MASTERPLAN §16.1 step 27 demolishes `/settings/plan` and folds it
 * into `/settings/billing`, and §20.4 lists which of the old screen's blocks survive the
 * rebuild. But the coverage-based buy flow — a student place, a subscription window, a
 * move up a tier — retires at **step 28**, not 27, and `./recharge-panel.tsx` says so in
 * its own docblock. So the page could not simply be deleted: a centre at its ceiling with
 * the places form gone has no door at all, and `app.guard_student_capacity()` is still the
 * fence that stops it admitting one more student. These cards moved with it.
 *
 * WHAT MOVED, AND WHAT DID NOT (§20.4's "what shipped on the old screen, and what of it
 * survives"):
 *
 *   · the places card — the pending purchase, the branch asks and their two answers, and
 *     the buy form — kept whole. Every part of it is a live door until step 28.
 *   · the subscription card — kept. §11.6 replaces periods with a balance, and that
 *     cutover is step 28; until it lands this is how a tier is moved (the tier moves when
 *     the money does, which is `settle_payment_intent`'s own rule).
 *   · the difference block — **teacher tiers only.** §20.4: "a Center has already chosen
 *     and is now managing its size", so the block is shown where the tiers are still a
 *     real choice and nowhere else. Its §8 rule travels with it: a per-student tier
 *     advertises no finite ceiling, because those are abuse limits and not headroom.
 *   · the four-tier ladder — kept, in a disclosure that opens only on the free plan,
 *     because it is the only place the product says what all four tiers are for.
 *   · the request form and the way to reach us — kept, for the reason `read-only.test.ts`
 *     gives for the whole module: asking to pay is the way out.
 *
 * WHAT DID NOT: the three-fact strip at the top, the usage table and its ceilings, the
 * two feature tick lists, and the list of past receipts. §20.4 answers all of those on the
 * billing screen now — question 1 is days-left rather than paid-through, question 2 is the
 * balance rather than a ceiling bar, and question 5 is the ledger, which shows a settled
 * payment with the same receipt link the list used to. The pricing calculator did not move
 * either: the billing screen draws it behind its own disclosure (§33, one engine, one
 * placement).
 *
 * IT READS ITS OWN DATA, like `./recharge-panel.tsx` and for the same reason. The billing
 * page answers §20.4's five questions from the session and three counts; this file needs
 * nine more reads that only the transition uses. Merging them would have made a screen that
 * is meant to be deleted at step 28 into a permanent tax on every visit to billing.
 */
const SHIPPED = [
  'attendance',
  'exams',
  'feeTracking',
  'manualMessaging',
  'printedReceipts',
  'parentSummary',
  'exportReports',
  'staffManagement',
  'multipleBranches',
] as const satisfies readonly FeatureKey[]

/** The ladder, cheapest first — the order somebody reads a price list in. */
const LADDER: PlanLimits[] = [
  PLANS.teacher_free,
  PLANS.teacher_plus,
  PLANS.center,
  PLANS.institution,
]

/** The two tiers where moving up is still a choice rather than a consequence of size. */
const TEACHER_TIERS = ['teacher_free', 'teacher_plus']

export async function PlanCards() {
  const session = await getSession()
  if (!session?.active) return null
  // Bound to a name so the narrowing survives the reads below: they run inside the
  // callbacks of a `Promise.all`, where TypeScript will not carry `session.active`'s
  // non-null-ness across the property access.
  const active = session.active

  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).settings.plan
  const plan = session.plan

  /**
   * Only an owner may file or read a request — `upgrade_requests_owner_read` says so,
   * so a manager's query would come back empty regardless.
   */
  const isOwner = active.role === 'owner'

  /*
   * THE PAID CEILING, never `session.ceiling`.
   *
   * Two things read off it: whether this tier sells places at all, and the number the
   * bands are priced from. `settle_payment_intent` recomputes it from the paid row, so
   * a trial — which moves the effective ceiling and not this one — would have us quote
   * a price the database then refuses.
   */
  const paidCeiling = studentCeiling(
    planFor(active.plan),
    active.studentCapacity,
  )
  const sellsPlaces = isOwner && paidCeiling.kind === 'purchased'

  const [
    studentCount,
    { count: teacherCount },
    { count: branchCount },
    { data: asked, error: askedError },
    { data: buys, error: buysError },
    { data: subs, error: subsError },
    asks,
  ] = await Promise.all([
    centerStudentCount(supabase, active.centerId),
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', active.centerId)
      .eq('active', true),
    supabase
      .from('branches')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', active.centerId)
      .eq('active', true),
    // This centre's open request, if there is one. `handled_at is null` is what makes
    // it open: a request the founder has ticked off is history, and showing it back
    // as pending would have the owner waiting for a call that already happened.
    isOwner
      ? supabase
          .from('upgrade_requests')
          .select('requested_plan, note, created_at')
          .eq('coaching_center_id', active.centerId)
          .is('handled_at', null)
          .maybeSingle()
      : // `error: null` so the note below reads off one shape. A manager is not an
        // owner whose pending request failed to load; they have no request to see.
        Promise.resolve({ data: null, error: null }),
    /*
     * Purchases this owner has opened and not yet paid for.
     *
     * The reference has to survive a reload — the owner leaves for bKash and comes
     * back — so it is read from the row here rather than carried in the action's
     * return. Lapsed ones are read too and shown as lapsed: an owner who sent the
     * money a day late needs to be told the price expired, not shown a screen that
     * has forgotten the purchase ever happened.
     */
    sellsPlaces
      ? supabase
          .from('payment_intents')
          .select('id, quantity, amount_bdt, expires_at')
          .eq('coaching_center_id', active.centerId)
          .eq('purpose', 'student_capacity')
          .in('state', ['pending', 'initiated'])
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
    /*
     * The one open subscription, if there is one.
     *
     * `limit(1)` and not five, because ./actions.ts allows exactly one: coverage is
     * worked out from `paid_through` when the intent opens, so two opened the same
     * afternoon would cover the same months and settling both would take the money
     * twice for one window. A lapsed one is read too and still blocks — which is why
     * the row carries a cancel button.
     */
    isOwner
      ? supabase
          .from('payment_intents')
          .select(
            'id, quantity, amount_bdt, expires_at, target_plan, covers_period_end',
          )
          .eq('coaching_center_id', active.centerId)
          .eq('purpose', 'subscription')
          .in('state', ['pending', 'initiated'])
          .order('created_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
    /*
     * §3.7's asks, waiting for the one reader who can end the wait: the owner, on this
     * screen, beside the price — which is what the head-office list has always said this
     * card is for. Only where places are sold, which is also the only place an ask can be
     * answered.
     */
    sellsPlaces ? openAsks(supabase, active.centerId) : Promise.resolve(null),
  ])

  /*
   * The three counts the bill is worked out from, or null if any of them would not read.
   *
   * A nought here is not a smaller bill, it is a wrong one — and this figure becomes a
   * receipt. So the form goes away and says so.
   */
  const counts =
    studentCount !== null && teacherCount !== null && branchCount !== null
      ? {
          students: studentCount,
          teachers: teacherCount,
          // A centre with no branch row is still one place, which is what the bill
          // charges for: `branchChargeBdt` counts branches beyond the included three.
          branches: Math.max(1, branchCount),
        }
      : null

  // Only the nine. A map covering all twelve flags would need a name for paid SMS,
  // and the only name available would describe a screen that does not exist — which
  // is exactly what this block must not put on paper.
  const labels: Record<(typeof SHIPPED)[number], string> = {
    attendance: t.attendance,
    exams: t.exams,
    feeTracking: t.fees,
    manualMessaging: t.messaging,
    printedReceipts: t.receipts,
    parentSummary: t.summary,
    exportReports: t.export,
    staffManagement: t.staff,
    multipleBranches: t.branches,
  }

  // Blank in every deployment until the founder puts their own number in. Absent
  // rather than a dead chip: a WhatsApp button that opens a chat with nobody is
  // worse than no button, and this is the screen where trust is being built.
  const salesPhone = normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')
  const salesMessage = t.contactMessage(
    active.centerName,
    planName(plan, locale),
  )

  /*
   * The tiers an owner may ask to be moved onto: the paid ones, minus the one they
   * are already on.
   *
   * Priced in the option label, because a dropdown that reads "Centre" is asking
   * somebody to remember a figure from four cards up the page. The same `priceLine`
   * the ladder above uses, so the two cannot disagree.
   */
  const askable = LADDER.filter(
    (tier) => tier.id !== 'teacher_free' && tier.id !== plan.id,
  )
  const choices = askable.map((tier) => ({
    value: tier.id,
    label: `${planName(tier, locale)} · ${priceLine(tier, t)}`,
  }))

  // The next rung up, which is what almost every request is: a free teacher wanting
  // Pro, a Pro teacher past 150 students wanting Centre. An owner already on the top
  // tier is offered the nearest one below, because there is nothing above it to sell.
  const rung = (id: PlanId) => LADDER.findIndex((tier) => tier.id === id)
  const suggested =
    askable.find((tier) => rung(tier.id) > rung(plan.id))?.id
    ?? askable[askable.length - 1].id

  // Composed here rather than in the client component, and not inside `t.upgrade`
  // either: the group below is handed across the server/client boundary whole, so a
  // function in it would not serialise. It names a plan and a date, and the date
  // carries Bangla numerals in Bangla. A Dhaka calendar day, so a request filed at
  // 1am local is not reported as yesterday.
  const pendingLine = asked
    ? t.pendingRequest(
        planName(planFor(asked.requested_plan), locale),
        formatDate(todayInDhaka(new Date(asked.created_at)), locale),
      )
    : null

  /*
   * §3.7's asks, as finished rows — the branch that ran out, how many places it wants,
   * when it asked, and what answering costs.
   *
   * PRICED HERE FROM THE SAME BANDS THE ACTION USES, off the paid ceiling. `answerAsk`
   * recomputes it rather than reading this figure, so the two must agree by construction:
   * an owner shown ৳625 who is charged ৳750 has been lied to on the screen where they
   * decide to trust us with money.
   *
   * Each ask priced against the ceiling as it stands, not cumulatively. Answering two
   * asks is two purchases, and the second is quoted when it is opened — by which time
   * the first may have raised the ceiling and moved the band.
   */
  const branchWords = dict(locale).hq
  const askRows = (asks ?? []).map((ask) => ({
    id: ask.id,
    line: t.places.askLine(
      ask.branchId === null
        ? branchWords.headOffice
        : (ask.branchName ?? branchWords.unnamedBranch),
      ask.places,
      formatDate(todayInDhaka(new Date(ask.createdAt)), locale),
    ),
    buy: t.places.askBuy(
      ask.places,
      formatTaka(
        priceIntent({
          purpose: 'student_capacity',
          plan: planFor(active.plan),
          purchasedCapacity: active.studentCapacity,
          places: ask.places,
        }).amountBdt,
      ),
    ),
  }))

  /*
   * WHERE THE NEXT SUBSCRIPTION WINDOW OPENS, and it is `coverageStart` rather than
   * arithmetic written twice: ./actions.ts bills the month this returns, so a second
   * formula here would draw a window the receipt then contradicts.
   *
   * A move is only offered while that window is this month. Coverage running past it
   * means the tier change is mid-term, which needs a credit the schema cannot hold —
   * `buySubscription` refuses it, so the dropdown does not offer it.
   */
  const now = new Date()
  const from = coverageStart(active.paidThrough, now)
  const canMove = from === currentPeriodMonth(now)

  /*
   * What this owner may pay for: staying where they are, and — upwards only — where
   * they could go.
   *
   * A free tier gets no renewal option: there is nothing to renew, and an option
   * quoting ৳0 on the screen where somebody has decided to start paying is a dead end.
   */
  const subChoices: SubscribeChoice[] = [
    ...(plan.pricing === 'free'
      ? []
      : [{ value: '' as const, label: t.subscribe.renewOption }]),
    ...(canMove
      ? askable
          .filter((tier) => PLAN_RANK[tier.id] > PLAN_RANK[plan.id])
          .map((tier) => ({
            value: tier.id,
            label: `${planName(tier, locale)} · ${priceLine(tier, t)}`,
          }))
      : []),
  ]

  // The closed list, labelled by the dictionary so "1 month" is not "1 months" and the
  // numerals are Bangla in Bangla.
  const monthChoices: MonthChoice[] = MONTHS_COVERED.map((n) => ({
    value: n,
    label: t.subscribe.monthsOption(n),
  }))

  const open = subs?.[0] ?? null
  const subscribes = isOwner && subChoices.length > 0

  /*
   * THE NEXT RUNG UP AND THE DIFFERENCE ITSELF — §20.4's fourth question, which the
   * four cards at the bottom of the old page could never answer. Two feature lists side
   * by side is not a difference; it is a diff, and it asks the reader to do it by eye.
   *
   * Strictly above, so the top tier gets no block at all. `PLAN_RANK` rather than the
   * array index, because the rank is the order the rest of the product compares tiers
   * in and `LADDER` is only the order a price list reads in.
   *
   * And on the teacher tiers only: §20.4 — a centre paying per student has already chosen
   * its plan and is managing its size, which the billing screen's third question answers.
   */
  const teacherTier = TEACHER_TIERS.includes(plan.id)
  const nextUp = teacherTier
    ? (LADDER.find((tier) => PLAN_RANK[tier.id] > PLAN_RANK[plan.id]) ?? null)
    : null

  /** What it adds, from the same list and the same labels as the card beside it. */
  const nextAdds = nextUp
    ? SHIPPED.filter((key) => !has(plan, key) && has(nextUp, key))
    : []

  /*
   * And what it raises — only where the figure is fit to print.
   *
   * A tier priced per student has no ceiling on students, teachers or batch size to
   * advertise, because it genuinely has none: capacity is bought. Its batch and
   * subject numbers are the internal safety limits of §6 and §8, and those are not
   * headroom to sell — "100 batches" is an abuse ceiling, and a centre told it is
   * being given ninety-nine more batches has been sold a number we would enforce
   * against them.
   */
  const nextRaises = nextUp
    ? (
        [
          [t.batches, plan.maxBatches, nextUp.maxBatches],
          [t.students, plan.maxStudents, nextUp.maxStudents],
          [t.perBatch, plan.maxStudentsPerBatch, nextUp.maxStudentsPerBatch],
          [t.subjects, plan.maxSubjects, nextUp.maxSubjects],
          [t.teachers, plan.maxTeachers, nextUp.maxTeachers],
        ] as [string, number | null, number | null][]
      ).filter(
        ([, from_, to]) =>
          from_ !== to && (to === null || nextUp.pricing !== 'per_student'),
      )
    : []

  /*
   * Whether that move can be paid for on this screen, which is all the block's one
   * action needs to know: the form below it, or the request form under that. Not a
   * second copy of either — an owner who can self-serve has a dropdown four inches
   * down the page, and a second one beside the price would be two ways to buy the
   * same month.
   */
  const selfServe = subscribes && subChoices.some((c) => c.value === nextUp?.id)

  return (
    <div className="flex flex-col gap-5">
      {/*
        THE PLACES CARD. Drawn only on a tier that sells places, since on the teacher
        tiers the ceiling moves by changing plan and the difference block already says so.
      */}
      {sellsPlaces && (
        <Card>
          <h2 className="font-semibold text-ink">{t.places.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.places.body}</p>

          {/*
            ABOVE THE BUY FORM, because it is the same purchase with the decision already
            made. An owner who scrolls past this to type a number into the box below has
            bought the places without closing the ask, and the manager in Mirpur is still
            being told HQ has been asked.
          */}
          {asks === null && (
            <p className="mt-3 text-sm text-ink-soft">{t.places.asksUnreadable}</p>
          )}

          {askRows.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="font-medium text-ink">{t.places.asksTitle}</h3>
              <p className="mt-1 text-sm text-ink-soft">{t.places.asksBody}</p>
              <div className="mt-2 flex flex-col gap-2">
                {askRows.map((row) => (
                  <AskRow
                    key={row.id}
                    id={row.id}
                    line={row.line}
                    buy={row.buy}
                    decline={t.places.askDecline}
                  />
                ))}
              </div>
            </div>
          )}

          {buysError && (
            <p className="mt-3 text-sm text-ink-soft">{t.places.unreadable}</p>
          )}

          {buys && buys.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="font-medium text-ink">{t.places.waitingTitle}</h3>
              <div className="mt-2 flex flex-col gap-2">
                {buys.map((buy) => (
                  <OpenPurchase
                    key={buy.id}
                    id={buy.id}
                    line={t.placesLine(buy.quantity, formatTaka(Number(buy.amount_bdt)))}
                    note={null}
                    expiresAt={buy.expires_at}
                    salesPhone={salesPhone}
                    locale={locale}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          <BuyPlaces
            ceiling={paidCeiling.ceiling}
            locale={locale}
            words={t.places}
          />
        </Card>
      )}

      {/*
        WHERE THE PLAN ITSELF IS PAID FOR — and, for a trial centre, the one control that
        ends the trial without the founder having to ring back.

        Drawn only when there is something to sell: a free tier with no upward move left
        (coverage still running, so a move would be mid-term) has nothing here, and a
        card offering a ৳0 renewal would be worse than no card.
      */}
      {subscribes && (
        <Card id="pay">
          <h2 className="font-semibold text-ink">{t.subscribe.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.subscribe.body}</p>

          {/* The one fact an owner comes to this card for. `paid_through` is the last
              day covered, so it is printed as a day and not a month. */}
          <p className="mt-2 text-sm font-medium text-ink">
            {active.paidThrough
              ? t.subscribe.coveredUntil(
                  formatDate(active.paidThrough, locale),
                )
              : t.subscribe.notCovered}
          </p>

          {subsError && (
            <p className="mt-3 text-sm text-ink-soft">{t.subscribe.unreadable}</p>
          )}

          {open && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="font-medium text-ink">{t.subscribe.waitingTitle}</h3>
              <div className="mt-2">
                <OpenPurchase
                  id={open.id}
                  line={t.subscribe.waitingLine(
                    digits(open.quantity, locale),
                    formatTaka(Number(open.amount_bdt)),
                    open.covers_period_end
                      ? formatDate(open.covers_period_end, locale)
                      : '—',
                  )}
                  note={
                    open.target_plan
                      ? t.subscribe.waitingPlan(
                          planName(planFor(open.target_plan), locale),
                        )
                      : null
                  }
                  expiresAt={open.expires_at}
                  salesPhone={salesPhone}
                  locale={locale}
                  t={t}
                />
              </div>
            </div>
          )}

          {/* No form while one is open, because the action refuses a second one — and a
              form that exists only to be rejected is a worse answer than the row above
              it and the cancel button under that. */}
          {!subsError && !open && counts && (
            <BuySubscription
              plan={plan.id}
              plans={subChoices}
              months={monthChoices}
              students={counts.students}
              teachers={counts.teachers}
              branches={counts.branches}
              from={from}
              locale={locale}
              words={{
                planLabel: t.subscribe.planLabel,
                monthsLabel: t.subscribe.monthsLabel,
                quote: t.subscribe.quote,
                submit: t.subscribe.submit,
                submitting: t.subscribe.submitting,
              }}
            />
          )}
          {!subsError && !open && !counts && (
            <p className="mt-3 text-sm text-ink-soft">
              {t.subscribe.priceUnreadable}
            </p>
          )}
        </Card>
      )}

      {/*
        §20.4'S FOURTH AND FIFTH QUESTIONS, WHICH THE CARDS BELOW NEVER ANSWERED: what
        changes if I move up, and what will it cost. One figure, from the same `priceLine`
        the ladder uses, so the two cannot disagree.
      */}
      {nextUp && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="font-semibold text-ink">
              {t.nextTitle(planName(nextUp, locale))}
            </h2>
            <p className="num font-bold text-brand-800">{priceLine(nextUp, t)}</p>
          </div>

          {nextAdds.length > 0 && (
            <>
              <p className="mt-3 text-sm font-medium text-ink-soft">{t.nextAdds}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {nextAdds.map((key) => (
                  <li key={key} className="flex gap-2 text-ink">
                    <span aria-hidden className="text-present">
                      +
                    </span>
                    {labels[key]}
                  </li>
                ))}
              </ul>
            </>
          )}

          {nextRaises.length > 0 && (
            <>
              <p className="mt-4 text-sm font-medium text-ink-soft">
                {t.nextRaises}
              </p>
              <dl className="mt-1 flex flex-col gap-1">
                {nextRaises.map(([label, from_, to]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <dt className="text-ink-soft">{label}</dt>
                    {/* The arrow is not `aria-hidden`, unlike the ticks and crosses in
                        the lists this replaced. Those repeated what their list was
                        headed with; this one carries the sentence — hidden, the row
                        reads "5 100". */}
                    <dd className="num font-semibold text-ink">
                      <span className="font-normal text-ink-faint">
                        {from_ === null ? t.noCap : digits(from_, locale)}
                      </span>
                      <span className="mx-1.5 text-ink-faint">→</span>
                      {to === null ? t.noCap : digits(to, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {/*
            ONE PRIMARY ACTION (§20.4), and it points at the control rather than being a
            second copy of it: an owner who can pay for this month has a priced dropdown
            below, and two ways to buy the same month is how somebody buys it twice.
          */}
          <a
            href={selfServe ? '#pay' : '#ask'}
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {selfServe ? t.nextGo : t.nextAsk}
          </a>
        </Card>
      )}

      {/*
        THE FOUR TIERS, FOLDED AWAY ON A TIER THAT IS ALREADY PAID FOR. §20.4: "a centre
        already paying us has chosen its plan and is now managing its size" — a plan grid
        in its face is a question it answered months ago. Open on the free tier, where
        choosing is the whole errand.

        Kept rather than deleted (§38). It is the only place the product says what all
        four tiers are for, and the block above only ever describes the next one.
      */}
      <details
        className="rounded-2xl border border-line bg-white p-5 shadow-sm"
        open={plan.pricing === 'free'}
      >
        <summary className="min-h-tap cursor-pointer font-semibold text-ink">
          {t.ladderAll}
        </summary>
        <ul className="mt-3 flex flex-col gap-2">
          {LADDER.map((tier) => {
            const isCurrent = tier.id === plan.id
            return (
              <li
                key={tier.id}
                className={`rounded-xl border p-4 ${
                  isCurrent ? 'border-brand-500 bg-brand-50' : 'border-line'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-ink">
                    {planName(tier, locale)}
                  </p>
                  <p className="num shrink-0 text-sm font-medium text-brand-800">
                    {priceLine(tier, t)}
                  </p>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {ladderLine(tier, t)}
                </p>
                {isCurrent && (
                  <p className="mt-1 text-xs font-medium text-brand-700">
                    {t.current}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </details>

      <Card id="ask">
        <h2 className="font-semibold text-ink">{t.contactTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.contactBody}</p>

        {isOwner ? (
          <>
            {/* Grey, above the form, and the form stays. `asked` being null used to
                mean both "nothing pending" and "the pending read fell over", and
                the component switches on exactly that — so a dropped read hid an
                open request and its withdraw button, leaving an owner sure we never
                got it. The form is safe to leave up: the write upserts on
                coaching_center_id, so filing again replaces the request rather than
                adding a second one. What is not safe is the silence. */}
            {askedError && (
              <p className="mt-3 text-sm text-ink-soft">{t.pendingUnreadable}</p>
            )}
            <UpgradeRequest
              choices={choices}
              suggested={suggested}
              pendingLine={pendingLine}
              pendingNote={asked?.note ?? null}
              words={t.upgrade}
            />
          </>
        ) : (
          /* A manager gets the sentence rather than a form that would be refused.
             Whoever pays for this decides what it costs — the same line
             `upgrade_requests_owner_insert` draws in the database. */
          <p className="mt-3 text-sm text-ink-faint">{t.upgrade.ownerOnly}</p>
        )}

        {salesPhone && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
            <a
              // wa.me wants the number without the +, exactly as the fee chips do.
              href={`https://wa.me/${salesPhone.slice(1)}?text=${encodeURIComponent(salesMessage)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-tap items-center rounded-xl border-2
                border-brand-500 bg-brand-50 px-4 font-medium text-brand-800"
            >
              {t.contactWhatsapp}
            </a>
            <a
              // The number is printed rather than hidden behind "Call", because
              // `tel:` opens nothing on a laptop and this is the one control on the
              // one screen where a centre decides to start paying us. A dead button
              // here is a lost sale; the digits work on any device. ASCII in both
              // languages — it is dialled, not read as prose.
              href={`tel:${salesPhone}`}
              className="inline-flex min-h-tap items-center rounded-xl border-2
                border-line px-4 font-medium text-ink-soft"
            >
              {t.contactCall}
              {/* `ml-1` and not a JSX space. This anchor is an inline-flex, and a
                  space there is worth exactly zero pixels — measured: 152.03px wide
                  with the space, 152.03px without, 156.03px with this margin. */}
              <span className="num ml-1">{formatBdMobile(salesPhone)}</span>
            </a>
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * The price, in as few words as a list will hold.
 *
 * Driven off `pricing` rather than off the id, so a tier added to plans.ts gets a
 * sensible line without this file being touched — and a tier whose pricing shape
 * changes cannot keep showing the old wording.
 */
function priceLine(
  plan: PlanLimits,
  t: ReturnType<typeof dict>['settings']['plan'],
): string {
  if (plan.pricing === 'free') return t.freePrice
  if (plan.pricing === 'flat') return t.monthly(formatTaka(plan.priceBdt))
  // Both per-student tiers are quoted, but only one of them has a published floor
  // to quote from; the institution tier is genuinely bespoke.
  return plan.id === 'center'
    ? t.from(formatTaka(CENTER_MONTHLY_FLOOR_BDT))
    : t.sized
}

/** One sentence on what a tier is for. Hand-written per tier; there are four. */
function ladderLine(
  plan: PlanLimits,
  t: ReturnType<typeof dict>['settings']['plan'],
): string {
  switch (plan.id) {
    case 'teacher_free':
      return t.addsFree
    case 'teacher_plus':
      return t.addsPro
    case 'center':
      return t.addsCenter
    case 'institution':
      return t.addsInstitution
  }
}
