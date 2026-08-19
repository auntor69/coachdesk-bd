'use client'

/**
 * The centre's name and payment wallet, with the message they produce.
 *
 * Both fields feed one 70-character SMS, and neither owner can be expected to
 * know that in the abstract — so the form shows the actual reminder as they type
 * and says, in one line, whether the payment number survived. That turns an
 * invisible constraint into an editing decision: shorten the name, or accept
 * that the number only goes out over WhatsApp.
 *
 * The preview is the one thing on this screen that is *not* translated. It is a
 * rendering of what a guardian receives, and a guardian receives Bangla whatever
 * language the owner reads the app in — showing an English-medium owner an English
 * preview would be showing them a message this product never sends.
 */
import { useActionState, useMemo, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { buildFeeReminderSms, WORST_CASE_NAME } from '@/lib/sms/templates'
import { fill } from '@/lib/i18n/fill'
import type { T } from '@/lib/i18n'
import type { PayoutWallet } from '@/lib/supabase/types'
import { saveCenterDetails, type ActionState } from '../actions'
import { MAX_NAME } from '@/lib/limits'

const WALLET_ORDER: PayoutWallet[] = ['bkash', 'nagad', 'rocket']

export function CenterForm({
  name: initialName,
  paymentWallet,
  paymentNumber,
  example,
  t,
  wallets,
  common,
}: {
  name: string
  paymentWallet: PayoutWallet | null
  paymentNumber: string | null
  /** `monthLabel` is the month in the reader's language; the rest feeds the SMS. */
  example: {
    studentName: string
    amount: number
    periodMonth: string
    monthLabel: string
  }
  t: T<'centerForm'>
  wallets: T<'wallets'>
  common: T<'common'>
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
      // Bangla, and not from the dictionary: this stands in for the centre's own
      // name inside a message a guardian reads. It is only ever seen for the
      // instant the field is empty.
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
        label={t.nameLabel}
        hint={t.nameHint}
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={MAX_NAME}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-ink">{t.walletLegend}</legend>
        <p className="-mt-1 mb-1 text-sm text-ink-soft">{t.walletHint}</p>
        <div className="flex flex-wrap gap-2">
          {([['', t.walletNone]] as [string, string][])
            .concat(WALLET_ORDER.map((key) => [key, wallets[key]]))
            .map(([value, label]) => (
              <label key={value} className="cursor-pointer">
                <input
                  type="radio"
                  name="paymentWallet"
                  value={value}
                  checked={wallet === value}
                  onChange={() => setWallet(value as '' | PayoutWallet)}
                  className="peer sr-only"
                />
                <span
                  className="inline-flex min-h-tap items-center rounded-xl border-2
                    border-line bg-white px-4 font-medium text-ink-soft
                    peer-checked:border-brand-600 peer-checked:bg-brand-50
                    peer-checked:text-brand-800"
                >
                  {label}
                </span>
              </label>
            ))}
        </div>
      </fieldset>

      {wallet && (
        <Field
          label={fill(t.numberLabel, { wallet: wallets[wallet] })}
          hint={t.numberHint}
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
          {fill(t.previewTitle, { month: example.monthLabel })}
        </p>
        <p
          className="mt-2 whitespace-pre-wrap break-words rounded-xl border
            border-line bg-white px-4 py-3 text-ink"
          lang="bn"
        >
          {preview.body}
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          <span className="num">{fill(t.chars, { n: preview.length })}</span> ·{' '}
          <span
            className={
              preview.segments > 1 ? 'num font-medium text-late' : 'num'
            }
          >
            {fill(t.smsCount, { n: preview.segments })}
          </span>
        </p>

        {preview.configured && (
          <p className="mt-3 border-t border-line pt-3 text-sm">
            {preview.inWorst ? (
              <span className="text-present">✓ {t.fitsAll}</span>
            ) : preview.inThis ? (
              <span className="text-late">{t.fitsSome}</span>
            ) : (
              <span className="text-late">{t.fitsNone}</span>
            )}
          </p>
        )}
      </div>

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : common.save}
      </Button>
    </form>
  )
}
