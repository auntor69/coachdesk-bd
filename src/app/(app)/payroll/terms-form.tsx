'use client'

/**
 * The form that agrees what one person is paid.
 *
 * THERE IS NO EDIT VERB ANYWHERE ON THIS SCREEN, and this form is why. The BEFORE INSERT
 * trigger `salary_terms_retire_previous` (20260811000044) switches off whatever was live
 * for the same payee, so choosing somebody who already has a figure agreed *is* the rise:
 * one insert, two rows, and last April's salary still explicable afterwards. An UPDATE
 * path would answer "why was he paid ৳12,000 in April" with today's number. `t.replaces`
 * sits under the button and says so before the tap rather than after it.
 *
 * NO IDEMPOTENCY TOKEN, unlike the expense and collection forms. A double-tap here
 * inserts a second identical agreement and the trigger retires the first, so the bill
 * still shows one row carrying the same figures — the cost is a spurious line in the
 * history, not money on the record that nobody can delete. `salary_terms` has no
 * `idempotency_key` column to write to in any case.
 *
 * WHICH BOXES APPEAR IS THE BASIS'S ANSWER, and the basis is asked with nothing filled
 * in. The two kinds of agreement take different figures: a monthly one takes four parts
 * the database adds up, a per-class one takes a rate the database refuses to multiply.
 * Showing the four monthly boxes before that question is answered invites ৳350 a class
 * typed into "Basic", which lands on the bill as a ৳350 monthly salary and understates
 * the wage bill by everything that teacher actually earns. One tap first, and the boxes
 * that appear are the right ones.
 *
 * TODAY ARRIVES AS A PROP, for the reason ExpenseForm gives: a client component that read
 * the clock would render one date on the server and another in the browser for six hours
 * out of every twenty-four.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { MAX_TEXT } from '@/lib/limits'
import { PER_CLASS_BASIS, SALARY_BASES, type BasisLabels } from '@/lib/payroll/basis'
import { payeeValue, type Payee } from '@/lib/payroll/bill'
import { setSalaryTerms, type PayrollState } from './actions'

/** The expense form's select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

/** The floor the action enforces, repeated so the browser's picker refuses below it. */
const EARLIEST_TERMS = '2000-01-01'

export function TermsForm({
  people,
  bases,
  t,
  common,
  today,
}: {
  /**
   * Active staff and teachers, name-sorted by the page. Somebody who has left is not
   * offered: the action refuses them anyway, and an absent option is a better way to
   * learn that than a submit into a refusal.
   */
  people: readonly Payee[]
  /** The page's own basis labels, passed down rather than duplicated. */
  bases: BasisLabels
  t: T<'salaryForm'>
  common: T<'common'>
  /** Today in Dhaka, as YYYY-MM-DD, written by the page. */
  today: string
}) {
  const [state, action, pending] = useActionState<PayrollState, FormData>(
    setSalaryTerms,
    null,
  )

  /**
   * The basis decides which figures are asked for, so it cannot be left uncontrolled.
   *
   * Empty rather than monthly — see the header. `''` is not a `SalaryBasis` and is not
   * pretended to be one: the action re-reads this out of the FormData and refuses
   * anything that is not one of the two, so what is held here is the string a `<select>`
   * actually carries.
   */
  const [basis, setBasis] = useState('')

  // Teachers first: a coaching centre agrees far more teachers' salaries than cooks'.
  // Two passes over a few dozen people rather than one building two arrays, because the
  // two lines read as what they are.
  const teachers = people.filter((p) => p.kind === 'teacher')
  const staff = people.filter((p) => p.kind === 'employee')

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="font-medium text-ink">{t.formTitle}</p>

      {state?.error && <Alert>{state.error}</Alert>}
      {/* The row appears in the bill below the moment the revalidation lands, so this
          line is not the only evidence anything happened. It is here for the half of
          the message the bill cannot show: that a figure agreed before this one has
          just been switched off.

          And nothing is reset afterwards, unlike the spending form. The next expense is
          a different expense; the next salary is very often the same one — four
          assistants on the same wage is how a centre of this size pays people, and there
          the only answer that changes is the name. Re-submitting the same person is
          harmless in any case: the trigger retires the identical row it just wrote. */}

      {state?.ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {state.ok}
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.payeeLabel}</span>
        {/* One select over two tables, and the value carries which of them — see
            `payeeValue`. Grouped, because a flat list of twenty names cannot say why the
            cook and the physics teacher are next to each other. A group with nobody in
            it is not drawn at all: an empty "Teachers" heading reads as a fault. */}
        <select name="payee" required defaultValue="" className={SELECT_CLASS}>
          <option value="">—</option>
          {teachers.length > 0 && (
            <optgroup label={t.payeeTeachers}>
              {teachers.map((p) => (
                <option key={payeeValue(p.kind, p.id)} value={payeeValue(p.kind, p.id)}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {staff.length > 0 && (
            <optgroup label={t.payeeStaff}>
              {/* The job goes in the option and not just on the bill: two people called
                  Rahim, one who cooks and one who keeps the books, are the same word
                  twice in a picker of bare names. A teacher has no job title because
                  teaching is the job. */}
              {staff.map((p) => (
                <option key={payeeValue(p.kind, p.id)} value={payeeValue(p.kind, p.id)}>
                  {p.job ? `${p.name} — ${p.job}` : p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.basisLabel}</span>
        {/* Controlled, because the boxes underneath are its answer. Empty first and
            `required`, the way the spending screen asks for a category — and here for a
            reason of its own, in the header. */}
        <select
          name="basis"
          required
          value={basis}
          onChange={(e) => setBasis(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">—</option>
          {SALARY_BASES.map((value) => (
            <option key={value} value={value}>
              {bases[value]}
            </option>
          ))}
        </select>
      </label>

      {/* The rate for one class, and the hint saying what it is not: nothing on this
          screen can turn ৳350 a class into a figure for August, because how many classes
          were taught is not something an agreement knows. 20260811000044 refuses to store
          one for the same reason. */}
      {basis === PER_CLASS_BASIS && (
        <Field
          label={t.perClassLabel}
          hint={t.perClassHint}
          name="perClass"
          type="text"
          inputMode="decimal"
          required
          maxLength={12}
          autoComplete="off"
          className="num"
        />
      )}

      {/* ANYTHING THAT IS NOT PER-CLASS CARRIES A MONTHLY FIGURE, which is the rule the
          action's own money block and `tallyBill` both go by. Written that way round
          rather than `=== MONTHLY_BASIS` so that a third basis arriving shows the boxes it
          needs instead of none at all — a form with no money on it would be the one
          failure here nobody could see. */}
      {basis !== '' && basis !== PER_CLASS_BASIS && (
        <>
          {/* `type="text"` with a decimal keypad and not `type="number"`, for the reason
              the spending form gives: a number input swallows the taka sign and the
              Bangla digits a phone keyboard produces, and its scroll wheel changes a
              figure somebody has already typed. `parseTaka` reads all of it. */}
          <Field
            label={t.basicLabel}
            name="basic"
            type="text"
            inputMode="decimal"
            required
            maxLength={12}
            autoComplete="off"
            className="num"
          />

          {/* The three optional parts. Empty is nothing rather than unreadable — most
              agreements at a coaching centre are one figure, and three boxes that had to
              be filled with zeroes would be three chances to typo one. */}
          <Field
            label={`${t.allowancesLabel} (${common.optional})`}
            name="allowances"
            type="text"
            inputMode="decimal"
            maxLength={12}
            autoComplete="off"
            className="num"
          />

          <Field
            label={`${t.otherLabel} (${common.optional})`}
            name="other"
            type="text"
            inputMode="decimal"
            maxLength={12}
            autoComplete="off"
            className="num"
          />

          {/* A plain amount, and the hint says so, because `net_bdt` is generated as
              `basic + allowances + other - deductions`: a minus figure typed in here
              would add to the salary rather than come off it. The action refuses one
              outright — `partNegative` — rather than quietly taking its absolute value. */}
          <Field
            label={`${t.deductionsLabel} (${common.optional})`}
            hint={t.deductionsHint}
            name="deductions"
            type="text"
            inputMode="decimal"
            maxLength={12}
            autoComplete="off"
            className="num"
          />
        </>
      )}

      {/* Defaulted to today and capped there. The trigger retires the previous figure the
          moment this row is inserted, whatever date is written on it, so an agreement
          dated next month would take effect this afternoon and be filed as though it had
          not — which is what `dateFuture` refuses and what this cap keeps the picker from
          offering. The floor is the year, because a centre writing down an agreement that
          has run since 2019 is ordinary. */}
      <Field
        label={t.effectiveLabel}
        name="effectiveFrom"
        type="date"
        required
        defaultValue={today}
        min={EARLIEST_TERMS}
        max={today}
      />

      <Field
        label={`${t.noteLabel} (${common.optional})`}
        name="note"
        placeholder={t.notePlaceholder}
        maxLength={MAX_TEXT}
        autoComplete="off"
      />

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : t.submit}
      </Button>

      {/* Under the button, where the spending form keeps `immutable`: it is what an owner
          needs to know at the moment their thumb is over the thing that retires the figure
          that was there before. */}
      <p className="text-sm text-ink-faint">{t.replaces}</p>
    </form>
  )
}




