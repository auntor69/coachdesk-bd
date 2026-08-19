'use client'

/**
 * The centre's name and payment wallet, with the message they produce.
 *
 * Both fields feed one 70-character SMS, and neither owner can be expected to
 * know that in the abstract — so the form shows the actual reminder as they type
 * and says, in one line, whether the payment number survived. That turns an
 * invisible constraint into an editing decision: shorten the name, or accept
 * that the number only goes out over WhatsApp.
 */
import { useActionState, useMemo, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { monthName } from '@/lib/bd/time'
import { buildFeeReminderSms, WALLET_LABEL_BN } from '@/lib/sms/templates'
import type { PayoutWallet } from '@/lib/supabase/types'
import { saveCenterDetails, type ActionState } from '../actions'
import { MAX_NAME } from '@/lib/limits'

/**
 * Fourteen code points with no space in them — exactly the budget
 * buildFeeReminderSms allows a student name, and short of a space so clamp()
 * cannot trim it back to a whole word. It therefore stands in for every name on
 * the roster at once: if the payment number fits alongside this, it fits for
 * everybody. Never rendered; it exists only to answer that question.
 */
const WORST_CASE_NAME = [...'মোহাম্মদসাদিয়ারহমান'].slice(0, 14).join('')

const WALLETS: { value: '' | PayoutWallet; label: string }[] = [
  { value: '', label: 'কোনোটাই না' },
  { value: 'bkash', label: WALLET_LABEL_BN.bkash },
  { value: 'nagad', label: WALLET_LABEL_BN.nagad },
  { value: 'rocket', label: WALLET_LABEL_BN.rocket },
]

export function CenterForm({
  name: initialName,
  paymentWallet,
  paymentNumber,
  example,
}: {
  name: string
  paymentWallet: PayoutWallet | null
  paymentNumber: string | null
  example: { studentName: string; amount: number; periodMonth: string }
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveCenterDetails,
    null,
  )

  const [name, setName] = useState(initialName)
  const [wallet, setWallet] = useState<'' | PayoutWallet>(paymentWallet ?? '')
  // Local form for editing — +8801… is not how anyone writes their own number.
  const [number, setNumber] = useState(
    paymentNumber ? formatBdMobile(paymentNumber) : '',
  )

  const preview = useMemo(() => {
    const input = {
      studentName: example.studentName,
      periodMonth: example.periodMonth,
      amount: example.amount,
      // The SMS never shows the due date; only the WhatsApp version does. Any
      // day inside the period keeps the input honest without inventing a fact.
      dueDate: `${example.periodMonth.slice(0, 8)}10`,
      daysLate: 0,
      centerName: name.trim() || 'কোচিং',
      paymentWallet: wallet || null,
      paymentNumber: number,
    }

    const shown = buildFeeReminderSms(input)
    const worst = buildFeeReminderSms({ ...input, studentName: WORST_CASE_NAME })

    const e164 = normalizeBdMobile(number)
    const digits = e164 ? formatBdMobile(e164) : ''
    const configured = Boolean(wallet && digits)

    return {
      body: shown.body,
      segments: shown.segments,
      length: [...shown.body].length,
      configured,
      inThis: configured && shown.body.includes(digits),
      inWorst: configured && worst.body.includes(digits),
    }
  }, [name, wallet, number, example])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert tone="ok">{state.ok}</Alert>}

      <Field
        label="কোচিংয়ের নাম"
        hint="প্রতিটি SMS-এর শেষে এই নামই যাবে, তাই ছোট নাম হলে ভালো"
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={MAX_NAME}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-ink">অভিভাবক কোথায় টাকা পাঠাবেন</legend>
        <p className="-mt-1 mb-1 text-sm text-ink-soft">
          ফি-এর বার্তায় এই নম্বরটি লেখা থাকবে
        </p>
        <div className="flex flex-wrap gap-2">
          {WALLETS.map((option) => (
            <label key={option.value} className="cursor-pointer">
              <input
                type="radio"
                name="paymentWallet"
                value={option.value}
                checked={wallet === option.value}
                onChange={() => setWallet(option.value)}
                className="peer sr-only"
              />
              <span
                className="inline-flex min-h-tap items-center rounded-xl border-2
                  border-line bg-white px-4 font-medium text-ink-soft
                  peer-checked:border-brand-600 peer-checked:bg-brand-50
                  peer-checked:text-brand-800"
              >
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {wallet && (
        <Field
          label={`${WALLET_LABEL_BN[wallet]} নম্বর`}
          hint="যে নম্বরে টাকা আসবে — ১১ সংখ্যা, যেমন 01712345678"
          name="paymentNumber"
          type="tel"
          inputMode="numeric"
          // No autofill. The browser would happily offer any number it has
          // stored, and a silently wrong value here sends a month of fees to
          // somebody else's wallet.
          autoComplete="off"
          maxLength={20}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="num"
        />
      )}

      {/*
        Below the fields, not above them: it is the consequence of the edits, and
        reading it before making them means nothing.
      */}
      <div className="rounded-2xl border border-line bg-brand-50/40 p-5">
        <p className="text-sm font-medium text-ink-soft">
          {monthName(example.periodMonth)} মাসের ফি-এর বার্তা দেখতে এমন হবে
        </p>
        <p
          className="mt-2 whitespace-pre-wrap break-words rounded-xl border
            border-line bg-white px-4 py-3 text-ink"
        >
          {preview.body}
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          <span className="num">{preview.length}</span> অক্ষর ·{' '}
          <span className={preview.segments > 1 ? 'font-medium text-late' : undefined}>
            <span className="num">{preview.segments}</span>টি SMS
          </span>
        </p>

        {preview.configured && (
          <p className="mt-3 border-t border-line pt-3 text-sm">
            {preview.inWorst ? (
              <span className="text-present">
                ✓ সব শিক্ষার্থীর বার্তায় নম্বরটি থাকবে
              </span>
            ) : preview.inThis ? (
              <span className="text-late">
                লম্বা নামের কিছু শিক্ষার্থীর বার্তা থেকে নম্বরটি বাদ যাবে। নাম ছোট
                করলে সবার বার্তাতেই জায়গা হবে।
              </span>
            ) : (
              <span className="text-late">
                নামটি লম্বা হওয়ায় SMS-এ নম্বরের জায়গা হচ্ছে না। কোচিংয়ের নাম ছোট
                করলে হবে — WhatsApp-এ নম্বরটি সবসময়ই যাবে।
              </span>
            )}
          </p>
        )}
      </div>

      <Button type="submit" full disabled={pending}>
        {pending ? 'সেভ হচ্ছে…' : 'সেভ করুন'}
      </Button>
    </form>
  )
}
