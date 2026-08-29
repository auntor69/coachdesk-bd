'use server'

/**
 * An owner raising their hand: "I want to change plan, ring me."
 *
 * WHY THIS EXISTS AT ALL, when the screen above it already had a WhatsApp chip and a
 * phone number. Both of those live behind `NEXT_PUBLIC_SALES_PHONE`, and that
 * variable is empty in every deployment — the founder's own number is not in the
 * repo and should not be. The card was gated on it, correctly for a dead WhatsApp
 * link and wrongly for the whole card, so an owner who had just read the price
 * calculator and decided to buy reached the bottom of the page and found nothing.
 * The sale ended there, silently, and nobody ever learned it had happened.
 *
 * A row instead of a mailto, because the founder panel already carries this centre's
 * name, its owner's name, a `tel:` link, the student and teacher counts and the exact
 * monthly bill. The only fact missing from that card was that the customer wants to
 * talk, so that is the only fact this writes.
 *
 * IT CHANGES NO ENTITLEMENT. `coaching_centers.plan` is locked by the trigger in
 * 20260811000004 and stays locked; a request is a note, and the tier only moves when
 * the founder moves it in ../../founder/actions.ts. An owner cannot upgrade
 * themselves by asking, which is the whole reason this can be a form with no
 * payment rail behind it.
 */

import { revalidatePath } from 'next/cache'

import {
  AuthError,
  getSession,
  requireRole,
  type CenterSession,
} from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { MAX_TEXT, clamp } from '@/lib/limits'
import type { PlanId } from '@/lib/plans'

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

  revalidatePath('/settings/plan')

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

  revalidatePath('/settings/plan')

  return { ok: t.withdrawn }
}
