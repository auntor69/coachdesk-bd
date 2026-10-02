'use server'

/**
 * An owner raising their hand: "I want to change plan, ring me." And the two things a
 * customer can buy without one: months of a tier, and a recharge of the balance.
 *
 * WHY THIS EXISTS AT ALL, when the screen above it already had a WhatsApp chip and a
 * phone number. Both of those live behind `NEXT_PUBLIC_SALES_PHONE`, and that
 * variable is empty in every deployment — the founder's own number is not in the
 * repo and should not be. The card was gated on it, correctly for a dead WhatsApp
 * link and wrongly for the whole card, so an owner who had just read the price
 * calculator and decided to buy reached the bottom of the page and found nothing.
 * The sale ended there, silently, and nobody ever learned it had happened.
 *
 * A ROW INSTEAD OF A MAILTO, because the founder panel already carries this centre's
 * name, its owner's name, a `tel:` link, the student and teacher counts and the exact
 * monthly bill. The only fact missing from that card was that the customer wants to
 * talk, so that is the only fact this writes.
 *
 * NO FORM HERE GRANTS ANYTHING. `coaching_centers.plan` is locked by the trigger in
 * 20260811000004 and stays locked: `requestUpgrade` writes a note, and `buySubscription`
 * writes a quote with a tier on it that `settle_payment_intent` reads once the money is
 * real (20260811000073). An owner still cannot move their own tier by asking — what
 * changed is that paying for it no longer needs a person to finish the job.
 *
 * THREE EXPORTS WENT WITH CAPACITY (§16.1 step 28), and they were the other half of
 * that sentence: `buyStudentPlaces`, `requestPlaces` with its `withdrawPlacesRequest`,
 * and the two answers to an ask, `answerAsk` and `declineAsk`. All five wrote or read
 * something a per-student tier no longer has — a priced batch of student places, or the
 * `capacity_requests` row a branch manager filed when the register was full. The rule
 * they were built on is untouched: what is left here is an owner saying what they want,
 * and the money is written by the server.
 */

import { revalidatePath } from 'next/cache'

import {
  AuthError,
  getSession,
  requireRole,
  type CenterSession,
} from '@/lib/auth/session'
import { normalizeBdMobile, toAsciiDigits } from '@/lib/bd/phone'
import { currentPeriodMonth, todayInDhaka } from '@/lib/bd/time'
import { currentPriceVersion, fileRechargeClaim, livePromotion } from '@/lib/billing/claims'
import { rechargeQuote } from '@/lib/billing/recharge'
import { rechargeWords } from '@/lib/i18n/recharge'
import { recordAcceptance } from '@/lib/legal/acceptance'
import { RECHARGE_POLICIES } from '@/lib/legal/policies'
import { centerStudentCount } from '@/lib/students/headcount'
import { openIntent } from '@/lib/billing/intents'
import { priceIntent } from '@/lib/billing/price'
import { paymentProvider } from '@/lib/billing/provider'
import { UNIQUE_VIOLATION } from '@/lib/idempotency'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { formatTaka } from '@/lib/money'
import {
  MAX_CENTER_PAYMENT_BDT,
  coverageStart,
  isMonthsCovered,
} from '@/lib/platform/billing'
import {
  PLAN_RANK,
  dailyRatePoisha,
  monthlyBillBdt,
  planFor,
  type PlanId,
} from '@/lib/plans'

export type UpgradeState = {
  error?: string
  ok?: string
} | null

/**
 * The tiers somebody may ask to be put on.
 *
 * Not `teacher_free`. Asking to be moved onto the free plan is a cancellation, and a
 * cancellation is a conversation — putting it behind the same button as "I want to
 * pay you" would turn one control into two opposite meanings and give the founder a
 * queue they cannot read at a glance.
 *
 * A DOWNGRADE BETWEEN PAID TIERS IS ALLOWED THOUGH, and deliberately: a centre that
 * wants to drop from Centre to Teacher Pro because they have shrunk is a phone call
 * we would far rather have than a customer who quietly stops paying. The form only
 * offers the tiers they are not already on; the founder decides what actually
 * happens.
 */
const ASKABLE = new Set<PlanId>(['teacher_plus', 'center', 'institution'])

/**
 * Owner only, and not manager.
 *
 * `upgrade_requests_owner_insert` draws the same line, so a manager would be refused
 * by RLS anyway — what RLS cannot do is say why, and a silent zero-row write would
 * render as "could not save it", which reads as a bug. The line is where it is
 * because this is a commitment of somebody else's money: a branch manager runs a
 * branch and does not decide what the centre pays, the same rule that keeps
 * `payments_owner_read` off them.
 *
 * NO `requireWritable` HERE, DELIBERATELY, and it is the one write in the whole app that
 * a suspended centre most needs. Read-only exists to make an owner ring us; refusing the
 * button that says "put me on a plan" would be refusing the thing we are asking them to
 * do, and every other module in this arc runs the check. A cancelled centre can file one
 * too, which is exactly right — that is a customer coming back.
 */
async function planOwner(): Promise<CenterSession | UpgradeState> {
  try {
    return await requireRole('owner')
  } catch (err) {
    if (err instanceof AuthError) {
      const caller = await getSession()
      const d = dict(caller?.locale ?? DEFAULT_LOCALE)
      return { error: d.settings.plan.upgrade.ownerOnly }
    }
    throw err
  }
}

function isSession(value: CenterSession | UpgradeState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Files — or replaces — this centre's open request.
 *
 * SAFE TO ARRIVE TWICE, which is not optional here. `experimental.useOffline` holds a
 * Server Action that had no network and replays it when there is one, so one tap in a
 * corridor with one bar is one row or three depending entirely on how this is
 * written. The table's primary key is the centre, so the replay is an upsert onto the
 * same row rather than a founder ringing the same owner three times.
 *
 * The delete before it is what makes `created_at` mean "how long they have been
 * waiting". Upserting alone would leave the date of a request the founder ticked off
 * in March sitting on a brand-new one in August; clearing a *handled* row first means
 * a fresh ask gets a fresh date, while an ask that is still open keeps its original
 * one and holds its place in the queue. Nothing is lost — the table has only ever
 * held one row per centre, so there is no history here to preserve.
 */
export async function requestUpgrade(
  _prev: UpgradeState,
  formData: FormData,
): Promise<UpgradeState> {
  const gate = await planOwner()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.upgrade

  const plan = String(formData.get('plan') ?? '') as PlanId
  if (!ASKABLE.has(plan)) return { error: t.badPlan }
  // Asking to be put on the tier they are already on is not a request, and it is
  // also the shape a replay takes once the founder has already applied the change:
  // refused here, which leaves the handled row handled instead of reopening it.
  if (plan === session.plan.id) return { error: t.badPlan }

  const note = clamp(String(formData.get('note') ?? ''), MAX_TEXT)

  const supabase = await createClient()

  // scoped-by: coaching_center_id is filtered below; the row being cleared is this
  // centre's own already-handled request, and RLS refuses any other centre's.
  await supabase
    .from('upgrade_requests')
    .delete()
    .eq('coaching_center_id', session.active.centerId)
    .not('handled_at', 'is', null)

  const { error } = await supabase.from('upgrade_requests').upsert(
    {
      coaching_center_id: session.active.centerId,
      requested_plan: plan,
      // Empty means no note, not an empty note — a column full of '' cannot be told
      // apart from one nobody filled in.
      note: note || null,
      requested_by: session.userId,
      // Reopened explicitly. A row the founder had ticked off is gone by now, but an
      // owner changing their mind while a request is still open must not be able to
      // leave `handled_at` set on the tier they no longer want.
      handled_at: null,
    },
    { onConflict: 'coaching_center_id' },
  )

  if (error) return { error: t.failed }

  revalidatePath('/settings/billing')

  return { ok: t.sent }
}

/**
 * Takes the request back.
 *
 * Exists because a pending card with no way out is a screen that lies about what the
 * reader controls, and because an owner who tapped the wrong tier has no other way to
 * correct it — the founder is not sitting at a keyboard waiting. `handled_at is null`
 * on the delete keeps this to the open request: once the founder has acted, there is
 * nothing here left to withdraw.
 */
export async function withdrawUpgradeRequest(
  _prev: UpgradeState,
  _formData: FormData,
): Promise<UpgradeState> {
  const gate = await planOwner()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.upgrade

  const supabase = await createClient()

  // scoped-by: coaching_center_id is filtered below — this centre's own open request.
  const { error } = await supabase
    .from('upgrade_requests')
    .delete()
    .eq('coaching_center_id', session.active.centerId)
    .is('handled_at', null)

  if (error) return { error: t.failed }

  revalidatePath('/settings/billing')

  return { ok: t.withdrawn }
}

/**
 * Months of the plan, bought by the owner — and, when they are not on it yet, the tier
 * itself. MASTERPLAN §16's "an owner moving their own centre between tiers without a
 * founder doing it for them".
 *
 * THE TIER MOVES WHEN THE MONEY DOES, not here: `target_plan` on the intent is read by
 * `settle_payment_intent` (20260811000073), which is service-role-only and the one writer
 * 20260811000004's guard admits. So this is still the rule the rest of the file follows —
 * the customer says what they want and the server writes the money — with the difference
 * that the answer no longer needs a person.
 *
 * UPGRADES AND RENEWALS ONLY. A move is allowed when it raises `PLAN_RANK`; anything
 * downwards is `requestUpgrade`'s conversation, for the reason written over `ASKABLE`. The
 * schema agrees about the floor of that: `target_plan` may never be `teacher_free`.
 *
 * WHERE THE COVERAGE STARTS IS NOT A PARAMETER. It is this month, or the month after the
 * one already paid for, whichever is later. Both halves matter: billing from today would
 * charge a centre twice for months it has, and billing from the end of old coverage would
 * bill a lapsed centre for the months it spent suspended. A `paid_through` that stops
 * mid-month rounds up to the next one, which errs by at most one month and errs in the
 * customer's favour.
 *
 * A TIER MOVE IS REFUSED WHILE COVERAGE IS STILL LIVE, and this is the one thing an owner
 * may want that this cannot do. Starting the new tier's window after the old coverage
 * while moving the plan today would sell twelve months of Institution for one month's
 * price; starting it today would charge twice for the overlap. The honest answer is the
 * other button on the same card and a founder who can pro-rate by hand.
 *
 * ONE OPEN SUBSCRIPTION AT A TIME, unlike places, which are additive and can queue.
 * Coverage is computed from `paid_through` when the intent opens, so two intents opened
 * the same afternoon would cover the same months and settling both would take the money
 * twice for one window. `cancelPurchase` is how an owner who mistyped gets out of it
 * without waiting seven days for the quote to lapse.
 */
export async function buySubscription(
  _prev: UpgradeState,
  formData: FormData,
): Promise<UpgradeState> {
  const gate = await planOwner()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.subscribe

  // Not `count`, which clamps: clamping a posted 99 to 12 would turn a nonsense request
  // into the largest purchase on the card. `MONTHS_COVERED` is the whole filter.
  const months = Number.parseInt(
    toAsciiDigits(String(formData.get('months') ?? '')).replace(/[^\d]/g, ''),
    10,
  )
  if (!isMonthsCovered(months)) return { error: t.badMonths }

  const current = planFor(session.active.plan)
  // Cast at the read like `requestUpgrade` above, so the two checks below need none: the
  // string is whatever a caller posted, and `ASKABLE` is what makes it a tier.
  const asked = String(formData.get('plan') ?? '') as '' | PlanId

  // An empty select, or the tier they are already on, is a renewal. Anything else has to
  // be a real tier and has to be a step up.
  const targetPlan = asked === '' || asked === current.id ? null : asked
  if (targetPlan !== null && !ASKABLE.has(targetPlan)) return { error: t.badPlan }
  if (targetPlan !== null && PLAN_RANK[targetPlan] <= PLAN_RANK[current.id]) {
    return { error: t.downgradeIsACall }
  }

  const buying = targetPlan === null ? current : planFor(targetPlan)

  const now = new Date()
  const thisMonth = currentPeriodMonth(now)
  const from = coverageStart(session.active.paidThrough, now)

  // A tier move has to start this month, and one is refused when coverage runs past it.
  // Starting the new tier after the old coverage while moving `plan` today would sell a
  // year of Institution for a month of it; starting it today would charge twice for the
  // overlap. A real pro-rate needs a credit `payments.amount_bdt > 0` cannot hold, so
  // the honest answer is the request form and a founder settling it by hand.
  if (targetPlan !== null && from !== thisMonth) return { error: t.midTermIsACall }

  const supabase = await createClient()

  const [{ count: students }, { count: teachers }, { count: branches }, { data: open }] =
    await Promise.all([
      // scoped-by: coaching_center_id is filtered below.
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('status', 'active'),
      // scoped-by: coaching_center_id is filtered below.
      supabase
        .from('teachers')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true),
      // scoped-by: coaching_center_id is filtered below.
      supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true),
      // scoped-by: coaching_center_id is filtered below.
      supabase
        .from('payment_intents')
        .select('id')
        .eq('coaching_center_id', session.active.centerId)
        .eq('purpose', 'subscription')
        .in('state', ['pending', 'initiated'])
        .limit(1),
    ])

  // A count that would not read is refused rather than treated as zero, which is the rule
  // ../../../lib/entitlement.ts writes down: a missing roster does not make the bill
  // smaller, it makes the bill wrong, and this one becomes a receipt.
  if (students === null || teachers === null || branches === null) return { error: t.failed }
  if (open === null) return { error: t.failed }
  if (open.length > 0) return { error: t.alreadyOpen }

  const quote = priceIntent({
    purpose: 'subscription',
    plan: buying,
    activeStudents: students,
    activeTeachers: teachers,
    // At least one building, the same floor ../../../lib/platform/centers.ts applies: a
    // centre that has never named a branch still teaches somewhere.
    activeBranches: Math.max(1, branches),
    months,
    from,
    targetPlan,
  })
  // Zero can only mean the tier being bought costs nothing, which is the free one — and
  // a free tier has no months to sell.
  if (quote.quantity <= 0 || quote.amountBdt <= 0) return { error: t.notOnThisPlan }

  // The same ceiling ../../founder/actions.ts refuses a hand-recorded payment above. An
  // organisation whose year costs more than this is a conversation, not a form, and the
  // two paths agreeing is what keeps a purchase settleable.
  if (quote.amountBdt > MAX_CENTER_PAYMENT_BDT) {
    return { error: t.tooMuch(formatTaka(MAX_CENTER_PAYMENT_BDT)) }
  }

  const admin = createAdminClient(session.userId)

  const opened = await openIntent(admin, {
    centerId: session.active.centerId,
    quote,
    requestedBy: session.userId,
    branchId: session.active.branchId,
    idempotencyKey: formData.get('idempotencyKey'),
  })
  if (!opened.ok) return { error: t.failed }

  const provider = paymentProvider(opened.intent.provider)
  const told = await provider.createPayment(admin, opened.intent)
  if (told.kind === 'blocked') return { error: t.closed }

  revalidatePath('/settings/billing')

  return { ok: t.opened }
}

/** A uuid and nothing that merely looks like one, since this arrives from a form. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Calling off a purchase the owner has not paid for.
 *
 * WHY THIS HAS TO EXIST, and why it also closes the same gap on the places card: a quote
 * lives seven days, and until now a mistyped one sat on the screen for all seven with a
 * reference the owner was invited to send money against. Nothing forced them to pay it, but
 * "cancel" is the control every payment screen has, and its absence reads as a purchase
 * they are committed to. `buySubscription` makes it load-bearing rather than merely kind —
 * one open subscription at a time means a wrong twelve months would block the right one.
 *
 * `pending -> cancelled` and `initiated -> cancelled` are both §11.2 transitions, so the
 * guard in 20260811000073 lets this through and refuses it the moment money has settled.
 * The state filter here is belt to that braces: without it a `successful` row would reach
 * the trigger and come back as a 42501 the owner reads as a bug.
 *
 * SERVICE ROLE BECAUSE NOTHING ELSE CAN. `authenticated` has no UPDATE on
 * `payment_intents` at all (20260811000057), so the gate is `planOwner` plus the centre
 * filter below, and both of them are this function's own doing.
 */
export async function cancelPurchase(
  _prev: UpgradeState,
  formData: FormData,
): Promise<UpgradeState> {
  const gate = await planOwner()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.subscribe

  const intent = String(formData.get('intent') ?? '')
  if (!UUID_RE.test(intent)) return { error: t.gone }

  const admin = createAdminClient(session.userId)

  // scoped-by: coaching_center_id is filtered below, so an id copied from another
  // customer's screen matches nothing.
  const { data, error } = await admin
    .from('payment_intents')
    .update({ state: 'cancelled' })
    .eq('id', intent)
    .eq('coaching_center_id', session.active.centerId)
    .in('state', ['pending', 'initiated'])
    .select('id')

  if (error) return { error: t.failed }
  if (!data || data.length === 0) return { error: t.gone }

  revalidatePath('/settings/billing')

  return { ok: t.cancelled }
}

/** What the recharge form reports back, in the two shapes the screen draws. */
export type RechargeState = { error?: string; ok?: string } | null

/**
 * The owner telling us they have sent the money — MASTERPLAN §11.9, build-order step 25.
 *
 * THIS IS THE ONE WRITE IN THE PRODUCT A READ-ONLY CENTRE MUST BE ABLE TO MAKE, and it is
 * therefore the one place `requireWritable` is deliberately absent. Read-only exists
 * because the balance cannot cover the day (§4.4/§11.7), and recharging is the only way
 * out of it — a dry centre refused its own top-up would be a customer we have locked out
 * of paying us. Every other gate in this file is unchanged: the owner check, the amount
 * bounded, the transaction ID required.
 *
 * WHAT IT DOES NOT DO: CREDIT ANYTHING. The row it writes is a claim — "I sent this, here
 * is the transaction ID" — and the balance moves only when a founder has looked at their
 * own bKash account and approved it (`public.approve_recharge_claim`, §11.9 step 7). The
 * bonus is priced here so the screen can show a figure, and *re-derived* at approval from
 * the amount that actually arrived: §11.11 is explicit that the browser never says what
 * the bonus is, and neither does this action.
 *
 * THE AMOUNT IS THE ONLY NUMBER THE CUSTOMER PICKS, and it is bounded on both sides
 * before anything is priced. Below one day's rate a recharge buys nothing at all —
 * §11.7's whole days or nothing — so it would be a claim a founder has to check by hand
 * in exchange for a figure the balance cannot spend, and the message says what the
 * smallest useful amount is rather than refusing in the abstract. Above
 * `MAX_CENTER_PAYMENT_BDT` it is the cap a founder-recorded receipt already carries, for
 * the same reason: a stray keystroke must not open a quote nobody meant to make.
 *
 * THE COUNTS ARE READ HERE RATHER THAN SENT. §11.4's list starts with a client-supplied
 * amount and this purchase's price *is* the centre's size — `monthlyBillBdt` and
 * `dailyRatePoisha` are computed from three counts the form is not trusted to state. They
 * are the same three `app.settle_billing` reads, from the same place the plan screen's own
 * bill comes from, so the rate the customer is shown is the rate the burn will charge.
 */
export async function submitRechargeClaim(
  _prev: RechargeState,
  formData: FormData,
): Promise<RechargeState> {
  const gate = await planOwner()
  const session = isSession(gate) ? gate : null
  if (!session) {
    const caller = await getSession()
    return { error: rechargeWords(caller?.locale ?? DEFAULT_LOCALE).ownerOnly }
  }

  const t = rechargeWords(session.locale)
  const supabase = await createClient()
  const admin = createAdminClient(session.userId)

  const [students, { count: teachers }, { count: branches }] = await Promise.all([
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
  ])

  // A missing count is not a smaller bill. This figure becomes a rate somebody sends
  // money against, so the form goes away and says so — the rule the plan screen already
  // follows when it prints `—` instead of a nought.
  if (students === null || teachers === null || branches === null) {
    return { error: t.unreadable }
  }

  const counts = { students, teachers, branches: Math.max(1, branches) }
  const plan = planFor(session.active.plan)
  const monthlyPoisha =
    monthlyBillBdt(plan, counts.students, counts.teachers, counts.branches) * 100
  const daily = dailyRatePoisha(plan, counts.students, counts.teachers, counts.branches)

  const typed = toAsciiDigits(String(formData.get('amount') ?? '')).replace(/[^0-9]/g, '')
  const amountBdt = Number(typed)
  if (!Number.isFinite(amountBdt) || amountBdt <= 0) return { error: t.badAmount }

  const minimumBdt = Math.ceil(daily / 100)
  if (minimumBdt > 0 && amountBdt < minimumBdt) {
    return { error: t.tooSmall(formatTaka(minimumBdt)) }
  }
  if (amountBdt > MAX_CENTER_PAYMENT_BDT) {
    return { error: t.tooLarge(formatTaka(MAX_CENTER_PAYMENT_BDT)) }
  }

  // The card and the promotion the quote is pinned to (§11.10/§11.11). Both are read
  // here and both are re-read at approval: this decides what the screen says, and that
  // decides what is credited, and §11.11 wants the second one authoritative.
  const today = todayInDhaka(new Date())
  const card = await currentPriceVersion(supabase, today)
  if (!card) return { error: t.unreadable }

  const promotion = await livePromotion(admin, card.id, new Date())
  const amountPoisha = amountBdt * 100
  const quote = rechargeQuote({
    amountPoisha,
    tiers: promotion?.tiers ?? [],
    // The centre's own monthly figure — the same one the quote's months are counted
    // from, and the one the approval re-derives from the stored counts (migration
    // 20260811000088). Both engines count months from the same number.
    monthlyPoisha: monthlyPoisha,
    dailyRatePoisha: daily,
  })

  /*
   * The consent tick, REFUSED HERE AND RECORDED BELOW (MASTERPLAN §11.6, §14.1).
   *
   * Refused rather than dropped, because the promise on the screen is that the money is not
   * refundable and the terms are the ones that say so — a claim filed with that box unticked
   * is a claim taken against nothing, which is the exact state §14.1 exists to end. It is
   * checked before the row is written, so a refused form leaves no half-filed claim behind.
   *
   * This is not a permission and not a fence: RLS has nothing to say about it, and the row in
   * `policy_acceptances` is the record rather than the gate.
   */
  if (String(formData.get('agree') ?? '') !== 'on') {
    return { error: t.agreeRequired }
  }

  const trxId = clamp(String(formData.get('trxId') ?? '').trim(), MAX_LABEL)
  if (trxId === '') return { error: t.badTrx }

  const sender = normalizeBdMobile(String(formData.get('sender') ?? ''))
  if (!sender) return { error: t.badPhone }

  const filed = await fileRechargeClaim(admin, {
    centerId: session.active.centerId,
    quotedPoisha: quote.payPoisha,
    quotedBonusPoisha: quote.bonusPoisha,
    priceVersionId: card.id,
    promotionId: promotion?.id ?? null,
    counts,
    trxId,
    senderMsisdn: sender,
    submittedBy: session.userId,
  })

  if (!filed.ok) {
    return { error: filed.reason === 'too_many_open' ? t.capReached : t.failed }
  }

  /*
   * What was agreed to, with the version of each document in force today.
   *
   * AFTER THE CLAIM IS FILED AND NEVER INSTEAD OF IT. `recordAcceptance` writes one row per
   * person, per policy, per version — so a second recharge at the same wording adds nothing,
   * and a recharge after we re-word the terms adds the new version beside the old one rather
   * than over it (§14.1: a term we change is a term somebody agreed to a different form of).
   * The centre is named here and is null at signup, because this is the first moment the
   * balance exists and the acceptance is about the balance.
   */
  await recordAcceptance(session.userId, session.active.centerId, RECHARGE_POLICIES)

  revalidatePath('/settings/billing')

  // The reference is in the answer as well as on the row, because the sentence the owner
  // reads next tells them to go and look at bKash — and a reference they can only see by
  // scrolling back is one they will not write down.
  return { ok: t.filed(filed.referenceCode) }
}
