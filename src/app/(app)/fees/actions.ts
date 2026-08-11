'use server'

/**
 * The fee board's two writes: raise this month's invoices, and record money
 * that came in.
 *
 * This is the screen the product is sold on, so both actions are built around
 * being run by a person who is interrupted. Generating invoices is safe to run
 * twice. Recording a payment names the student in its confirmation, because an
 * owner holding cash across a desk needs to see that it landed on the right
 * child before the next parent starts talking.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireRole, AuthError, type CenterSession } from '@/lib/auth/session'
import { parseTaka, formatTaka, sumTaka } from '@/lib/money'
import { currentPeriodMonth } from '@/lib/bd/time'
import type { PaymentMethod } from '@/lib/supabase/types'

export type FeeState = {
  error?: string
  ok?: string
  /** Set when the write succeeded but the owner should read something first. */
  warn?: string
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
 * A bKash transaction id is 10 alphanumeric characters; Nagad and bank refs
 * vary. Long enough for any of them, short enough that the column is not a
 * free-text field someone pastes a conversation into.
 */
const MAX_REFERENCE = 40
const MAX_NOTE = 200

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
      return { error: 'ফি-এর হিসাব শুধু মালিক বা ম্যানেজার রাখতে পারেন।' }
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

  const rawMonth = String(formData.get('periodMonth') ?? '')
  const periodMonth = MONTH_RE.test(rawMonth) ? rawMonth : currentPeriodMonth()

  // Which day of the month the fee is due. Coaching centres in Bangladesh
  // conventionally want it in the first third of the month; 10 is the default
  // the form offers, and anything outside 1–28 is refused rather than clamped,
  // because a due date of the 31st silently becoming the 28th in February is
  // the kind of surprise that shows up in a phone call from a parent.
  const rawDueDay = Number(formData.get('dueDay') ?? 10)
  if (!Number.isInteger(rawDueDay) || rawDueDay < 1 || rawDueDay > 28) {
    return { error: 'তারিখ ১ থেকে ২৮-এর মধ্যে দিন।' }
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
    return { error: 'শিক্ষার্থীর তালিকা পড়া যায়নি। আবার চেষ্টা করুন।' }
  }

  const billable = (enrollments ?? [])
    .map((e) => {
      const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches
      return { id: e.id, studentId: e.student_id, fee: Number(batch?.monthly_fee_bdt ?? 0) }
    })
    .filter((e) => Number.isFinite(e.fee) && e.fee > 0)

  if (billable.length === 0) {
    return {
      error:
        'ইনভয়েস তৈরি করার মতো কিছু নেই। ব্যাচে মাসিক ফি বসানো আছে কি না দেখুন।',
    }
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
    return { error: 'ইনভয়েস তৈরি হয়নি। আবার চেষ্টা করুন।' }
  }

  const count = inserted?.length ?? 0
  const total = sumTaka((inserted ?? []).map((i) => Number(i.amount_bdt)))

  revalidatePath('/fees')
  revalidatePath('/dashboard')

  if (count === 0) {
    return { ok: 'এই মাসের সব ইনভয়েস আগেই তৈরি করা হয়েছে। নতুন কিছু যোগ হয়নি।' }
  }

  return {
    ok: `${count}টি ইনভয়েস তৈরি হয়েছে — মোট ${formatTaka(total)}।`,
  }
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

  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId) return { error: 'কোন ইনভয়েস, তা পাওয়া যায়নি।' }

  const amount = parseTaka(String(formData.get('amount') ?? ''))
  if (amount === null) return { error: 'টাকার পরিমাণ ঠিকভাবে লিখুন।' }
  if (amount === 0) return { error: 'টাকার পরিমাণ শূন্য হতে পারে না।' }
  // Refunds exist in the schema as negative payments and the board's arithmetic
  // handles them, but there is no refund button yet, so a negative here is a
  // mistyped amount rather than an intention.
  if (amount < 0) return { error: 'টাকার পরিমাণ শূন্যের বেশি হতে হবে।' }

  const rawMethod = String(formData.get('method') ?? 'cash') as PaymentMethod
  const method = METHODS.has(rawMethod) ? rawMethod : 'cash'

  const reference = String(formData.get('reference') ?? '')
    .trim()
    .slice(0, MAX_REFERENCE)
  const note = String(formData.get('note') ?? '')
    .trim()
    .slice(0, MAX_NOTE)

  const supabase = await createClient()

  // Read the invoice through the balance view rather than trusting the form.
  // Three things come from this and none of them can come from the client: that
  // the invoice is real and in this centre (RLS decides), which student the
  // payment belongs to, and what was still owed a moment ago.
  const { data: invoice } = await supabase
    .from('fee_invoice_balances')
    .select('id, student_id, student_name, remaining_bdt, voided_at')
    .eq('id', invoiceId)
    .maybeSingle()

  // A view's columns are all nullable as far as Postgres can prove, so the id
  // and the student have to be narrowed here rather than asserted. They cannot
  // actually be null — both are NOT NULL on fee_invoices — but a missing one
  // would mean the row is not what we think it is, and that is the same answer
  // as not finding it.
  if (!invoice?.id || !invoice.student_id) return { error: 'ইনভয়েসটি পাওয়া যায়নি।' }
  if (invoice.voided_at) return { error: 'এই ইনভয়েসটি বাতিল করা হয়েছে।' }

  const { error: paymentError } = await supabase.from('fee_payments').insert({
    coaching_center_id: session.active.centerId,
    invoice_id: invoice.id,
    student_id: invoice.student_id,
    amount_bdt: amount,
    method,
    reference: reference || null,
    note: note || null,
    received_by: session.userId,
  })

  if (paymentError) {
    return { error: 'টাকা জমা হয়নি। আবার চেষ্টা করুন।' }
  }

  revalidatePath('/fees')
  revalidatePath('/dashboard')
  revalidatePath('/me')

  const wasOwed = Number(invoice.remaining_bdt ?? 0)
  const stillOwed = sumTaka([wasOwed, -amount])
  const name = invoice.student_name ?? 'শিক্ষার্থী'

  if (stillOwed > 0) {
    return {
      ok: `${name} — ${formatTaka(amount)} জমা হয়েছে।`,
      warn: `এখনো ${formatTaka(stillOwed)} বাকি আছে।`,
    }
  }

  if (stillOwed < 0) {
    return {
      ok: `${name} — ${formatTaka(amount)} জমা হয়েছে।`,
      warn: `প্রয়োজনের চেয়ে ${formatTaka(-stillOwed)} বেশি জমা হয়েছে। ভুল হলে এখনই দেখে নিন।`,
    }
  }

  return { ok: `${name} — ${formatTaka(amount)} জমা হয়েছে। ফি সম্পূর্ণ পরিশোধ ✓` }
}
