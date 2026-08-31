'use server'

/**
 * The founder's own writes: money a centre paid us, what plan they are on, confirming a
 * purchase the customer started themselves, ticking off a request to change tier, and
 * getting a locked-out owner back in.
 *
 * THE ONLY PLACE IN THE APP THAT WRITES `payments`, directly or through
 * `settle_payment_intent`. Until this file existed the founder panel's "we have
 * received" column read ৳0 for every customer forever, because centres are signed up in
 * person and handed over bKash — the money was real and nothing recorded it. A
 * spreadsheet would have worked for a week; the reason it belongs here is that the panel
 * already knows what each centre *should* pay, and a screen that shows the bill beside
 * what arrived is the difference between chasing the right centre and chasing all of
 * them.
 *
 * WHY BOTH OF THESE GO THROUGH createAdminClient(), AND WHAT THAT COSTS.
 *
 * `payments` has exactly one RLS policy and it is SELECT-only (`payments_owner_read`).
 * `coaching_centers.plan`, `.status` and `.sms_credit_balance` are locked by the
 * trigger in 20260811000004: UPDATE on those columns raises 42501 for anybody who is
 * not service_role, and the blanket UPDATE grant was revoked and re-granted for five
 * harmless columns only. That is deliberate and it stays — money and a customer's tier
 * must not be reachable from a browser session, not even the founder's, because a
 * session token is a thing that leaks.
 *
 * The consequence is that inside these two functions RLS is not protecting anything.
 * The admin client bypasses every policy in the database, so `requirePlatformAdmin()`
 * on the first line is not defence in depth — it is the entire door. A Server Action
 * is a public HTTP endpoint reachable by anyone who can guess its id, so that check
 * being present and being *first* is the whole security model of this file.
 *
 * WHY TWO ACTIONS AND NOT ONE FORM. Recording a receipt and changing a tier are one
 * conversation and two different kinds of fact. A single form would mean the plan
 * `<select>` posts on every payment, so a founder who takes ৳1,999 from a Pro teacher
 * while the dropdown happens to be showing "Centre" has silently trebled that
 * customer's bill and will find out when they complain. Separate forms, separate
 * submits, and neither can move the other's data.
 *
 * CONFIRMING A PURCHASE IS NOT THE SAME AS RECORDING A PAYMENT, which is why it is its
 * own action and not a fifth field on the receipt form. `recordCenterPayment` is money
 * that arrived with nothing behind it — cash at a desk, a transfer against a bill. A
 * purchase already has a server-priced intent behind it (§11.2), so confirming one goes
 * through the provider interface and `settle_payment_intent`, which writes the receipt
 * and raises the student ceiling in one transaction. Neither action can do the other's
 * job: this one cannot name an amount, and that one cannot grant a place.
 *
 * TICKING OFF A REQUEST IS THE ODD ONE OUT and deliberately does not use the admin
 * client. `markUpgradeHandled` writes `upgrade_requests`, which has a policy for exactly
 * this — `upgrade_requests_platform_update` — so the write can be checked by the
 * database instead of trusted from here. Nothing about a request is money or a tier, so
 * there is no trigger standing in the way and no reason to reach past RLS. Where a
 * policy can do the job, the policy does the job.
 *
 * THE PASSWORD RESET TOUCHES AN ACCOUNT RATHER THAN A CENTRE, which makes it the most
 * dangerous thing in this file and the one with a rule module of its own. Read
 * lib/auth/founder-reset.ts for what it refuses and why the answer to "should the
 * platform admin be able to reset any password" is that they already can, from their
 * own environment, and what this removes is the database console rather than the
 * limit. It goes through GoTrue's admin API, which is service-role by construction —
 * there was never an RLS-shaped version of it to prefer.
 */

import { revalidatePath } from 'next/cache'

import {
  AuthError,
  getSession,
  requirePlatformAdmin,
  type Session,
} from '@/lib/auth/session'
import { founderResetRefusal } from '@/lib/auth/founder-reset'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { readIntent } from '@/lib/billing/intents'
import { paymentProvider } from '@/lib/billing/provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { addMonths, formatMonth, hasPassed } from '@/lib/bd/time'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { PAYMENT_METHODS } from '@/lib/fees/methods'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { passwordTooShort } from '@/lib/i18n/messages'
import { readIdempotencyKey, UNIQUE_VIOLATION } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { formatTaka, parseTaka } from '@/lib/money'
import {
  PLANS,
  planFor,
  planName,
  studentCeiling,
  type PlanId,
} from '@/lib/plans'
import {
  MAX_CENTER_PAYMENT_BDT,
  coverageEnd,
  isMonthsCovered,
  isPeriodChoice,
} from '@/lib/platform/billing'
import type { CenterStatus, MemberRole, PaymentMethod } from '@/lib/supabase/types'

/**
 * What both forms render back.
 *
 * `warn` is a success that the founder should read before walking away — the receipt
 * was written but the centre is still on trial, or the plan changed onto limits its
 * roster already exceeds. Neither is a failure and neither should be silent.
 */
export type FounderState = {
  error?: string
  ok?: string
  warn?: string
} | null

/**
 * The methods a coaching centre will actually hand a founder money in. Same list as
 * the fee register's, and now literally the same list: this set fails closed, so a value
 * the enum allows and this list forgets is a payment nobody can record, and there is one
 * array behind both so there is nothing left to forget. See @/lib/fees/methods.
 */
const METHODS = new Set<PaymentMethod>(PAYMENT_METHODS)

const PLAN_IDS = new Set<PlanId>(Object.keys(PLANS) as PlanId[])

/** Matches `center_status` in 20260811000001_init_schema.sql. */
const STATUSES = new Set<CenterStatus>([
  'trial',
  'active',
  'suspended',
  'cancelled',
])

/**
 * The gate, and the error a non-founder gets.
 *
 * Returns state rather than throwing so a `useActionState` form renders a sentence
 * instead of an error boundary — same shape as `feeAdmin` on the fee board. The
 * sentence says nothing about what would have happened, matching the 404 that
 * `pagePlatformAdmin` serves the page: someone poking at this endpoint should not
 * learn that a founder panel exists.
 */
async function founder(): Promise<Session | FounderState> {
  try {
    return await requirePlatformAdmin()
  } catch (err) {
    if (err instanceof AuthError) {
      const caller = await getSession()
      const d = dict(caller?.locale ?? DEFAULT_LOCALE)
      return { error: d.founder.money.forbidden }
    }
    throw err
  }
}

function isSession(value: Session | FounderState): value is Session {
  return value !== null && 'userId' in value
}

/**
 * Records money a coaching centre paid us.
 *
 * WRITE-ONCE AND NO EDIT PATH, on purpose, and the same rule the fee board follows
 * for a parent's payment: this row is money, and money is not editable from a browser
 * session. A wrong figure is corrected the day there is a reason to by a negative
 * counter-entry that keeps both facts, never by an UPDATE that leaves the founder's
 * own history saying something different from what happened. There is deliberately no
 * `deleteCenterPayment` in this file.
 *
 * `subscription_id` is left null. The `subscriptions` table models a billing engine —
 * renewal dates, price snapshots, a status of its own — and nothing renews anything
 * today; a row written by hand beside a hand-recorded receipt would be a second place
 * for a plan to be recorded and the two would disagree within a month. What a
 * subscription would have told us, the coverage window on the payment already does.
 *
 * Safe to arrive twice. The form sends a uuid it minted once and the unique index in
 * 20260811000025 refuses the second row carrying it, so a lost response or a replayed
 * request cannot inflate the one total that says whether this business works.
 */
export async function recordCenterPayment(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).founder
  const words = t.money

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: words.noCenter }

  const amount = parseTaka(String(formData.get('amount') ?? ''))
  // Zero and negative both land here. A ৳0 receipt is not a payment and the column's
  // own check constraint would refuse it — better to say so in words than to hand the
  // founder a database error.
  if (amount === null || amount <= 0) return { error: words.badAmount }
  if (amount > MAX_CENTER_PAYMENT_BDT) {
    return { error: t.tooMuch(formatTaka(MAX_CENTER_PAYMENT_BDT)) }
  }

  const method = String(formData.get('method') ?? 'bkash') as PaymentMethod
  if (!METHODS.has(method)) return { error: words.badMethod }

  // Re-derived here rather than trusted: the `<select>` in the browser is a
  // suggestion, and this endpoint is reachable without it.
  const from = String(formData.get('coversFrom') ?? '')
  if (!isPeriodChoice(from)) return { error: words.badPeriod }

  const months = Number(formData.get('months') ?? 0)
  if (!isMonthsCovered(months)) return { error: words.badMonths }

  const reference = clamp(String(formData.get('reference') ?? ''), MAX_LABEL)
  const note = clamp(String(formData.get('note') ?? ''), MAX_TEXT)

  // Null if the browser could not mint one, which records the receipt with no retry
  // protection rather than refusing it.
  const key = readIdempotencyKey(formData.get('idempotencyKey'))

  // Named, because migration 46's log has no JWT to read here and §10 wants "every
  // taka the centre pays us" attributed to whoever wrote it down.
  const admin = createAdminClient(session.userId)

  // The centre is read before the insert for the error message, not for safety: the
  // FK would refuse an id that is not a centre either way, but "centre not found" is
  // a sentence and a foreign key violation is a stack trace. Its status is read in
  // the same round trip, because a receipt for a centre that is still marked trial is
  // the one thing worth saying out loud afterwards.
  // scoped-by: this is the founder panel, which is every centre by definition; the
  // gate is requirePlatformAdmin above and the id came from the list it rendered.
  const { data: center } = await admin
    .from('coaching_centers')
    .select('id, name, status')
    .eq('id', centerId)
    .maybeSingle()

  if (!center) return { error: words.noCenter }

  const coversTo = coverageEnd(from, months)

  // scoped-by: coaching_center_id is written on the row below; the admin client has
  // no session to scope to and requirePlatformAdmin above is what authorises it.
  const { error } = await admin.from('payments').insert({
    coaching_center_id: centerId,
    amount_bdt: amount,
    method,
    // Empty means no reference, not an empty reference — a bKash TrxID column full of
    // '' is indistinguishable from one that was never filled in.
    reference: reference || null,
    covers_period_start: from,
    covers_period_end: coversTo,
    note: note || null,
    recorded_by: session.userId,
    idempotency_key: key,
  })

  if (error) {
    // The one error that is not a failure: the unique index in 20260811000025 refusing
    // a second row for a receipt already entered. Guarded on `key` too, because
    // without one that index cannot be what fired.
    if (!key || error.code !== UNIQUE_VIOLATION) return { error: words.failed }

    // Read back and check it against what this request asked for. The founder is told
    // the same thing either way — the receipt exists, for this centre, for this money,
    // over this window — and a stored row that disagrees on any of those means the key
    // was reused somewhere it should not have been, which is not a receipt to confirm.
    //
    // scoped-by: this is the founder panel, and the key is unique per centre, so the
    // filter on coaching_center_id below is what makes the lookup mean anything.
    const { data: existing } = await admin
      .from('payments')
      .select('id, amount_bdt, covers_period_start, covers_period_end')
      .eq('coaching_center_id', centerId)
      .eq('idempotency_key', key)
      .maybeSingle()

    if (
      !existing
      || Number(existing.amount_bdt) !== amount
      || existing.covers_period_start !== from
      || existing.covers_period_end !== coversTo
    ) {
      return { error: words.failed }
    }
  }

  revalidatePath('/founder')

  // The last month covered, as a month rather than as `coversTo`'s day: "August 2026
  // to July 2027" is what a founder and a centre owner say to each other, and
  // "2027-07-31" is what the database needs. Derived with addMonths rather than by
  // slicing the end date, so the two can never disagree about which month that is.
  const lastMonth = addMonths(from, months - 1)

  const receipt =
    from === lastMonth
      ? t.paymentSavedMonth(formatTaka(amount), formatMonth(from, session.locale))
      : t.paymentSaved(
          formatTaka(amount),
          formatMonth(from, session.locale),
          formatMonth(lastMonth, session.locale),
        )

  // A payment against a centre that is not active is the pay-first-at-signup case
  // half-done: the money arrived and the account is still switched off. Said as a
  // warning beside the confirmation rather than fixed silently, because activating a
  // customer is a decision and this action is not the place it gets made.
  return center.status === 'active'
    ? { ok: receipt }
    : { ok: receipt, warn: words.notActive }
}

/**
 * Moves a centre onto a plan, a status, or both.
 *
 * The only way either column changes. `bootstrap_center` sets them once at signup and
 * the trigger in 20260811000004 has refused every browser session since, which is
 * why a centre that upgraded over the phone stayed on `teacher_free` — nothing could
 * write the new tier.
 *
 * NO LIMIT ENFORCEMENT, DELIBERATELY. Moving a centre with two hundred students onto
 * a plan that caps at thirty is allowed, and the reason is that the alternative is
 * worse: a founder who has just agreed a downgrade with a customer needs the tier to
 * match what was agreed, and a refusal would leave them billing one thing and the
 * product allowing another. What the plan caps do from that moment is stop the next
 * student being *added*, which is the correct behaviour and is what the warning
 * returned here tells the founder to expect. Nothing is deleted; no roster is
 * truncated to fit a tier.
 */
export async function setCenterPlan(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).founder
  const words = t.money

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: words.noCenter }

  const plan = String(formData.get('plan') ?? '') as PlanId
  if (!PLAN_IDS.has(plan)) return { error: words.badPlan }

  const status = String(formData.get('status') ?? '') as CenterStatus
  if (!STATUSES.has(status)) return { error: words.badStatus }

  const limits = planFor(plan)
  const admin = createAdminClient(session.userId)

  /*
   * THE TRIAL PAIR IS CLEARED WHEN THE NEW TIER IS ONE SOMEBODY PAYS FOR, which is
   * MASTERPLAN.md §4.3's "the founder clears the trial fields when a customer pays"
   * expressed as a property of the row rather than as a step to remember.
   *
   * A trial is a temporary grant of a *better* tier, and `effectiveEntitlement` will
   * not let a stale one demote anybody — so the failure it cannot prevent is the
   * opposite one: a founder agrees Teacher Pro on the phone, sets it here, and the
   * fortnight-old Plus trial keeps granting whatever it granted until a date nobody
   * mentioned. Recording the purchase is exactly the moment the trial has been
   * answered, so it ends here.
   *
   * AND IT SURVIVES A MOVE TO THE FREE TIER, which is the case an unconditional clear
   * would have broken. `bootstrap_center` starts every signup on a 14-day Teacher Plus
   * trial, so almost every centre this form touches early has a live pair; a founder
   * correcting a status typo on a three-day-old centre would otherwise take the trial
   * off it silently, and the owner would lose features mid-fortnight. Leaving it alone
   * costs nothing, because an expired trial is a comparison at read time and stops
   * granting on its own.
   *
   * The row comes back so the warning below can be about this centre rather than about
   * a centre with nothing bought. A `.select()` on an update also turns "no such
   * centre" into an answer: an update matching zero rows is not an error, so without
   * this the founder was told a plan had been saved for an id that does not exist.
   *
   * scoped-by: the founder panel is every centre; requirePlatformAdmin above is the
   * gate, and this update names a single id.
   */
  const { data: updated, error } = await admin
    .from('coaching_centers')
    .update(
      limits.pricing === 'free'
        ? { plan, status }
        : { plan, status, trial_plan: null, trial_ends_at: null },
    )
    .eq('id', centerId)
    .select('student_capacity')
    .maybeSingle()

  if (error || !updated) return { error: words.failed }

  revalidatePath('/founder')

  const applied = t.planSaved(
    planName(limits, session.locale),
    t.status[status],
  )

  // Counted after the write rather than before it, so the warning describes the plan
  // the centre is actually on. Two cheap counts, and only to decide one sentence.
  // scoped-by: one centre by id, on the founder's own panel.
  const [{ count: students }, { count: teachers }] = await Promise.all([
    admin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('status', 'active'),
    admin
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('active', true),
  ])

  /*
   * Whether the centre is now above what the new plan holds — the one sentence that
   * makes this panel safe to use, because moving a centre down a tier does not remove
   * anybody and the founder would otherwise find out from the customer.
   *
   * The student half asks `studentCeiling` rather than `limits.maxStudents`, which is
   * null on the two centre tiers and so never fired: a 300-student centre moved onto
   * `center` — 79 included places — reported "saved" with no warning, and the next
   * student that centre tried to admit was refused by migration 36's trigger with the
   * founder none the wiser.
   *
   * The purchased figure is the centre's own `student_capacity`, read back off the
   * update above, and it has to be: `app.student_ceiling` in the database is
   * `greatest(included_students, student_capacity)` on the two centre tiers, so a 0
   * passed here would predict a refusal the trigger is not going to make and warn a
   * founder about a centre that has bought the places. The TypeScript side ignores it
   * on the teacher tiers for the same reason the SQL does — those are not priced per
   * student — so the two agree on every plan rather than only on the ones tested.
   */
  const over =
    (students ?? 0) > studentCeiling(limits, updated.student_capacity).ceiling ||
    (limits.maxTeachers !== null && (teachers ?? 0) > limits.maxTeachers)

  return over
    ? { ok: applied, warn: t.overLimit(planName(limits, session.locale)) }
    : { ok: applied }
}

/**
 * The founder confirming that money for one priced purchase actually arrived.
 *
 * THE HUMAN HALF OF §11.3. The manual provider "is a real provider whose verification
 * step is a human being", and this is that step: the founder is looking at a transfer in
 * their own bKash app, matching it to a quote on this screen, and typing the TrxID they
 * can see. Nothing about the amount is theirs to decide — `settle_payment_intent` charges
 * what the intent says and grants what the intent says, so the worst a mistake here can
 * do is settle the wrong quote, which is visible in both rows afterwards.
 *
 * WHY IT CAN DRIVE `createPayment` TOO. Only an `initiated` intent settles: the
 * reference-bearing step is what makes `successful` mean "reconciled", so §11.2 leaves
 * `pending -> successful` out of the diagram on purpose. An intent the customer never
 * opened the instructions for is still `pending`, and a founder who has the money in
 * hand should not be told to go and make the customer click something. So the provider's
 * own transition runs first — its function, not a state write in this file — and the
 * settlement follows.
 *
 * Safe to arrive twice. The intent's `already` answer is a success, not an error: a
 * founder tapping Confirm on a slow connection reads back what the first delivery did.
 */
export async function confirmCenterPurchase(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).founder
  const words = t.purchases

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: t.money.noCenter }

  const intentId = String(formData.get('intentId') ?? '')
  if (!intentId) return { error: words.noIntent }

  // The one fact only the person holding the phone has, and the one thing the payload
  // legitimately contributes (§11.4). Refused here as a sentence rather than at the
  // bottom of the RPC as a 42501.
  const providerRef = clamp(String(formData.get('providerRef') ?? ''), MAX_LABEL)
  if (!providerRef) return { error: words.noReference }

  const method = String(formData.get('method') ?? 'bkash') as PaymentMethod
  if (!METHODS.has(method)) return { error: t.money.badMethod }

  const note = clamp(String(formData.get('note') ?? ''), MAX_TEXT)

  const admin = createAdminClient(session.userId)

  const intent = await readIntent(admin, centerId, intentId)
  if (!intent) return { error: words.noIntent }

  // Read off the row, not off the form: the check constraint ties `grants_capacity` to
  // the purpose, so this is the same number the database is about to grant.
  const grantsPlaces = intent.purpose === 'student_capacity'

  // Checked here for the sentence, and again by the provider and the RPC for the answer.
  // A quote that lapsed is re-quoted at today's price rather than honoured.
  if (intent.state !== 'successful') {
    if (intent.state !== 'pending' && intent.state !== 'initiated') {
      return { error: words.closed }
    }
    if (hasPassed(intent.expires_at)) {
      return { error: words.expiredQuote }
    }
  }

  try {
    const provider = paymentProvider(intent.provider)

    if (intent.state === 'pending') {
      const opened = await provider.createPayment(admin, intent)
      if (opened.kind === 'blocked') return { error: words.closed }
    }

    const settled = await provider.handleCallback(admin, {
      intentId: intent.id,
      providerRef,
      method,
      confirmedBy: session.userId,
      note,
    })

    if (!settled.ok) {
      return { error: settled.reason === 'refused' ? words.refused : words.noIntent }
    }

    revalidatePath('/founder')

    if (settled.already) return { ok: words.already }

    const confirmed = t.purchaseConfirmed(formatTaka(settled.chargedBdt))

    // The ceiling is the half of this the founder can be asked about tomorrow, so it is
    // said out loud — and only for the purchase that moves it.
    return {
      ok: grantsPlaces
        ? `${confirmed} ${t.purchaseHolds(settled.capacityAfter)}`
        : confirmed,
    }
  } catch {
    // `paymentProvider` throws for a provider with no module behind it (§11.1). A
    // deployment mistake rather than something the founder can act on.
    return { error: words.failed }
  }
}

/**
 * Closing a quote nobody is going to pay.
 *
 * Not a delete. `cancelled` is a state §11.2 draws from both open states, the row keeps
 * saying what was quoted and to whom, and the trigger refuses the transition from
 * anything settled — so the wrong tap on a paid purchase changes nothing.
 *
 * The reason it exists is the expiry rule: nothing sweeps for a lapsed quote, so without
 * this the founder's list would fill with dead rows they could only clear from the SQL
 * editor.
 */
export async function cancelCenterPurchase(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).founder
  const words = t.purchases

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: t.money.noCenter }

  const intentId = String(formData.get('intentId') ?? '')
  if (!intentId) return { error: words.noIntent }

  const admin = createAdminClient(session.userId)

  // The state filter is what turns "already settled" into a sentence: the trigger would
  // refuse the transition anyway, and a founder should read words rather than a 42501.
  // scoped-by: coaching_center_id is filtered below, beside the id.
  const { data, error } = await admin
    .from('payment_intents')
    .update({ state: 'cancelled' })
    .eq('id', intentId)
    .eq('coaching_center_id', centerId)
    .in('state', ['pending', 'initiated'])
    .select('id')
    .maybeSingle()

  if (error) return { error: words.failed }
  if (!data) return { error: words.closed }

  revalidatePath('/founder')

  return { ok: words.cancelled }
}

/**
 * Ticks off a customer who asked to change plan.
 *
 * Not the same event as changing their tier, and that is why it is its own button.
 * Half the requests this panel will show do not end in an upgrade — a centre asks,
 * the founder rings them, and the answer is "next term" or "actually we are
 * shrinking". `setCenterPlan` records what was decided; this records that the
 * conversation happened, so the queue empties for the right reason. Wiring the tick
 * into the plan change instead would leave every "we talked and left it as it was"
 * sitting in the list for ever, and a list that never empties stops being read.
 *
 * THE ROW IS KEPT, NOT DELETED. `handled_at` is stamped and the request stays, which
 * is what stops the owner's own screen flipping back to an empty form the moment the
 * founder acts — /settings/plan reads `handled_at is null`, so the pending card
 * disappears while the fact that they asked does not. An owner who wants to ask again
 * gets a fresh row, dated the day they asked again; see the note on requestUpgrade.
 *
 * Safe to arrive twice: `handled_at is null` in the filter means the second delivery
 * matches nothing and the timestamp on the first one stands. That matters more than it
 * looks — without it a replay would move the handled time forward every time, which is
 * the only record of how quickly a customer got answered.
 */
export async function markUpgradeHandled(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).founder

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: t.money.noCenter }

  // The session's own client, not the admin one. See the note at the top of the file:
  // `upgrade_requests_platform_update` exists precisely so this write is checked by
  // the database rather than waved through by a service key.
  const supabase = await createClient()

  // scoped-by: coaching_center_id is filtered below; the id came from the founder's
  // own list, and app.is_platform_admin() in the policy is what authorises the write.
  const { error } = await supabase
    .from('upgrade_requests')
    .update({ handled_at: new Date().toISOString() })
    .eq('coaching_center_id', centerId)
    .is('handled_at', null)

  if (error) return { error: t.asked.failed }

  revalidatePath('/founder')

  return { ok: t.asked.handled }
}

/**
 * Gets a locked-out owner or manager back into their own centre.
 *
 * THE LAST PIECE OF A RECOVERY STORY WITH NO EMAIL IN IT. Login is a number and a
 * password; /account changes a password you still know; the owner's staff screen issues
 * one to a teacher who belongs to nobody else. Between them they cover everybody except
 * the three groups lib/auth/founder-reset.ts names — an owner, a manager, and a teacher
 * who works at two centres — and the copy on the owner's screen has been telling those
 * three to ring the founder since it shipped. This is the button that call reaches.
 *
 * IT IS KEYED ON THE NUMBER, NOT ON A LIST. There is no roster of accounts rendered
 * beside each centre, on purpose: the panel deliberately holds no link inward and one
 * contact detail per customer, and a list of every staff member at every centre would
 * be a directory of people the founder has no reason to read. The founder types the
 * number the person is ringing from, which is also the number they sign in with, and is
 * the thing they can actually see on their own phone screen. A mistyped digit lands on
 * `notStaff` rather than on a stranger.
 *
 * WHAT COMES BACK IS A NAME, and that is the check that matters. The founder reads
 * "new password set for Jamshed Rahman" back to whoever is on the line; if that is not
 * who they are talking to, they have just reset the wrong person and they find out in
 * the same second rather than a week later.
 *
 * Safe to arrive twice. Setting a password to the same value again is the same state,
 * so a replayed request — see the note on useOffline in next.config.ts — changes
 * nothing. There is no idempotency key because there is nothing to double.
 *
 * WHAT IT DOES NOT DO IS END THE OTHER SESSIONS. GoTrue leaves live sessions alone on a
 * password change, here as everywhere else in this product, so this is a way back in and
 * not a way to throw somebody out. The copy on the form says so, because an owner
 * ringing about a phone they no longer have is asking for the second thing.
 */
export async function resetCenterStaffPassword(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const d = dict(session.locale)
  const t = d.founder
  const words = t.lockout

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: t.money.noCenter }

  // Normalised before it is looked up, because `profiles.phone` holds exactly one
  // shape — E.164 — and an owner reading their number off a signboard says 01712…
  const phone = normalizeBdMobile(String(formData.get('phone') ?? ''))
  if (!phone) return { error: words.errors.noAccount }

  const password = String(formData.get('password') ?? '')
  if (password.length < MIN_PASSWORD) {
    return { error: passwordTooShort(session.locale) }
  }

  const admin = createAdminClient(session.userId)

  // scoped-by: profiles is not centre-scoped — phone is unique platform-wide, which
  // is what makes one number one account. requirePlatformAdmin above is the gate.
  const { data: profile, error: profileFailed } = await admin
    .from('profiles')
    .select('id, full_name, is_platform_admin')
    .eq('phone', phone)
    .maybeSingle()

  // A failed read is not "no such number". Falling through would tell the founder to
  // check the digits when the truth is that the database did not answer.
  if (profileFailed) return { error: words.failed }

  let rolesAtCenter: MemberRole[] = []

  if (profile) {
    // Filtered to this centre, unlike the owner's reset which reads every membership
    // an account holds anywhere. The two rules ask different questions and this is
    // where they part: "does this person work here", not "do they work only here".
    // scoped-by: coaching_center_id is filtered below, to the centre whose card the
    // form was submitted from.
    const { data: rows, error: rowsFailed } = await admin
      .from('center_members')
      .select('role')
      .eq('user_id', profile.id)
      .eq('coaching_center_id', centerId)

    if (rowsFailed) return { error: words.failed }
    rolesAtCenter = (rows ?? []).map((row) => row.role)
  }

  const refusal = founderResetRefusal({
    userId: profile?.id ?? null,
    readerId: session.userId,
    rolesAtCenter,
    isPlatformAdmin: profile?.is_platform_admin ?? false,
  })

  // `|| !profile` only narrows the type — a missing profile already comes back as
  // noAccount from the rule, which is where that decision is written and tested.
  if (refusal || !profile) return { error: words.errors[refusal ?? 'noAccount'] }

  const { error } = await admin.auth.admin.updateUserById(profile.id, { password })
  if (error) return { error: words.failed }

  // Nothing on the panel changes, so nothing is revalidated. The name is what the
  // founder needs next, read back down the phone to the person waiting on it.
  return { ok: t.resetDone(profile.full_name || formatBdMobile(phone)) }
}
