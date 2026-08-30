'use client'

/**
 * Adding somebody who works here and does not teach.
 *
 * SIX FIELDS AND TWO OF THEM MATTER: a name and what they do. Everything else is
 * optional, because the person entering this is often a receptionist writing down the
 * new cleaner and does not have their mobile number to hand. A form that insisted would
 * be a form that gets skipped, and an employee who was never written down is an
 * employee whose salary cannot be recorded either.
 *
 * NO LOGIN CHECKBOX, unlike the teacher form this one otherwise resembles. Access is a
 * membership row and this table's `user_id` is a link and not a grant, so a tick here
 * would either do nothing or quietly do something the teachers screen is responsible
 * for. The phone hint says as much, because typing a number into an app is exactly when
 * somebody expects access to follow.
 *
 * TODAY ARRIVES AS A PROP, for the reason ExpenseForm gives at length: a client
 * component that read the clock itself would disagree with the server for six hours out
 * of every twenty-four, and the reader's machine may be set to anything at all.
 */
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import { MAX_LABEL, MAX_NAME, MAX_TEXT } from '@/lib/limits'
import type { EmployeeRole } from '@/lib/supabase/types'
import { addEmployee, type StaffState } from '../actions'

/** The expense form's select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

/** The floor the action enforces, repeated so the browser's picker refuses below it. */
const EARLIEST_JOIN = '2000-01-01'

export function EmployeeForm({
  t,
  roles,
  common,
  today,
  branchPick,
  branches,
}: {
  t: T<'staffForm'>
  /** The fourteen jobs in the enum's order, labelled by the page. */
  roles: { value: EmployeeRole; label: string }[]
  common: T<'common'>
  /** Today in Dhaka, as YYYY-MM-DD, written by the page. */
  today: string
  branchPick: T<'branchPick'>
  /** `null` draws no branch field at all — see branchChoicesFor. */
  branches: BranchChoice[] | null
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState<StaffState, FormData>(
    async (prev, formData) => {
      const result = await addEmployee(prev, formData)
      // Straight back to the list on success. Nothing here produces a sentence the
      // owner has to read first — no username to repeat, no account joined — so the
      // deliverable is the name appearing among the others.
      if (result?.ok) router.push('/settings/staff')
      return result
    },
    null,
  )

  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.error && <Alert>{state.error}</Alert>}

      <Field
        label={t.nameLabel}
        name="name"
        placeholder={t.namePlaceholder}
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.roleLabel}</span>
        {/* Empty first and `required`, the way the expense form asks for a category.
            The column defaults to `other`, which is exactly the answer nobody means:
            a select that opened on it would file the whole payroll under "Other" for
            every owner who tapped past this field. */}
        <select name="role" required defaultValue="" className={SELECT_CLASS}>
          <option value="">—</option>
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </label>

      <Field
        label={`${t.designationLabel} (${common.optional})`}
        hint={t.designationHint}
        name="designation"
        maxLength={MAX_LABEL}
        autoComplete="off"
      />

      {/* Which building they work in — the branch their wage is billed to, through
          `app.payee_branch`. Draws nothing for all but the head office of an
          institution. */}
      <BranchPicker t={branchPick} branches={branches} />

      <Field
        label={`${t.phoneLabel} (${common.optional})`}
        hint={t.phoneHint}
        name="phone"
        type="tel"
        inputMode="numeric"
        placeholder="01712345678"
        className="num"
      />

      {/* Defaulted to today and capped there: somebody who starts next week is added
          next week, and a date in the future would put them on this month's payroll
          before they have worked a day of it. The floor is the year, because a centre
          entering the staff it has had for three years is the ordinary first use. */}
      <Field
        label={t.joinedLabel}
        name="joinedOn"
        type="date"
        required
        defaultValue={today}
        min={EARLIEST_JOIN}
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
        {pending ? common.adding : t.submit}
      </Button>
    </form>
  )
}
