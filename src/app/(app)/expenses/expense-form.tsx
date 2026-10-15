'use client'

/**
 * The form that writes down a bill the centre paid.
 *
 * THE ONLY WAY MONEY GOING OUT GETS ONTO THE RECORD, which is what makes it the other
 * half of the profit figure. Everything about its shape follows from one fact about the
 * table behind it: 20260811000045 revoked DELETE from a browser session and granted
 * UPDATE on three columns that are not the amount. A figure typed wrong here is not
 * something the owner can come back and fix — it is something they correct with a second
 * row carrying a minus sign, which is why `t.immutable` sits under the button and says so
 * before they submit rather than after.
 *
 * TODAY ARRIVES AS A PROP. A client component that read the clock itself would render one
 * date on the server and another in the browser for six hours out of every twenty-four —
 * Dhaka is UTC+6 and `new Date()` in here is the reader's own machine, which may be set to
 * anything at all. The page computes it once with `todayInDhaka()`, and the same string
 * both fills the field and caps it.
 *
 * NO EDIT BUTTON AND NO DELETE, then. There is a branch field now, where there is
 * anything to ask: this docstring used to say a picker here would be "this screen
 * inventing a boundary the rest of the app does not enforce", which was true until
 * 20260811000053 gave the column its meaning and 20260811000054 started filling it in.
 * Rent is the plainest thing a branch owns, so an institution's head office is asked
 * which building's bill this is; everybody else is answered for and sees no field.
 */
import { useActionState, useEffect, useRef, useState } from 'react'

import { BranchPicker } from '@/components/branch-picker'
import { MethodPicker, type MethodLabels } from '@/components/method-picker'
import { PaperLink } from '@/components/paper-link'
import { Alert, Button, Field } from '@/components/ui'
import type { BranchChoice } from '@/lib/branches'
import { EXPENSE_CATEGORIES, type CategoryLabels } from '@/lib/expenses/categories'
import type { T } from '@/lib/i18n'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { MAX_LABEL, MAX_TEXT } from '@/lib/limits'
import type { PaymentMethod } from '@/lib/supabase/types'
import { recordExpense, type ExpenseState } from './actions'

/** The notice form's select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

/**
 * The floor the action enforces, repeated so the browser's own picker refuses below it.
 *
 * Two copies of one date is a real cost, and the alternative is worse: `min` cannot be
 * handed down from the action without exporting a constant from a `"use server"` file,
 * which Next refuses to build. The server's check is the one that counts — this is the
 * spinner in the date field stopping at a sensible year, not a rule.
 */
const EARLIEST_SPEND = '2000-01-01'

export function ExpenseForm({
  t,
  categories,
  methods,
  common,
  today,
  branchPick,
  branches,
}: {
  t: T<'expenseForm'>
  /** The page's own labels, passed down rather than duplicated. See CategoryLabels. */
  categories: CategoryLabels
  /** `d.feeRow.methods`, the same map the collection form's picker is given. */
  methods: MethodLabels
  common: T<'common'>
  /** Today in Dhaka, as YYYY-MM-DD, written by the page. */
  today: string
  branchPick: T<'branchPick'>
  /** `null` draws no branch field at all — see branchChoicesFor. */
  branches: BranchChoice[] | null
}) {
  const [state, action, pending] = useActionState<ExpenseState, FormData>(
    recordExpense,
    null,
  )

  const formRef = useRef<HTMLFormElement>(null)

  /**
   * The token that makes this submit arrive once however many times it is delivered.
   *
   * Same mechanism as the payment and refund forms, and needed here for the reason those
   * two comments give doubled: a double-tap on 3G writes a second permanent row, and
   * `center_profit_month` subtracts it. Rent entered twice is rent-sized money missing
   * from the month's profit for cash that never left the drawer, and nobody can delete
   * the second row afterwards. 20260811000050 is the index that refuses it.
   */
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Clear the typed figures once the money is on the record, then re-mint: `reset()`
    // puts every control back to its default and the token input has none, so minting
    // first would hand the next expense an empty one. Not after an error — nothing was
    // written, so keeping the token means a retry of the same entry is still deduplicated.
    if (state?.ok) formRef.current?.reset()

    const input = keyRef.current
    if (input && (state?.ok || !input.value)) input.value = mintIdempotencyKey()
  }, [state])

  /**
   * The picker is controlled, so the method it holds has to live somewhere.
   *
   * Cash first because that is how a coaching centre pays for photocopies, and because
   * the reference field below only appears once the answer stops being cash — a
   * transaction ID for money handed over in notes is a box with nothing to put in it.
   *
   * AND IT SURVIVES A SAVE, unlike every other control on this form. `reset()` above
   * clears the figures because the next expense is a different one; the method is the
   * one answer the next expense usually shares, because bills get paid in a sitting —
   * three bKash payments entered off three SMS confirmations, or an afternoon's
   * receipts, all one way. Both fee forms leave it alone for the same reason. The
   * reference *field* still empties: it is uncontrolled, so `reset()` reaches it, which
   * is right — one transaction ID is never another's.
   */
  const [method, setMethod] = useState<PaymentMethod>('cash')

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      {/* No value in the markup, on purpose: written after mount by the effect above,
          because a uuid minted during render would differ between the server and the
          browser. */}
      <input type="hidden" name="idempotencyKey" ref={keyRef} />

      <p className="font-medium text-ink">{t.formTitle}</p>

      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {state.ok}
        </p>
      )}

      {/*
        The voucher, the instant it is written — the sheet the person who took the money signs
        and the office keeps. The sentence above says the voucher number; this opens the paper
        it is printed on, instead of sending the owner down to the register to find the number
        again and guess that it is tappable.

        Behind the same `state` as the sentence, so the replay branch gets it too: a retry
        carries the row the first arrival wrote, which is the same voucher and not a second.
      */}
      {state?.receipt && (
        <PaperLink
          href={`/expenses/voucher/${state.receipt.id}`}
          label={`${t.printVoucher} ${state.receipt.no}`}
        >
          {t.printVoucher}
        </PaperLink>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.categoryLabel}</span>
        {/* Empty first and `required`, the way the exam form asks for a type: a select
            that defaults to `rent` puts the centre's largest recurring bill one careless
            submit away, and a select with no empty option cannot be left unanswered by
            somebody who has not decided yet. */}
        <select name="category" required defaultValue="" className={SELECT_CLASS}>
          <option value="">—</option>
          {EXPENSE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {categories[category]}
            </option>
          ))}
        </select>
      </label>

      {/* Which building's bill this is, and only for the head office of an institution
          with more than one — see BranchPicker, which draws no field for everybody else
          and answers for them in a hidden one. Beside the category rather than lower
          down, because the two of them are the same kind of question: what this row is,
          as against what it cost. Below them the amount, the date and the method read as
          one block of figures.

          `reset()` above puts it back to head office after each save, unlike the method
          below it. The method survives because the next bill in the pile was usually
          paid the same way; the building usually was not, because the head office is
          the one desk that holds every building's paper. */}
      <BranchPicker t={branchPick} branches={branches} current={null} />

      {/* `type="text"` with a decimal keypad rather than `type="number"`: a number input
          swallows the taka sign and the Bangla digits a phone keyboard produces, and its
          scroll wheel changes a figure somebody has already typed. `parseTaka` reads all
          of it. Negative allowed, because a minus row is the only correction there is. */}
      <Field
        label={t.amountLabel}
        name="amount"
        type="text"
        inputMode="decimal"
        required
        maxLength={12}
        autoComplete="off"
        className="num"
      />

      {/* Defaulted to today and capped there. The floor is the year, not the month: a
          centre entering last December's electricity bill in January is ordinary. */}
      <Field
        label={t.dateLabel}
        name="spentOn"
        type="date"
        required
        defaultValue={today}
        min={EARLIEST_SPEND}
        max={today}
      />

      <MethodPicker
        id="expense-method"
        legend={t.methodLegend}
        labels={methods}
        value={method}
        onChange={setMethod}
      />

      {/* Only once the money did not change hands in notes. Optional even then — a
          receptionist who paid by bKash and did not keep the ID still has to be able to
          write the expense down, and a required box here would send them to `cash`. */}
      {method !== 'cash' && (
        <Field
          label={`${t.referenceLabel} (${common.optional})`}
          name="reference"
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

      <label
        className="flex min-h-tap cursor-pointer items-start gap-3 rounded-xl border-2
          border-line bg-white px-4 py-3 has-[:checked]:border-brand-600
          has-[:checked]:bg-brand-50"
      >
        <input
          type="checkbox"
          name="recurring"
          className="mt-1 h-5 w-5 shrink-0 accent-brand-600"
        />
        <span className="min-w-0">
          <span className="block font-medium text-ink">{t.recurringLabel}</span>
          <span className="block text-sm text-ink-soft">{t.recurringHint}</span>
        </span>
      </label>

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : t.submit}
      </Button>

      {/* Under the button, not above it: it is what the owner needs to know at the moment
          their thumb is over the thing that cannot be undone. */}
      <p className="text-sm text-ink-faint">{t.immutable}</p>
    </form>
  )
}
