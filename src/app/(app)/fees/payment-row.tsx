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

import { Alert, Button, Field } from '@/components/ui'
import { formatDate, toBanglaDigits } from '@/lib/bd/time'
import { formatTaka as taka } from '@/lib/money'
import type { FeeReminderChannel } from '@/lib/supabase/types'
import { recordPayment, type FeeState } from './actions'
import {
  ChaseChips,
  CHANNEL_LABEL,
  type ChaseTarget,
  type ReminderCenter,
} from './reminder-chips'

export type { ReminderCenter }

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
 * A board row is a chase target plus the money the form needs. Extending rather
 * than restating it means the row cannot drift out of the shape the reminder
 * builders are fed — the guardian number and the opt-out in particular, which
 * decide whether a message can be sent at all.
 */
export type FeeRow = ChaseTarget & {
  studentCode: string | null
  billed: number
  discount: number
  net: number
  paid: number
  /** 'আজ' / 'গতকাল' / a date, computed server-side. Null if never chased. */
  remindedDay: string | null
  remindedVia: FeeReminderChannel | null
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
              {formatDate(row.dueDate)}
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

/**
 * The chase, as it appears under one board row: who was last contacted and when,
 * then the three chips.
 *
 * The chips themselves live in reminder-chips.tsx because the reminder worklist
 * renders exactly the same three, and the message a family receives must not
 * depend on which screen the owner was standing on.
 */
function Reminder({ row, center }: { row: FeeRow; center: ReminderCenter }) {
  const [sentVia, setSentVia] = useState<FeeReminderChannel | null>(null)

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

      <div className="mt-2">
        <ChaseChips target={row} center={center} onSent={setSentVia} />
      </div>
    </div>
  )
}
