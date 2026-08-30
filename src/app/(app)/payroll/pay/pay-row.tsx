'use client'

/**
 * One person's row for the month, with the form that hands them a salary behind a tap.
 *
 * WHAT IS ABOVE THE FORM IS THE GUARD AGAINST PAYING TWICE. 20260811000044 has no unique
 * index on (payee, for_month) on purpose — half a salary on the 5th and half on the 20th is
 * two real rows and a reversing correction is a third — so nothing in the database will
 * refuse a second payment, and ./actions.ts deliberately does not either. What stops an
 * owner paying a salary twice by accident is this row printing what is already on the
 * record for this month before the form opens. That is why the figures are not inside the
 * collapsed panel.
 *
 * FOUR BOXES OR ONE, decided by whether there is a live monthly agreement behind the row.
 * Four prefilled from the agreement is the ordinary case: `amount_bdt` is generated from
 * `basic + allowances + other − deductions`, a payslip has to be able to say what the
 * figure was made of, and the box that actually varies month to month is the deduction. One
 * empty box is for a per-class teacher or somebody with money on the month and no agreement
 * — there is no agreed figure to prefill, so four boxes would be four empty questions.
 *
 * THE TOTAL IS SHOWN BECAUSE THE DATABASE ADDS IT UP. Nobody types the figure that gets
 * recorded, and an owner handing over ৳13,000 has to see ৳13,000 before they tap rather
 * than four numbers they are expected to add up on a phone.
 *
 * NO EDIT AND NO DELETE, so `t.correctionHint` sits under the button and says how a mistake
 * is undone: 20260811000044 revokes DELETE from a browser session and grants UPDATE on
 * `(reference, note)` alone, which makes a reversing negative payment the only correction
 * there is. An owner who does not know that hunts for an edit button and, not finding one,
 * pays again.
 */
import { useActionState, useEffect, useRef, useState } from 'react'

import { MethodPicker, type MethodLabels } from '@/components/method-picker'
import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT } from '@/lib/limits'
import { formatTaka, parseTaka, sumTaka } from '@/lib/money'
import type { SalaryParts } from '@/lib/payroll/month'
import type { PaymentMethod } from '@/lib/supabase/types'
import { paySalary, type PayState } from './actions'

/**
 * One of the three figures a row prints, built by the page.
 *
 * Agreed, paid and left, kept apart in words all the way down: one taka figure per person
 * would be read as any of the three, and they differ by however much is still owed.
 */
export type RowFigure = { label: string; value: string }

export function PayRow({
  payee,
  forMonth,
  name,
  job,
  gone,
  offLabel,
  figures,
  hint,
  flag,
  parts,
  canWrite,
  methods,
  t,
  common,
}: {
  /** `payeeValue(kind, id)` — one field, so the browser cannot disagree about the kind. */
  payee: string
  /** The month the screen is showing, submitted with the form and never read from a clock. */
  forMonth: string
  name: string
  job: string
  /** Their staff row is switched off. They may still be paid — see ./actions.ts. */
  gone: boolean
  offLabel: string
  figures: RowFigure[]
  /** Why this row has no "left" figure, where that needs saying. */
  hint: string | null
  /** Already paid, overpaid, in how many instalments — joined by the page. */
  flag: string | null
  /** The agreement's four columns, or null where there is nothing to prefill. */
  parts: SalaryParts | null
  canWrite: boolean
  methods: MethodLabels
  t: T<'salaryPayForm'>
  common: T<'common'>
}) {
  const [state, action, pending] = useActionState<PayState, FormData>(paySalary, null)
  const [open, setOpen] = useState(false)

  /**
   * Cash first, and it survives a save, for the reason the spending form gives: salaries
   * get handed out in a sitting, and the next one usually goes the same way.
   */
  const [method, setMethod] = useState<PaymentMethod>('cash')

  /**
   * The token that makes this submit arrive once however many times it is delivered.
   *
   * 20260811000051 is the index that refuses the second arrival, and its header argues why
   * this form needed one more than the other two: a duplicate salary is subtracted from the
   * month's profit, cannot be deleted, and burns a second voucher number, so two slips
   * exist for one payment.
   */
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Minted after mount, never during render: `crypto.randomUUID` on the server and in
    // the browser would produce two different values for one form. `open` is in the deps
    // because the input does not exist until the panel does.
    const input = keyRef.current
    if (input && (state?.ok || !input.value)) input.value = mintIdempotencyKey()
  }, [state, open])

  return (
    <li className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className="truncate">{name}</span>
            {/* Grey and not the warning colour the bill uses. There an unstopped agreement
                belonging to somebody who left overstates the wage bill and is a fault; here
                it is a fact about a settlement that is very often the right thing to pay. */}
            {gone && (
              <span
                className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-xs
                  font-semibold text-ink-faint"
              >
                {offLabel}
              </span>
            )}
          </p>
          <p className="truncate text-sm text-ink-soft">{job}</p>
        </div>

        {/*
          All three figures on the right, stacked, and every one labelled. A wage bill is
          read down that column — twenty names scanned for the one figure that looks wrong —
          and `shrink-0` keeps the name truncating rather than the money.
        */}
        <dl className="shrink-0 text-right text-sm">
          {figures.map((f) => (
            <div key={f.label} className="flex items-baseline justify-end gap-2">
              <dt className="text-ink-faint">{f.label}</dt>
              <dd className="num min-w-[5.5rem] font-semibold text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {flag && <p className="mt-1 text-sm font-medium text-brand-700">{flag}</p>}
      {hint && <p className="mt-2 text-sm text-ink-soft">{hint}</p>}

      {canWrite &&
        (!open ? (
          <div className="mt-3 border-t border-line pt-3">
            {/* An error survives the panel closing because nothing moved. */}
            {state?.error && <Alert>{state.error}</Alert>}
            {/* A plain underlined word, not a button: the wide buttons in this app do the
                thing the screen is for, and this screen is for reading a month. */}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex min-h-tap items-center text-sm font-medium
                text-brand-700 underline"
            >
              {t.open}
            </button>
          </div>
        ) : (
          <form
            action={action}
            className="mt-3 flex flex-col gap-3 border-t border-line pt-3"
          >
            {/* No value in the markup: written after mount by the effect above. */}
            <input type="hidden" name="idempotencyKey" ref={keyRef} />
            <input type="hidden" name="payee" value={payee} />
            {/*
              The month comes off the screen the owner is looking at. A server clock would
              put every salary a centre pays on the 3rd into the wrong month, and
              `center_profit_month` groups by this column.
            */}
            <input type="hidden" name="forMonth" value={forMonth} />

            <p className="font-medium text-ink">{t.heading}</p>

            {state?.error && <Alert>{state.error}</Alert>}
            {state?.ok && (
              <p role="status" className="text-sm font-medium text-brand-700">
                {state.ok}
              </p>
            )}

            {/*
              Keyed on the confirmation, which is how the boxes go back to the agreement's
              figures once a salary is recorded without a `setState` in an effect: a new
              voucher number is a new key, so React remounts the fields with their defaults.
            */}
            <Amounts key={state?.ok ?? 'first'} parts={parts} t={t} />

            <MethodPicker
              // Unique per row: the page renders one of these under every person, and
              // `aria-labelledby` pointing at a repeated id resolves to whichever came first.
              id={`pay-method-${payee}`}
              legend={t.methodLabel}
              labels={methods}
              value={method}
              onChange={setMethod}
            />

            {/* Only once the money did not change hands in notes, and optional even then:
                a manager who paid by bKash and did not keep the ID still has to be able to
                write the salary down. */}
            {method !== 'cash' && (
              <Field
                label={`${t.referenceLabel} (${common.optional})`}
                name="reference"
                placeholder={t.referencePlaceholder}
                maxLength={MAX_LABEL}
                autoComplete="off"
                className="num"
              />
            )}

            <Field
              label={`${t.noteLabel} (${common.optional})`}
              name="note"
              placeholder={t.notePlaceholder}
              maxLength={MAX_TEXT}
              autoComplete="off"
            />

            <Button type="submit" full disabled={pending}>
              {pending ? t.paying : t.submit}
            </Button>

            {/* Under the button: it is what an owner needs to know at the moment their
                thumb is over the thing that cannot be undone. */}
            <p className="text-sm text-ink-faint">{t.correctionHint}</p>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-tap items-center self-start text-sm
                text-ink-faint underline"
            >
              {t.cancel}
            </button>
          </form>
        ))}
    </li>
  )
}

/** A prefilled box holds a plain figure, not formatted money: it is going to be edited. */
function box(value: number): string {
  return String(value)
}

/** What a box holds, as a number, with an empty box counting as nothing. */
function figure(text: string): number {
  return parseTaka(text) ?? 0
}

/**
 * The money boxes, and the figure they add up to.
 *
 * CONTROLLED, AND THE ONLY STATE ON THIS FORM THAT IS. The total under them is what will
 * actually be recorded — `amount_bdt` is generated from these four columns — so it has to
 * follow the typing rather than wait for a round trip.
 *
 * The arithmetic is `sumTaka`'s, in integer poisha, which is the same function the tested
 * month reads the result back through. Adding four floats here and letting Postgres add the
 * same four in numeric would eventually print a total a poisha away from the row.
 */
function Amounts({
  parts,
  t,
}: {
  parts: SalaryParts | null
  t: T<'salaryPayForm'>
}) {
  const [basic, setBasic] = useState(parts ? box(parts.basic) : '')
  const [allowances, setAllowances] = useState(parts ? box(parts.allowances) : '')
  const [other, setOther] = useState(parts ? box(parts.other) : '')
  const [deductions, setDeductions] = useState(parts ? box(parts.deductions) : '')

  /*
   * `type="text"` with a decimal keypad and never `type="number"`: a number input swallows
   * the taka sign and the Bangla digits a phone keyboard produces, and its scroll wheel
   * changes a figure somebody has already typed. `parseTaka` reads all of it.
   */
  const moneyBox = {
    type: 'text',
    inputMode: 'decimal' as const,
    maxLength: 12,
    autoComplete: 'off',
    className: 'num',
  }

  // One box, because there is no agreed figure to split into four. A per-class teacher or
  // somebody with money on this month and no live agreement.
  if (parts === null) {
    return (
      <Field
        {...moneyBox}
        label={t.amountLabel}
        name="basic"
        required
        value={basic}
        onChange={(e) => setBasic(e.target.value)}
      />
    )
  }

  const total = sumTaka([
    figure(basic),
    figure(allowances),
    figure(other),
    -figure(deductions),
  ])

  return (
    <>
      <Field
        {...moneyBox}
        label={t.basicLabel}
        name="basic"
        required
        value={basic}
        onChange={(e) => setBasic(e.target.value)}
      />
      <Field
        {...moneyBox}
        label={t.allowancesLabel}
        name="allowances"
        value={allowances}
        onChange={(e) => setAllowances(e.target.value)}
      />
      <Field
        {...moneyBox}
        label={t.otherLabel}
        name="other"
        value={other}
        onChange={(e) => setOther(e.target.value)}
      />
      {/* The one box where a minus sign is always a mistake — it is subtracted by the
          generated column, so a negative deduction would add to the salary. The action
          refuses it in words; the hint is so nobody types it. */}
      <Field
        {...moneyBox}
        label={t.deductionsLabel}
        hint={t.deductionsHint}
        name="deductions"
        value={deductions}
        onChange={(e) => setDeductions(e.target.value)}
      />

      <div
        className="flex items-baseline justify-between gap-4 rounded-xl bg-brand-50 px-4
          py-3"
      >
        <span className="font-medium text-brand-900">{t.totalLabel}</span>
        <span className="num text-lg font-bold text-brand-900">{formatTaka(total)}</span>
      </div>
    </>
  )
}
