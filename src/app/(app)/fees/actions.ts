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
import { pageAll } from '@/lib/supabase/page'
import {
  requireRole,
  getSession,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { parseTaka, formatTaka, sumTaka, MAX_TAKA } from '@/lib/money'
import { billableEnrollments, unpricedStudents } from '@/lib/fees/billable'
import { arrearsPlan, oldestEnrollments, ARREARS_FIELD_PREFIX } from '@/lib/fees/arrears'
import { cancelVerdict } from '@/lib/fees/void'
import { refundVerdict, refundable } from '@/lib/fees/refund'
import { discountVerdict, maxDiscount } from '@/lib/fees/discount'
import { currentPeriodMonth } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { readIdempotencyKey, UNIQUE_VIOLATION } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import type { OutreachChannel, PaymentMethod } from '@/lib/supabase/types'

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
 * Which enrolments are actually billed is billableEnrollments' decision, and the
 * reasoning for each exclusion is written there — a free batch, a closed one, and a
 * fee that did not survive the wire. One of those exclusions is reported back: a
 * batch left with no monthly fee is how a month's billing comes out short with a
 * confirmation on screen saying it worked.
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
  //
  // `active` rides on the embed rather than an `!inner` join filter: supabase-js
  // infers the row type from the literal select string, and a filtered join degrades
  // every column on this query to unknown. The filtering happens in JS instead.
  //
  // PAGED, AND THAT IS THE DIFFERENCE BETWEEN A BILL AND A WRONG BILL. PostgREST
  // answers at most 1000 rows and does not say when it stopped, and this product
  // charges per enrolment: 250 students taking four subjects each is a thousand
  // active enrolments, which is the middle of the tier we ask ৳1,999 a month for.
  // Read in one shot, a centre that size gets a month billed for the first thousand
  // enrolments, no invoice for the rest, and a green confirmation naming the count —
  // the exact failure the note above `unpriced` calls out, arriving by a route
  // nothing on the screen could reveal.
  //
  // Ordered by id, which is unique. Offset paging over an unordered query may repeat
  // or skip a row between pages, and a repeated enrolment here would be a second
  // invoice for one subject.
  const enrollments = await pageAll((from, to) =>
    supabase
      .from('enrollments')
      .select('id, student_id, batches (monthly_fee_bdt, active)')
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active')
      .order('id')
      .range(from, to),
  )

  if ('failed' in enrollments) {
    return {
      error:
        enrollments.failed === 'tooLarge'
          ? t.errors.rosterTooLarge
          : t.errors.rosterUnreadable,
    }
  }

  const billable = billableEnrollments(enrollments.rows)

  /**
   * Students the run could not bill because their batch has no monthly fee.
   *
   * The one exclusion an owner has to hear about, and the only way this screen can
   * report a success that is a third short. Read from the same rows and the same
   * decision as the billing above, so it cannot describe a different set.
   */
  const unpriced = unpricedStudents(enrollments.rows)
  const warn = unpriced > 0 ? t.invoicesSkipped(unpriced) : undefined

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
        enrollment_id: e.enrollmentId,
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
    return { ok: t.invoicesAllExisted, warn }
  }

  return { ok: t.invoicesCreated(count, formatTaka(total)), warn }
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
 *
 * Safe to arrive twice. The form sends a uuid it minted once, the unique index in
 * 20260811000025 refuses the second row carrying it, and this answers that refusal
 * with the receipt the first one wrote — so a lost response, a double tap, or a
 * request Next replayed when the network came back all leave one payment on the
 * record. See ./payment-row.tsx for when the browser mints a new one.
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
  // A refund is a negative payment and has its own form below this one, which turns a
  // positive figure negative on the way in. So a negative typed *here* is a slipped
  // minus rather than an intention, and the two forms never have to guess which one
  // the owner meant.
  if (amount < 0) return { error: t.errors.amountNegative }

  const rawMethod = String(formData.get('method') ?? 'cash') as PaymentMethod
  const method = METHODS.has(rawMethod) ? rawMethod : 'cash'

  // Both clamped rather than refused, for the reason `clamp` gives: the form
  // caps them, so a longer one is not the form. A transaction id is checked
  // against a bKash SMS, so a truncated one is visibly wrong to the person who
  // typed it — which is the right kind of wrong.
  const reference = clamp(String(formData.get('reference') ?? '').trim(), MAX_LABEL)
  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)

  // Null if the browser could not mint one, which records the payment with no retry
  // protection rather than refusing it. See lib/idempotency.ts for why that is the
  // right way round.
  const key = readIdempotencyKey(formData.get('idempotencyKey'))

  const supabase = await createClient()

  // Read the invoice through the balance view rather than trusting the form.
  // Three things come from this and none of them can come from the client: that
  // the invoice is real and in this centre (RLS decides), which student the
  // payment belongs to, and what was still owed a moment ago.
  const { data: invoice, error: invoiceError } = await supabase
    .from('fee_invoice_balances')
    .select('id, student_id, student_name, remaining_bdt, voided_at')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoiceId)
    .maybeSingle()

  // An owner with the cash already in their hand, told the bill is not there — see
  // invoiceUnreadable. This is the one site on the money surface where the wrong
  // sentence ends with the notes going into a drawer unrecorded.
  if (invoiceError) return { error: t.errors.invoiceUnreadable }

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
      idempotency_key: key,
    })
    .select('id, receipt_no')
    .single()

  // Whether this request is the second arrival of a payment already on the record.
  // Only that changes below — the owner is shown the same confirmation either way,
  // deliberately: "received ৳1500 from Karim" is true, complete, and the sentence
  // they need. Telling them it was "already recorded" would read as a warning that
  // they had taken the money twice, which is the fear this screen exists to answer,
  // not to provoke.
  let replay = false
  let receipt: { id: string; no: number }

  if (paymentError) {
    // The one error that is not a failure: the unique index in 20260811000025
    // refusing a second row for a submit that is already recorded. Guarded on `key`
    // as well as the code, because without a key that index cannot be the one that
    // fired and a 23505 from somewhere else — the receipt-number index, if the
    // trigger's max() ever came out low — is a genuine failure.
    if (!key || paymentError.code !== UNIQUE_VIOLATION) {
      return { error: t.errors.paymentFailed }
    }

    const { data: existing } = await supabase
      .from('fee_payments')
      .select('id, receipt_no, invoice_id, amount_bdt')
      .eq('coaching_center_id', session.active.centerId)
      .eq('idempotency_key', key)
      .maybeSingle()

    // Checked against what this request asked for, not trusted for being findable.
    // A key that turns up on a different invoice or a different amount is a key
    // reused where it should not have been, and answering that with a receipt would
    // put a slip in a parent's hand for a payment against another child. There is no
    // sentence worth writing for it: it cannot happen from this form, and if it does
    // the honest report is that the payment did not go through.
    if (
      !existing
      || existing.invoice_id !== invoice.id
      || Number(existing.amount_bdt) !== amount
    ) {
      return { error: t.errors.paymentFailed }
    }

    replay = true
    receipt = { id: existing.id, no: existing.receipt_no }
  } else {
    receipt = { id: payment.id, no: payment.receipt_no }
  }

  revalidatePath('/fees')
  revalidatePath('/dashboard')
  revalidatePath('/me')

  const wasOwed = Number(invoice.remaining_bdt ?? 0)
  // On a replay the payment is already in the view's sum — `remaining_bdt` is
  // `net - paid` (20260811000006) and the row it is being deduplicated against was
  // written before this request read the invoice. Subtracting again would tell the
  // owner the family still owes money they have handed over, on the one screen where
  // that sentence starts an argument.
  const stillOwed = replay ? wasOwed : sumTaka([wasOwed, -amount])
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
const CHANNELS = new Set<OutreachChannel>(['sms', 'whatsapp', 'call'])

/**
 * Comfortably longer than the WhatsApp text, which is the longest of the three.
 * A cap at all because this string arrives from the browser — the row builds the
 * message client-side so the page does not have to ship three variants of it per
 * invoice — and an unbounded text column fed by a client is a place to paste a
 * megabyte.
 */
const MAX_BODY = 1000

export type FeeReminderLog = {
  invoiceId: string
  channel: OutreachChannel
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
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TAKA) {
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

/* -------------------------------------------------------------------------- */
/* Cancelling a bill that should not have been raised                         */
/* -------------------------------------------------------------------------- */

/**
 * The columns both writes below read back before deciding anything.
 *
 * One literal, for the reason the board's COLUMNS gives: supabase-js parses the
 * select string at the type level, and a concatenation widens to `string` and takes
 * every column with it.
 */
const VOID_COLUMNS = 'id, student_name, paid_bdt, voided_at'

/**
 * Cancels a bill that should not have been raised.
 *
 * WHY THE PRODUCT NEEDS THIS AT ALL. The generator bills every active enrolment, so a
 * student who left in June and whose enrolment nobody closed is billed in July — and
 * until this existed, that ৳2,000 was permanent. It sat in the outstanding total on
 * the board, in the arrears the month-close screen opens the next month with, and on
 * the worklist telling the owner to message a parent whose child does not come here
 * any more. `voided_at` had been in the schema since the first migration and no screen
 * could set it.
 *
 * The word on the button is "cancel", not "void": an owner in Bandarban is not doing
 * accounting, they are undoing a mistake. The column keeps the schema's name.
 *
 * WHAT IT REFUSES is a bill with money on it, and the reasoning is in
 * lib/fees/void.ts. Refunding first is the way through — a negative payment, which the
 * control above this one on the same row now writes — so the refusal names the step
 * rather than describing a dead end.
 *
 * Safe to arrive twice, like every write in this app: a bill already cancelled is
 * answered with the same confirmation as the first time. `useOffline` replays Server
 * Actions when a phone comes back on the network, and a second arrival must not read
 * as a failure.
 *
 * The database checks all of this again in app.guard_invoice_void(), and that is not
 * belt-and-braces for its own sake: this function runs behind a Server Action, which
 * is a public HTTP endpoint, and the trigger is the only one of the two that a crafted
 * request cannot skip.
 */
export async function voidInvoice(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const session = await feeAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).fees

  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId) return { error: t.errors.noInvoice }

  // Optional, and clamped rather than refused for the reason `clamp` gives. An owner
  // cancelling a bill for a child who left has nothing to explain, and a required
  // field here would be answered with a full stop.
  const reason = clamp(String(formData.get('reason') ?? '').trim(), MAX_TEXT)

  const supabase = await createClient()

  // Read through the view, never from the form. It decides three things the client
  // cannot be trusted for: that the invoice exists and is in this centre (RLS), what
  // has been paid against it, and whether it is already cancelled.
  const { data: invoice, error: invoiceError } = await supabase
    .from('fee_invoice_balances')
    .select(VOID_COLUMNS)
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoiceId)
    .maybeSingle()

  // "Invoice not found" about the bill the reader is looking at, on the button that
  // would have cancelled it. Nothing was cancelled, which is what to say instead.
  if (invoiceError) return { error: t.errors.invoiceUnreadable }
  if (!invoice?.id) return { error: t.errors.invoiceMissing }

  const name = invoice.student_name ?? dict(session.locale).common.unknown
  const verdict = cancelVerdict({
    paid: Number(invoice.paid_bdt ?? 0),
    voidedAt: invoice.voided_at,
  })

  // The replay, and the one case that is a success without a write. Told in the same
  // words as the first time: "Karim's bill is cancelled" is true either way, and
  // "already cancelled" would read as a warning that they had done something twice.
  if (verdict === 'already') return { ok: t.invoiceCancelled(name) }
  if (verdict === 'paid') return { error: t.errors.cancelPaid }

  // `is('voided_at', null)` in the filter as well as in the verdict above. Two
  // requests a moment apart both pass the read, and this is what makes the second one
  // change nothing — the same reason the payment insert leans on a unique index rather
  // than on having looked first.
  //
  // voided_at is sent and then overwritten by the trigger with now(). Deliberate on
  // both sides: PostgREST needs a value to write, and a timestamp from a client could
  // be backdated into a month the owner has already closed and been shown.
  const { error } = await supabase
    .from('fee_invoices')
    .update({ voided_at: new Date().toISOString(), void_reason: reason || null })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoice.id)
    .is('voided_at', null)

  // Includes the trigger's own refusal, which can only fire on a payment that landed
  // between the read above and this write. The owner is told the bill has money on it,
  // which is the true and useful sentence in that race.
  if (error) return { error: t.errors.cancelFailed }

  revalidatePath('/fees')
  revalidatePath('/dashboard')
  revalidatePath('/me')

  return { ok: t.invoiceCancelled(name) }
}

/**
 * Puts a cancelled bill back.
 *
 * Here because cancelling is one tap and a mis-tap is a family silently stopping to
 * owe money — nothing else in this product removes a debt, so nothing else needs an
 * undo this badly. It is also the only way back: a cancelled invoice keeps its unique
 * (enrollment_id, period_month), so re-running the generator will not raise a
 * replacement, which is the right behaviour for a student who left and a trap for
 * somebody who cancelled the wrong row.
 *
 * No money check on the way back. A cancelled bill has none on it — that is what
 * cancelling required — and restoring one only puts an amount back on a family's
 * ledger that was billed to them in the first place.
 *
 * Idempotent, same as its opposite: a bill that already stands is answered as
 * restored.
 */
export async function restoreInvoice(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const session = await feeAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).fees

  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId) return { error: t.errors.noInvoice }

  const supabase = await createClient()

  const { data: invoice, error: invoiceError } = await supabase
    .from('fee_invoice_balances')
    .select(VOID_COLUMNS)
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoiceId)
    .maybeSingle()

  // And the way back. "Not found" here says the cancelled bill has been thrown out
  // for good, which is the one thing this button exists to prove wrong.
  if (invoiceError) return { error: t.errors.invoiceUnreadable }
  if (!invoice?.id) return { error: t.errors.invoiceMissing }

  const name = invoice.student_name ?? dict(session.locale).common.unknown

  // The trigger clears voided_by and void_reason alongside, so a restored bill carries
  // no trace of a cancellation it is no longer under.
  const { error } = await supabase
    .from('fee_invoices')
    .update({ voided_at: null })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoice.id)

  if (error) return { error: t.errors.restoreFailed }

  revalidatePath('/fees')
  revalidatePath('/dashboard')
  revalidatePath('/me')

  return { ok: t.invoiceRestored(name) }
}

/* -------------------------------------------------------------------------- */
/* Money back out                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What the refund box needs to know about the bill it is aimed at.
 *
 * `paid_bdt` is the netted total, so a bill already partly refunded offers only what
 * is left — this action never counts payment rows. `remaining_bdt` is the view's own
 * answer for what is owed (`net - paid`, 20260811000006) and is not recomputed here,
 * for the reason docs §4 gives: two screens must not derive the same figure twice.
 */
const REFUND_COLUMNS = 'id, student_id, student_name, remaining_bdt, paid_bdt, voided_at'

/**
 * Hands money back: a second payment row with a negative amount, and its own receipt.
 *
 * NOT AN EDIT AND NOT A DELETE, because neither is available to anybody — see
 * 20260811000017, which revokes both from the browser and refuses even the migration
 * role a new receipt number. So the register still adds up to the cash in the drawer,
 * and the parent holding the first slip can be handed the second.
 *
 * THE CEILING IS WHAT CAME IN, and lib/fees/refund.ts is the rule. Read here as well
 * as on the form because this is a public HTTP endpoint and a missing button is not a
 * check, and again in app.guard_payment_floor() which is the copy that cannot be
 * talked out of it. A refund past zero cannot be undone by anything — that is why it
 * is checked three times.
 *
 * A CANCELLED BILL IS REFUSED. Money on a cancelled invoice cannot happen (cancelling
 * required a netted zero), so there is nothing to hand back; and a payment row against
 * a bill that is out of every total would be money the product cannot show anywhere.
 * Restore it first if the cancellation was the mistake.
 *
 * Idempotent through the same key and the same unique index as recordPayment, for the
 * same reason at greater cost: `useOffline` replays Server Actions when a phone comes
 * back on the network, and a refund that lands twice is cash out of the drawer twice
 * with no way to take either row back.
 */
export async function refundPayment(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const session = await feeAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).fees

  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId) return { error: t.errors.noInvoice }

  // Positive on the way in: the owner types what they are handing over, and this is
  // the one place in the product that turns it negative. A form that asked for "-500"
  // would be a form somebody types 500 into.
  const amount = parseTaka(String(formData.get('amount') ?? ''))
  if (amount === null) return { error: t.errors.amountUnreadable }

  const rawMethod = String(formData.get('method') ?? 'cash') as PaymentMethod
  const method = METHODS.has(rawMethod) ? rawMethod : 'cash'
  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)
  const key = readIdempotencyKey(formData.get('idempotencyKey'))

  const supabase = await createClient()

  const { data: invoice, error: invoiceError } = await supabase
    .from('fee_invoice_balances')
    .select(REFUND_COLUMNS)
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoiceId)
    .maybeSingle()

  // Money going the other way, and the same reading as the payment form: cash out of
  // the drawer with nothing recorded against it.
  if (invoiceError) return { error: t.errors.invoiceUnreadable }
  if (!invoice?.id || !invoice.student_id) return { error: t.errors.invoiceMissing }
  if (invoice.voided_at) return { error: t.errors.invoiceVoided }

  const received = Number(invoice.paid_bdt ?? 0)

  switch (refundVerdict({ received, amount })) {
    case 'unreadable':
      return { error: t.errors.amountUnreadable }
    case 'zero':
      return { error: t.errors.amountZero }
    case 'nothing':
      return { error: t.errors.refundNothing }
    // Names the ceiling rather than only refusing. The owner is standing at a drawer
    // deciding how much to count out, and "up to ৳1,500" is the answer they need.
    case 'tooMuch':
      return { error: t.errors.refundTooMuch(formatTaka(refundable(received))) }
  }

  const { data: payment, error: paymentError } = await supabase
    .from('fee_payments')
    .insert({
      coaching_center_id: session.active.centerId,
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      amount_bdt: -amount,
      method,
      note: note || null,
      received_by: session.userId,
      idempotency_key: key,
    })
    .select('id, receipt_no')
    .single()

  let replay = false
  let receipt: { id: string; no: number }

  if (paymentError) {
    // Everything here is recordPayment's reasoning, including why the existing row is
    // checked against what this request asked for rather than trusted for being
    // findable. The one difference is the sign: the row that deduplicates a refund of
    // ৳500 holds -500, and a key that turns up against +500 is a payment, not this.
    if (!key || paymentError.code !== UNIQUE_VIOLATION) {
      return { error: t.errors.refundFailed }
    }

    const { data: existing } = await supabase
      .from('fee_payments')
      .select('id, receipt_no, invoice_id, amount_bdt')
      .eq('coaching_center_id', session.active.centerId)
      .eq('idempotency_key', key)
      .maybeSingle()

    if (
      !existing
      || existing.invoice_id !== invoice.id
      || Number(existing.amount_bdt) !== -amount
    ) {
      return { error: t.errors.refundFailed }
    }

    replay = true
    receipt = { id: existing.id, no: existing.receipt_no }
  } else {
    receipt = { id: payment.id, no: payment.receipt_no }
  }

  revalidatePath('/fees')
  revalidatePath('/dashboard')
  revalidatePath('/me')

  const name = invoice.student_name ?? dict(session.locale).common.unknown
  const back = formatTaka(amount)

  const wasOwed = Number(invoice.remaining_bdt ?? 0)
  // A refund moves the family towards owing, so it *adds* to what is outstanding. On
  // a replay it is already in the view's sum — the row this is being deduplicated
  // against was written before this request read the invoice — so adding again would
  // tell the owner the family owes money nobody has taken back.
  const owedNow = replay ? wasOwed : sumTaka([wasOwed, amount])

  // Where the bill stands afterwards, in the same three shapes recordPayment uses,
  // because it is the same question asked from the other side of the desk. The usual
  // outcome is the first: a refunded bill is an owed bill, and if the student has left
  // then cancelling it is the next thing the owner wants — which the control directly
  // below this form now offers, the money that was blocking it having gone. The middle
  // case is a parent who overpaid getting some but not all of the credit back.
  if (owedNow > 0) {
    return { ok: t.refunded(name, back), warn: t.stillOwed(formatTaka(owedNow)), receipt }
  }

  if (owedNow < 0) {
    return { ok: t.refunded(name, back), warn: t.overpaid(formatTaka(-owedNow)), receipt }
  }

  return { ok: t.refunded(name, back), receipt }
}

/* -------------------------------------------------------------------------- */
/* A fee the centre decided not to charge                                     */
/* -------------------------------------------------------------------------- */

const DISCOUNT_COLUMNS =
  'id, student_name, amount_bdt, discount_bdt, remaining_bdt, voided_at'

/**
 * Waives part of a fee, or takes a waiver back.
 *
 * WHY IT EXISTS. `discount_bdt` has been in the schema since migration 1 with both its
 * bounds as table checks, the board renders it, the export has a column for it and
 * month-close nets it out — and until 20260811000030 no screen could set it. A centre
 * that waives a fee constantly, which every coaching centre does, had two places to put
 * it and both were wrong: bill the discounted figure, and `amount_bdt` stops being the
 * fee so next month's generator bills full price again with nobody remembering why; or
 * record a payment the family never made, which is permanent, lands in the day's takings
 * and stops the drawer reconciling. The full argument is in lib/fees/discount.ts.
 *
 * A REPLACEMENT, NOT AN INCREMENT. The figure sent is the whole waiver on this bill, and
 * it overwrites whatever was there. Adding to a running total would make each edit
 * depend on the last one, so an owner correcting ৳500 to ৳800 would land at ৳1,300 — and
 * the same request arriving twice would waive twice. This shape is idempotent by
 * construction, which is why there is no key anywhere near it: `useOffline` replays
 * Server Actions, and a SET to an absolute figure is the same answer however many times
 * it is asked.
 *
 * ZERO IS A LEGITIMATE FIGURE and the only way to undo a waiver. The trigger clears the
 * reason, who granted it and when, alongside — a bill back at full price that still
 * reads "second child, half fee" is worse than one that says nothing.
 *
 * A CANCELLED BILL IS REFUSED, because it is out of every total on every screen, so a
 * waiver on one can do nothing except confuse whoever reads it later. Restore it first.
 *
 * NOT REFUSED: a waiver on a bill the family has already paid. That leaves them in
 * credit, which is true, is what the board should say, and is what the refund control on
 * the same row hands back. It is also the most sympathetic case there is.
 */
export async function discountInvoice(
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

  // Optional and clamped, exactly as the cancellation reason is: a required field here
  // would be answered with a full stop. The screen asks for it anyway, because this is
  // the one column that survives the owner forgetting.
  const reason = clamp(String(formData.get('reason') ?? '').trim(), MAX_TEXT)

  const supabase = await createClient()

  // Read through the view, never from the form. It decides what the client cannot be
  // trusted for: that the bill exists and is in this centre (RLS), what it was billed —
  // which is the ceiling — and whether it is cancelled.
  const { data: invoice, error: invoiceError } = await supabase
    .from('fee_invoice_balances')
    .select(DISCOUNT_COLUMNS)
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoiceId)
    .maybeSingle()

  // The waiver. Nothing was waived, and the family is still billed what they were.
  if (invoiceError) return { error: t.errors.invoiceUnreadable }
  if (!invoice?.id) return { error: t.errors.invoiceMissing }

  const billed = Number(invoice.amount_bdt ?? 0)

  switch (discountVerdict({ billed, discount: amount, voidedAt: invoice.voided_at })) {
    case 'cancelled':
      return { error: t.errors.discountVoided }
    case 'unreadable':
      return { error: t.errors.amountUnreadable }
    case 'negative':
      return { error: t.errors.discountNegative }
    case 'tooMuch':
      return { error: t.errors.discountTooMuch(formatTaka(maxDiscount(billed))) }
  }

  // `is('voided_at', null)` in the filter as well as in the verdict, for the reason
  // voidInvoice gives: two requests a moment apart both pass the read, and this is what
  // stops the second one landing on a bill cancelled in between. The trigger refuses it
  // too; this makes the answer a sentence rather than a Postgres error.
  //
  // discounted_by and discounted_at are not sent and could not be — they are outside the
  // column grant. The trigger stamps them.
  const { error } = await supabase
    .from('fee_invoices')
    .update({ discount_bdt: amount, discount_reason: reason || null })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', invoice.id)
    .is('voided_at', null)

  if (error) return { error: t.errors.discountFailed }

  revalidatePath('/fees')
  revalidatePath('/dashboard')
  revalidatePath('/me')

  const name = invoice.student_name ?? dict(session.locale).common.unknown

  // Taking one back is its own sentence. "৳0 waived" is arithmetically what happened and
  // not what the owner did, and an owner who has just undone something needs to read
  // that it is undone.
  if (amount <= 0) return { ok: t.discountCleared(name) }

  // What the family owes now, as a change to the figure Postgres already computed
  // rather than as the formula restated here. `remaining_bdt` is net-less-paid decided
  // in the view (20260811000030), and it is stale by exactly the waiver that just
  // changed — so putting the old waiver back and taking the new one off is the whole
  // adjustment. Recomputing `billed - waiver - paid` in TypeScript would be a second
  // answer to a question the database already answers, which docs §4 forbids for a
  // reason: the day net_bdt's definition moves, that line disagrees silently.
  //
  // Same three shapes as recordPayment, because it is the same question — where does
  // this bill now stand — and the credit case is real here: a fee waived after the
  // family paid in full leaves money to hand back.
  const owedNow = sumTaka([
    Number(invoice.remaining_bdt ?? 0),
    Number(invoice.discount_bdt ?? 0),
    -amount,
  ])
  const waived = formatTaka(amount)

  if (owedNow > 0) {
    return { ok: t.discounted(name, waived), warn: t.stillOwed(formatTaka(owedNow)) }
  }

  if (owedNow < 0) {
    return { ok: t.discounted(name, waived), warn: t.overpaid(formatTaka(-owedNow)) }
  }

  return { ok: t.discounted(name, waived) }
}

/* -------------------------------------------------------------------------- */
/* What the centre was already owed before any of this existed                 */
/* -------------------------------------------------------------------------- */

/**
 * How many names the refusal message lists before it stops.
 *
 * The count in the sentence is always the true one; this only bounds the list. Eight
 * is about what fits on a phone before the message stops being read, and an owner
 * with more wrong boxes than that has mis-typed a column rather than a cell.
 */
const ARREARS_NAMES_SHOWN = 8

/**
 * Records what families already owed before the centre started using this product.
 *
 * WHY THIS IS THE MOST IMPORTANT WRITE IN THE FEE BOARD. A centre is signed up by
 * loading their register, opening this board on a phone in front of the owner, and
 * showing them their own outstanding total — most owners do not know that figure
 * precisely, and seeing it is the moment they buy. Until this existed the figure was
 * ৳0 on day one, because the importer loads students and the generator only bills the
 * month it is pressed in.
 *
 * Running the generator over past months is not the same thing and is not a
 * substitute: it would bill every active student the full batch fee for months most
 * families have already settled in cash, and netting that off would take two hundred
 * payment entries. What is wanted is one figure per family, typed off the register.
 *
 * THE MONTH MUST HAVE ENDED, and this is the only rule the screen cannot enforce
 * alone. `fee_invoices` is unique on `(enrollment_id, period_month)`, so a row written
 * here into the current month takes the slot the generator was going to use — and
 * because the generator's upsert ignores duplicates, that family's real monthly fee
 * would never be billed and nobody would be told. A finished month is also what makes
 * the board read correctly: a past due date is overdue, so the chase list picks the
 * family up immediately and the month-close screen carries the debt as opening
 * arrears, which is exactly what it is.
 *
 * SAFE TO PRESS TWICE, through the same unique key rather than in spite of it. Which
 * enrolment each debt hangs off is decided in lib/fees/arrears.ts — the oldest active
 * one, tie-broken by id — precisely so a replayed request lands on the same slot and
 * writes nothing. `useOffline` replays server actions, and a family billed twice for
 * their arrears is the one failure this screen must not have.
 *
 * ONE BAD BOX REFUSES THE WHOLE SUBMISSION, unlike the roster importer, which loads
 * what it can. See arrearsPlan for the argument: a student missing from a list is
 * visibly missing, and an outstanding total that is short by one family looks exactly
 * like a total that is right.
 */
export async function recordArrears(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const session = await feeAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).fees

  // Strictly before the month it is being loaded in. Not merely a valid month: see
  // the note above for what the current month would cost the generator.
  const rawMonth = String(formData.get('periodMonth') ?? '')
  if (!MONTH_RE.test(rawMonth) || rawMonth >= currentPeriodMonth()) {
    return { error: t.errors.arrearsMonthNotPast }
  }
  const periodMonth = rawMonth

  // Refused outside 1–28 rather than clamped, exactly as the generator does it and
  // for the same reason — a deadline that quietly moved is a phone call from a parent.
  const rawDueDay = Number(formData.get('dueDay') ?? 10)
  if (!Number.isInteger(rawDueDay) || rawDueDay < 1 || rawDueDay > 28) {
    return { error: t.errors.dueDayRange }
  }
  const dueDate = `${periodMonth.slice(0, 7)}-${String(rawDueDay).padStart(2, '0')}`

  const entries: { studentId: string; raw: string }[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(ARREARS_FIELD_PREFIX) || typeof value !== 'string') continue
    entries.push({ studentId: key.slice(ARREARS_FIELD_PREFIX.length), raw: value })
  }

  const supabase = await createClient()

  // No batch filter and no fee, unlike the generator's read. An old debt exists
  // whether or not the class it was owed for is still running, and its amount is
  // typed rather than derived — the batch price is what a family owes each month, not
  // what they failed to pay over the three before this app arrived.
  //
  // Paged for the generator's reason, with a different symptom: every enrolment in
  // the centre is read here to find each student's oldest one, so a roster cut off at
  // a thousand rows leaves the students past the cut with no enrolment found. They
  // would come back as rejects, named on screen, with a reason that is not what went
  // wrong — an owner told a real student is not enrolled has no way to act on that.
  const enrollments = await pageAll((from, to) =>
    supabase
      .from('enrollments')
      .select('id, student_id, enrolled_at')
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active')
      .order('id')
      .range(from, to),
  )

  if ('failed' in enrollments) {
    return {
      error:
        enrollments.failed === 'tooLarge'
          ? t.errors.rosterTooLarge
          : t.errors.rosterUnreadable,
    }
  }

  const plan = arrearsPlan(entries, oldestEnrollments(enrollments.rows))

  // Named boxes before anything else, so an owner reading the message knows which
  // cells to go back to. The extra query is on the failure path only.
  if (plan.rejects.length > 0) {
    const { data: named } = await supabase
      .from('students')
      .select('id, name')
      .eq('coaching_center_id', session.active.centerId)
      .in(
        'id',
        plan.rejects.slice(0, ARREARS_NAMES_SHOWN).map((r) => r.studentId),
      )

    const nameById = new Map((named ?? []).map((s) => [s.id, s.name]))
    const unknown = dict(session.locale).common.unknown
    const reasons = t.errors.arrearsReasons

    const details = plan.rejects
      .slice(0, ARREARS_NAMES_SHOWN)
      .map((r) => `${nameById.get(r.studentId) ?? unknown} (${reasons[r.problem]})`)
      .join(', ')

    return {
      error: t.errors.arrearsRejected(
        plan.rejects.length,
        plan.rejects.length > ARREARS_NAMES_SHOWN ? `${details}…` : details,
      ),
    }
  }

  if (plan.invoices.length === 0) return { error: t.errors.arrearsNothingTyped }

  // ignoreDuplicates, like the generator's, and for a stronger reason: this is the
  // request `useOffline` may replay. A family who already has a bill in that month is
  // left exactly as they are — the count below is what actually landed, so the
  // difference between the two is reportable rather than invisible.
  const { data: inserted, error: insertError } = await supabase
    .from('fee_invoices')
    .upsert(
      plan.invoices.map((i) => ({
        coaching_center_id: session.active.centerId,
        student_id: i.studentId,
        enrollment_id: i.enrollmentId,
        period_month: periodMonth,
        amount_bdt: i.amount,
        due_date: dueDate,
        // The only durable mark of why a bill exists in a month that predates the
        // centre's first invoice. Nothing renders it, the same way nothing renders
        // the note on a payment — it is a record on the row, not a screen. In the
        // owner's own language, because they are who would read it.
        note: dict(session.locale).arrears.title,
      })),
      { onConflict: 'enrollment_id,period_month', ignoreDuplicates: true },
    )
    .select('id, amount_bdt')

  if (insertError) return { error: t.errors.arrearsFailed }

  const count = inserted?.length ?? 0
  const total = sumTaka((inserted ?? []).map((i) => Number(i.amount_bdt)))

  revalidatePath('/fees')
  revalidatePath('/dashboard')

  if (count === 0) return { ok: t.arrearsAllExisted }

  const skipped = plan.invoices.length - count

  return {
    ok: t.arrearsCreated(count, formatTaka(total)),
    ...(skipped > 0 ? { warn: t.arrearsSomeExisted(skipped) } : {}),
  }
}
