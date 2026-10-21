'use server'

/**
 * The buildings an organisation runs: opening one, correcting one, and closing one.
 *
 * THE HEAD OFFICE ONLY, and unusually for this app that rule is enforced three times
 * over. 20260811000053 wrote it into the database — `branches_branch_scope` is
 * restrictive, so a manager pinned to Mirpur reads exactly the Mirpur row and an insert
 * of anything else fails the check — the page draws no form for them, and `caller()`
 * below refuses them in words. The database copy is the one that matters; this one
 * exists because a policy failure arrives as `42501` and the only sentence a screen can
 * make of that is "could not save", which tells a branch manager nothing about who to
 * ask. §3.7 is the rule being spelt out: a branch manager is not the billing owner and
 * must not be able to raise the organisation's monthly cost on their own signature.
 *
 * AND AN INSTITUTION PLAN, re-checked here for the reason the staff actions give about
 * theirs. Since 20260811000096 it is also checked in the database — `branches` had no
 * trigger at all, so a token posted straight at PostgREST could write the fortieth
 * building on a tier that sells one — and this file's copy is what produces the sentence
 * a reader can act on, which a SQLSTATE cannot.
 *
 * NO CEILING ON HOW MANY, unlike every other list in settings. A branch is not a quota an
 * owner can run out of — it is a line on the monthly bill (`INSTITUTION_BRANCH_BDT`, after
 * the included three), so the answer to a fourth one is a price and not a refusal. Which
 * is why the add form names the price before the tap: see `nextBranchCostBdt` and
 * settings.branches.addCost.
 *
 * BUT A PRICE HAS TO BE PAID, which is the half this file was missing (`fence` below, and
 * the trigger behind it). A signup is given days rather than money (§4.3), so a trialling
 * institution is writable while its balance holds nothing: the included three are its
 * tier's and free, and every building past them needs money on the balance to carry the
 * monthly line. An organisation that has never paid us anything runs the three it was
 * given.
 *
 * AND NOTHING HERE DELETES, which is a stronger rule than the one on employees. Every
 * foreign key onto this table is `on delete set null` — students, batches, teachers,
 * employees, expenses, and the branch stamped on `fee_invoices`, `fee_payments` and
 * `salary_payments` by the triggers in 20260811000047 and 20260811000052 — so Postgres
 * would not refuse the delete. It would quietly unfile a year of money from the
 * building that took it, and `notices` (`on delete cascade`) would lose its rows
 * outright. Worse, `center_members.branch_id` is `on delete set null` too, and a null
 * branch is the head office: deleting a branch would promote every manager pinned to it
 * to reading the whole organisation. A building that closes is switched off and stays on
 * the books.
 */
import { revalidatePath } from 'next/cache'

import {
  requireRole,
  requireWritable,
  authRefusal,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { isHqMember } from '@/lib/branches'
import { isBranchRefusal } from '@/lib/capacity'
import { dict } from '@/lib/i18n'
import { MAX_NAME, MAX_TEXT, clamp } from '@/lib/limits'
import { formatTaka } from '@/lib/money'
import {
  branchOpeningRefusal,
  has,
  INSTITUTION_BRANCH_BDT,
  INSTITUTION_INCLUDED_BRANCHES,
} from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'

export type BranchState = { error?: string; ok?: string } | null

/**
 * The caller, or the sentence to show somebody who may not be one.
 *
 * Three refusals in one function and they are three different kinds. The role check is a
 * fence and `authRefusal` writes its wording, including the separate sentence a lapsed
 * subscription gets. The plan check is an entitlement, so its sentence names what is
 * missing. The last is neither: a branch manager is a legitimate manager who is being
 * told whose decision this is, which is why `hqOnly` says who can rather than that they
 * cannot.
 */
async function caller(): Promise<CenterSession | BranchState> {
  let session: CenterSession
  try {
    session = requireWritable(await requireRole('manager'))
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: await authRefusal(err, (d) => d.settings.errors.forbidden) }
    }
    throw err
  }

  const d = dict(session.locale).settings
  if (!has(session.plan, 'multipleBranches')) {
    return { error: d.errors.branchesNeedInstitution }
  }
  if (!isHqMember(session.active)) return { error: d.branches.errors.hqOnly }

  return session
}

function isSession(value: CenterSession | BranchState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * The two fields both writes share, read off the form and checked.
 *
 * Returns the refusal instead of the values when the name is missing, so the add form
 * and the row panel refuse the same mistake in the same words. The address is trimmed to
 * null rather than kept as an empty string: the column is nullable, and "" would be a
 * building whose address is recorded as blank rather than not recorded.
 */
type Fields = { name: string; address: string | null }

function readFields(session: CenterSession, formData: FormData): Fields | BranchState {
  const t = dict(session.locale).settings.branches.errors

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: t.nameRequired }

  const address = String(formData.get('address') ?? '').trim()

  return {
    // Clamped rather than refused, for the reason `clamp` gives: a name at the cap is a
    // long name, and the browser stopped the keystrokes already.
    name: clamp(name, MAX_NAME),
    address: address ? clamp(address, MAX_TEXT) : null,
  }
}

function isFields(value: Fields | BranchState): value is Fields {
  return value !== null && 'name' in value
}

/**
 * The sentence for a building past the included three with nothing on the balance.
 *
 * The two figures are the plan's own constants rather than read off this row, because the
 * refusal is the same sentence for everybody reading it: three included, ৳750 each after.
 */
function notFunded(session: CenterSession): string {
  return dict(session.locale).settings.branches.errors.notFunded(
    INSTITUTION_INCLUDED_BRANCHES,
    formatTaka(INSTITUTION_BRANCH_BDT),
  )
}

/**
 * Whether this organisation may open one more building, as a sentence when it may not.
 *
 * THE RULE IS `branchOpeningRefusal`'s, and the read is this file's. The three buildings
 * the tier includes change no line on any bill, so they are never asked about money; past
 * them the monthly figure the branch adds has to come off a balance that holds something,
 * because that is what pays it (§11.6).
 *
 * A COUNT THAT DID NOT COME BACK IS REFUSED, not read as zero, for the reason
 * `limitRefusal` gives: a failed count is "we cannot tell just now", and the alternative
 * is opening a building whose allowance nobody could check. NULL IS NOT MONEY for the same
 * reason — `branchOpeningRefusal` refuses an unreadable balance rather than treating it as
 * empty, and the session's own figure is the one the settlement has just written.
 *
 * THE DATABASE ASKS THE SAME QUESTION — `app.guard_branch_ceiling` in 20260811000096, on
 * every insert and on every closed building switched back on, whatever route the write
 * came in by. That copy is the fence. This one exists because a refusal has to name what it
 * costs and where to go, and because a form that could only refuse is worse than a form
 * that is not drawn at all.
 */
async function fence(session: CenterSession): Promise<BranchState | null> {
  const d = dict(session.locale).settings
  const supabase = await createClient()

  const { count } = await supabase
    .from('branches')
    .select('id', { count: 'exact', head: true })
    .eq('coaching_center_id', session.active.centerId)
    .eq('active', true)

  if (count === null) return { error: d.listUnreadable }

  const refusal = branchOpeningRefusal(session.plan, {
    activeBranches: count,
    balancePoisha: session.billing.balancePoisha,
  })

  // Unreachable from this module's own `caller()`, which refuses a tier without branches
  // before any action body runs. Kept because a plan can change under a form that was
  // drawn a minute ago, and because the answer belongs where the question is asked.
  if (refusal === 'no_branches') return { error: d.errors.branchesNeedInstitution }
  if (refusal === 'needs_money') return { error: notFunded(session) }
  return null
}

/**
 * Opens a building.
 *
 * The one write in settings that costs money, and the price is on the form rather than
 * here (settings.branches.addCost) — but a price is not a receipt. The three the tier
 * includes are free and the fourth onwards is paid for out of the balance, so a trialling
 * institution with nothing on it is refused with the reason and the way to fix it.
 */
export async function createBranch(
  _prev: BranchState,
  formData: FormData,
): Promise<BranchState> {
  const session = await caller()
  if (!isSession(session)) return session

  const fields = readFields(session, formData)
  if (!isFields(fields)) return fields

  const refused = await fence(session)
  if (refused) return refused

  const d = dict(session.locale).settings
  const supabase = await createClient()

  const { error } = await supabase.from('branches').insert({
    coaching_center_id: session.active.centerId,
    name: fields.name,
    address: fields.address,
  })

  if (error) {
    // `unique (coaching_center_id, name)` is the only realistic failure, and "you
    // already have one of these" is more useful than a database string.
    if (error.code === '23505') return { error: d.branches.errors.duplicate }
    // The trigger's own refusal, under the count above: two owners at one desk, or a
    // request that never went near this screen. Without this the reader would be shown
    // "could not save" for a rule the product states in a sentence.
    if (isBranchRefusal(error)) return { error: notFunded(session) }
    return { error: d.errors.addFailed }
  }

  revalidatePath('/settings/branches')
  return { ok: d.added }
}

/**
 * Corrects what was written down about a building.
 *
 * A name typed wrong and an address, and nothing else. Everything filed under the branch
 * holds its id rather than its letters, so this repairs the name everywhere at once —
 * including on last year's receipts, which is the reason a rename is offered at all and
 * a second branch with the correct spelling is not.
 *
 * `active` is not touched here: a correction and a closure are different errands and
 * share no submit button.
 */
export async function saveBranch(
  _prev: BranchState,
  formData: FormData,
): Promise<BranchState> {
  const session = await caller()
  if (!isSession(session)) return session

  const d = dict(session.locale).settings
  const branchId = String(formData.get('branchId') ?? '')
  if (!branchId) return { error: d.branches.errors.notFound }

  const fields = readFields(session, formData)
  if (!isFields(fields)) return fields

  const supabase = await createClient()

  const { data: saved, error } = await supabase
    .from('branches')
    .update({ name: fields.name, address: fields.address })
    .eq('id', branchId)
    // Scoped as well as governed by RLS, for the reason the roster gives: an owner of
    // two organisations passes `is_staff_admin` for both, so the policy alone would let
    // an id from the other one through under a switcher that says this one.
    .eq('coaching_center_id', session.active.centerId)
    .select('id')

  if (error) {
    if (error.code === '23505') return { error: d.branches.errors.duplicate }
    return { error: d.errors.saveFailed }
  }
  // An update matching no policy changes nothing and reports no error, so the rows
  // written are counted rather than assumed — the trap saveMarks documents.
  if (!saved || saved.length === 0) return { error: d.branches.errors.notFound }

  revalidatePath('/settings/branches')
  return { ok: d.saved }
}

/**
 * A building closes, or one that closed is open again.
 *
 * ONE COLUMN AND NOTHING ELSE MOVES. Every student, bill, salary and register already
 * filed under the branch stays exactly where it is — see the head of this file for why
 * there is no delete — and the head office's own reports still add it in, because a
 * building that closed in March still took fees in February.
 *
 * There is no guard on the students standing in it, unlike the subject list's. The edit
 * form does now move a student to another building, so a guard could name the repair —
 * but it would be a repair to make one child at a time, and fencing the button would
 * leave an owner unable to record the plain fact that a building has shut until they had
 * emptied it. The count sits beside the button instead, so the decision is made with the
 * number in view, and every move is on the student's own profile afterwards.
 *
 * CLOSING ONE IS NEVER ASKED ABOUT MONEY, AND OPENING ONE ALWAYS IS. A closure stops a
 * monthly line — refusing it would be charging a customer for shutting a building — while
 * a building switched back on starts one again, which is why `fence` is asked on the way
 * in and not on the way out. A row that is already open is a no-op here and the trigger
 * returns before its own test, so a resubmitted form cannot be refused for a building that
 * was never closed.
 */
export async function setBranchActive(
  _prev: BranchState,
  formData: FormData,
): Promise<BranchState> {
  const session = await caller()
  if (!isSession(session)) return session

  const d = dict(session.locale).settings
  const branchId = String(formData.get('branchId') ?? '')
  if (!branchId) return { error: d.branches.errors.notFound }

  const next = String(formData.get('next') ?? '') === 'on'

  if (next) {
    const refused = await fence(session)
    if (refused) return refused
  }

  const supabase = await createClient()

  const { data: saved, error } = await supabase
    .from('branches')
    .update({ active: next })
    .eq('id', branchId)
    .eq('coaching_center_id', session.active.centerId)
    .select('id')

  if (error) {
    if (isBranchRefusal(error)) return { error: notFunded(session) }
    return { error: d.errors.changeFailed }
  }
  if (!saved || saved.length === 0) return { error: d.branches.errors.notFound }

  revalidatePath('/settings/branches')
  return { ok: d.saved }
}
