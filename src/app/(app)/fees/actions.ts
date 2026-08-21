'use server'

/**
 * The fee board's writes: raise this month's invoices, record money that came
 * in, and note that a parent was chased.
 *
 * This is the screen the product is sold on, so all three are built around being
 * run by a person who is interrupted. Generating invoices is safe to run twice.
 * Recording a payment names the student in its confirmation, because an owner
 * holding cash across a desk needs to see that it landed on the right child
 * before the next parent starts talking. Logging a reminder never blocks the tap
 * that opens the messaging app.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import {
  requireRole,
  getSession,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { parseTaka, formatTaka, sumTaka } from '@/lib/money'
import { currentPeriodMonth } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import type { FeeReminderChannel, PaymentMethod } from '@/lib/supabase/types'

export type FeeState = {
  error?: string
  ok?: string
  /** Set when the write succeeded but the owner should read something first. */
  warn?: string
  /**
   * The slip that was just created, for the link the row shows next to its
   * confirmation. Both halves travel: the id is what /fees/receipt needs, and the
   * number is what the owner reads out to the parent standing in front of them
   * before anything has been printed.
   *
   * Only ever set on success. A row that showed a receipt link after a failed write
   * would be offering to print a payment that does not exist.
   */
  receipt?: { id: string; no: number }
} | null

/** Cash and the three mobile wallets an owner will actually be handed money in. */
const METHODS = new Set<PaymentMethod>([
  'cash',
  'bkash',
  'nagad',
  'rocket',
  'bank_transfer',
  'other',
])

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/


/**
 * Fees are owner-and-manager work. A teacher with can_view_fees may read the
 * board, but recording money is not something the permission grants — a teacher
 * who could enter payments could write off a fee, and that is the owner's money.
 */
async function feeAdmin(): Promise<CenterSession | FeeState> {
  try {
    return await requireRole('manager')
  } catch (err) {
    if (err instanceof AuthError) {
      // No session at all, or one whose role is wrong — either way there is no
      // `session.locale` to read. getSession is memoised per request and was
      // already called by requireRole above, so this costs nothing.
      const caller = await getSession()
      const d = dict(caller?.locale ?? DEFAULT_LOCALE)
      return { error: d.fees.errors.forbidden }
    }
    throw err
  }
}

function isSession(value: CenterSession | FeeState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Raises invoices for a month, one per active enrollment.
 *
 * Per enrollment, not per student, because the product charges by subject: a
 * student taking Physics and Chemistry owes two fees and may drop one of them
 * mid-term. The unique key on (enrollment_id, period_month) is what makes this
 * safe to press twice — the second press inserts nothing and says so, which is
 * the behaviour an owner who lost signal halfway needs.
 *
 * Batches priced at zero are skipped rather than invoiced for ৳0. A centre uses
 * a free batch for a trial week or a scholarship student, and sending that
 * family a bill for nothing is worse than sending them nothing.
 */
export async function generateInvoices(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const session = await feeAdmin()
  if (!isSession(session)) return session

  // The whole group, not just `errors`: the confirmation names a count and a total,
  // so the sentence is written here and travels finished. A function cannot cross
  // into the form that shows it.
  const t = dict(session.locale).fees

  const rawMonth = String(formData.get('periodMonth') ?? '')
  const periodMonth = MONTH_RE.test(rawMonth) ? rawMonth : currentPeriodMonth()

  // Which day of the month the fee is due. Coaching centres in Bangladesh
  // conventionally want it in the first third of the month; 10 is the default
  // the form offers, and anything outside 1–28 is refused rather than clamped,
  // because a due date of the 31st silently becoming the 28th in February is
  // the kind of surprise that shows up in a phone call from a parent.
  const rawDueDay = Number(formData.get('dueDay') ?? 10)
  if (!Number.isInteger(rawDueDay) || rawDueDay < 1 || rawDueDay > 28) {
    return { error: t.errors.dueDayRange }
  }
  const dueDate = `${periodMonth.slice(0, 7)}-${String(rawDueDay).padStart(2, '0')}`

  const supabase = await createClient()

  // RLS already limits this to the caller's centre; the explicit filter keeps
  // the query honest if a future policy is ever loosened.
  const { data: enrollments, error: rosterError } = await supabase
    .from('enrollments')
    .select('id, student_id, batches (monthly_fee_bdt)')
    .eq('coaching_center_id', session.active.centerId)
    .eq('status', 'active')

  if (rosterError) {
    return { error: t.errors.rosterUnreadable }
  }

  const billable = (enrollments ?? [])
    .map((e) => {
      const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches
      return { id: e.id, studentId: e.student_id, fee: Number(batch?.monthly_fee_bdt ?? 0) }
    })
    .filter((e) => Number.isFinite(e.fee) && e.fee > 0)

  if (billable.length === 0) {
    return { error: t.errors.nothingToBill }
  }

  // ignoreDuplicates makes this an insert-what-is-missing rather than an
  // overwrite. Deliberate: an invoice already raised may have been discounted or
  // part-paid, and regenerating the month must never reset that.
  const { data: inserted, error: insertError } = await supabase
    .from('fee_invoices')
    .upsert(
      billable.map((e) => ({
        coaching_center_id: session.active.centerId,
        student_id: e.studentId,
        enrollment_id: e.id,
        period_month: periodMonth,
        amount_bdt: e.fee,
        due_date: dueDate,
      })),
      { onConflict: 'enrollment_id,period_month', ignoreDuplicates: true },
    )
    .select('id, amount_bdt')

  if (insertError) {
    return { error: t.errors.invoicesFailed }
  }

  const count = inserted?.length ?? 0
  const total = sumTaka((inserted ?? []).map((i) => Number(i.amount_bdt)))

  revalidatePath('/fees')
  revalidatePath('/dashboard')

  if (count === 0) {
    return { ok: t.invoicesAllExisted }
  }

  return { ok: t.invoicesCreated(count, formatTaka(total)) }
}

/**
 * Records money received against one invoice.
 *
 * Cash leaves the reference field empty on purpose. Some owners will not put
 * every payment through bKash, for reasons that are theirs, and a tool that
 * forces a transaction id for every taka is a tool they stop using in week two.
 *
 * Overpayment is allowed but reported. A parent settling two months at once is
 * ordinary; 15000 typed where 1500 was meant is a typo. Blocking the first to
 * catch the second would be wrong, so both go through and the owner is told
 * what the family is now in credit for.
 */
export async function recordPayment(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const session = await feeAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).fees

  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId) return { error: t.errors.noInvoice }

  const amount = parseTaka(String(formData.get('amount') ?? ''))
  if (amount === null) return { error: t.errors.amountUnreadable }
  if (amount === 0) return { error: t.errors.amountZero }
  // Refunds exist in the schema as negative payments and the board's arithmetic
  // handles them, but there is no refund button yet, so a negative here is a
  // mistyped amount rather than an intention.
  if (amount < 0) return { error: t.errors.amountNegative }

  const rawMethod = String(formData.get('method') ?? 'cash') as PaymentMethod
  const method = METHODS.has(rawMethod) ? rawMethod : 'cash'

  // Both clamped rather than refused, for the reason `clamp` gives: the form
  // caps them, so a longer one is not the form. A transaction id is checked
  // against a bKash SMS, so a truncated one is visibly wrong to the person who
  // typed it — which is the right kind of wrong.
  const reference = clamp(String(formData.get('reference') ?? '').trim(), MAX_LABEL)
  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)

  const supabase = await createClient()

  // Read the invoice through the balance view rather than trusting the form.
  // Three things come from this and none of them can come from the client: that
  // the invoice is real and in this centre (RLS decides), which student the
  // payment belongs to, and what was still owed a moment ago.
  const { data: invoice } = await supabase
    .from('fee_invoice_balances')
    .select('id, student_id, student_name, remaining_bdt, voided_at')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoiceId)
    .maybeSingle()

  // A view's columns are all nullable as far as Postgres can prove, so the id
  // and the student have to be narrowed here rather than asserted. They cannot
  // actually be null — both are NOT NULL on fee_invoices — but a missing one
  // would mean the row is not what we think it is, and that is the same answer
  // as not finding it.
  if (!invoice?.id || !invoice.student_id) return { error: t.errors.invoiceMissing }
  if (invoice.voided_at) return { error: t.errors.invoiceVoided }

  // The number comes back rather than being asked for afterwards: it is assigned by
  // a trigger under an advisory lock (20260811000017), so a second query would be a
  // guess at which row was ours. `single()` is safe here for the reason it usually
  // is not — one row was inserted, so exactly one comes back or the insert failed.
  const { data: payment, error: paymentError } = await supabase
    .from('fee_payments')
    .insert({
      coaching_center_id: session.active.centerId,
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      amount_bdt: amount,
      method,
      reference: reference || null,
      note: note || null,
      received_by: session.userId,
    })
    .select('id, receipt_no')
    .single()

  if (paymentError) {
    return { error: t.errors.paymentFailed }
  }

  const receipt = { id: payment.id, no: payment.receipt_no }

  revalidatePath('/fees')
  revalidatePath('/dashboard')
  revalidatePath('/me')

  const wasOwed = Number(invoice.remaining_bdt ?? 0)
  const stillOwed = sumTaka([wasOwed, -amount])
  // A view cannot prove student_name is not null, though fee_invoices says it is.
  // 'অজানা' beside a figure is visibly wrong and gets asked about; 'undefined' is
  // not a word in either language.
  const name = invoice.student_name ?? dict(session.locale).common.unknown
  const paid = formatTaka(amount)

  if (stillOwed > 0) {
    return {
      ok: t.received(name, paid),
      warn: t.stillOwed(formatTaka(stillOwed)),
      receipt,
    }
  }

  if (stillOwed < 0) {
    return {
      ok: t.received(name, paid),
      warn: t.overpaid(formatTaka(-stillOwed)),
      receipt,
    }
  }

  return { ok: t.receivedInFull(name, paid), receipt }
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                  */
/* -------------------------------------------------------------------------- */

/** The three ways an owner can reach a parent from the board today. */
const CHANNELS = new Set<FeeReminderChannel>(['sms', 'whatsapp', 'call'])

/**
 * Comfortably longer than the WhatsApp text, which is the longest of the three.
 * A cap at all because this string arrives from the browser — the row builds the
 * message client-side so the page does not have to ship three variants of it per
 * invoice — and an unbounded text column fed by a client is a place to paste a
 * megabyte.
 */
const MAX_BODY = 1000

/** numeric(10, 2) stops at 99999999.99, and no coaching fee is near it. */
const MAX_AMOUNT = 99_999_999

export type FeeReminderLog = {
  invoiceId: string
  channel: FeeReminderChannel
  /** What the board showed as owed at the moment the owner tapped. */
  amount: number
  /** The guardian number the link was aimed at; null for anything unparseable. */
  toPhone?: string | null
  /** The exact text put in front of the owner. Null for a call. */
  body?: string | null
}

/**
 * Records that the owner reached out about one invoice.
 *
 * Called from the row's tap handler rather than a form, because the tap has to do
 * two things at once: open the phone's SMS or WhatsApp app, and leave a note that
 * it happened. The link does the first and nothing here interferes with it; this
 * does the second.
 *
 * The amount, the number and the body come from the client rather than being
 * recomputed here, which looks like misplaced trust and is not. This row exists
 * to answer "what did I tell this family", and a message regenerated at log time
 * could name a figure the parent never saw — the owner sends ৳700, a discount
 * lands a minute later, and the log would insist they were told ৳500. What must
 * not come from the client is *which invoice*, and that is read back through
 * fee_invoice_balances so RLS decides whether it is theirs at all.
 *
 * Returns whether the row was written. The caller marks the invoice as chased
 * only on true, so the board never claims a reminder it has no record of.
 */
export async function logFeeReminder(
  input: FeeReminderLog,
): Promise<{ logged: boolean }> {
  const session = await feeAdmin()
  if (!isSession(session)) return { logged: false }

  const invoiceId = String(input?.invoiceId ?? '')
  const channel = input?.channel
  if (!invoiceId || !CHANNELS.has(channel)) return { logged: false }

  const amount = Number(input?.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { logged: false }
  }

  const supabase = await createClient()

  // Voided as well as missing. The board never shows a cancelled invoice, so a
  // reminder against one can only come from a page left open through the
  // cancellation — and the parent should not be chased for it.
  const { data: invoice } = await supabase
    .from('fee_invoice_balances')
    .select('id, voided_at')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoiceId)
    .maybeSingle()

  if (!invoice?.id || invoice.voided_at) return { logged: false }

  const body = String(input?.body ?? '').slice(0, MAX_BODY)

  const { error } = await supabase.from('fee_reminders').insert({
    coaching_center_id: session.active.centerId,
    invoice_id: invoice.id,
    channel,
    // Through sumTaka so the stored figure is rounded to the two places the
    // column holds, rather than letting a float land on Postgres and be rounded
    // there into something the owner was never shown.
    amount_bdt: sumTaka([amount]),
    // Normalised so the column keeps the one meaning it is documented to have.
    // Null rather than the raw string if it will not parse: a log entry saying
    // the message went to "01712-34" is worse than one that admits it does not
    // know where the message went.
    to_phone: normalizeBdMobile(input?.toPhone),
    body: body || null,
    sent_by: session.userId,
  })

  if (error) return { logged: false }

  // The board only, and only for the "last chased" line. Not /dashboard, which
  // counts money rather than conversations.
  //
  // Naming one path does not keep this to one screen: a Server Action that
  // revalidates anything makes Next re-render whatever route the caller is
  // standing on, and this is called just as often from /fees/reminders. That
  // screen is a worklist being read top to bottom on a phone, and a refresh
  // there would drop the row the owner just tapped out from under their thumb.
  // It defends itself — see the frozen list in reminder-list.tsx — because the
  // defence belongs next to the thumb it protects, not in the write path.
  revalidatePath('/fees')

  return { logged: true }
}
