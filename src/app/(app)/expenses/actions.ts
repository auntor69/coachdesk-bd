'use server'

/**
 * Writing down money the centre paid out.
 *
 * THE WRITE THAT MAKES THE PROFIT LINE MEAN ANYTHING. `center_profit_month`
 * (20260811000049) is `collected − expenses − payroll`, and until this action exists two
 * of those three sides are structurally zero — not because the centre spends nothing but
 * because nothing in the product can say that it does. A profit figure equal to the
 * month's collections is not a profit figure; it is the collection total under a
 * different heading, and an owner who reads it as profit is being misled by us.
 *
 * STAFF-ADMIN ONLY, matching `expenses_staff_admin_write` exactly. Not teachers, and
 * deliberately not through §6.5's `can_view_fees` either: that permission is about a
 * teacher collecting money for their own batch, which is a different act from reading —
 * or writing — what the centre pays in rent and what it pays its staff. The role is
 * re-checked here rather than trusted from the page, because a Server Action is a public
 * HTTP endpoint and the page's own `forbidden()` is a redirect, not a fence.
 *
 * EVERY FIGURE IS RE-DERIVED FROM THE FORM AND THEN CHECKED. The amount goes through
 * parseTaka, the category and the method are looked up in the canonical lists rather than
 * cast, and the date is bounded at both ends. A category cast from a string would be a
 * `22P02` from Postgres and "something went wrong" on the screen; a date of 0026-08-05
 * would be a row in a month nobody opens, which the table's own revoke on DELETE makes
 * permanent.
 *
 * THERE IS NO EDIT AND NO DELETE HERE, and that is 20260811000045's decision rather than
 * this file's: DELETE is revoked from `authenticated` and UPDATE is granted on
 * `(reference, note, recurring)` alone, with a trigger behind the grant. A figure typed
 * wrong is corrected by a second row with a minus amount, which is the same rule the fee
 * side has had since 20260811000017 and the same rule that lets a month's spending be
 * reconstructed later at all.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import {
  requireRole,
  requireWritable,
  requireCapability,
  authRefusal,
  AuthError,
} from '@/lib/auth/session'
import { readIdempotencyKey, UNIQUE_VIOLATION } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { MAX_TAKA, parseTaka } from '@/lib/money'
import { todayInDhaka } from '@/lib/bd/time'
import { postedBranchId } from '@/lib/branches'
import { dict } from '@/lib/i18n'
import { EXPENSE_CATEGORIES } from '@/lib/expenses/categories'
import { PAYMENT_METHODS } from '@/lib/fees/methods'
import { has } from '@/lib/plans'
import type { CenterSession } from '@/lib/auth/session'
import type { ExpenseCategory, PaymentMethod } from '@/lib/supabase/types'

export type ExpenseState = { error?: string; ok?: string } | null

/**
 * Membership tests rather than casts, built from the canonical lists.
 *
 * Sets and not `.includes()` on the arrays, matching the fee actions: the cost is the
 * same at these sizes and the intent reads better at the call site. Both lists carry a
 * compile-time check that they hold every value of their enum — see
 * @/lib/expenses/categories and @/lib/fees/methods — so a category added in a migration
 * fails the build here rather than arriving as a value this file silently refuses.
 */
const CATEGORIES = new Set<ExpenseCategory>(EXPENSE_CATEGORIES)
const METHODS = new Set<PaymentMethod>(PAYMENT_METHODS)

/**
 * The shape `<input type="date">` submits, and the shape a `date` column takes.
 *
 * Not a full calendar check — 2026-02-31 gets past this and is refused by Postgres — but
 * the two failures that matter are the two this catches cheaply: an empty field, and a
 * value from something that is not a date input at all.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Before this, nobody was running a coaching centre with software.
 *
 * A floor on `spent_on` so a mistyped year cannot write a row into a month no screen will
 * ever show. Deliberately far back rather than "this year": a centre entering last
 * December's electricity bill in January is ordinary, and a floor that argued with them
 * would be a wrong refusal on a right entry.
 */
const EARLIEST_SPEND = '2000-01-01'

/**
 * The caller, or the sentence to show somebody who is not allowed to be one.
 *
 * The same conversion the notices and settings actions do: the require* helpers throw and
 * a form wants a sentence. One message for both refusals — not signed in, and signed in
 * as a teacher — because they are the same answer from the reader's side.
 *
 * A read-only centre gets its own sentence out of `authRefusal`, and must: an owner whose
 * plan has lapsed is not somebody who "cannot open this", and writing down what the
 * centre spent is not a thing we should be charging for at the moment it matters.
 *
 * AND THE PLAN IS CHECKED HERE, not only on the screen. `centerWideReporting` is what
 * gates the spending ledger, and the locked card the page draws for a plan without it is
 * a sentence rather than a fence: this action is a public HTTP endpoint, so a centre on a
 * teacher plan could post the form's fields to it and write rows into a ledger it cannot
 * open — rows that `center_profit_month` would then subtract from a profit line it also
 * cannot open. Nothing leaks and no entitlement is raised, but a feature that has not
 * been bought would be writing to the record, and the write is the part nobody can undo:
 * 20260811000045 revoked DELETE. The same flag and the same argument as ../payroll's own
 * caller, which is where the choice of flag is set out at length.
 *
 * THEN THE `expenses` CAPABILITY (§6.2), before the plan flag rather than after it, so the
 * manager who was never given the spending book is told that and not told to upgrade. Both
 * sentences are true for them; only one names something they can get.
 */
async function caller(): Promise<CenterSession | ExpenseState> {
  let session: CenterSession
  try {
    session = requireCapability('expenses', requireWritable(await requireRole('manager')))
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: await authRefusal(err, (d) => d.denied.title) }
    }
    throw err
  }
  if (!has(session.plan, 'centerWideReporting')) {
    return { error: dict(session.locale).expenses.errors.needsCenter }
  }
  return session
}

function isSession(value: CenterSession | ExpenseState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Puts one expense on the centre's record.
 *
 * `branch_id` COMES FROM THE FORM NOW, where the form had anything to ask. This
 * docstring used to say the column was left null because nothing in `src/` read
 * `branches` yet and writing one here would be inventing a boundary the rest of the app
 * did not enforce. Three steps closed that: the branches screen let somebody type a
 * building, 20260811000053 made the column mean who may read the row, and 20260811000054
 * files a new row under the branch of whoever wrote it. So the null is still the answer
 * for a single-building centre and for a manager pinned to one — the stamp fills theirs —
 * and the head office of an institution is asked, because head office is the one desk
 * that is not in any building and the electricity bill it is holding belongs to one.
 *
 * Passed through unchecked, per createStudent's own insert: `expenses_branch_scope` and
 * the composite foreign key from 20260811000005 are the boundary, and a second copy of
 * either rule in this file would be the copy that goes stale — as the paragraph above
 * just demonstrated.
 *
 * WHAT IT DECIDES IS WHICH BUILDING LOOKS PROFITABLE. §8.3's comparison table takes each
 * branch's spending off this column, so rent filed at head office is rent no building
 * pays and a branch that looks better than it is.
 *
 * `recorded_by` is the caller, from the session and never from the form. It is `on delete
 * set null`, so a manager who leaves takes their name off the row without taking the money
 * off the month.
 *
 * The voucher number is not sent and cannot be: it is assigned by a BEFORE INSERT trigger
 * under an advisory lock (20260811000045), which is what lets a rolled-back insert burn no
 * number. It comes back out of the insert rather than being read afterwards, because a
 * second query would be a guess at which row was ours.
 */
export async function recordExpense(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).expenses
  const centerId = session.active.centerId

  const category = String(formData.get('category') ?? '')
  if (!CATEGORIES.has(category as ExpenseCategory)) {
    return { error: t.errors.categoryRequired }
  }

  // parseTaka reads Bangla digits, thousands separators and a stray ৳, and returns null
  // for anything it cannot read as a number — which is how "they typed nonsense" is told
  // apart from "they typed zero" two lines down.
  const amount = parseTaka(String(formData.get('amount') ?? ''))
  if (amount === null) return { error: t.errors.amountRequired }
  // The table's own `check (amount_bdt <> 0)`, caught here so the owner reads a sentence
  // about their entry instead of a constraint name.
  if (amount === 0) return { error: t.errors.amountZero }
  // On the magnitude, not the value: a correction is a negative row, and -৳99,999,999 is
  // as far out of range as the same figure the other way.
  if (Math.abs(amount) > MAX_TAKA) return { error: t.errors.amountTooLarge }

  const spentOn = String(formData.get('spentOn') ?? '').trim()
  if (!DATE_RE.test(spentOn)) return { error: t.errors.dateRequired }
  if (spentOn < EARLIEST_SPEND) return { error: t.errors.dateTooOld }
  // String comparison, because both sides are YYYY-MM-DD and in that shape lexicographic
  // order is chronological order. Today in Dhaka and not in UTC: for six hours every
  // evening those are different days, and the one the owner means is theirs.
  if (spentOn > todayInDhaka()) return { error: t.errors.dateFuture }

  const method = String(formData.get('method') ?? '')
  if (!METHODS.has(method as PaymentMethod)) return { error: t.errors.methodRequired }

  const reference = clamp(String(formData.get('reference') ?? '').trim(), MAX_LABEL)
  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)
  const recurring = formData.get('recurring') === 'on'

  // Absent, truncated or malformed is null, which records the expense with no retry
  // protection rather than refusing it. See lib/idempotency.ts for why that is the right
  // way round even here, where nobody is standing at the desk waiting.
  const key = readIdempotencyKey(formData.get('idempotencyKey'))

  const supabase = await createClient()

  const { data: written, error: writeError } = await supabase
    .from('expenses')
    .insert({
      coaching_center_id: centerId,
      category: category as ExpenseCategory,
      amount_bdt: amount,
      spent_on: spentOn,
      method: method as PaymentMethod,
      reference: reference || null,
      note: note || null,
      recurring,
      recorded_by: session.userId,
      idempotency_key: key,
      branch_id: postedBranchId(formData),
    })
    .select('voucher_no')
    .single()

  let voucherNo: number

  if (writeError) {
    // The one error that is not a failure: 20260811000050's unique index refusing a second
    // row for a submit already on the record. Guarded on `key` as well as the code, because
    // without a key that index cannot be the one that fired and a 23505 from somewhere else
    // — the voucher-number index, if the trigger's max() ever came out low — is a genuine
    // failure that must not be reported as a save.
    if (!key || writeError.code !== UNIQUE_VIOLATION) return { error: t.errors.failed }

    const { data: existing } = await supabase
      .from('expenses')
      .select('voucher_no')
      .eq('coaching_center_id', centerId)
      .eq('idempotency_key', key)
      .maybeSingle()

    /*
     * The read-back failed, and this is the one branch where "it did not save" would write
     * a second permanent row.
     *
     * Getting here means the index already refused the insert, which is proof that a row
     * carrying this key is in the table: the money is recorded and only its voucher number
     * is unknown. An owner told "this could not be saved" types it again — and a fresh form
     * mints a fresh key, so the index has nothing to refuse and the month is short by
     * nothing and long by one rent. `expenses` revokes DELETE, so that duplicate is
     * permanent and the profit figure is wrong until somebody writes a minus row.
     *
     * So it says "almost certainly saved, go and look" instead, and revalidates on the way
     * out — the row it is sending them to look at was written by a request this one knows
     * nothing about, and the cached page predates it.
     */
    if (!existing) {
      revalidatePath('/expenses')
      return { error: t.errors.savedUnknown }
    }

    voucherNo = existing.voucher_no
  } else {
    voucherNo = written.voucher_no
  }

  revalidatePath('/expenses')
  // The same confirmation whether this was the first arrival or the fourth. Telling an
  // owner their expense was "already recorded" would read as a warning that they had paid
  // the rent twice, which is not what happened and not what the sentence is for.
  return { ok: t.savedVoucher(voucherNo) }
}
