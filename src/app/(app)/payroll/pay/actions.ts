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
 * "ALREADY PAID" IS A READ AND A TICK, NOT A CONSTRAINT. 20260811000044 deliberately has
 * no unique index on (payee, for_month): half a salary on the 5th and half on the 20th is
 * two real rows, and the only correction this table permits is a third one with a minus
 * sign. So a second payment for a month is legitimate and this action must not refuse it.
 * What stops one tap becoming two payments is the idempotency token; what stops a second
 * full salary paid by accident is `needsRepeatConfirmation` — a payment that would take the
 * month past the live monthly agreement is refused until the form says it was meant. The
 * tick is something an advance, a bonus or a settlement can give and a duplicate cannot,
 * and the form shows it on every row that already has money on the month, so the refusal
 * can never be a dead end. The screen still prints paid, agreed and left above every form:
 * this fence is for the owner who does not read it.
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
  requireCapability,
  authRefusal,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { currentPeriodMonth } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { readIdempotencyKey, UNIQUE_VIOLATION } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { formatTaka, MAX_TAKA, parseTaka, sumTaka } from '@/lib/money'
import { MONTHLY_BASIS } from '@/lib/payroll/basis'
import { readPayeeValue, type PayeeKind } from '@/lib/payroll/bill'
import { needsRepeatConfirmation } from '@/lib/payroll/month'
import { PAYMENT_METHODS } from '@/lib/fees/methods'
import { has } from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import type { PaymentMethod } from '@/lib/supabase/types'

/**
 * The sentence, and the row it is about.
 *
 * `receipt` is the half this action was missing, and the complaint that produced it was
 * exact: the confirmation said "Paid. Voucher no. 1042." and stopped, so the manager holding
 * a form and a person waiting at the desk had to scroll to the register and guess that the
 * underlined number in it was tappable. The id travels the way the fee actions' does — one
 * narrow field, only ever on success — and the row turns it into the button that opens the
 * payslip, which is where the Print button lives.
 */
export type PayState =
  | { error?: string; ok?: string; receipt?: { id: string; no: number } }
  | null

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
 *
 * `payroll` too (§6.2), the same word as ../actions.ts because it is the same book: that
 * file agrees what a person is owed and this one hands it over. A narrowing that covered
 * one and not the other would be a manager who can raise a salary they cannot pay.
 */
async function caller(): Promise<CenterSession | PayState> {
  let session: CenterSession
  try {
    session = requireCapability('payroll', requireWritable(await requireRole('manager')))
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
 * `branch_id` is not sent, and must not be: 20260811000052 added the column and stamps it
 * in a BEFORE INSERT trigger from the payee's own branch. That is deliberate rather than
 * incidental — a value this file supplied is a value the month salary run forgets, and the
 * forgetting is silent, since a null branch is not an error but a salary missing from one
 * row of §8.3's comparison. Once stamped it never moves: a teacher transferred in July does
 * not take last year's wage bill to their new branch.
 *
 * `paid_by` is the caller, from the session and never from the form. It is `on delete set
 * null`, so a manager who leaves takes their name off the voucher without taking the money
 * off the month. `paid_at` is left to its default: the month is what the profit line reads,
 * and the timestamp is bookkeeping for the order of a register. * 
 * The voucher number is not sent and cannot be: it is assigned by a BEFORE INSERT trigger
 * under an advisory lock, which is what lets a rolled-back insert burn no number. It comes
 * back out of the insert rather than being read afterwards, because a second query would be a
 * guess at which row was ours — and the row's id comes back with it, so the screen can offer
 * the payslip without the register being re-read.
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

  // The payee's column in both tables, chosen from the one picker value so the two reads
  // below and the insert cannot disagree about which half of the pair this is.
  const payeeColumn = payee.kind === 'employee' ? 'employee_id' : 'teacher_id'

  /*
   * What this month already holds for them, and what a monthly agreement says it should.
   *
   * Read before the insert because these two figures are the only place a repeated salary
   * can be told apart from a genuine instalment — see needsRepeatConfirmation. Failing
   * closed on either read: a guard that could not be read must not let an overpayment
   * through, and `salary_payments` revokes DELETE, so the mistake would be permanent.
   *
   * A replay's own row is left out of the sum. A retry of the first payment carries the key
   * already on the record, and counting it would make the replay look like a second payment
   * and refuse it — the one request the idempotency index exists to answer with the voucher
   * written the first time.
   */
  const [paidRows, termsRow] = await Promise.all([
    supabase
      .from('salary_payments')
      .select('amount_bdt, idempotency_key')
      .eq('coaching_center_id', centerId)
      .eq('for_month', forMonth)
      .eq(payeeColumn, payee.id),
    supabase
      .from('salary_terms')
      .select('basis, net_bdt')
      .eq('coaching_center_id', centerId)
      .eq('active', true)
      .eq(payeeColumn, payee.id)
      .maybeSingle(),
  ])

  if (paidRows.error || termsRow.error) return { error: t.errors.failed }

  const alreadyPaid = sumTaka(
    (paidRows.data ?? [])
      .filter((row) => !key || row.idempotency_key !== key)
      .map((row) => Number(row.amount_bdt ?? 0)),
  )
  // Null on a per-class agreement — 20260811000044 refuses to store a monthly figure for
  // one — and null when there is no live agreement at all. Both are nothing to measure
  // against; see needsRepeatConfirmation.
  const agreedNet =
    termsRow.data && termsRow.data.basis === MONTHLY_BASIS
      ? Number(termsRow.data.net_bdt ?? 0)
      : null

  /*
   * The fence itself. A payment that would take the month past the agreed figure is
   * refused in words unless the form carried the explicit tick — which is what makes the
   * second full salary that used to be one tap into a deliberate choice, while the second
   * half of a salary stays an ordinary payment. A negative row is never refused: a
   * reversing correction is the only way this table permits a mistake to be put right.
   */
  if (
    needsRepeatConfirmation({
      agreedNet,
      alreadyPaid,
      amount: net,
      confirmed: formData.get('confirmRepeat') === 'on',
    })
  ) {
    // Revalidated on the way out for the same reason the read-back failure below is: the
    // refusal names the confirmation tick, and a page rendered before the payment this
    // refusal was measured against is not drawing it. Refreshing first is what keeps the
    // sentence's one instruction reachable from the screen it is printed on.
    revalidatePath('/payroll/pay')
    return {
      error: t.errors.repeatConfirm(formatTaka(alreadyPaid), formatTaka(agreedNet ?? 0)),
    }
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
    // The id as well as the number: the number is what the sentence says, and the id is what
    // the slip is fetched by, so both come out of the one insert rather than a second read.
    .select('id, voucher_no')
    .single()

  let voucherNo: number
  let paymentId: string

  if (writeError) {
    // The one error that is not a failure: 20260811000051's unique index refusing a second row
    // for a submit already on the record. Guarded on `key` as well as the code, because
    // without a key that index cannot be the one that fired, and a 23505 from somewhere else —
    // the voucher-number index, if the trigger's max() ever came out low — is a genuine
    // failure that must not be reported as a payment.
    if (!key || writeError.code !== UNIQUE_VIOLATION) return { error: t.errors.failed }

    const { data: existing } = await supabase
      .from('salary_payments')
      .select('id, voucher_no')
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
    paymentId = existing.id
  } else {
    voucherNo = written.voucher_no
    paymentId = written.id
  }

  revalidatePath('/payroll/pay')
  // The same confirmation whether this was the first arrival or the fourth. Telling an owner
  // the salary was "already paid" would read as a warning that they had paid it twice, which
  // is not what happened and not what the sentence is for.
  //
  // The receipt travels with it, and on the replay branch above it is the row the first
  // arrival wrote — the same slip, not a second one, which is the whole point of the
  // idempotency index.
  return { ok: t.savedVoucher(voucherNo), receipt: { id: paymentId, no: voucherNo } }
}
