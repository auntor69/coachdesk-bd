'use client'

/**
 * The ways money changes hands, as one radio group.
 *
 * IN components/ RATHER THAN IN fees/, because the third form to ask the question is not
 * a fee form: writing down what the centre paid the landlord asks it too, and money going
 * out changes hands the same seven ways money coming in does. It sat next to the board it
 * was written for while both callers lived there; a sibling route folder reaching across
 * into another one to borrow a control would have been the wrong shape, and this is where
 * the components more than one screen needs already live.
 *
 * Sharing the control is the only way the lists cannot drift — a wallet added to the enum
 * turns up on every form or on none — and it keeps the refund panel from having to import
 * the board row it is rendered inside.
 *
 * NOT A `<select>`. The person using this is holding a phone in one hand with a parent
 * in front of them, and a row of chips' worth of tap target is worth more than the
 * vertical space a native picker would save.
 *
 * The values come straight from @/lib/fees/methods, which is the one list and carries the
 * compile-time check that it holds every value of the enum. Values only: the labels are
 * looked up in the dictionary, so a wallet added to the enum without a label is a compile
 * error rather than a blank chip.
 */
import type { PaymentMethod } from '@/lib/supabase/types'
import { PAYMENT_METHODS } from '@/lib/fees/methods'

/**
 * The dictionary's labels for them, keyed by the enum rather than by a loose string, so
 * a method with no label cannot compile and a label for a method that no longer exists
 * cannot linger.
 */
export type MethodLabels = Record<PaymentMethod, string>

export function MethodPicker({
  id,
  legend,
  labels,
  value,
  onChange,
}: {
  /**
   * Names the group for a screen reader, and it has to be unique in the document: the
   * board puts one of these under every open row, and `aria-labelledby` pointing at a
   * repeated id resolves to whichever came first. Callers key it on the invoice.
   */
  id: string
  legend: string
  labels: MethodLabels
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Not a `<label>`: it names a group of six radios, and a label may only point
          at one control. `aria-labelledby` is how a radiogroup gets a name, and
          without it a screen reader announces six unexplained wallets. */}
      <span id={id} className="font-medium text-ink">
        {legend}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {PAYMENT_METHODS.map((m) => (
          <label
            key={m}
            className={`inline-flex min-h-tap cursor-pointer items-center rounded-xl
              border-2 px-4 font-medium transition-colors ${
                value === m
                  ? 'border-brand-500 bg-brand-50 text-brand-800'
                  : 'border-line text-ink-soft'
              }`}
          >
            <input
              type="radio"
              name="method"
              value={m}
              checked={value === m}
              onChange={() => onChange(m)}
              className="sr-only"
            />
            {labels[m]}
          </label>
        ))}
      </div>
    </div>
  )
}
