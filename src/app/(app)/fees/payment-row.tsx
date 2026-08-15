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
import Link from 'next/link'

import { Alert, Button, Field } from '@/components/ui'
import { formatDateBn, toBanglaDigits } from '@/lib/bd/time'
import { formatTaka as taka } from '@/lib/money'
import { buildFeeReminderSms, buildFeeReminderText } from '@/lib/sms/templates'
import type { FeeReminderChannel, PayoutWallet } from '@/lib/supabase/types'
import { recordPayment, logFeeReminder, type FeeState } from './actions'

/** Cash first, then the wallets an owner is actually handed money through. */
const METHODS = [
  { value: 'cash', label: 'নগদ টাকা' },
  { value: 'bkash', label: 'বিকাশ' },
  { value: 'nagad', label: 'নগদ' },
  { value: 'rocket', label: 'রকেট' },
  { value: 'bank_transfer', label: 'ব্যাংক' },
  { value: 'other', label: 'অন্য' },
] as const

/**
 * "এসএমএস" rather than the formal "খুদেবার্তা", which nobody says out loud.
 */
const CHANNEL_LABEL: Record<FeeReminderChannel, string> = {
  sms: 'এসএমএস',
  whatsapp: 'হোয়াটসঅ্যাপ',
  call: 'কল',
}

export type FeeRow = {
  id: string
  name: string
  studentCode: string | null
  billed: number
  discount: number
  net: number
  paid: number
  remaining: number
  dueDate: string
  daysLate: number
  /** YYYY-MM-01 — which month's fee this is, for the reminder text. */
  periodMonth: string
  /** E.164, or null when the centre has not recorded one. */
  guardianPhone: string | null
  smsOptOut: boolean
  /** 'আজ' / 'গতকাল' / a date, computed server-side. Null if never chased. */
  remindedDay: string | null
  remindedVia: FeeReminderChannel | null
}

/**
 * The centre-level facts every reminder on the board needs: who is asking, and
 * where the money should go. One object rather than three props because they are
 * fetched together, they change together on one settings screen, and they are all
 * inputs to the same sentence.
 */
export type ReminderCenter = {
  name: string
  paymentWallet: PayoutWallet | null
  /** E.164, as coaching_centers stores it. Null until the owner sets one. */
  paymentNumber: string | null
}

export function PaymentRow({
  row,
  center,
}: {
  row: FeeRow
  center: ReminderCenter
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    recordPayment,
    null,
  )
  const [method, setMethod] = useState<string>('cash')
  const formRef = useRef<HTMLFormElement>(null)

  // Clear the typed amount once it has been recorded, so a second tap on the
  // same row cannot accidentally take the money twice. The field falls back to
  // whatever is now outstanding, which the server has just recalculated.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset()
  }, [state])

  const settled = row.remaining <= 0

  return (
    <li className="rounded-xl border border-line bg-white">
      <details className="group">
        <summary
          className="flex min-h-tap cursor-pointer list-none items-center
            justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {row.name}
              {row.studentCode && (
                <span className="num ml-2 text-sm text-ink-faint">{row.studentCode}</span>
              )}
            </p>
            <p className="text-sm text-ink-faint">
              {formatDateBn(row.dueDate)}
              {/* Only while the money is still owed. Red is the colour that means
                  act on this, and a settled invoice needs no action — leaving the
                  warning on a paid row spends the owner's attention on the one
                  place it cannot be used. That the family paid late is a pattern
                  worth a report, not a badge that never goes away. */}
              {!settled && row.daysLate > 0 && (
                <span className="font-medium text-absent">
                  {' '}
                  · <span className="num">{toBanglaDigits(row.daysLate)}</span> দিন দেরি
                </span>
              )}
            </p>
            {row.paid !== 0 && !settled && (
              <p className="num text-sm text-ink-soft">
                {taka(row.paid)} / {taka(row.net)} দেওয়া হয়েছে
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

          {/* A settled invoice keeps its history visible but offers no form.
              Recording more money against a paid bill is either a correction or
              a refund, and neither has a button yet — doing it by accident is
              the likelier outcome of leaving the field here. */}
          {settled ? (
            <>
              <p className="num mt-2 text-sm text-ink-soft">
                {taka(row.paid)} জমা হয়েছে · মোট {taka(row.net)}
                {row.discount > 0 && ` (${taka(row.discount)} ছাড়)`}
              </p>
              {/* Stated at the child's name, not just in the total at the top,
                  because this is where the owner looks when the parent asks
                  what happened to their extra hundred taka. */}
              {row.remaining < 0 && (
                <p className="num mt-1 text-sm font-medium text-late">
                  {taka(-row.remaining)} বেশি জমা আছে
                </p>
              )}
            </>
          ) : (
            <>
              {/* Above the form, not below it. A row opened on an overdue
                  invoice is more often opened to chase it than to take money
                  that nobody has brought yet, and the form is six fields tall —
                  putting the chase under it means scrolling past all of them. */}
              <Reminder row={row} center={center} />

              <form ref={formRef} action={formAction} className="flex flex-col gap-3">
                <input type="hidden" name="invoiceId" value={row.id} />

                <Field
                  label="কত টাকা জমা হলো"
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

                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-ink">কীভাবে</span>
                  <div role="radiogroup" className="flex flex-wrap gap-2">
                    {METHODS.map((m) => (
                      <label
                        key={m.value}
                        className={`inline-flex min-h-tap cursor-pointer items-center
                          rounded-xl border-2 px-4 font-medium transition-colors ${
                            method === m.value
                              ? 'border-brand-500 bg-brand-50 text-brand-800'
                              : 'border-line text-ink-soft'
                          }`}
                      >
                        <input
                          type="radio"
                          name="method"
                          value={m.value}
                          checked={method === m.value}
                          onChange={() => setMethod(m.value)}
                          className="sr-only"
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>

                {method !== 'cash' && (
                  <Field
                    label="ট্রানজেকশন আইডি (ঐচ্ছিক)"
                    name="reference"
                    placeholder="8N7A6B5C4D"
                    maxLength={40}
                    className="num"
                  />
                )}

                <Button type="submit" disabled={pending} full>
                  {pending ? 'জমা হচ্ছে…' : 'জমা নিন'}
                </Button>
              </form>
            </>
          )}
        </div>
      </details>
    </li>
  )
}

/** One tap target. Deliberately identical for all three — which channel a family
 *  actually reads is the centre's knowledge, not something to rank for them. */
const CHIP =
  'inline-flex min-h-tap items-center rounded-xl border-2 border-line px-4' +
  ' font-medium text-ink-soft transition-colors active:bg-brand-50'

/**
 * The chase: a prefilled SMS, a prefilled WhatsApp message, or a phone call.
 *
 * No gateway is involved. Each of these is a link that hands the message to the
 * owner's own phone with the text already written, so it goes from their number,
 * at their own operator's rate, and needs no registered sender ID — none of which
 * exists yet. The alternative available tonight is what the paper register
 * offered: read the number off a different screen and retype the amount from
 * memory.
 *
 * The message is built here rather than on the server because the row already
 * carries every input it needs, and shipping three rendered strings per invoice
 * down to a phone on 3G to save two pure function calls is the wrong trade. It is
 * the same function the cron worker will call when there is a gateway.
 *
 * Tapping does not wait for the log. The link navigates, the phone switches to
 * its messaging app, and the write lands in the background — an owner should
 * never watch a spinner between deciding to chase someone and being able to.
 */
function Reminder({ row, center }: { row: FeeRow; center: ReminderCenter }) {
  const [sentVia, setSentVia] = useState<FeeReminderChannel | null>(null)

  const input = {
    studentName: row.name,
    periodMonth: row.periodMonth,
    amount: row.remaining,
    dueDate: row.dueDate,
    daysLate: row.daysLate,
    centerName: center.name,
    // Passed to both builders and dropped by whichever cannot afford it. The SMS
    // gives it up when 70 characters will not stretch; WhatsApp always carries it.
    paymentWallet: center.paymentWallet,
    paymentNumber: center.paymentNumber,
  }
  const smsBody = buildFeeReminderSms(input).body
  const chatBody = buildFeeReminderText(input)
  const phone = row.guardianPhone

  // Set only once the row is actually in the database, never optimistically. The
  // whole point of the line below is to stop the owner chasing the same family
  // twice, and a badge that appears when the write failed would do the opposite
  // of that. The delay is invisible on a phone, which has already switched apps.
  function log(channel: FeeReminderChannel, body: string | null) {
    logFeeReminder({ invoiceId: row.id, channel, amount: row.remaining, toPhone: phone, body })
      .then((result) => {
        if (result.logged) setSentVia(channel)
      })
      .catch(() => {})
  }

  const day = sentVia ? 'এইমাত্র' : row.remindedDay
  const via = sentVia ?? row.remindedVia

  return (
    <div className="mb-4 border-b border-line pb-4">
      <p className="font-medium text-ink">অভিভাবককে মনে করিয়ে দিন</p>

      {/* No verb. Tapping the link proves the message was written and handed to
          the phone, not that a parent read it — and a call that rang out is
          still worth recording, because it is why the next try should be
          WhatsApp. "সর্বশেষ: আজ · কল" claims exactly what is known. */}
      {day && (
        <p className="mt-0.5 text-sm text-ink-faint">
          সর্বশেষ: {day}
          {via && ` · ${CHANNEL_LABEL[via]}`}
        </p>
      )}

      {phone === null ? (
        <p className="mt-2 text-sm text-ink-soft">
          অভিভাবকের নম্বর নেই।{' '}
          <Link href="/settings/students" className="font-medium text-brand-700">
            যোগ করে নিন
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* An opt-out is a preference about messages, so it silences both
                message channels — and neither of them silences the call. A phone
                call is a person, not a broadcast, and a family that asked not to
                be texted has not asked never to be spoken to. */}
            {!row.smsOptOut && (
              <>
                <a
                  // "?&body=" rather than "?body=": iOS historically wanted the
                  // separator to be "&" and Android wants "?", and this form is
                  // the one both parse. The empty first parameter is ignored.
                  href={`sms:${phone}?&body=${encodeURIComponent(smsBody)}`}
                  onClick={() => log('sms', smsBody)}
                  className={CHIP}
                >
                  {CHANNEL_LABEL.sms}
                </a>
                <a
                  // wa.me wants the number without the +.
                  href={`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(chatBody)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => log('whatsapp', chatBody)}
                  className={CHIP}
                >
                  {CHANNEL_LABEL.whatsapp}
                </a>
              </>
            )}
            <a
              href={`tel:${phone}`}
              onClick={() => log('call', null)}
              className={CHIP}
            >
              {CHANNEL_LABEL.call}
            </a>
          </div>

          {row.smsOptOut && (
            <p className="mt-2 text-sm text-ink-faint">
              এই পরিবার এসএমএস পেতে চায় না — ফোন করা যাবে।
            </p>
          )}
        </>
      )}
    </div>
  )
}
