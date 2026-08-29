'use client'

/**
 * The ways money changes hands, as one radio group.
 *
 * ITS OWN FILE RATHER THAN A PIECE OF payment-row.tsx, because two forms ask the
 * question now: the one that takes money in and the one that hands it back. Sharing the
 * control is the only way the two lists cannot drift — a wallet added to the enum has
 * to turn up on both forms or on neither — and it keeps the refund panel from having to
 * import the board row it is rendered inside.
 *
 * NOT A `<select>`. The person using this is holding a phone in one hand with a parent
 * in front of them, and a row of chips' worth of tap target is worth more than the
 * vertical space a native picker would save.
 */
import type { PaymentMethod } from '@/lib/supabase/types'
import { PAYMENT_METHODS } from '@/lib/fees/methods'

/**
 * Cash first, then the wallets an owner is actually handed money through.
 *
 * An alias now rather than a list, because this was one of five hand-typed copies of the
 * same seven values and one of them had drifted — see @/lib/fees/methods for the whole
 * story and for the compile-time check that replaces having to remember. Values only:
 * the labels are looked up in the dictionary, so a wallet added to the enum without a
 * label is still a compile error rather than a blank chip.
 *
 * The name stays because two forms import it.
 */
export const METHODS: readonly PaymentMethod[] = PAYMENT_METHODS

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
        {METHODS.map((m) => (
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
