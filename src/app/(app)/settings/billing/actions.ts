'use server'

/**
 * An owner raising their hand: "I want to change plan, ring me." And, below that,
 * buying the student places a paid plan sells by the seat.
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
 * NOR DOES `buyStudentPlaces` — the same rule one step down. It writes a quote with a
 * price and a reference; `student_capacity` moves when the founder confirms the
 * transfer and `settle_payment_intent` runs. Both exports here are an owner saying
 * what they want, which is why neither needs a rail we do not have yet.
 *
 * AND `requestPlaces` IS THE SAME SENTENCE FROM A MANAGER, which is §3.7: a branch
 * manager cannot raise the organisation's monthly cost on their own signature, so at a
 * full register the fork is a price for whoever pays and an ask for whoever cannot.
 * That ask is a row for the same reason the upgrade request is — the founder's panel
 * and the HQ dashboard already know everything about the centre except that somebody
 * in Mirpur has run out of desks.
 *
 * `answerAsk` CLOSES THAT LOOP, and it is the one pair of exports here where the two
 * halves are not symmetrical. The ask is written by a manager's own client under RLS;
 * the answer needs the service role, because resolving one writes three columns at once
 * and no browser has UPDATE on that table. Which is the same rule as everything else in
 * this file: the customer says what they want, and the money is written by the server.
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
import { MAX_LABEL, MAX_PLACES, MAX_TEXT, clamp } from '@/lib/limits'
import { formatTaka } from '@/lib/money'
import {
  MAX_CENTER_PAYMENT_BDT,
  coverageStart,
  isMonthsCovered,
} from '@/lib/platform/billing'
import {
  ASK_PLACES,
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
 * A manager, and specifically not an owner — the one gate in this app that refuses
 * upwards.
 *
 * `requireRole('manager')` admits an owner, because everywhere else "manager or above"
 * is what a manager check means. Here it would be wrong twice over. The row it guards
 * means "somebody who cannot pay needs you to", so an owner filing one is a note to
 * themselves; and `capacity_requests_manager_insert` draws exactly this line in the
 * database, so an owner would get a zero-row write and a screen that says the save
 * failed. Refused here instead, in a sentence that says whose button it is.
 */
async function planManager(): Promise<CenterSession | UpgradeState> {
  try {
    const session = await requireRole('manager')
    if (session.active.role !== 'manager') {
      return { error: dict(session.locale).settings.plan.places.ownerBuys }
    }
    return session
  } catch (err) {
    if (err instanceof AuthError) {
      const caller = await getSession()
      const d = dict(caller?.locale ?? DEFAULT_LOCALE)
      return { error: d.settings.plan.places.managerOnly }
    }
    throw err
  }
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
 * How many places the owner typed. The twin of `count` in ./calculator.tsx, and it
 * lives here rather than in ../../../lib/limits.ts because that file imports nothing
 * on purpose and this needs `toAsciiDigits` — an owner on a Bangla keyboard types ২০.
 */
function count(raw: string, max: number): number {
  const n = Number.parseInt(toAsciiDigits(raw).replace(/[^\d]/g, ''), 10)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, max)
}

/**
 * Opens a purchase for student places and tells the owner where to send the money.
 *
 * PRICED FROM THE PAID PLAN, never `session.plan`. Those two disagree during a trial,
 * and `settle_payment_intent` reads `app.student_ceiling` off the paid row — so a
 * teacher-tier centre trialling Centre would be quoted, sent to bKash, and then
 * refused with 42501 after it had already paid. `session.active` is the paid truth.
 *
 * NOTHING HERE GRANTS ANYTHING. The row it writes is a quote with a price and a
 * reference; the ceiling only moves when the founder confirms the transfer and
 * `settle_payment_intent` runs. That is why an owner may open one at all, and why the
 * amount is worked out here from the bands rather than read off the form: a client
 * that could name its own price could buy a thousand places for a taka.
 *
 * No `requireWritable`, for the reason at the top of this file — a suspended centre
 * paying us is the outcome read-only exists to produce.
 */
export async function buyStudentPlaces(
  _prev: UpgradeState,
  formData: FormData,
): Promise<UpgradeState> {
  const gate = await planOwner()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.places

  const places = count(String(formData.get('places') ?? ''), MAX_PLACES)
  if (places <= 0) return { error: t.badCount }

  const quote = priceIntent({
    purpose: 'student_capacity',
    plan: planFor(session.active.plan),
    purchasedCapacity: session.active.studentCapacity,
    places,
  })
  // `places` is already above zero, so an empty quote can only mean this plan grants
  // its ceiling outright and there is nothing to sell.
  if (quote.quantity <= 0) return { error: t.notOnThisPlan }

  // Service role because `payment_intents` is founder-readable and nobody's browser
  // may write a price. The owner's own client could not insert this row.
  const admin = createAdminClient(session.userId)

  const opened = await openIntent(admin, {
    centerId: session.active.centerId,
    quote,
    requestedBy: session.userId,
    branchId: session.active.branchId,
    // Raw, because openIntent reads it: a replayed offline submit must land on the
    // intent it already opened rather than a second one at the same price.
    idempotencyKey: formData.get('idempotencyKey'),
  })
  if (!opened.ok) return { error: t.failed }

  // Moves the row pending -> initiated, which is what the founder's "waiting for
  // money" badge reads. The instruction itself is rendered by the page from the row,
  // not returned through here — the owner leaves for bKash and comes back to a
  // reloaded screen, and a reference that only existed in action state would be gone.
  const provider = paymentProvider(opened.intent.provider)
  const told = await provider.createPayment(admin, opened.intent)
  if (told.kind === 'blocked') return { error: t.closed }

  revalidatePath('/settings/billing')
  // And the desk this was very likely pressed from. §3.4: an owner who runs out of places
  // with a family standing in front of them buys them inside the add-student screen, and
  // that screen prints the reference off the row this just wrote. Without this line the
  // confirmation there says "send the money as shown below" above nothing.
  revalidatePath('/settings/students/new')

  return { ok: t.opened }
}

/**
 * A branch manager telling HQ the register is full.
 *
 * HOW MANY IS NOT A PARAMETER. §3.7's button says "Request 25 more places", and
 * `ASK_PLACES` is that 25 — the manager is reporting a shortage, not pricing a purchase,
 * and a number arriving from a form is a number somebody can change. What it costs is
 * worked out from the bands by whoever actually pays.
 *
 * NEITHER IS THE BRANCH. 20260811000054's trigger fills `branch_id` from the writer's
 * own membership, so a Mirpur manager's ask says Mirpur without this form being trusted
 * to say so — and 20260811000053's restrictive policy refuses an explicit foreign one.
 *
 * SAFE TO ARRIVE TWICE, like `requestUpgrade` above and for the same offline replay.
 * The mechanism is different because the table is: a partial unique index over the open
 * asks, one per branch, so the second insert is refused rather than upserted. The ask
 * they already filed is the answer to "did this work", so a unique violation is
 * success. `.upsert()` cannot be used here — supabase-js has no way to name the
 * predicate of a partial index — and should not be: a resolved ask is history, and an
 * upsert would reopen it.
 */
export async function requestPlaces(
  _prev: UpgradeState,
  _formData: FormData,
): Promise<UpgradeState> {
  const gate = await planManager()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.places

  const supabase = await createClient()

  const { error } = await supabase.from('capacity_requests').insert({
    coaching_center_id: session.active.centerId,
    places: ASK_PLACES,
    requested_by: session.userId,
  })

  if (error && error.code !== UNIQUE_VIOLATION) return { error: t.askFailed }

  // Both screens that offer the button, because either one may have been the one
  // pressed and both draw the "already asked" line from the same row.
  revalidatePath('/settings/students/new')
  revalidatePath('/settings/students/import')

  return { ok: t.asked }
}

/**
 * Takes the ask back, for `withdrawUpgradeRequest`'s reason: a pending card with no way
 * out is a screen that lies about what the reader controls.
 *
 * FILTERED BY THE WRITER'S OWN BRANCH, which is not belt and braces. RLS keeps a pinned
 * manager to their own rows, but a manager with no branch passes `app.branch_ok` for
 * every row in the centre — so a head-office manager withdrawing "their" ask with only
 * a centre filter would delete Mirpur's and Uttara's along with it.
 */
export async function withdrawPlacesRequest(
  _prev: UpgradeState,
  _formData: FormData,
): Promise<UpgradeState> {
  const gate = await planManager()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.places
  const branchId = session.active.branchId

  const supabase = await createClient()

  // scoped-by: coaching_center_id is filtered below. `handled_at is null` keeps this to
  // the ask nobody has answered, which is also all the policy allows.
  const { error } = await supabase
    .from('capacity_requests')
    .delete()
    .eq('coaching_center_id', session.active.centerId)
    .is('handled_at', null)
    .filter('branch_id', branchId === null ? 'is' : 'eq', branchId)

  if (error) return { error: t.askFailed }

  revalidatePath('/settings/students/new')
  revalidatePath('/settings/students/import')

  return { ok: t.askWithdrawn }
}

/** A uuid and nothing that merely looks like one, since this arrives from a form. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The ask an owner is about to answer, or null if there is nothing to answer.
 *
 * READ WITH THE OWNER'S OWN CLIENT, deliberately, even though the write below needs the
 * service role. `capacity_requests_center_read` is what proves this row is theirs; doing
 * it by hand on an admin client would put that boundary in this file, where a missing
 * `.eq('coaching_center_id', …)` is a centre reading another centre's asks. The centre
 * filter is here as well, and it is the belt: RLS is the braces.
 */
async function openAskById(
  session: CenterSession,
  raw: unknown,
): Promise<{ id: string; places: number; branchId: string | null } | null> {
  const id = String(raw ?? '')
  if (!UUID_RE.test(id)) return null

  const supabase = await createClient()

  // scoped-by: coaching_center_id is filtered below, and RLS refuses another centre's.
  const { data } = await supabase
    .from('capacity_requests')
    .select('id, places, branch_id')
    .eq('id', id)
    .eq('coaching_center_id', session.active.centerId)
    .is('handled_at', null)
    .maybeSingle()

  if (!data) return null

  return { id: data.id, places: data.places, branchId: data.branch_id }
}

/**
 * §3.7's answer: HQ approves an ask by paying for it.
 *
 * THE PLACES COME FROM THE ROW, not from the form. The form sends one id; how many
 * places that ask was for is a column, so an owner cannot be talked into a bigger
 * purchase than the one on their screen and a tampered POST cannot enlarge somebody
 * else's ask. Priced from the paid plan for `buyStudentPlaces`'s reason.
 *
 * THE ORDER OF THE TWO WRITES IS THE WHOLE DESIGN. The purchase is opened first and the
 * ask is stamped with it second, so a failure in between leaves an open ask and a real
 * purchase — the owner sees both on this screen and can answer again. Stamping first
 * would leave an ask marked handled by a purchase that does not exist, and the manager
 * waiting on it would have been told it was dealt with.
 *
 * NOTHING HERE RAISES THE CEILING. `handled_at` means "answered", not "granted": whether
 * the places arrive is `payment_intents.state`, which moves when the founder confirms
 * the transfer and `settle_payment_intent` runs. That is why the record points at the
 * intent instead of carrying an `approved` boolean of its own.
 */
export async function answerAsk(
  _prev: UpgradeState,
  formData: FormData,
): Promise<UpgradeState> {
  const gate = await planOwner()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.places

  const ask = await openAskById(session, formData.get('ask'))
  if (!ask) return { error: t.askGone }

  const quote = priceIntent({
    purpose: 'student_capacity',
    plan: planFor(session.active.plan),
    purchasedCapacity: session.active.studentCapacity,
    places: ask.places,
  })
  if (quote.quantity <= 0) return { error: t.notOnThisPlan }

  const admin = createAdminClient(session.userId)

  const opened = await openIntent(admin, {
    centerId: session.active.centerId,
    quote,
    requestedBy: session.userId,
    // The branch that ran out, not the owner's own. `openIntent` calls this "which
    // branch asked", and on this path that is a fact rather than an inference — §3.8's
    // receipt should say Mirpur even though head office paid.
    branchId: ask.branchId,
    idempotencyKey: formData.get('idempotencyKey'),
  })
  if (!opened.ok) return { error: t.failed }

  const provider = paymentProvider(opened.intent.provider)
  const told = await provider.createPayment(admin, opened.intent)
  if (told.kind === 'blocked') return { error: t.closed }

  // Service role because `authenticated` has no UPDATE on this table at all —
  // 20260811000058 revokes it rather than leaving it unpolicied, since resolving writes
  // three columns at once and one of them points at money.
  //
  // `handled_at is null` again, and not for tidiness: two owners answering the same ask
  // in the same minute would otherwise have the second purchase quietly overwrite the
  // first one's link, leaving a paid intent attached to nothing.
  const { error } = await admin
    .from('capacity_requests')
    .update({
      handled_at: new Date().toISOString(),
      handled_by: session.userId,
      intent_id: opened.intent.id,
    })
    .eq('id', ask.id)
    .eq('coaching_center_id', session.active.centerId)
    .is('handled_at', null)

  // Not an error the owner is shown: the purchase is open and the instruction to pay is
  // on the screen they land on. What is left behind is an ask that still looks open,
  // which the next answer resolves — the opposite failure would be a manager told their
  // shortage was dealt with by a purchase nobody made.
  if (error) return { ok: t.opened }

  revalidatePath('/settings/billing')
  revalidatePath('/settings/students/new')
  revalidatePath('/settings/students/import')

  return { ok: t.opened }
}

/**
 * The other answer, which §3.7 allows and 20260811000058 calls "refused and dated": a
 * date with no intent behind it.
 *
 * It exists because the alternative is worse than a no. An ask nobody answers sits on
 * the manager's screen saying HQ has been told, for a term, while the owner who decided
 * against it has no way to say so — and the branch keeps turning families away expecting
 * places that are not coming. A closed ask lets them ask again next month, which is the
 * conversation that should happen.
 */
export async function declineAsk(
  _prev: UpgradeState,
  formData: FormData,
): Promise<UpgradeState> {
  const gate = await planOwner()
  if (!isSession(gate)) return gate

  const session = gate
  const t = dict(session.locale).settings.plan.places

  const ask = await openAskById(session, formData.get('ask'))
  if (!ask) return { error: t.askGone }

  const admin = createAdminClient(session.userId)

  const { error } = await admin
    .from('capacity_requests')
    .update({ handled_at: new Date().toISOString(), handled_by: session.userId })
    .eq('id', ask.id)
    .eq('coaching_center_id', session.active.centerId)
    .is('handled_at', null)

  if (error) return { error: t.askFailed }

  revalidatePath('/settings/billing')
  revalidatePath('/settings/students/new')
  revalidatePath('/settings/students/import')

  return { ok: t.askDeclined }
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
