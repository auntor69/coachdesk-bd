'use client'

/**
 * One row of the fee board: the form that records money against it, and the
 * three ways to chase it.
 *
 * Built for someone standing at a desk with a parent in front of them and a
 * queue behind. So: the amount is prefilled with what is owed, because paying in
 * full is the normal case and typing a number twice is where mistakes come from;
 * the confirmation names the student, because the fear is putting money on the
 * wrong child; and the form stays open after saving so that confirmation is
 * still on screen when they look up.
 *
 * The reference field appears only for the wallets that have one. Cash never
 * asks for it — some owners will not put every taka through bKash, and a tool
 * that demands a transaction id for cash is a tool they stop using in week two.
 */
import { useActionState, useEffect, useRef, useState } from 'react'

import { MethodPicker } from '@/components/method-picker'
import { PaperLink } from '@/components/paper-link'
import { Alert, Button, Field } from '@/components/ui'
import { digits, formatDate } from '@/lib/bd/time'
import type { Award } from '@/lib/fees/scholarship'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { MAX_LABEL } from '@/lib/limits'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka as taka } from '@/lib/money'
import type { OutreachChannel, PaymentMethod } from '@/lib/supabase/types'
import { recordPayment, type FeeState } from './actions'
import { CancelBill } from './cancel-bill'
import { DiscountBill } from './discount'
import { RefundBill } from './refund'
import {
  ChaseChips,
  lateLabel,
  type ChaseTarget,
  type ReminderCenter,
} from './reminder-chips'

export type { ReminderCenter }

/**
 * The groups this row and the things inside it need. Not the locale's dictionary and
 * not a provider: one group per component keeps the payload to the strings actually
 * rendered, and the board ships one copy of these for the whole page however many
 * rows are on it.
 */
type RowWords = {
  t: T<'feeRow'>
  chase: T<'chase'>
  channels: T<'channels'>
  cancel: T<'cancel'>
  refund: T<'refund'>
  discount: T<'discount'>
  common: T<'common'>
}

/**
 * A board row is a chase target plus the money the form needs. Extending rather
 * than restating it means the row cannot drift out of the shape the reminder
 * builders are fed — the guardian number and the opt-out in particular, which
 * decide whether a message can be sent at all.
 */
export type FeeRow = ChaseTarget & {
  studentCode: string | null
  billed: number
  discount: number
  /**
   * Why the centre waived it, in the owner's own words, or null. Carried onto the row
   * rather than fetched when the panel opens: a cancelled bill leaves the board and a
   * discounted one stays on it, so this is the question the owner asks months later —
   * looking at the row, not at a form.
   */
  discountReason: string | null
  /**
   * How the waiver was said, when it was said as more than a figure (§9.3).
   *
   * `discountPercent` and `scholarshipId` are frozen on the invoice; `scholarshipName` is
   * joined live from the award, so a spelling corrected on the list is corrected on every
   * bill it ever labelled. Null on a retired award is not possible — retiring keeps the
   * row — but a null name with a set id would be a cross-centre row the FK forbids.
   */
  discountPercent: number | null
  scholarshipId: string | null
  scholarshipName: string | null
  /**
   * Which part of an agreed plan this bill is, or null on a bill that is not part of one.
   *
   * Both or neither, which the invoice's own check constraint guarantees — the label reads
   * "part 2 of 3" and needs the pair. Without it an owner cannot tell ৳2,000 overdue on a
   * ৳2,000 fee from the first third of a ৳6,000 agreement being honoured, and those are
   * opposite conversations to have with the family.
   */
  instalmentNo: number | null
  instalmentOf: number | null
  net: number
  paid: number
  /** "today" / "yesterday" / a date, written server-side. Null if never chased. */
  remindedDay: string | null
  remindedVia: OutreachChannel | null
}

export function PaymentRow({
  row,
  center,
  locale,
  words,
  awards,
  readOnly = false,
}: {
  row: FeeRow
  center: ReminderCenter
  /**
   * For the date and the day count, which `formatDate` and `lateLabel` render in
   * the reader's own numerals. Two bytes on the wire, and it buys this component
   * the whole of lib/bd without either dictionary coming with it.
   */
  locale: Locale
  words: RowWords
  /**
   * The centre's awards that are still in use, for the waiver panel's select. Read
   * once by the board and handed to every row as the same array, so it crosses the
   * wire once however many rows there are.
   */
  awards: Award[]
  /**
   * A teacher with can_view_fees reads this board; they do not collect on it. See
   * the read-only branch below for what that removes and why it is a different
   * shape rather than a disabled one.
   */
  readOnly?: boolean
}) {
  const { t, chase, channels, cancel, refund, discount, common } = words
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    recordPayment,
    null,
  )
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const formRef = useRef<HTMLFormElement>(null)

  /**
   * A DOM id that is unique across the whole board, and it has to be.
   *
   * `Field` falls back to the input's `name` when given no id, which is right on a
   * screen with one form and wrong on this one: a batch of forty students puts forty
   * `id="amount"` in the document, and `<label for="amount">` resolves to whichever
   * came first. Tapping the amount label on the seventh row would focus the first
   * row's field — money typed against the wrong child, which is the one mistake this
   * screen exists to prevent. Every row is in the DOM whether its `<details>` is open
   * or not, so collapsing them does not help.
   *
   * Keyed on the invoice id rather than the index, so it survives the board being
   * re-sorted and matches the `invoiceId` the form actually posts.
   */
  const fid = (name: string) => `${name}-${row.id}`

  /**
   * The token that makes this form's submit arrive once however many times it is
   * delivered. See lib/idempotency.ts for the failure it exists for — the short
   * version is that the insert can land while the response does not, and a fee
   * payment cannot be deleted afterwards by anybody.
   *
   * A ref into the DOM rather than a piece of React state, and it has to be: the
   * server and the browser would mint two different uuids for the same markup, so
   * this value cannot come out of render at all. Setting it from an effect is
   * exactly what an effect is for — the input is an external system holding a value
   * React does not own.
   */
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Clear the typed amount once it has been recorded, so a second tap on the same
    // row cannot accidentally take the money twice. The field falls back to whatever
    // is now outstanding, which the server has just recalculated.
    if (state?.ok) formRef.current?.reset()

    // Then the token, in that order: `reset()` puts every control back to its default
    // and this input has no default, so minting first would hand the next payment an
    // empty one.
    //
    // Minted on mount (nothing in the input yet) and again once money has been
    // recorded (the old token is spent — reusing it would collide with the row
    // already there and answer the next parent's payment with the previous receipt,
    // which is a real payment silently not recorded, worse than the double it
    // prevents). Not after an error: nothing was written, so keeping the token means
    // resubmitting the same amount is still deduplicated.
    const input = keyRef.current
    if (input && (state?.ok || !input.value)) input.value = mintIdempotencyKey()
  }, [state])

  const settled = row.remaining <= 0
  const head = (
    <RowHead row={row} settled={settled} locale={locale} t={t} common={common} />
  )

  // Not a `<details>` with a disabled form in it, and not one with an empty
  // panel: everything inside the disclosure is either a way to take money or a
  // way to chase it, and a read-only reader has neither. What is left is exactly
  // the summary, so the summary is the whole row — a control that opens onto
  // nothing reads as a bug, and one that opens onto greyed-out buttons reads as
  // a permission the owner forgot to grant.
  if (readOnly) {
    return (
      <li className="rounded-xl border border-line bg-white">
        <div className="flex min-h-tap items-center justify-between gap-3 px-4 py-3">
          {head}
        </div>
      </li>
    )
  }

  return (
    <li className="rounded-xl border border-line bg-white">
      <details className="group">
        <summary
          className="flex min-h-tap cursor-pointer list-none items-center
            justify-between gap-3 px-4 py-3"
        >
          {head}
        </summary>

        <div className="border-t border-line px-4 py-4">
          {state?.error && <Alert>{state.error}</Alert>}
          {state?.ok && (
            <p role="status" className="font-medium text-brand-700">
              {state.ok}
            </p>
          )}
          {state?.warn && (
            <div className="mt-2">
              <Alert tone="warn">{state.warn}</Alert>
            </div>
          )}
          {/* Under the confirmation, and only once there is money to print. The
              number is beside the link rather than inside it because the owner will
              read it out to the parent before either of them has seen a sheet of
              paper — and a figure in the middle of a translated sentence would have
              to be a template filled in the browser for no gain. */}
          {state?.receipt && (
            <div className="mt-2 flex items-center gap-2">
              <PaperLink
                href={`/fees/receipt/${state.receipt.id}`}
                label={`${t.receiptLink} ${state.receipt.no}`}
              >
                {t.receiptLink}
              </PaperLink>
              <span className="num text-ink-soft">#{state.receipt.no}</span>
            </div>
          )}

          {/* A settled invoice keeps its history visible but offers no form.
              Recording more money against a paid bill is either a correction or
              a refund; the refund has its own control below, which turns a
              positive figure negative on the way in, and a correction is not
              something this field can express. */}
          {settled ? (
            <>
              <p className="num mt-2 text-sm text-ink-soft">
                {fill(t.settled, { paid: taka(row.paid), net: taka(row.net) })}
              </p>
              {/* Stated at the child's name, not just in the total at the top,
                  because this is where the owner looks when the parent asks
                  what happened to their extra hundred taka. */}
              {row.remaining < 0 && (
                <p className="num mt-1 text-sm font-medium text-late">
                  {fill(t.inCredit, { amount: taka(-row.remaining) })}
                </p>
              )}
            </>
          ) : (
            <>
              {/* Above the form, not below it. A row opened on an overdue
                  invoice is more often opened to chase it than to take money
                  that nobody has brought yet, and the form is six fields tall —
                  putting the chase under it means scrolling past all of them. */}
              <Reminder
                row={row}
                center={center}
                t={t}
                chase={chase}
                channels={channels}
              />

              <form ref={formRef} action={formAction} className="flex flex-col gap-3">
                <input type="hidden" name="invoiceId" value={row.id} />
                {/* No value in the markup, on purpose: it is written after mount by
                    the effect above, because a uuid minted during render would be a
                    different one on the server than in the browser. */}
                <input type="hidden" name="idempotencyKey" ref={keyRef} />

                <Field
                  label={t.amount}
                  id={fid('amount')}
                  name="amount"
                  // Not type="number": it strips the thousands separator an owner
                  // may type and refuses Bangla digits outright, and parseTaka
                  // handles both. inputMode still brings up the number pad.
                  type="text"
                  inputMode="decimal"
                  defaultValue={String(row.remaining)}
                  required
                  maxLength={12}
                  className="num"
                />

                <MethodPicker
                  id={fid('method')}
                  legend={t.method}
                  labels={t.methods}
                  value={method}
                  onChange={setMethod}
                />

                {method !== 'cash' && (
                  <Field
                    label={`${t.reference} (${common.optional})`}
                    id={fid('reference')}
                    name="reference"
                    placeholder="8N7A6B5C4D"
                    maxLength={MAX_LABEL}
                    className="num"
                  />
                )}

                <Button type="submit" disabled={pending} full>
                  {pending ? t.receiving : t.receive}
                </Button>
              </form>
            </>
          )}

          {/* What the centre waived, and why, on one line under both branches rather
              than appended to the settled sentence it used to hang off. Two reasons it
              moved: an unpaid bill with a waiver on it said nothing at all before, which
              is the more common case now that waivers can be granted from this panel;
              and the owner's own words needed somewhere to go. A discounted bill stays
              on the board for as long as the centre exists, so "কেন এই পরিবারের বিল কম"
              is asked here, looking at the row. */}
          {row.discount > 0 && (
            <div className="mt-2">
              <p className="num text-sm text-ink-soft">
                {fill(t.discount, { amount: taka(row.discount) })}
              </p>
              {/* What kind of waiver it was, when it was more than a figure somebody
                  typed. The name first, because that is what a report totals; a bare
                  share only when there is no name behind it, since a named percentage
                  award already carries its rule in the label. */}
              {row.scholarshipName && (
                <p className="mt-0.5 text-sm text-ink-soft">
                  <span className="text-ink-faint">{t.awardLabel}:</span>{' '}
                  {row.scholarshipName}
                  {row.discountPercent !== null && (
                    <span className="num"> ({row.discountPercent}%)</span>
                  )}
                </p>
              )}
              {!row.scholarshipName && row.discountPercent !== null && (
                <p className="num mt-0.5 text-sm text-ink-soft">
                  {fill(t.discountShare, { percent: row.discountPercent })}
                </p>
              )}
              {/* Only when they left any: a blank line under a figure reads as a
                  rendering fault rather than as "they wrote nothing". */}
              {row.discountReason && (
                <p className="mt-0.5 text-sm text-ink-soft">
                  <span className="text-ink-faint">{discount.reasonLabel}:</span>{' '}
                  {row.discountReason}
                </p>
              )}
            </div>
          )}

          {/* Money out, and only when there is any on the bill: a control whose only
              possible answer is "this family has paid nothing" is a control that
              teaches an owner to distrust the panel. `row.paid` is the netted figure,
              so a bill already handed back in full loses this again.

              Above the cancel step rather than below it, because it is the step that
              unblocks the cancel step — cancel.paidNote points up at it by name — and
              because keeping the two money forms next to each other leaves the bottom
              of the panel to the one control that is about the bill rather than the
              cash. */}
          {row.paid > 0 && (
            <RefundBill
              invoiceId={row.id}
              paid={row.paid}
              remaining={row.remaining}
              t={refund}
              methods={t.methods}
              common={common}
            />
          )}

          {/* A fee the centre decided not to charge. Unconditional, unlike the refund
              control: every live bill can carry a waiver, including one already paid in
              full — that leaves the family in credit, which is true, and the refund
              control directly above is how the money goes home.

              Between the two money forms and the cancel step because that is what it is
              between in kind: it changes what a family owes, like a payment, but it is a
              decision about the bill, like a cancellation. */}
          <DiscountBill
            invoiceId={row.id}
            billed={row.billed}
            discount={row.discount}
            // Always live here: both board queries filter `voided_at is null`, so a
            // cancelled bill is not on this list at all. Passed rather than hard-coded
            // so the panel's own refusal is the shared rule's, not this file's
            // assumption about which query it was rendered from.
            voidedAt={null}
            awards={awards}
            // How the waiver on this bill was last said, so the panel opens at it rather
            // than at taka. Frozen figures off the invoice, not the award's rule today.
            scholarshipId={row.scholarshipId}
            discountPercent={row.discountPercent}
            t={discount}
            common={common}
          />

          {/* Last thing in the panel, under every branch, because it belongs to
              none of them: a bill raised against the wrong child is as likely to have
              been paid off as not, and hiding the way out of one behind "this is
              settled" would leave the ৳0 duplicates on the board forever.

              Its own separator and its own quiet styling — see cancel-bill.tsx for why
              it must not look like the button above it. `row.paid` is the netted
              figure, so a payment already handed back does not stand in the way. */}
          <CancelBill
            invoiceId={row.id}
            paid={row.paid}
            t={cancel}
            common={common}
          />
        </div>
      </details>
    </li>
  )
}

/**
 * The name, the deadline and the money — the part of a row that is the same
 * whether it is a summary you can open or a line you can only read.
 *
 * A fragment rather than a wrapper, so both parents keep their own flex classes
 * and neither gains a div. Split out for one reason: the read-only board and the
 * collecting board must show a family's arrears identically, and the way that
 * stops being true is two copies of this markup drifting a badge apart.
 */
function RowHead({
  row,
  settled,
  locale,
  t,
  common,
}: {
  row: FeeRow
  settled: boolean
  locale: Locale
  t: T<'feeRow'>
  common: T<'common'>
}) {
  return (
    <>
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">
          {row.name}
          {row.studentCode && (
            <span className="num ml-2 text-sm text-ink-faint">{row.studentCode}</span>
          )}
        </p>
        <p className="text-sm text-ink-faint">
          {formatDate(row.dueDate, locale)}
          {/* Which part of an agreed plan this is, so an overdue ৳2,000 on a ৳6,000 fee
              reads as a family keeping to a schedule rather than one who has paid a
              third of a bill. Not styled as a warning: it is what the bill is. */}
          {row.instalmentNo !== null && row.instalmentOf !== null && (
            <span className="num">
              {' · '}
              {fill(t.instalmentPart, {
                n: digits(row.instalmentNo, locale),
                of: digits(row.instalmentOf, locale),
              })}
            </span>
          )}
          {/* Only while the money is still owed. Red is the colour that means
              act on this, and a settled invoice needs no action — leaving the
              warning on a paid row spends the owner's attention on the one
              place it cannot be used. That the family paid late is a pattern
              worth a report, not a badge that never goes away. */}
          {!settled && row.daysLate > 0 && (
            <span className="num font-medium text-absent">
              {' · '}
              {lateLabel(row.daysLate, locale, common)}
            </span>
          )}
        </p>
        {row.paid !== 0 && !settled && (
          <p className="num text-sm text-ink-soft">
            {fill(t.paidOf, { paid: taka(row.paid), net: taka(row.net) })}
          </p>
        )}
      </div>

      <span
        className={`num shrink-0 font-semibold ${
          settled ? 'text-present' : row.daysLate > 0 ? 'text-absent' : 'text-ink'
        }`}
      >
        {settled ? '✓' : taka(row.remaining)}
      </span>
    </>
  )
}

/**
 * The chase, as it appears under one board row: who was last contacted and when,
 * then the three chips.
 *
 * The chips themselves live in reminder-chips.tsx because the reminder worklist
 * renders exactly the same three, and the message a family receives must not
 * depend on which screen the owner was standing on.
 */
function Reminder({
  row,
  center,
  t,
  chase,
  channels,
}: {
  row: FeeRow
  center: ReminderCenter
  t: T<'feeRow'>
  chase: T<'chase'>
  channels: T<'channels'>
}) {
  const [sentVia, setSentVia] = useState<OutreachChannel | null>(null)

  const day = sentVia ? t.justNow : row.remindedDay
  const via = sentVia ?? row.remindedVia

  return (
    <div className="mb-4 border-b border-line pb-4">
      <p className="font-medium text-ink">{t.chaseTitle}</p>

      {/* No verb. Tapping the link proves the message was written and handed to
          the phone, not that a parent read it — and a call that rang out is
          still worth recording, because it is why the next try should be
          WhatsApp. "সর্বশেষ: আজ · কল" claims exactly what is known. */}
      {day && (
        <p className="mt-0.5 text-sm text-ink-faint">
          {t.lastChase}: {day}
          {via && ` · ${channels[via]}`}
        </p>
      )}

      <div className="mt-2">
        <ChaseChips
          target={row}
          center={center}
          onSent={setSentVia}
          t={chase}
          channels={channels}
        />
      </div>
    </div>
  )
}
