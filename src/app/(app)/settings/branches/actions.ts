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
 * theirs: nothing in the database knows what a centre bought, so `multipleBranches` is
 * checked in this file or it is not checked at all. A Server Action is a public HTTP
 * endpoint and the locked card on the page is a courtesy to the reader, not a fence.
 *
 * NO CAP, unlike every other list in settings. A branch is not a quota an owner can run
 * out of — it is a line on the monthly bill (`INSTITUTION_BRANCH_BDT`, after the
 * included three), so the answer to a fourth one is a price and not a refusal. Which is
 * why the add form names the price before the tap: see `nextBranchCostBdt` and
 * settings.branches.addCost.
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
import { dict } from '@/lib/i18n'
import { MAX_NAME, MAX_TEXT, clamp } from '@/lib/limits'
import { has } from '@/lib/plans'
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
 * Opens a building.
 *
 * The one write in settings that costs money, and it says so on the form rather than
 * here — there is nothing to refuse, so there is nothing for this action to explain. The
 * bill is computed from what is on the table, so an owner who adds a fourth branch is
 * charged for a fourth branch whether or not this screen was where they added it.
 */
export async function createBranch(
  _prev: BranchState,
  formData: FormData,
): Promise<BranchState> {
  const session = await caller()
  if (!isSession(session)) return session

  const fields = readFields(session, formData)
  if (!isFields(fields)) return fields

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
 * There is no guard on the students standing in it, unlike the subject list's. A guard
 * would have to name a repair, and moving a student between branches has no screen yet;
 * fencing the button would leave an owner unable to record the plain fact that a
 * building has shut. The count sits beside the button instead, so the decision is made
 * with the number in view.
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
  const supabase = await createClient()

  const { data: saved, error } = await supabase
    .from('branches')
    .update({ active: next })
    .eq('id', branchId)
    .eq('coaching_center_id', session.active.centerId)
    .select('id')

  if (error) return { error: d.errors.changeFailed }
  if (!saved || saved.length === 0) return { error: d.branches.errors.notFound }

  revalidatePath('/settings/branches')
  return { ok: d.saved }
}
