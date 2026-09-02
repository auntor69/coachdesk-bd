import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { getSession, pageRole } from '@/lib/auth/session'
import { formatDate, todayInDhaka } from '@/lib/bd/time'
import { purchaseReceipt } from '@/lib/billing/receipt'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { createClient } from '@/lib/supabase/server'
import { PrintButton } from '../../../../fees/print-button'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).purchaseReceipt.title} — CoachDesk`,
  }
}

/** One line, not a concatenation — see the fee board's own COLUMNS on type inference. */
const RECEIPT_COLUMNS =
  'intent_id, amount_bdt, method, reference, covers_period_start, covers_period_end, note, paid_at, payment_intents (purpose, quantity, grants_capacity, branch_id)'

/**
 * What the centre paid us, as a piece of paper. §9.9's fifth and last printable.
 *
 * THE LETTERHEAD IS OURS, AND THAT IS THE WHOLE DIFFERENCE. The fee receipt, the refund
 * slip, the payslip and the expense voucher all carry the centre's name at the top because
 * the centre issues them — to a parent, to an employee, to whoever took the cash. Here the
 * seller is CoachDesk and the buyer is the coaching centre, so the header inverts and the
 * centre moves into a billed-to block. An owner filing this against a bKash statement is
 * filing a supplier's receipt, and a supplier's receipt that names only the buyer is not one.
 *
 * ONE COPY. NO CUT LINE. NO SIGNATURE. The other four sheets are cut in half because the
 * other party has to be handed something and has to sign for it. The other party here is us,
 * we already hold the row, and the proof the money moved is the wallet's own transaction
 * number rather than anybody's pen. A blank line nobody will ever sign is worse than no line.
 *
 * NO PLAN GATE, deliberately, and this is the one printable without one. `printedReceipts`
 * withholds paper from a centre that has not paid for it; this is paper about paying. Telling
 * a customer their receipt is a premium feature is the single worst sentence this product
 * could print, and the read is already owner-only — `payments_owner_read` and
 * `payment_intents_owner_read` both resolve to the owner or a platform admin, which is what
 * `pageRole('owner')` asks for. No migration and no new policy.
 *
 * ANY PLATFORM PAYMENT, not only a purchase of places. `payments` also holds the monthly
 * subscription money a founder records by hand, and a list that linked only capacity rows
 * would 404 on the rest — so the purpose comes off the intent when there is one and the
 * sheet simply says less when there is not. lib/billing/receipt.ts decides all of that,
 * including which of the two real identifiers heads the sheet, because `payments` has no
 * receipt series of its own: only `fee_payments` got one (20260811000017).
 *
 * `paid_at` GOES THROUGH `todayInDhaka`, and this is the opposite of the expense voucher.
 * That sheet prints `spent_on`, a plain `date` already in the Dhaka calendar, and converting
 * it would hand back the day before. This is a timestamptz, so money taken at 1am Dhaka
 * dates to the previous day unless it is converted. Same rule as the payslip.
 *
 * WHAT IS NOT ON IT is the rate the places were sold at. §3.8 asks for it and
 * `payment_intents` does not store it; recomputing the bands here would price the *next*
 * purchase, because `settle_payment_intent` has already raised `student_capacity` by the time
 * anybody prints this. Recorded as a schema gap in §15, and pinned by tests/purchase-receipt.
 *
 * A miss is notFound() rather than a 403: RLS decides what is visible, and refusing another
 * centre's payment id by name would confirm the id exists.
 */
export default async function PurchaseReceiptPage({
  params,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  params: Promise<{ paymentId: string }>
}) {
  const { paymentId } = await params
  const session = await pageRole('owner')

  const locale = session.locale
  const d = dict(locale)
  const t = d.purchaseReceipt

  const supabase = await createClient()
  const centerId = session.active.centerId

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select(RECEIPT_COLUMNS)
    .eq('coaching_center_id', centerId)
    .eq('id', paymentId)
    .maybeSingle()

  /*
   * The read that failed, ahead of the 404, and it says the payment is recorded before it
   * says anything else. Money reaching us is the one event in this product an owner will
   * chase within the hour, and a screen that looks like the record is gone is a screen that
   * has them ringing to ask whether their ৳720 arrived.
   */
  if (paymentError) {
    return (
      <div className="flex flex-col gap-4">
        <BackToPlan label={t.backToPlan} />
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  if (!payment) notFound()

  const sheet = purchaseReceipt(payment)

  const [{ data: center }, branchRow] = await Promise.all([
    // The billed-to block. The app shell's header is print:hidden, so this is the only thing
    // on the sheet that says which centre the money came from.
    supabase
      .from('coaching_centers')
      .select('name, phone, address')
      .eq('id', centerId)
      .maybeSingle(),
    /*
     * Which building the purchase was for, when the intent names one. Read from `branches`
     * by id rather than through `branchChoicesFor`, which filters on `active`: a branch that
     * has since closed was still what the places were bought for.
     */
    sheet.branchId === null
      ? null
      : supabase
          .from('branches')
          .select('name')
          .eq('coaching_center_id', centerId)
          .eq('id', sheet.branchId)
          .maybeSingle(),
  ])

  /*
   * Printed whatever those two reads did, which is the expense voucher's call rather than the
   * fee receipt's. Every figure comes off the payment row and is already correct; what a
   * dropped read costs is a postal address or a branch name, and neither is worth withholding
   * a receipt over.
   */
  const centerName = center?.name ?? session.active.centerName

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <BackToPlan label={t.backToPlan} />
        <PrintButton label={t.print} />
      </div>

      <section
        className="break-inside-avoid rounded-xl border border-line bg-white p-4
          print:rounded-none print:border-ink-faint"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div className="min-w-0">
            {/*
              Hard-coded, and the only string on any sheet that is. It is a proper noun, so
              it is the same word in both dictionaries — and putting it in bn.ts would be a
              Latin string in the Bangla file, which the i18n gate rightly refuses without a
              named exemption. Every generateMetadata in the app spells it out the same way.
            */}
            <h1 className="text-lg font-bold text-ink">CoachDesk</h1>
            <p className="text-sm text-ink-soft">{t.issuerLine}</p>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-sm font-medium text-ink-soft">{t.title}</p>
            {sheet.number !== null && (
              <>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {sheet.number.kind === 'purchase' ? t.purchaseNo : t.transferNo}
                </p>
                {/* The largest thing on the sheet after the amount: it is what somebody
                    quotes down a phone line, so it has to survive a photocopy. */}
                <p className="num text-xl font-bold text-ink">{sheet.number.value}</p>
              </>
            )}
          </div>
        </header>

        <div className="mt-3 border-b border-line pb-3">
          <p className="text-sm text-ink-soft">{t.billedTo}</p>
          <p className="font-semibold text-ink">{centerName}</p>
          {center?.address && <p className="text-sm text-ink-soft">{center.address}</p>}
          {center?.phone && <p className="num text-sm text-ink-soft">{center.phone}</p>}
          {branchRow?.data?.name && (
            <p className="text-sm text-ink-soft">
              {t.branch}: {branchRow.data.name}
            </p>
          )}
        </div>

        <dl className="mt-3 flex flex-col gap-1.5">
          {/* Converted, unlike the expense voucher's date — see the note at the top. */}
          <Line label={t.date} value={formatDate(todayInDhaka(new Date(sheet.paidAt)), locale)} num />
          {/* Absent rather than guessed at when there is no intent behind the row: a
              founder-recorded payment says what it was for in its note, if anywhere. */}
          {sheet.purpose !== null && (
            <Line label={t.what} value={t.bought[sheet.purpose](sheet.quantity)} />
          )}
          {sheet.coverage !== null && (
            <Line
              label={t.coverage}
              value={t.coverageRange(
                formatDate(sheet.coverage.from, locale),
                formatDate(sheet.coverage.to, locale),
              )}
              num
            />
          )}
          <Line label={t.method} value={d.feeRow.methods[sheet.method]} />
          {sheet.reference !== null && (
            <Line label={t.reference} value={sheet.reference} num />
          )}
          {sheet.note !== null && <Line label={t.note} value={sheet.note} />}
        </dl>

        {/* The figure the sheet is for. Neutral rather than the fee receipt's green: that
            green means money the centre received, and this is money it sent. */}
        <div className="mt-3 flex items-baseline justify-between gap-4 rounded-lg bg-surface-alt px-3 py-2">
          <span className="font-medium text-ink">{t.amount}</span>
          <span className="num text-2xl font-bold text-ink">{formatTaka(sheet.amount)}</span>
        </div>

        {/* What the purchase actually changed, and only where it changed something. On every
            purpose except places this is zero by check constraint, and "your limit went up by
            0" is a line an owner would stop and worry about for nothing. */}
        {sheet.placesAdded > 0 && (
          <p className="mt-3 font-medium text-ink">{t.placesAdded(sheet.placesAdded)}</p>
        )}

        <p className="mt-4 text-xs text-ink-faint">{t.footNote}</p>
        {/* Only for the handful of rows that carry neither identifier. Said out loud, because
            an owner looking for a number on a receipt and finding none assumes it is a bug. */}
        {sheet.number === null && (
          <p className="mt-1 text-xs text-ink-faint">{t.noNumberNote}</p>
        )}
      </section>
    </div>
  )
}

/** One label-and-value row. Same shape as the expense voucher's, for the same reason. */
function Line({
  label,
  value,
  num = false,
}: {
  label: string
  value: string
  /** Tabular figures, for anything the reader will compare against something else. */
  num?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className={`min-w-0 text-right font-medium text-ink ${num ? 'num' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

/** The way back. No month to carry, unlike the expense voucher's: /settings/plan has one view. */
function BackToPlan({ label }: { label: string }) {
  return (
    <Link
      href="/settings/plan"
      className="inline-flex min-h-tap items-center font-medium text-brand-700"
    >
      ← {label}
    </Link>
  )
}
