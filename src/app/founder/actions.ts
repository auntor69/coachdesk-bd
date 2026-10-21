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
import { parseDays } from '@/lib/billing/levers'
import { leverLabels, leverSentences } from '@/lib/i18n/levers'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { approveClaim, rejectClaim } from '@/lib/billing/claims'
import { readIntent } from '@/lib/billing/intents'
import { paymentProvider } from '@/lib/billing/provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { digits, formatDate, hasPassed } from '@/lib/bd/time'
import { formatBdMobile } from '@/lib/bd/phone'
import { identifierOfTyped } from '@/lib/auth/identifier'
import { PAYMENT_METHODS } from '@/lib/fees/methods'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { REJECT_REASONS, rechargeWords, type RejectReason } from '@/lib/i18n/recharge'
import { passwordTooShort } from '@/lib/i18n/messages'
import { readIdempotencyKey, UNIQUE_VIOLATION } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { formatTaka, parseTaka, sumTaka } from '@/lib/money'
import { PLANS, planFor, planName, type PlanId } from '@/lib/plans'
import { MAX_CENTER_PAYMENT_BDT, isMonthsCovered } from '@/lib/platform/billing'
import type { CenterStatus, Json, MemberRole, PaymentMethod } from '@/lib/supabase/types'

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

/**
 * The Postgres code for a CHECK constraint or a trigger raising with it.
 *
 * Local rather than beside UNIQUE_VIOLATION in lib/idempotency.ts, which is about one
 * tap being one payment and has nothing to say about arithmetic. One credit path reads
 * it, and it reads it to name the floor in 20260811000074.
 */
const CHECK_VIOLATION = '23514'

const PLAN_IDS = new Set<PlanId>(Object.keys(PLANS) as PlanId[])

/**
 * The reasons a rejection may carry, as the panel's own list.
 *
 * Derived from the one array rather than typed out again: `REJECT_REASONS` is what the
 * `<select>` offers, `recharge_claims.reject_reason` checks the same four, and
 * `reject_recharge_claim` refuses anything else — so a fifth reason has to be added in
 * three places and this is the one that says so out loud.
 */
const REASONS = new Set<RejectReason>(REJECT_REASONS)

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

  /*
   * The amount is OPTIONAL IN THE FORM AND READ FROM THE ROW BY THE DATABASE.
   *
   * `founder_record_payment` (20260811000092) has two branches and they need different
   * figures: a centre's receipt is what the founder typed, and a teacher's is
   * `price_versions.teacher_plus_monthly_poisha × months`, priced by the function so a
   * slipped keystroke cannot sell a year of Pro for ৳49 (§11.4: a request may carry a
   * quantity and never an amount). So a blank amount is legal here, and which field
   * matters is decided where the customer's kind is known — in SQL, from the row.
   * A centre that posted no figure is refused there, with a sentence, and mapped below.
   */
  const typedAmount = String(formData.get('amount') ?? '').trim()
  const amount: number | null = typedAmount === '' ? null : parseTaka(typedAmount)
  // Zero and negative both land here. A ৳0 receipt is not a payment and the column's own
  // check constraint would refuse it — better to say so in words than to hand the founder
  // a database error.
  if (amount !== null && amount <= 0) return { error: words.badAmount }
  if (amount !== null && amount > MAX_CENTER_PAYMENT_BDT) {
    return { error: t.tooMuch(formatTaka(MAX_CENTER_PAYMENT_BDT)) }
  }

  const method = String(formData.get('method') ?? 'bkash') as PaymentMethod
  if (!METHODS.has(method)) return { error: words.badMethod }

  /*
   * Zero months is a centre's answer and one, three, six or twelve is a teacher's, so the
   * list is checked only when something was chosen. Still re-derived here rather than
   * trusted: the `<select>` in the browser is a suggestion and this endpoint is reachable
   * without it, and the database refuses a months value that is not a whole positive count.
   */
  const postedMonths = Number(formData.get('months') ?? 0)
  const months = Number.isFinite(postedMonths) && postedMonths > 0 ? Math.floor(postedMonths) : 0
  if (months > 0 && !isMonthsCovered(months)) return { error: words.badMonths }

  const reference = clamp(String(formData.get('reference') ?? ''), MAX_LABEL)
  const note = clamp(String(formData.get('note') ?? ''), MAX_TEXT)
  /*
   * A REASON IS REQUIRED, and it is the note field. The receipt cannot be edited or
   * deleted, so the note is the only part of it that can say what was agreed on the phone
   * — and the same rule is a `raise` inside `founder_record_payment` rather than a
   * convention here, because this action is a public endpoint like every other.
   */
  if (!note) return { error: words.badReason }

  // Null if the browser could not mint one, which records the receipt with no retry
  // protection rather than refusing it.
  const key = readIdempotencyKey(formData.get('idempotencyKey'))

  /*
   * THE SESSION'S OWN CLIENT, not the admin key, and the difference is the same one
   * `approveRechargeClaim` records: `founder_record_payment` asks `app.is_platform_admin()`
   * inside itself and writes `auth.uid()` onto the receipt, so the gate above is the second
   * check rather than the only one. The ledger holds no INSERT grant for a browser at all,
   * so a hand-posted form cannot reach it whatever it says.
   */
  const supabase = await createClient()

  // The centre is read before the write for the error message and for the warning below,
  // not for safety: the function refuses an id that is not a centre either way, but
  // "centre not found" is a sentence and `23503` is a stack trace. Its status is read in
  // the same round trip, because a receipt for a centre that is still marked trial is the
  // one thing worth saying out loud afterwards.
  // scoped-by: this is the founder panel, which is every centre by definition; the gate is
  // requirePlatformAdmin above and the id came from the list it rendered.
  const { data: center } = await supabase
    .from('coaching_centers')
    .select('id, status')
    .eq('id', centerId)
    .maybeSingle()

  if (!center) return { error: words.noCenter }

  // scoped-by: coaching_center_id is an argument to the function, which reads the row and
  // refuses a centre that does not exist; the founder gate is asked inside it.
  const outcome = await writePayment(supabase, {
    centerId,
    amountPoisha: amount === null ? null : Math.round(amount * 100),
    months,
    reason: note,
    method,
    reference: reference || null,
    key,
  })

  if (!outcome.ok) return { error: words[outcome.reason] }

  revalidatePath('/founder')

  /*
   * The confirmation is built from WHAT WAS CREDITED, not from what was typed — the same
   * rule `approveRechargeClaim` follows for a bonus the customer was quoted. For a centre
   * the two are the same figure; for a teacher the amount came off the price card, which is
   * the whole point of it not being typed, and a founder reading "৳499 for one month" off
   * the database cannot be looking at a number the form invented.
   */
  const receipt =
    months > 0
      ? t.paidMonths(formatTaka(outcome.amountPoisha / 100), digits(months, session.locale))
      : t.paidBalance(formatTaka(outcome.amountPoisha / 100))

  // A payment against a centre that is not active is the pay-first-at-signup case
  // half-done: the money arrived and the account is still switched off. Said as a
  // warning beside the confirmation rather than fixed silently, because activating a
  // customer is a decision and this action is not the place it gets made.
  return center.status === 'active'
    ? { ok: receipt }
    : { ok: receipt, warn: words.notActive }
}

/** The one SQLSTATE this file reads for a sentence. See `writePayment`. */
const INVALID_PARAMETER = '22023'

type PaymentOutcome =
  | { ok: true; amountPoisha: number; balanceAfter: number; already: boolean }
  | { ok: false; reason: 'badAmount' | 'badMonths' | 'badReason' | 'failed' }

/**
 * `public.founder_record_payment` AS POSTGREST SEES IT, cast the way `settleDay` and the two
 * levers cast theirs.
 *
 * The function is new in 20260811000092 and `src/lib/supabase/types.ts` is regenerated
 * against a live project, so it is not in `Database['public']['Functions']` yet. The cast
 * keeps the argument names honest — they are the function's own — and is a no-op once the
 * types catch up.
 */
type PaymentRpc = (
  fn: 'founder_record_payment',
  args: {
    p_center: string
    p_amount_poisha: number | null
    p_months: number
    p_reason: string
    p_method: PaymentMethod
    p_reference: string | null
    p_idempotency_key: string | null
  },
) => PromiseLike<{ data: Json | null; error: { code?: string; message: string } | null }>

/**
 * One receipt, written through the function that credits the balance.
 *
 * WHY A FUNCTION AND NOT AN INSERT, which is what this replaced: the founder's form used to
 * write a `payments` row with a coverage window on it, and nothing in the product reads a
 * coverage window any more (§16.1 step 24 made access `balance < owed`). The customer's
 * money was recorded, granted no days, and left them read-only until somebody used a
 * different control — a bug that looked like it had worked.
 *
 * So the money is written where it counts and the branch is chosen by the row rather than by
 * the form: a centre's typed amount becomes a recharge on the balance, and a teacher's
 * months are priced from `price_versions` by the function itself.
 */
async function writePayment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    centerId: string
    amountPoisha: number | null
    months: number
    reason: string
    method: PaymentMethod
    reference: string | null
    key: string | null
  },
): Promise<PaymentOutcome> {
  // BOUND, NOT DETACHED — see settleDay in lib/billing/settlement.ts. `rpc` is a prototype
  // method that reads `this.rest`, so calling it as a free function threw on every
  // signed-in page once already.
  //
  // `as never` on both arguments because the generated `Functions` union is what `rpc` is
  // typed against, and this function is newer than the types — the same no-op cast
  // `writeTrialDays` makes, and the second half of the note on `PaymentRpc`.
  const record = ((fn: string, args: Record<string, unknown>) =>
    supabase.rpc(fn as never, args as never)) as unknown as PaymentRpc

  const { data, error } = await record('founder_record_payment', {
    p_center: input.centerId,
    p_amount_poisha: input.amountPoisha,
    p_months: input.months,
    p_reason: input.reason,
    p_method: input.method,
    p_reference: input.reference,
    p_idempotency_key: input.key,
  })

  if (error) {
    /*
     * `22023` IS THE FUNCTION REFUSING AN ARGUMENT, and the only one reachable from this
     * screen is a centre that posted no amount — the months are checked against the closed
     * list above, the reason is checked above, and a teacher's amount is not the caller's to
     * give at all. The message is read to choose the sentence, which is a little more
     * knowing than this codebase usually is about an error string; the alternative is three
     * round trips to find out which refusal it was.
     */
    if (error.code === INVALID_PARAMETER) {
      if (/month/i.test(error.message)) return { ok: false, reason: 'badMonths' }
      if (/reason/i.test(error.message)) return { ok: false, reason: 'badReason' }
      return { ok: false, reason: 'badAmount' }
    }

    // A unique violation cannot land here: the function catches the replay itself and hands
    // back the receipt it already wrote.
    return { ok: false, reason: 'failed' }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'failed' }
  }

  const out = data as Record<string, unknown>
  return {
    ok: true,
    amountPoisha: numberOrNull(out.amountPoisha) ?? 0,
    balanceAfter: numberOrNull(out.balanceAfter) ?? 0,
    already: out.already === true,
  }
}

/**
 * Records a credit: money we owe a centre back.
 *
 * WHY THIS EXISTS. §15 had a move down a tier and a move taken mid-way through paid
 * coverage as phone calls, and the reason was arithmetic rather than product design —
 * both owe the customer the difference, and `payments.amount_bdt` was positive by check
 * until 20260811000074. A negative row on the same table is the whole mechanism: the
 * netted sum per centre is what we have actually been paid, so a credit handed back over
 * bKash and a credit taken off the next purchase are the same row now and a full-price
 * receipt later.
 *
 * ITS OWN ACTION, for the reason there are two forms rather than one: a sign is the
 * easiest thing in the world to get wrong on a shared form, and the founder should not be
 * one mis-tapped radio button away from recording ৳1,999 arriving as ৳1,999 going out.
 * The form posts a positive figure and the sign is put on here, so a browser cannot
 * choose the direction of the money at all.
 *
 * WHAT IT REFUSES TO SEND. No coverage window and no intent, both of which
 * 20260811000074 also refuses at the table — see that migration on why a credit that
 * could name a period would be free access forever, and why one pointing at a purchase
 * would print as a sheet selling places back.
 *
 * THE REASON IS REQUIRED, here and at the table. This row cannot be edited or deleted, so
 * an unexplained credit is a figure nobody can ever account for; the note is the only
 * part of it that says what was agreed.
 */
export async function creditCenterPayment(
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

  // Positive on the way in and negated below. A form that could post a minus sign is a
  // form that could record a payment as a credit by accident.
  const amount = parseTaka(String(formData.get('amount') ?? ''))
  if (amount === null || amount <= 0) return { error: words.badAmount }
  if (amount > MAX_CENTER_PAYMENT_BDT) {
    return { error: t.tooMuch(formatTaka(MAX_CENTER_PAYMENT_BDT)) }
  }

  // Which rail it went back on, or `cash` where it was handed over. The same closed list
  // the receipt form uses.
  const method = String(formData.get('method') ?? 'bkash') as PaymentMethod
  if (!METHODS.has(method)) return { error: words.badMethod }

  const reason = clamp(String(formData.get('reason') ?? '').trim(), MAX_TEXT)
  if (!reason) return { error: words.badReason }

  const reference = clamp(String(formData.get('reference') ?? '').trim(), MAX_LABEL)
  const key = readIdempotencyKey(formData.get('idempotencyKey'))

  const admin = createAdminClient(session.userId)

  // scoped-by: the founder panel is every centre by definition; requirePlatformAdmin
  // above is the gate and the id came from the list it rendered.
  const { data: center } = await admin
    .from('coaching_centers')
    .select('id, name')
    .eq('id', centerId)
    .maybeSingle()

  if (!center) return { error: words.noCenter }

  /*
   * What they have paid, read before the write so the refusal can name the figure.
   *
   * The floor is 20260811000074's trigger and this is not it: the trigger holds under
   * two credits landing together and this read cannot. It is here because "৳4,000 is more
   * than the ৳1,999 this centre has paid us" is a sentence a founder can act on and
   * `23514` is not. The trigger is still what makes the rule true.
   *
   * scoped-by: filtered to the one centre below; the admin client has no session to
   * scope to.
   */
  const { data: paidRows } = await admin
    .from('payments')
    .select('amount_bdt')
    .eq('coaching_center_id', centerId)

  const paid = sumTaka((paidRows ?? []).map((r) => Number(r.amount_bdt)))
  if (paidRows && amount > paid) return { error: t.creditTooMuch(formatTaka(paid)) }

  // scoped-by: coaching_center_id is written on the row below.
  const { error } = await admin.from('payments').insert({
    coaching_center_id: centerId,
    // The sign, applied once, on the server.
    amount_bdt: -amount,
    method,
    reference: reference || null,
    // Not sent rather than sent as null: 20260811000074 refuses both, and leaving them
    // out is the version that cannot be turned into a value by an edit further up.
    note: reason,
    recorded_by: session.userId,
    idempotency_key: key,
  })

  if (error) {
    // The unique index in 20260811000025 refusing a replay of a submit already recorded,
    // which is a success. Guarded on `key`, because without one that index cannot fire.
    if (key && error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await admin
        .from('payments')
        .select('amount_bdt')
        .eq('coaching_center_id', centerId)
        .eq('idempotency_key', key)
        .maybeSingle()

      if (!existing || Number(existing.amount_bdt) !== -amount) return { error: words.failed }
    } else if (error.code === CHECK_VIOLATION) {
      // The floor, having lost the race the read above wins on its own. Every other
      // check on this row is satisfied by construction here — no window, no intent, a
      // reason that is not blank — so 23514 can only be the netted total.
      return { error: t.creditTooMuch(formatTaka(paid)) }
    } else {
      return { error: words.failed }
    }
  }

  revalidatePath('/founder')
  return { ok: t.creditSaved(formatTaka(amount)) }
}

/**
 * The founder crediting a recharge a customer says they sent — §11.9 step 7.
 *
 * THE OTHER HALF OF THE ONE SCREEN THING IN THE PRODUCT A READ-ONLY CENTRE MAY DO. The
 * customer files the claim (`submitRechargeClaim`, which is deliberately the one write not
 * behind `requireWritable`); this is the human looking at their own bKash account and
 * saying what arrived. Nothing is credited between those two steps — `fileRechargeClaim`
 * writes an assertion and no money — which is what makes a wrong amount a conversation
 * rather than a correction of history.
 *
 * THE SESSION'S OWN CLIENT, unlike every other write in this file, and the difference is
 * worth reading before changing it: `approve_recharge_claim` is a security-definer RPC
 * that checks `app.is_platform_admin()` itself and records `auth.uid()` on the payment and
 * on the claim, so the gate below is the *second* check rather than the only one — the
 * exact inversion of `recordCenterPayment`, where the admin key is the whole door.
 *
 * THE BOX IS BLANK BY DEFAULT and blank means "what they said they sent": §11.9 lets the
 * founder override the amount, because customers send the wrong figure constantly, and a
 * prefilled box is a figure nobody checked. The cap is the same one a founder-recorded
 * receipt carries, so a stray keystroke cannot credit more than a payment can record.
 *
 * THE BONUS IS NOT HERE. It is re-derived inside the function from the amount that
 * actually arrived and the promotion live at that moment, so the figure quoted to the
 * customer decides nothing (§11.11) — the sentence returned below is built from what the
 * database credited, not from what the screen promised.
 */
export async function approveRechargeClaim(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = rechargeWords(session.locale)

  const claimId = String(formData.get('claimId') ?? '')
  if (!claimId) return { error: t.queueFailed }

  // Read as blank *before* parsing, or an untouched box would be reported as a number
  // nobody could read.
  const typed = String(formData.get('arrived') ?? '').trim()
  let arrivedPoisha: number | null = null

  if (typed !== '') {
    const arrived = parseTaka(typed)
    // Zero is refused and not coerced: a credit of nothing is not a smaller credit, and
    // the function raises 22023 for it — in a code rather than in a sentence.
    if (arrived === null || arrived <= 0) return { error: t.badAmount }
    if (arrived > MAX_CENTER_PAYMENT_BDT) {
      return { error: t.tooLarge(formatTaka(MAX_CENTER_PAYMENT_BDT)) }
    }
    arrivedPoisha = Math.round(arrived * 100)
  }

  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)

  const supabase = await createClient()
  const outcome = await approveClaim(supabase, {
    claimId,
    arrivedPoisha,
    note: note || null,
  })

  if (!outcome.ok) {
    // The anti-replay fence gets the customer's own sentence for it, because that is the
    // sentence the founder has to repeat down the phone. The other two are one answer: a
    // claim somebody else already decided clears itself off the queue on the re-render.
    return { error: outcome.reason === 'duplicate' ? t.reason.duplicate : t.queueFailed }
  }

  revalidatePath('/founder')

  // `creditedLine` is the customer's own line for an approved claim, read here as the
  // founder's receipt: it is the same fact, and it is the only place the credited bonus
  // appears — the row leaves the queue on the re-render, so this is what the founder reads
  // instead of it. The blank where there is no bonus is `creditedLine`'s own convention.
  return {
    ok: t.creditedLine(
      formatTaka(outcome.arrivedPoisha / 100),
      outcome.bonusPoisha > 0 ? formatTaka(outcome.bonusPoisha / 100) : '',
    ),
  }
}

/**
 * Closing a claim that will not be credited — §11.9's rejection, and it needs a reason.
 *
 * A SHORT LIST RATHER THAN FREE TEXT, because a rejection without one becomes a phone call
 * and a reason nobody can group is barely better. The list is re-checked here for the same
 * reason every set in this file is: the `<select>` is a suggestion, this endpoint is
 * reachable without it, and the sentence the customer will read comes off the row.
 *
 * `other` IS THE ONE THE NOTE IS FOR — "we called them and agreed to treat it as a
 * discount" is a fact no enum can carry — so the note travels with the reason rather than
 * being an approval-only field. Nothing is credited either way, and nothing is deleted: the
 * row keeps its reason, its reviewer and its note, which is what lets the customer's own
 * card say what happened.
 */
export async function rejectRechargeClaim(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = rechargeWords(session.locale)

  const claimId = String(formData.get('claimId') ?? '')
  if (!claimId) return { error: t.queueFailed }

  const reason = String(formData.get('reason') ?? '') as RejectReason
  if (!REASONS.has(reason)) return { error: t.queueFailed }

  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)

  const supabase = await createClient()
  const closed = await rejectClaim(supabase, { claimId, reason, note: note || null })
  if (!closed) return { error: t.queueFailed }

  revalidatePath('/founder')

  // Word for word what the customer's own card will say, so the founder and the customer
  // are reading the same thing rather than two versions of it.
  return { ok: t.stateRejected }
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
    // `id` back, not the row: what this needs is "did the update match a centre", and
    // the one column it used to read — `student_capacity` — went with capacity (§16.1
    // step 28). The counter below no longer asks about students at all.
    .select('id')
    .maybeSingle()

  if (error || !updated) return { error: words.failed }

  revalidatePath('/founder')

  const applied = t.planSaved(
    planName(limits, session.locale),
    t.status[status],
  )

  // Counted after the write rather than before it, so the warning describes the plan
  // the centre is actually on. One cheap count, and only to decide one sentence.
  // scoped-by: one centre by id, on the founder's own panel.
  const { count: teachers } = await admin
    .from('teachers')
    .select('id', { count: 'exact', head: true })
    .eq('coaching_center_id', centerId)
    .eq('active', true)

  /*
   * Whether the centre is now above what the new plan holds — the one sentence that
   * makes this panel safe to use, because moving a centre down a tier does not remove
   * anybody and the founder would otherwise find out from the customer.
   *
   * ONLY THE TEACHER HALF IS LEFT (§16.1 step 28), and the student half is not a loss.
   * It asked `studentCeiling` — the plan's allowance, or the number of places the centre
   * had bought — and the second of those does not exist any more while the first is null
   * on both per-student tiers. There is no number a tier change can put a roster above:
   * the balance charges for the students there are, and a downgrade removes none of them.
   * `maxTeachers` still does, and it is the one a move between the two centre tiers
   * actually changes.
   */
  const over = limits.maxTeachers !== null && (teachers ?? 0) > limits.maxTeachers

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

    // The one half of this the founder can be asked about tomorrow — the tier — said out
    // loud, and only for the purchase that moves it. The ceiling it used to name went
    // with capacity (§16.1 step 28): nothing this settlement writes raises a student
    // limit any more, so there is no second sentence to add. The tier is read off the
    // intent rather than off the centre because that is the value the settlement used; a
    // plan read back afterwards would also be right, and would cost a round trip to say
    // the same thing.
    return {
      ok: [
        confirmed,
        intent.target_plan
          ? t.purchaseMovedTo(planName(planFor(intent.target_plan), session.locale))
          : null,
      ]
        .filter(Boolean)
        .join(' '),
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
 * founder acts — /settings/billing reads `handled_at is null`, so the pending card
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
 * THE LAST PIECE OF A RECOVERY STORY. /account changes a password you still know; the
 * owner's staff screen issues one to a teacher who belongs to nobody else. Between them
 * they cover everybody except the three groups lib/auth/founder-reset.ts names — an owner,
 * a manager, and a teacher who works at two centres — and the copy on the owner's screen
 * has been telling those three to ring the founder since it shipped. This is the button
 * that call reaches, and for an owner who signed up through the app it is the only way
 * back in that exists: there is no reset link to send, and nobody above them to ask.
 *
 * IT IS KEYED ON THE IDENTIFIER, NOT ON A LIST. There is no roster of accounts rendered
 * beside each centre, on purpose: the panel deliberately holds no link inward and one
 * contact detail per customer, and a list of every staff member at every centre would be a
 * directory of people the founder has no reason to read. The founder types what the person
 * can read off their own screen — the number they sign in with, §5.2's username for a
 * teacher who was given one, or §5.4's address for anybody who signed up themselves —
 * because each of the three is the only identifier some population has. A typo lands on
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

  /*
   * Whatever the person on the line read out: a number, §5.2's username, or — since §5.4 —
   * the address they signed up with. `identifierOfTyped` is §5.3's dispatch applied to typed
   * text rather than to a cookie, so the founder can accept exactly what the login screen
   * accepts and refuses what it would refuse, without a query. This field asked for a number
   * and nothing else, which left the two populations that have no number — everybody who
   * signed up through the app, and every teacher whose login is a username — with no way
   * back into their own account.
   *
   * The lookup below can then be one column rather than three, and that is not a shortcut:
   * the three sets cannot overlap (an address carries an `@`, a Bangladesh mobile starts
   * with a digit, a username has neither), so whichever branch answered is the only branch
   * that could have.
   */
  const identifier = identifierOfTyped(String(formData.get('identifier') ?? ''))
  if (!identifier) return { error: words.errors.noAccount }

  const password = String(formData.get('password') ?? '')
  if (password.length < MIN_PASSWORD) {
    return { error: passwordTooShort(session.locale) }
  }

  const admin = createAdminClient(session.userId)

  // scoped-by: profiles is not centre-scoped — each of the three identifier columns is
  // unique platform-wide, which is what makes one identifier one account. `founder()`
  // above is the gate, and `.eq` takes the column the dispatch chose, never a filter
  // string built out of a form post.
  const { data: profile, error: profileFailed } = await admin
    .from('profiles')
    .select('id, full_name, is_platform_admin')
    .eq(identifier.kind, identifier.value)
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

  // Nothing on the panel changes, so nothing is revalidated. The name is what the founder
  // needs next, read back down the phone to the person waiting on it — and when the account
  // has no name typed on it, the identifier they just read out, in the shape its owner
  // reads it: a number as 01712345678 rather than +8801712345678, an address as it is.
  return {
    ok: t.resetDone(
      profile.full_name ||
        (identifier.kind === 'phone' ? formatBdMobile(identifier.value) : identifier.value),
    ),
  }
}

/**
 * Moves money on or off a centre's prepaid balance — §11.7's first lever, step 26.
 *
 * THE ANSWER TO EVERY CASE §11.8 COULD NOT FENCE. A centre shut for three weeks around
 * Eid was charged for three weeks and will say so; a 200-row paste was a mistake and is
 * now a daily rate; a founder was asleep when a customer ran dry. The money model has no
 * self-serve answer to any of them on purpose — a pause button would cut a fully-using
 * customer's price by a third and make revenue unforecastable — so what is built instead
 * is a human with two levers and a written reason.
 *
 * THE SESSION'S OWN CLIENT AND NOT THE ADMIN KEY, which is the same inversion
 * `approveRechargeClaim` makes and for the same reason: `founder_adjust_balance` asks
 * `app.is_platform_admin()` inside itself and writes `auth.uid()` onto the row, so the
 * gate below is the second check rather than the only one. The ledger holds no INSERT
 * grant for `authenticated` at all (§11.7's threat table), so a browser cannot reach this
 * table directly whatever it posts.
 *
 * WHAT THE BROWSER MAY NAME: an amount and a reason. Nothing else. It cannot name the
 * balance, the day, or a rate — the function reads the balance under the ledger's own
 * advisory lock and refuses an amount that would take it below nothing, which is the
 * constraint standing behind the sentence returned here.
 */
export async function adjustCenterBalance(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).founder
  const labels = leverLabels(session.locale)

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: t.money.noCenter }

  // Signed here and not by the form: one control, and a minus sign is the only way to take
  // money off, so it has to be readable. Zero is refused below — an adjustment of nothing
  // adjusts nothing, and the function raises for it too.
  const taka = parseTaka(String(formData.get('amount') ?? ''))
  if (taka === null || taka === 0) return { error: labels.badAdjust }
  if (Math.abs(taka) > MAX_CENTER_PAYMENT_BDT) {
    return { error: t.tooMuch(formatTaka(MAX_CENTER_PAYMENT_BDT)) }
  }

  const reason = clamp(String(formData.get('reason') ?? '').trim(), MAX_TEXT)
  if (!reason) return { error: labels.noReason }

  const outcome = await writeAdjustment(await createClient(), {
    centerId,
    amountPoisha: Math.round(taka * 100),
    reason,
  })

  revalidatePath('/founder')

  if (!outcome.ok) return { error: labels[outcome.reason] }

  return {
    ok: leverSentences(session.locale).adjusted(
      formatTaka(outcome.amountPoisha / 100),
      formatTaka(outcome.balanceAfter / 100),
    ),
  }
}

/**
 * Gives a centre days rather than money — §11.7's second lever, step 26.
 *
 * DAYS AND NOT FAKE MONEY, which is §11.7's whole distinction and the reason this is a
 * second action rather than a sign on the first. A trial, a goodwill extension or a
 * closure allowance given forward cannot be spent on anything else, cannot be confused
 * with taka a customer actually paid, and costs nothing to represent: the entry carries
 * zero and the line moves.
 *
 * THE DATE IS NOT THE BROWSER'S TO NAME. The founder types a number of days and the
 * function works out the reach from the line the row actually holds and the Dhaka day —
 * and starts at today when the line is behind it, so granting three days to a centre that
 * lapsed a fortnight ago leaves it covered rather than still dry. The sentence returned
 * here is built from the date the database answered with, never from what the form
 * predicted.
 *
 * `MAX_GRANT_DAYS` IS CHECKED HERE AND IN SQL, like every cap in this product: a Server
 * Action is a public HTTP endpoint, so the field's `maxLength` is a suggestion and this is
 * the sentence. A stray keystroke past a year is a free decade otherwise. The constant
 * itself never reaches the copy — the hint says "up to a year" — because a sentence naming
 * 366 is a sentence that drifts the day the constant moves.
 */
export async function grantCenterDays(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).founder
  const labels = leverLabels(session.locale)

  const centerId = String(formData.get('centerId') ?? '')
  if (!centerId) return { error: t.money.noCenter }

  const days = parseDays(String(formData.get('days') ?? ''))
  if (days === null) return { error: labels.badDays }

  const reason = clamp(String(formData.get('reason') ?? '').trim(), MAX_TEXT)
  if (!reason) return { error: labels.noReason }

  const outcome = await writeGrant(await createClient(), { centerId, days, reason })

  revalidatePath('/founder')

  if (!outcome.ok) return { error: labels.failed }

  return {
    ok: leverSentences(session.locale).grantedDays(
      digits(outcome.days, session.locale),
      formatDate(outcome.chargedThrough, session.locale),
    ),
  }
}

/**
 * What a new account is given before it pays — §4.3's trial lengths, as a lever.
 *
 * A POLICY AND NOT A PRICE, which is why it is a form here rather than a migration: the
 * funnel changes, and the founder changes with it. The three numbers are read by
 * `public.bootstrap_center` at signup (20260811000092) and quoted on the onboarding screen
 * from the same row, so this one edit moves all three.
 *
 * AND A FOURTH NUMBER CAME WITH 20260811000098: the roster a trial may hold before it has to
 * be funded. It is the same kind of decision — what a new account is given before it pays —
 * which is why it is on this form and not on a price card, and zero switches the bound off
 * entirely for a founder who would rather carry the rows than refuse a customer.
 *
 * THE DATABASE IS ASKED, not trusted: `founder_set_trial_days` checks
 * `app.is_platform_admin()` inside itself and refuses a value outside 0–365, so a
 * hand-posted form with the anon key can neither set its own trial length nor write a
 * decade into the table.
 */
export async function setTrialDays(
  _prev: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const gate = await founder()
  if (!isSession(gate)) return gate

  const session = gate
  const words = dict(session.locale).founder.settings

  /** A whole day count off the wire, or null for anything that is not one. */
  const days = (field: string): number | null => {
    const raw = String(formData.get(field) ?? '').trim()
    if (!raw) return null
    const value = parseTaka(raw)
    if (value === null || !Number.isFinite(value)) return null
    const whole = Math.floor(value)
    return whole < 0 || whole > 365 ? null : whole
  }

  /**
   * A whole student count off the wire, or null for anything that is not one.
   *
   * A second reader rather than the one above with a wider cap, because the two numbers mean
   * different things: days run to a year, and a roster runs to a hundred thousand. Refusing the
   * overlap (0 is both "no trial" and "no bound") would be wrong in both places — a zero-day
   * trial is a product decision, and a zero-roster bound is the founder switching the fence
   * off — so the bounds are checked where they belong, and the database checks them again.
   */
  const students = (field: string): number | null => {
    const raw = String(formData.get(field) ?? '').trim()
    if (!raw) return null
    const value = parseTaka(raw)
    if (value === null || !Number.isFinite(value)) return null
    const whole = Math.floor(value)
    return whole < 0 || whole > 100000 ? null : whole
  }

  const teacherDays = days('teacherDays')
  const centerDays = days('centerDays')
  const institutionDays = days('institutionDays')
  if (teacherDays === null || centerDays === null || institutionDays === null) {
    return { error: words.badDays }
  }

  const roster = students('roster')
  if (roster === null) return { error: words.badRoster }

  const ok = await writeTrialDays(await createClient(), {
    teacherDays,
    centerDays,
    institutionDays,
    roster,
  })

  if (!ok) return { error: words.failed }

  revalidatePath('/founder')
  return { ok: words.saved }
}

/**
 * `public.founder_set_trial_days` AS POSTGREST SEES IT — the same cast, for the same
 * reason, as every other function written after `src/lib/supabase/types.ts` was generated.
 */
type TrialDaysRpc = (
  fn: 'founder_set_trial_days',
  args: {
    p_teacher_trial_days: number
    p_center_trial_days: number
    p_institution_trial_days: number
    p_trial_roster_ceiling: number
  },
) => PromiseLike<{ data: Json | null; error: { code?: string; message: string } | null }>

async function writeTrialDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    teacherDays: number
    centerDays: number
    institutionDays: number
    roster: number
  },
): Promise<boolean> {
  // `as never` for the reason `writePayment` records: the generated `Functions` union is
  // what `rpc` is typed against and this function is newer than the types.
  const save = ((fn: string, args: Record<string, unknown>) =>
    supabase.rpc(fn as never, args as never)) as unknown as TrialDaysRpc

  const { data, error } = await save('founder_set_trial_days', {
    p_teacher_trial_days: input.teacherDays,
    p_center_trial_days: input.centerDays,
    p_institution_trial_days: input.institutionDays,
    // Named after the column it writes and not after the screen's word for it: 20260811000098
    // added the argument, and the house rule for these casts is that the names are the ones
    // the function declares.
    p_trial_roster_ceiling: input.roster,
  })

  if (error) return false
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

/**
 * The two functions as PostgREST sees them, cast the way `settleDay` and `approveClaim`
 * cast theirs.
 *
 * Migration 86 is the newest file in the repository and `src/lib/supabase/types.ts` is
 * regenerated after it is applied, so the entries below are the standing placeholder until
 * that run — the same note `lib/billing/claims.ts` carried for migration 84. The cast is a
 * no-op once they exist, because the argument names are the same ones the functions
 * declare.
 */
type LeverRpc = (
  fn: 'founder_adjust_balance' | 'founder_grant_days',
  args: Record<string, unknown>,
) => PromiseLike<{ data: Json | null; error: { code?: string; message: string } | null }>

/** The refusals a founder can act on, and nothing else — the rest are real faults. */
type AdjustOutcome =
  | { ok: true; amountPoisha: number; balanceAfter: number }
  | { ok: false; reason: 'overdraw' | 'failed' }

type GrantOutcome =
  | { ok: true; days: number; chargedThrough: string }
  | { ok: false; reason: 'failed' }

/**
 * The three codes these functions raise in, read for the one that is a sentence.
 *
 * `23514` IS THE ONE A FOUNDER MEETS — "that would leave the balance at -৳300" — and it is
 * a `23514` because the rule is `billing_ledger_no_overdraft` and the function raises with
 * the constraint's own code. The other two are `42501` for a caller who is not the
 * platform admin and `22023` for an argument the action already refused in words; both are
 * faults rather than things a founder typed, so they answer with the general sentence.
 */
const OVERDRAFT = '23514'

/** A number off the wire, or null for anything that is not one. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function writeAdjustment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { centerId: string; amountPoisha: number; reason: string },
): Promise<AdjustOutcome> {
  // BOUND, NOT DETACHED — see settleDay in lib/billing/settlement.ts. `rpc` is a
  // prototype method that reads `this.rest`, so calling it as a free function set
  // `this` to undefined and threw; the arrow keeps the cast and keeps `this`.
  const adjust = ((fn: 'founder_adjust_balance', args: Record<string, unknown>) =>
    supabase.rpc(fn as never, args as never)) as unknown as LeverRpc

  const { data, error } = await adjust('founder_adjust_balance', {
    p_center: input.centerId,
    p_amount_poisha: input.amountPoisha,
    p_reason: input.reason,
  })

  if (error) {
    return { ok: false, reason: error.code === OVERDRAFT ? 'overdraw' : 'failed' }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'failed' }
  }

  const out = data as Record<string, unknown>
  const balanceAfter = numberOrNull(out.balanceAfter)

  // The sentence the founder reads is built from this figure, so a missing one is the
  // wire disagreeing with the database rather than a zero to fall back on.
  if (balanceAfter === null) return { ok: false, reason: 'failed' }

  return { ok: true, amountPoisha: input.amountPoisha, balanceAfter }
}

async function writeGrant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { centerId: string; days: number; reason: string },
): Promise<GrantOutcome> {
  // BOUND, NOT DETACHED — same fix as writeAdjustment above.
  const grant = ((fn: 'founder_grant_days', args: Record<string, unknown>) =>
    supabase.rpc(fn as never, args as never)) as unknown as LeverRpc

  const { data, error } = await grant('founder_grant_days', {
    p_center: input.centerId,
    p_days: input.days,
    p_reason: input.reason,
  })

  if (error) return { ok: false, reason: 'failed' }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'failed' }
  }

  const out = data as Record<string, unknown>
  const chargedThrough =
    typeof out.chargedThrough === 'string' ? out.chargedThrough.slice(0, 10) : null

  // The date the screen reads back, and the one the row now holds — a grant that reported
  // a date of its own would be the second engine this whole module exists to avoid.
  if (chargedThrough === null) return { ok: false, reason: 'failed' }

  return { ok: true, days: input.days, chargedThrough }
}
