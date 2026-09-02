import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import {
  currentPeriodMonth,
  digits,
  formatDate,
  todayInDhaka,
} from '@/lib/bd/time'
import { openAsks } from '@/lib/billing/asks'
import { priceIntent } from '@/lib/billing/price'
import { purchaseReceipt } from '@/lib/billing/receipt'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { MONTHS_COVERED, coverageStart } from '@/lib/platform/billing'
import {
  PLANS,
  CENTER_MONTHLY_FLOOR_BDT,
  PLAN_RANK,
  has,
  hasStaff,
  overStaffSeats,
  planFor,
  planName,
  studentCeiling,
  type FeatureKey,
  type PlanId,
  type PlanLimits,
} from '@/lib/plans'
import { AskRow } from './ask-row'
import { BuyPlaces } from './buy-places'
import {
  BuySubscription,
  type MonthChoice,
  type SubscribeChoice,
} from './buy-subscription'
import { PriceCalculator } from './calculator'
import { OpenPurchase } from './open-purchase'
import { UpgradeRequest } from './upgrade-request'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.plan.title} — CoachDesk` }
}

/**
 * WHICH FEATURES ARE LISTED, AND WHY IT IS EIGHT AND NOT TWELVE.
 *
 * `PlanFeatures` carries twelve flags. One of them — multiple branches — describes
 * a screen nobody has built yet, and two more (`automatedSms`, `buySmsCredits`) wait
 * on a BTRC sender ID that does not exist. A tick beside any of those on a paid tier
 * would be selling something that cannot be delivered, on the one screen in the app
 * where that is unrecoverable.
 *
 * So the list is the shipped set, and the note under it says so. A feature moves
 * into this array on the day it works, not on the day it is decided — and because
 * the array is `as const`, adding one here will not compile until it has a name in
 * `labels` below. `exportReports` arrived by that rule: it had been priced into Pro
 * since the plan engine was written and stayed off this list until the three sheets
 * behind /api/export were built and covered by tests.
 *
 * `parentSummary` arrived by the same rule and was overdue by it. /progress ships a
 * per-student weekly report built from real attendance and marks, its Server Action
 * refuses the free tier, and the dashboard door is drawn only when the flag is on —
 * so the feature works and is already being withheld. Leaving it off this list was
 * the mirror image of the mistake the rule exists to prevent: not a tick for
 * something unbuilt, but a price screen omitting the one line its own paywall calls
 * the reason to pay ৳499.
 * `multipleBranches` arrived last and by the same rule: /hq ships a head-office view
 * over every branch's students, money and attendance, its guard checks the flag, and
 * the menu now carries a row for it that is greyed on the tiers without it. Until that
 * screen existed the flag named nothing a reader could be shown, which is why the note
 * in the Bangla dictionary said branches did not exist — it says something else now.
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

/**
 * What this centre is paying for, what that includes, and what the next tier costs.
 *
 * The screen exists because the paywall arrived before the price list did. Half a
 * dozen places now say a feature "comes with শিক্ষক প্রো", and until this page
 * there was nowhere in the product that said what শিক্ষক প্রো costs or how to get
 * onto it. A locked feature pointing at a plan the reader cannot look up is a dead
 * end, and a dead end is where a trial stops.
 *
 * THE USAGE BLOCK IS THE UPGRADE PROMPT. Not a banner and not a nag: an owner at
 * 28 of 30 students needs to find that out before the thirty-first student is
 * standing in front of them, and a plain count against the cap does that without
 * anybody being sold to.
 *
 * NOTHING HERE CHARGES ANYBODY. There is no payment rail yet — centres are signed
 * up in person, by the founder, from their own laptop — so the call to action is a
 * request the founder reads on their own panel, beside this centre's name, owner,
 * phone number and exact monthly bill. That is honest about how the business
 * currently works, and it is also the highest-converting thing available: the founder
 * answers.
 *
 * THE REQUEST FORM IS NOT GATED ON A PHONE NUMBER, and it used to be. The whole
 * contact card sat behind `NEXT_PUBLIC_SALES_PHONE`, which is empty in every
 * deployment because the founder's own number is not in the repo — so an owner who
 * had read the calculator and decided to buy reached the bottom of this page and
 * found nothing at all. Gating a dead WhatsApp chip was right; gating the card was
 * not, because the alternative was never "no way to get in touch", it was "no way we
 * bothered to build". The chips are still conditional. The form never is.
 */
export default async function PlanPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).settings.plan
  const plan = session.plan

  /**
   * Only an owner may file or read a request — `upgrade_requests_owner_read` says so,
   * so a manager's query would come back empty regardless. Skipped rather than sent
   * and discarded, because this page is otherwise four counts and a manager has no
   * use for a round trip that can only answer "nothing".
   */
  const isOwner = session.active.role === 'owner'

  /*
   * THE PAID CEILING, never `session.ceiling`.
   *
   * Two things read off it: whether this tier sells places at all, and the number the
   * bands are priced from. `settle_payment_intent` recomputes it from the paid row, so
   * a trial — which moves the effective ceiling and not this one — would have us quote
   * a price the database then refuses. See ./actions.ts.
   */
  const paidCeiling = studentCeiling(
    planFor(session.active.plan),
    session.active.studentCapacity,
  )
  const sellsPlaces = isOwner && paidCeiling.kind === 'purchased'

  const [
    { count: batchCount },
    { count: studentCount },
    { count: subjectCount },
    { count: teacherCount },
    { count: branchCount },
    { data: asked, error: askedError },
    { data: buys, error: buysError },
    { data: subs, error: subsError },
    asks,
    { data: settled, error: settledError },
  ] = await Promise.all([
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
    supabase
      .from('subjects')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    // Not in the usage table — no tier caps branches — but the monthly bill counts them
    // beyond the three an Institution includes, so the card below cannot price a
    // renewal without it. `max(1, …)` where it is used: a centre with no branch row is
    // still one place.
    supabase
      .from('branches')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    // This centre's open request, if there is one. `handled_at is null` is what makes
    // it open: a request the founder has ticked off is history, and showing it back
    // as pending would have the owner waiting for a call that already happened.
    isOwner
      ? supabase
          .from('upgrade_requests')
          .select('requested_plan, note, created_at')
          .eq('coaching_center_id', session.active.centerId)
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
     *
     * Five, because more than that on this card is a founder problem, not an owner's.
     */
    sellsPlaces
      ? supabase
          .from('payment_intents')
          .select('id, quantity, amount_bdt, expires_at')
          .eq('coaching_center_id', session.active.centerId)
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
     *
     * `target_plan` comes with it so the row can say what the money moves them onto;
     * the period columns are the window the founder will read back off the receipt.
     */
    isOwner
      ? supabase
          .from('payment_intents')
          .select(
            'id, quantity, amount_bdt, expires_at, target_plan, covers_period_end',
          )
          .eq('coaching_center_id', session.active.centerId)
          .eq('purpose', 'subscription')
          .in('state', ['pending', 'initiated'])
          .order('created_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
    /*
     * §3.7's asks, waiting for the one reader who can end the wait.
     *
     * Only where places are sold and only for an owner, which `sellsPlaces` is both of.
     * A manager reading this screen filed the ask themselves and is shown it on the
     * screen where they filed it; a teacher tier has nothing to buy, so an ask left over
     * from before a downgrade is the founder panel's problem rather than this card's.
     */
    sellsPlaces ? openAsks(supabase, session.active.centerId) : Promise.resolve(null),
    /*
     * What we have already been paid, newest first — the way in to §9.9's last printable.
     *
     * Owner-only rather than `sellsPlaces`, because this is not about places: a শিক্ষক প্রো
     * centre paying monthly has receipts too, and gating them behind a tier that sells
     * capacity would hide a paying customer's own paperwork. `payments_owner_read` is the
     * policy either way, so a manager's query would come back empty.
     *
     * The intent comes embedded so each line can say what the money bought. Composite
     * `payments_intent_fkey`, generated `isOneToOne: false`, so the shape is unwrapped
     * defensively by lib/billing/receipt.ts rather than trusted here. `priced_lines` comes
     * with it and this card never prints it: the column is required by the shared reader on
     * purpose, so that the printable cannot be the one caller that forgets §3.8's rate.
     *
     * Six, because this card is a way to find a receipt and not a ledger. An owner needing
     * last year's rings us, which is the same answer as for a lapsed purchase.
     */
    isOwner
      ? supabase
          .from('payments')
          .select(
            'id, intent_id, amount_bdt, method, reference, covers_period_start, covers_period_end, note, paid_at, payment_intents (purpose, quantity, grants_capacity, branch_id, priced_lines)',
          )
          .eq('coaching_center_id', session.active.centerId)
          .order('paid_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null, error: null }),
  ])

  /*
   * What is being used now, and `null` where the count did not arrive rather than the
   * nought it used to be.
   *
   * A zero here is the worst kind on this screen. "0 / 30 students" to a centre with
   * thirty is the paywall telling them they have all the room in the world, on the one
   * page whose job is to show them they have run out — and on the centre tiers the note
   * below says the student count is the figure their bill is worked out from, so a
   * nought is a bill basis nobody would query. `—` instead, like every other figure in
   * the product that is not known.
   */
  const usage: { label: string; used: number | null; limit: number | null }[] = [
    { label: t.batches, used: batchCount, limit: plan.maxBatches },
    // The ceiling rather than `plan.maxStudents`, and this is the row where that null
    // did the most damage: the note under this table tells a centre its student count
    // is what the bill is worked out from, and the row above it said the count had no
    // ceiling at all. See lib/plans.ts studentCeiling.
    { label: t.students, used: studentCount, limit: session.ceiling.ceiling },
    { label: t.subjects, used: subjectCount, limit: plan.maxSubjects },
    // Only where there are colleagues to count. On a one-teacher plan "1 / 1" is a
    // row that tells the reader nothing they did not know when they signed up.
    //
    // Unless the number is wrong, which is the one case where it tells them
    // everything: a centre moved down a tier keeps its teachers, and this row is
    // where "6 / 1" gets said out loud. Switching them off is /settings/teachers,
    // which the hub links to under the same condition.
    //
    // And drawn when the count did not arrive at all, which used to be the same as a
    // nought and so took the row away. Over their seats is precisely the state that
    // cannot be ruled out by a read that failed, and this row is the only place the
    // product says it — so it stays, reading "— / 1", and the owner taps through to a
    // list that counts them again.
    ...(hasStaff(plan) || teacherCount === null || overStaffSeats(plan, teacherCount)
      ? [{ label: t.teachers, used: teacherCount, limit: plan.maxTeachers }]
      : []),
  ]

  // Only the nine. A map covering all twelve flags would need a name for paid SMS,
  // and the only name available would describe a screen that does not exist — which
  // is exactly what this screen must not put on paper.
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

  const have = SHIPPED.filter((key) => has(plan, key))
  const lack = SHIPPED.filter((key) => !has(plan, key))

  // Blank in every deployment until the founder puts their own number in. Absent
  // rather than a dead chip: a WhatsApp button that opens a chat with nobody is
  // worse than no button, and this is the screen where trust is being built. What is
  // no longer gated on it is the card itself — see the note at the top.
  const salesPhone = normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')
  const salesMessage = t.contactMessage(
    session.active.centerName,
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
  const from = coverageStart(session.active.paidThrough, now)
  const canMove = from === currentPeriodMonth(now)

  /*
   * What this owner may pay for: staying where they are, and — upwards only — where
   * they could go.
   *
   * Priced in the label like the request dropdown, because a line reading "Institution"
   * asks somebody to remember a figure from four cards up the page. A free tier gets no
   * renewal option: there is nothing to renew, and an option quoting ৳0 on the screen
   * where somebody has decided to start paying is a dead end.
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
  /*
   * The three counts the bill is worked out from, or null if any of them would not read.
   *
   * A nought here is not a smaller bill, it is a wrong one — and this figure becomes a
   * receipt. So the form goes away and says so, which is the same rule the usage table
   * above follows when it prints `—` instead of a zero.
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
  const subscribes = isOwner && subChoices.length > 0

  /*
   * THE NEXT RUNG UP AND THE DIFFERENCE ITSELF — §20.4's fourth question, which the
   * four cards at the bottom of this page could never answer. Two feature lists side
   * by side is not a difference; it is a diff, and it asks the reader to do it by eye.
   *
   * Strictly above, so the top tier gets no block at all. `PLAN_RANK` rather than the
   * array index, because the rank is the order the rest of the product compares tiers
   * in and `LADDER` is only the order a price list reads in.
   */
  const nextUp =
    LADDER.find((tier) => PLAN_RANK[tier.id] > PLAN_RANK[plan.id]) ?? null

  /** What it adds, from the same list and the same labels as the card above. */
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
   * against them. So on those tiers a finite cap is left out rather than printed;
   * the usage table above still shows an owner their own.
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
        ([, from, to]) =>
          from !== to && (to === null || nextUp.pricing !== 'per_student'),
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
          plan: planFor(session.active.plan),
          purchasedCapacity: session.active.studentCapacity,
          places: ask.places,
        }).amountBdt,
      ),
    ),
  }))

  /*
   * The receipts, as finished rows.
   *
   * Composed through `purchaseReceipt`, the same function the printable itself uses, so the
   * line an owner taps and the sheet it opens cannot describe the purchase differently — and
   * so the machine-written note (`student_capacity x40`) is dropped in both places rather
   * than in one. Nothing is priced here: see that module on why the bands must not be
   * recomputed after a purchase has already raised the ceiling.
   *
   * CREDITS ARE IN THIS LIST, not filtered out of it. They are `payments` rows since
   * 20260811000074 and the card is the only place an owner can see what we have done with
   * their money; a credit hidden here is a figure they cannot reconcile against the total.
   * Labelled and signed on the way out, because the sheet prints the magnitude.
   */
  // The printable's own words, not a second copy of them in this group: the list and the
  // sheet it opens must name a purchase identically.
  const sheetWords = dict(locale).purchaseReceipt
  const receipts =
    settled?.map((row) => {
      const sheet = purchaseReceipt(row)
      const credit = sheet.kind === 'credit'
      return {
        id: row.id,
        // A credit has no intent by constraint, so it always falls to its reason — which is
        // required, so it is never the bare fallback word.
        what:
          sheet.purpose !== null
            ? sheetWords.bought[sheet.purpose](sheet.quantity)
            : (sheet.note ?? t.paid.receipt),
        // The one place the sign is printed. On a line among other lines it is what tells a
        // reader which way ৳750 went, and the badge beside it says the word.
        taka: credit ? `− ${formatTaka(sheet.amount)}` : formatTaka(sheet.amount),
        credit,
        day: formatDate(todayInDhaka(new Date(sheet.paidAt)), locale),
        number: sheet.number?.value ?? (credit ? t.paid.credit : t.paid.receipt),
      }
    }) ?? null

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
      {/*
        TWO COLUMNS FROM `lg` UP, one on a phone, out of one DOM — the arrangement the
        dashboard proved (§20.8 step 2). Every block carries an `order-N` matching the
        sequence a phone reads it in, and the two column wrappers are `display: contents`
        below the breakpoint so they generate no box and their children are flex items of
        this one column again. `lg:items-start` or the shorter column stretches to the
        taller one and the rail ends in a foot of white.
      */}
      <div className="order-1 lg:col-span-12">
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {dict(locale).settings.hub.title}
        </Link>

        <h1 className="text-xl font-bold text-ink lg:text-2xl">{t.title}</h1>

        {/*
          §20.4'S FIRST QUESTION, ANSWERED IN THREE FIGURES rather than in a clause of a
          subtitle: what they are on, what it costs, and the date the money runs to.
          That date is what an owner opens this screen for, and until now it was printed
          inside the subscription card — which a manager never sees, and which an owner
          on a tier with nothing left to sell is not shown either.

          Ruled rather than boxed: one container with two dividers, not three cards
          (§20.7). Stacked below `sm`, because three figures across a 375px screen is
          three columns of wrapped words.
        */}
        <dl
          className="mt-3 grid divide-y divide-line rounded-xl border border-line
            bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        >
          <Fact label={t.factPlan} value={planName(plan, locale)} />
          <Fact label={t.factPrice} value={priceLine(plan, t)} />
          <Fact
            label={t.factPaid}
            value={
              session.active.paidThrough
                ? formatDate(session.active.paidThrough, locale)
                : t.factPaidNone
            }
            // Amber only where the product is actually withholding something. The shell
            // says why in a banner; this says which date it happened after.
            tone={session.access === 'read_only' ? 'late' : 'ink'}
          />
        </dl>
      </div>

      <div className="contents lg:order-2 lg:col-span-7 lg:flex lg:flex-col lg:gap-5">
        <Card className="order-2">
          <h2 className="font-semibold text-ink">{t.usageTitle}</h2>
          <dl className="mt-2 flex flex-col gap-1.5">
            {usage.map((row) => {
              /*
                FULL AND OVER, SAID ON THE ROW. A line reading "30 / 30" is the reason
                this screen gets opened, and it looked like every other line on it —
                the reader had to compare the two figures themselves, on every row, to
                find the one that had run out. Over is a real state and not an
                impossible one: a centre moved down a tier keeps its students, and the
                teachers row is drawn specifically to say so.
              */
              const { used, limit } = row
              const full = used !== null && limit !== null && used >= limit
              const over = used !== null && limit !== null && used > limit
              return (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt className="text-ink-soft">{row.label}</dt>
                  {/*
                    The count is always shown, cap or no cap. It used to be replaced by
                    the words "no limit" on the centre tiers, which meant the block
                    titled "what is being used now" showed an owner nothing they were
                    using — and on those tiers the student count is the figure their
                    bill is worked out from, so it is the one number they came for.
                  */}
                  <dd
                    className={`num font-semibold ${
                      over ? 'text-absent' : full ? 'text-late' : 'text-ink'
                    }`}
                  >
                    {used === null ? '—' : digits(used, locale)}
                    {limit === null ? (
                      <span className="ml-1 font-medium text-ink-soft">
                        · {t.noCap}
                      </span>
                    ) : (
                      `/${digits(limit, locale)}`
                    )}
                    {full && (
                      <span className="ml-2 text-xs font-medium">
                        {over ? t.capOver : t.capFull}
                      </span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
          {plan.maxStudentsPerBatch !== null && (
            <p className="mt-2 text-sm text-ink-faint">
              {t.perBatchCap(plan.maxStudentsPerBatch)}
            </p>
          )}
          {plan.maxBatches !== null && has(plan, 'multipleBranches') && (
            <p className="mt-2 text-sm text-ink-faint">
              {t.perBranchBatches(plan.maxBatches)}
            </p>
          )}
        </Card>

        {/*
          Directly under the counts, because the row that says "118 / 120 students" is
          where an owner learns they need this — and drawn only on a tier that sells
          places, since on the teacher tiers the ceiling moves by changing plan and the
          card below already says so.
        */}
        {sellsPlaces && (
          <Card className="order-3">
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
          WHERE THE PLAN ITSELF IS PAID FOR — and, for a trial centre, the one control on
          this page that ends the trial without the founder having to ring back. Under the
          places card because places are the more frequent errand for a centre already
          paying; above the receipts because this is the money going out, not the paperwork
          coming back.

          Drawn only when there is something to sell: a free tier with no upward move left
          (coverage still running, so a move would be mid-term) has nothing here, and a
          card offering a ৳0 renewal would be worse than no card.
        */}
        {subscribes && (
          <Card className="order-4" id="pay">
            <h2 className="font-semibold text-ink">{t.subscribe.title}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t.subscribe.body}</p>

            {/* The one fact an owner comes to this card for. `paid_through` is the last
                day covered, so it is printed as a day and not a month. */}
            <p className="mt-2 text-sm font-medium text-ink">
              {session.active.paidThrough
                ? t.subscribe.coveredUntil(
                    formatDate(session.active.paidThrough, locale),
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
          §20.4'S FOURTH AND FIFTH QUESTIONS, WHICH THE FOUR CARDS BELOW NEVER ANSWERED:
          what changes if I move up, and what will it cost. The difference itself, and one
          figure for the price — from the same `priceLine` the list uses, so the two cannot
          disagree. Absent on the top tier, where there is nothing above to move onto.
        */}
        {nextUp && (
          <Card className="order-5">
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
                  {nextRaises.map(([label, from, to]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between gap-4"
                    >
                      <dt className="text-ink-soft">{label}</dt>
                      {/* The arrow is not `aria-hidden`, unlike the ticks and crosses in
                          the feature lists. Those repeat what their list is headed with;
                          this one carries the sentence — hidden, the row reads "5 100". */}
                      <dd className="num font-semibold text-ink">
                        <span className="font-normal text-ink-faint">
                          {from === null ? t.noCap : digits(from, locale)}
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
              a few inches up, and two ways to buy the same month is how somebody buys it
              twice. On a phone that jump is worth having — the form it lands on is three
              cards away — and on a laptop the target is already beside this block.
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
          in its face is a question it answered months ago, and it was the tallest thing on
          this screen. Open on the free tier, where choosing is the whole errand.

          Kept rather than deleted (§38). It is the only place the product says what all
          four tiers are for, the block above only describes the next one, and a reader
          comparing two rungs further up has nowhere else to look.
        */}
        <details
          className="order-6 rounded-2xl border border-line bg-white p-5 shadow-sm"
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

        {/* Last in the column and wrapped for its order, because `PriceCalculator`
            renders its own `Card` and takes no class of its own. */}
        <div className="order-7">
          <PriceCalculator t={dict(locale).planCalc} locale={locale} />
        </div>
      </div>

      {/*
        THE RAIL: what has been paid, what the plan holds, and how to reach us. Beside the
        working column on a laptop rather than a screen further down, and after it on a
        phone — none of it is why somebody opened this screen, and all of it is what they
        check once they are here.
      */}
      <div className="contents lg:order-3 lg:col-span-5 lg:flex lg:flex-col lg:gap-5">
        {/*
          Under the places card and not inside it, because it is not about places: the monthly
          subscription money lands in the same table, so a শিক্ষক প্রো centre has receipts to
          print without ever buying a single place.

          Drawn only when there is something to draw, or when the read broke. A card headed
          "what we have received" with nothing under it is the trial centre being told, on the
          pricing screen, that they have paid us nothing — which they know, and which is the
          one sentence this screen should not open with.
        */}
        {isOwner && (settledError || (receipts !== null && receipts.length > 0)) && (
          <Card className="order-8">
            <h2 className="font-semibold text-ink">{t.paid.title}</h2>
            {settledError ? (
              <p className="mt-1 text-sm text-ink-soft">{t.paid.unreadable}</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink-soft">{t.paid.body}</p>
                <div className="mt-3 flex flex-col gap-2">
                  {receipts?.map((r) => (
                    <Link
                      key={r.id}
                      href={`/settings/plan/receipt/${r.id}`}
                      className={`flex min-h-tap flex-col justify-center rounded-xl border p-3
                        ${r.credit ? 'border-late/40 bg-late/5' : 'border-line bg-surface-alt'}`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-ink">{r.what}</span>
                        {/* Toned rather than coloured, and the sign is in the string: a
                            credit among receipts has to be legible as the odd one out at a
                            glance, and green or red would both say the wrong thing about
                            money the centre is owed. */}
                        <span
                          className={`num shrink-0 font-bold
                            ${r.credit ? 'text-late' : 'text-ink'}`}
                        >
                          {r.taka}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-3">
                        <span className="num text-sm text-ink-soft">{r.day}</span>
                        <span className="num shrink-0 text-sm text-brand-700 underline">
                          {r.number}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Card>
        )}

        <Card className="order-9">
          <h2 className="font-semibold text-ink">{t.haveTitle}</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {have.map((key) => (
              <li key={key} className="flex gap-2 text-ink">
                <span aria-hidden className="text-present">
                  ✓
                </span>
                {labels[key]}
              </li>
            ))}
          </ul>

          {/* Named, not hidden. A feature an owner cannot see they are missing is a
              feature they cannot decide to pay for — and one they discover by
              tapping is a feature they experience as broken. */}
          {lack.length > 0 && (
            <>
              <h2 className="mt-4 font-semibold text-ink">{t.lackTitle}</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {lack.map((key) => (
                  <li key={key} className="flex gap-2 text-ink-soft">
                    <span aria-hidden className="text-ink-faint">
                      ✕
                    </span>
                    {labels[key]}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-3 text-xs text-ink-faint">{t.onlyBuilt}</p>
        </Card>

        <Card className="order-last" id="ask">
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
            <div
              className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3"
            >
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
                    with the space, 152.03px without, 156.03px with this margin. The
                    at-risk row spaces the same two parts with a plain JSX space and is
                    right to, because that anchor is an inline-block, where the space
                    is 3.27px of real layout. */}
                <span className="num ml-1">{formatBdMobile(salesPhone)}</span>
              </a>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/**
 * One of the three facts at the top of the screen.
 *
 * The label above its figure rather than beside it, because the three sit in a row from
 * `sm` up and a stacked pair per cell reads as a table without one being drawn. The
 * figure is `num` in both languages: two of the three are numerals, and the third is a
 * plan name that sits beside them.
 */
function Fact({
  label,
  value,
  tone = 'ink',
}: {
  label: string
  value: string
  /** Amber where the fact is the reason something is being withheld. */
  tone?: 'ink' | 'late'
}) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </dt>
      <dd
        className={`num mt-0.5 font-bold ${
          tone === 'late' ? 'text-late' : 'text-ink'
        }`}
      >
        {value}
      </dd>
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

/*
 * OpenPurchase moved to ./open-purchase.tsx when the add-student screen started
 * opening place purchases of its own — see the head of that file.
 */
