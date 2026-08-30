'use server'

/**
 * Handing over a salary, and writing down that it went.
 *
 * THE THIRD TERM OF THE PROFIT LINE, ACTUALLY WRITTEN. ../actions.ts records what a centre
 * has agreed to pay; that is a standing figure and no money has moved. This is the row
 * 20260811000049's `center_profit_month` subtracts — `sum(amount_bdt)` grouped by
 * `for_month` — so until this action existed, the payroll side of §9.8 was structurally
 * zero and an owner reading `collected − rent` as profit was being told they made money
 * they had not.
 *
 * THE MONTH IS `for_month`, WHICH THE FORM SENDS AND THE CLOCK DOES NOT DECIDE. December's
 * salary handed over in January is December's cost. If this action stamped the month from
 * the server clock, a centre that pays on the 3rd would have every salary land in the wrong
 * month and every January would read as a disaster. So the month comes off the screen the
 * owner is looking at, is checked against a regex and both ends of a range, and never comes
 * from `now()`.
 *
 * "ALREADY PAID" IS NOT CHECKED HERE, AND THAT IS THE DESIGN. 20260811000044 deliberately
 * has no unique index on (payee, for_month): half a salary on the 5th and half on the 20th
 * is two real rows, and the only correction this table permits is a third one with a minus
 * sign. So a second payment for a month is legitimate and this action must not refuse it.
 * What stops an owner paying twice by accident is the screen — every row prints what is
 * already on the record for that month before the form opens — and what stops one tap
 * becoming two payments is the idempotency token, which is a different question with a
 * different answer.
 *
 * SOMEBODY WHO HAS LEFT MAY BE PAID, unlike ../actions.ts, where agreeing a figure with
 * them is refused. The asymmetry is the point: a final settlement after somebody leaves is
 * an ordinary act and often the last thing a centre owes them, while a new agreement with
 * somebody switched off is either the wrong person picked or a rehiring nobody recorded.
 *
 * NOTHING HERE EDITS OR DELETES. 20260811000044 revokes UPDATE and DELETE on
 * `salary_payments` from `authenticated` outright, hands back `(reference, note)` alone, and
 * puts a trigger behind the grant — so a figure typed wrong is corrected by a second row
 * with a minus amount, which is the same rule the fee side has had since 20260811000017.
 *
 * STAFF-ADMIN ONLY, re-checked here, matching `salary_payments_staff_admin_write` exactly.
 * A Server Action is a public HTTP endpoint and the page's `forbidden()` is a redirect, not
 * a fence. The plan half has nothing behind it — no trigger knows what a centre bought — so
 * it is checked here or it is not checked at all.
 */
import { revalidatePath } from 'next/cache'

import {
  requireRole,
  requireWritable,
  authRefusal,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { currentPeriodMonth } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { readIdempotencyKey, UNIQUE_VIOLATION } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { MAX_TAKA, parseTaka, sumTaka } from '@/lib/money'
import { readPayeeValue, type PayeeKind } from '@/lib/payroll/bill'
import { PAYMENT_METHODS } from '@/lib/fees/methods'
import { has } from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import type { PaymentMethod } from '@/lib/supabase/types'

export type PayState = { error?: string; ok?: string } | null

/**
 * A membership test rather than a cast, built from the canonical list.
 *
 * The same list a fee payment uses, because it is the same question — and a `method` cast
 * from the form would reach Postgres as `22P02` on the enum, which is "something went wrong"
 * on the screen. The list carries a compile-time check that it holds every value of
 * `payment_method`, so a fourth wallet added in a migration fails the build in
 * lib/fees/methods.ts rather than arriving here as a value this file silently refuses.
 */
const METHODS = new Set<PaymentMethod>(PAYMENT_METHODS)

/** A month is its first day, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/** Nobody was paid by a coaching centre running this app before then. */
const EARLIEST_MONTH = '2000-01-01'

/**
 * The caller, or the sentence to show somebody who may not be one.
 *
 * Written out again rather than shared with ../actions.ts, and that is a rule about
 * `'use server'` rather than a preference: every export of this module is a public HTTP
 * endpoint, so exporting a helper that returns a session would publish an endpoint handing
 * out `userId`, plan and centre to anybody who can POST. Each action module carries its own,
 * as expenses, notices and settings all do.
 *
 * Two refusals, different in kind. The role check is a fence and `authRefusal` writes its
 * sentence, including the separate one a lapsed subscription gets. The plan check is an
 * entitlement, and its sentence names what is missing rather than saying "not allowed": an
 * owner on a teacher plan who reached this endpoint is not doing anything wrong.
 */
async function caller(): Promise<CenterSession | PayState> {
  let session: CenterSession
  try {
    session = requireWritable(await requireRole('manager'))
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: await authRefusal(err, (d) => d.denied.title) }
    }
    throw err
  }

  if (!has(session.plan, 'centerWideReporting')) {
    return { error: dict(session.locale).payrollPay.errors.needsCenter }
  }
  return session
}

function isSession(value: CenterSession | PayState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * One of the three optional parts: blank is zero, nonsense is null.
 *
 * Blank and zero are the same thing here for the reason ../actions.ts gives — most salaries
 * are a single number and an owner who leaves allowances empty has said "none" — and
 * nonsense is a refusal rather than a zero, because a ৳1,500 allowance typed as `1,5OO`
 * silently becoming nothing is a salary short by ৳1,500 that nobody will ever look for.
 */
function part(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? '').trim()
  if (!text) return 0
  return parseTaka(text)
}

/**
 * Whether this centre has such a person.
 *
 * Read before the insert, and not out of caution: the composite foreign key would refuse an
 * id from another centre anyway, but as `23503` with a constraint name in it, which this file
 * could only report as "it did not save".
 *
 * Only whether they exist, unlike ../actions.ts, which also refuses somebody switched off.
 * See the header: a final settlement after somebody leaves is an ordinary payment.
 *
 * Two branches and not one computed table name, because `from(kind === 'employee' ? … : …)`
 * hands the client a union it cannot narrow. A malformed id reads as missing rather than as a
 * failure: `maybeSingle` hands back no row and an error Postgres raised on the uuid cast, and
 * "this centre has no such person" is the true statement about a value that cannot name one.
 */
async function payeeExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  centerId: string,
  kind: PayeeKind,
  id: string,
): Promise<boolean> {
  if (kind === 'employee') {
    const { data } = await supabase
      .from('employees')
      .select('id')
      .eq('id', id)
      .eq('coaching_center_id', centerId)
      .maybeSingle()

    return data !== null
  }

  const { data } = await supabase
    .from('teachers')
    .select('id')
    .eq('id', id)
    .eq('coaching_center_id', centerId)
    .maybeSingle()

  return data !== null
}

/**
 * Records one salary paid, for one month, to one person.
 *
 * THE FOUR PARTS AND NOT ONE AMOUNT, because `amount_bdt` is generated from them and a
 * payslip has to be able to say what the figure was made of. The form prefills them from the
 * live agreement, so the ordinary case is four boxes nobody touches; the box that actually
 * varies month to month is `deductions`, which is what an absence or a recovered advance
 * lands in.
 *
 * A NEGATIVE PART IS ALLOWED AND A NEGATIVE DEDUCTION IS NOT. 20260811000044 puts no
 * non-negative check on these columns on purpose — the reversing correction its guard trigger
 * names has to be writable — so the signed boxes are how a wrong payment is undone. The
 * deduction is the one box where a minus sign is always a mistake: it is subtracted by the
 * generated column, so typing it negative adds to the salary. A reversal is a single negative
 * figure, not a mirror of the original's composition.
 *
 * `branch_id` is not written, and cannot be: `salary_payments` has no such column.
 * 20260811000049 records why that matters — three of the four sides of §8.3's per-branch
 * profit line exist and this is the missing one — and that it needs its own migration on
 * 20260811000047's argument, because a join through the employee would rewrite which branch
 * paid last year's salaries.
 *
 * `paid_by` is the caller, from the session and never from the form. It is `on delete set
 * null`, so a manager who leaves takes their name off the voucher without taking the money
 * off the month. `paid_at` is left to its default: the month is what the profit line reads,
 * and the timestamp is bookkeeping for the order of a register.
 *
 * The voucher number is not sent and cannot be: it is assigned by a BEFORE INSERT trigger
 * under an advisory lock, which is what lets a rolled-back insert burn no number. It comes
 * back out of the insert rather than being read afterwards, because a second query would be a
 * guess at which row was ours.
 */
export async function paySalary(
  _prev: PayState,
  formData: FormData,
): Promise<PayState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).payrollPay
  const centerId = session.active.centerId

  const payee = readPayeeValue(String(formData.get('payee') ?? ''))
  if (!payee) return { error: t.errors.payeeRequired }

  const forMonth = String(formData.get('forMonth') ?? '').trim()
  if (!MONTH_RE.test(forMonth)) return { error: t.errors.monthRequired }
  if (forMonth < EARLIEST_MONTH) return { error: t.errors.monthTooOld }
  // String comparison of two YYYY-MM-01, where lexicographic order is chronological order.
  // No future months: a salary filed forward puts cost into a month whose profit line is not
  // due yet, and the picker only offers this month and the eleven before it.
  if (forMonth > currentPeriodMonth()) return { error: t.errors.monthFuture }

  // parseTaka reads Bangla digits, thousands separators and a stray ৳, and returns null for
  // anything it cannot read as a number — which is how "they typed nonsense" is told apart
  // from "they typed zero" further down.
  const basic = parseTaka(String(formData.get('basic') ?? ''))
  if (basic === null) return { error: t.errors.amountRequired }

  const allowances = part(formData.get('allowances'))
  const other = part(formData.get('other'))
  const deductions = part(formData.get('deductions'))
  if (allowances === null || other === null || deductions === null) {
    return { error: t.errors.partUnreadable }
  }

  // Only the deduction. See the header: the other three are signed so a wrong payment can be
  // reversed, and this one negative would add to the salary instead of coming off it.
  if (deductions < 0) return { error: t.errors.deductionsNegative }

  const four = [basic, allowances, other, deductions]
  // On the magnitude, not the value: a reversal of ৳13,000 is as far out of range at
  // -৳99,999,999 as the same figure the other way.
  if (four.some((n) => Math.abs(n) > MAX_TAKA)) return { error: t.errors.amountTooLarge }

  // The same arithmetic the generated column will do, done once here to check it — not
  // stored, and not what any screen reads back.
  const net = sumTaka([basic, allowances, other, -deductions])
  // The table's own `check (basic + allowances + other - deductions <> 0)`, caught here so an
  // owner reads a sentence about their entry instead of a constraint name. An empty form is
  // the common way to arrive at zero, and "nothing was paid" is not a payment.
  if (net === 0) return { error: t.errors.netZero }
  if (Math.abs(net) > MAX_TAKA) return { error: t.errors.amountTooLarge }

  const method = String(formData.get('method') ?? '')
  if (!METHODS.has(method as PaymentMethod)) return { error: t.errors.methodRequired }

  const reference = clamp(String(formData.get('reference') ?? '').trim(), MAX_LABEL)
  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)

  // Absent, truncated or malformed is null, which records the payment with no retry
  // protection rather than refusing it. See lib/idempotency.ts for why that is the right way
  // round: the money is already out of the drawer.
  const key = readIdempotencyKey(formData.get('idempotencyKey'))

  const supabase = await createClient()

  if (!(await payeeExists(supabase, centerId, payee.kind, payee.id))) {
    return { error: t.errors.payeeNotFound }
  }

  const { data: written, error: writeError } = await supabase
    .from('salary_payments')
    .insert({
      coaching_center_id: centerId,
      // Exactly one of the pair, which `salary_payments_one_payee` enforces. The kind decides
      // which, and it came out of one picker value rather than two fields the browser could
      // disagree about.
      employee_id: payee.kind === 'employee' ? payee.id : null,
      teacher_id: payee.kind === 'teacher' ? payee.id : null,
      for_month: forMonth,
      basic_bdt: basic,
      allowances_bdt: allowances,
      other_bdt: other,
      deductions_bdt: deductions,
      // `gross_bdt` and `amount_bdt` are not here at all: they are generated columns, and
      // writing to one is an error rather than a duplicated sum.
      method: method as PaymentMethod,
      reference: reference || null,
      note: note || null,
      paid_by: session.userId,
      idempotency_key: key,
    })
    .select('voucher_no')
    .single()

  let voucherNo: number

  if (writeError) {
    // The one error that is not a failure: 20260811000051's unique index refusing a second row
    // for a submit already on the record. Guarded on `key` as well as the code, because
    // without a key that index cannot be the one that fired, and a 23505 from somewhere else —
    // the voucher-number index, if the trigger's max() ever came out low — is a genuine
    // failure that must not be reported as a payment.
    if (!key || writeError.code !== UNIQUE_VIOLATION) return { error: t.errors.failed }

    const { data: existing } = await supabase
      .from('salary_payments')
      .select('voucher_no')
      .eq('coaching_center_id', centerId)
      .eq('idempotency_key', key)
      .maybeSingle()

    /*
     * The read-back failed, and this is the one branch where "it did not save" would write a
     * second permanent row.
     *
     * Getting here means the index already refused the insert, which is proof that a row
     * carrying this key is in the table: the salary is recorded and only its voucher number is
     * unknown. An owner told "this could not be saved" pays again — and a fresh form mints a
     * fresh key, so the index has nothing to refuse and the month is long by one salary.
     * `salary_payments` revokes DELETE, so that duplicate is permanent, the profit line is
     * wrong until somebody writes a reversing row, and two vouchers exist for one payment.
     *
     * So it says "almost certainly paid, go and look" instead, and revalidates on the way out —
     * the row it is sending them to look at was written by a request this one knows nothing
     * about, and the cached page predates it.
     */
    if (!existing) {
      revalidatePath('/payroll/pay')
      return { error: t.errors.savedUnknown }
    }

    voucherNo = existing.voucher_no
  } else {
    voucherNo = written.voucher_no
  }

  revalidatePath('/payroll/pay')
  // The same confirmation whether this was the first arrival or the fourth. Telling an owner
  // the salary was "already paid" would read as a warning that they had paid it twice, which
  // is not what happened and not what the sentence is for.
  return { ok: t.savedVoucher(voucherNo) }
}
