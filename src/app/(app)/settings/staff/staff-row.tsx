'use client'

/**
 * One person on the payroll, with their repairs behind a tap.
 *
 * SHUT UNTIL ASKED, the same way the subject and exam-kind rows are, and for a reason
 * that is stronger here: this list is read to answer "who works here" far more often
 * than it is edited, and a row carries somebody's mobile number. Six open forms down
 * the screen would be six phone numbers and six job titles competing with the names.
 *
 * TWO SECTIONS AND NO THIRD. The first corrects what was typed; the second records that
 * somebody left, or came back. There is no remove — `salary_payments` has a foreign key
 * onto this row with no `on delete` behind it, so anybody who has ever been paid cannot
 * be deleted, and deleting the ones who have not been paid yet would be a different rule
 * for the same kind of person. See the head of ./actions.ts.
 *
 * THE BRANCH IS IN THE FIRST SECTION ONLY. Moving somebody to another building is a
 * correction of the same kind as their job title, and `setEmployeeActive` below writes
 * `active` and `left_on` and nothing else — a picker over that button would look like it
 * decided which building they left from, which is a thing nobody can change after the
 * fact. See BranchPicker for why the field answers even when it draws nothing.
 *
 * `SettingsListRow` was not reused, though the shape rhymes: that component is two
 * names, a count and three verbs, and every field on it is a name. This row has six
 * fields, a select and a date, and the thing it can refuse is a date rather than a
 * dependency. Sharing them would mean a component with two halves and a flag.
 */
import { useActionState, useState } from 'react'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import { MAX_LABEL, MAX_NAME, MAX_TEXT } from '@/lib/limits'
import type { EmployeeRole } from '@/lib/supabase/types'
import { saveEmployee, setEmployeeActive, type StaffState } from './actions'

/** The expense form's select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

/** The floor the action enforces, repeated so the browser's picker refuses below it. */
const EARLIEST_JOIN = '2000-01-01'

export type StaffMember = {
  id: string
  name: string
  role: EmployeeRole
  designation: string | null
  phone: string | null
  /** YYYY-MM-DD, straight from the column: it fills a date input, not a sentence. */
  joinedOn: string
  active: boolean
  note: string | null
  /**
   * Which building they are filed under, or `null` for head office — a real answer and
   * not a blank. `employees.branch_id`, which is the staff list they appear on and the
   * branch `app.payee_branch` bills their wage to.
   */
  branchId: string | null
  /**
   * The job as it should print — the centre's own word for it, or the role's. Worked
   * out by the page with `jobTitle`, because the labels are the dictionary's.
   */
  title: string
  /**
   * The small print, already joined: what the role counts as where the centre renamed
   * it, the date that matters, and whether they can sign in. One string because every
   * part of it comes from a dictionary section this component cannot be handed — two
   * of the three take an argument, and `T` maps a function leaf to `never`.
   */
  meta: string
}

export function StaffRow({
  employee,
  roles,
  offLabel,
  today,
  t,
  branchPick,
  branches,
  common,
}: {
  employee: StaffMember
  /** The fourteen jobs in the enum's order, labelled by the page. */
  roles: { value: EmployeeRole; label: string }[]
  offLabel: string
  /** Today in Dhaka, as YYYY-MM-DD. Caps both date fields. See ExpenseForm. */
  today: string
  t: T<'staffForm'>
  branchPick: T<'branchPick'>
  /** `null` draws no branch field — see branchChoicesFor. */
  branches: BranchChoice[] | null
  common: T<'common'>
}) {
  const [open, setOpen] = useState(false)

  const [saved, saveAction, saving] = useActionState<StaffState, FormData>(
    saveEmployee,
    null,
  )
  const [switched, activeAction, switching] = useActionState<StaffState, FormData>(
    setEmployeeActive,
    null,
  )

  return (
    <li className="rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className="truncate">{employee.name}</span>
            {!employee.active && (
              <span
                className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-xs
                  font-semibold text-ink-faint"
              >
                {offLabel}
              </span>
            )}
          </p>
          <p className="truncate text-sm text-ink-soft">{employee.title}</p>
          {/* Wraps rather than truncates, unlike the two lines above it. Whether
              somebody can sign in is the one fact on this row that must not be the
              part a narrow phone cuts off. */}
          <p className="text-sm text-ink-faint">{employee.meta}</p>
        </div>
        {/* A plain underlined word and not a button, for the reason CancelBill gives:
            the wide buttons in this app do the thing the screen is for. */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-tap shrink-0 items-center text-sm font-medium
            text-brand-700"
        >
          {open ? common.cancel : common.edit}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          {/* The repair, first and in the ordinary shape of a form. A mistyped name or
              a wrong number is what nearly every visit here is about; somebody leaving
              is one tap further down. */}
          <form action={saveAction} className="flex flex-col gap-3">
            <input type="hidden" name="employeeId" value={employee.id} />

            <p className="text-sm text-ink-soft">{t.editHint}</p>

            {saved?.error && <Alert>{saved.error}</Alert>}
            {saved?.ok && (
              <p role="status" className="font-medium text-brand-700">
                {saved.ok} ✓
              </p>
            )}

            <Field
              label={t.nameLabel}
              name="name"
              defaultValue={employee.name}
              placeholder={t.namePlaceholder}
              required
              maxLength={MAX_NAME}
              autoComplete="off"
            />

            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-ink">{t.roleLabel}</span>
              <select
                name="role"
                defaultValue={employee.role}
                required
                className={SELECT_CLASS}
              >
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
              defaultValue={employee.designation ?? ''}
              maxLength={MAX_LABEL}
              autoComplete="off"
            />

            {/* Where the add form puts it, between the job and the phone number. Its own
                id, because this list draws a panel per person and every one of them is in
                the document as soon as it is opened — a shared id would point each label
                at the first row's select. Everybody the picker does not ask still submits
                the building they are filed under, which is what keeps a corrected phone
                number from moving them to head office; see BranchPicker. */}
            <BranchPicker
              t={branchPick}
              branches={branches}
              current={employee.branchId}
              id={`employee-branch-${employee.id}`}
            />

            <Field
              label={`${t.phoneLabel} (${common.optional})`}
              hint={t.phoneHint}
              name="phone"
              type="tel"
              inputMode="numeric"
              placeholder="01712345678"
              defaultValue={employee.phone ?? ''}
              className="num"
            />

            {/* Capped at today, floored at the year, like the expense date: a start
                date in the future is a mistake, and last year's is ordinary. */}
            <Field
              label={t.joinedLabel}
              name="joinedOn"
              type="date"
              required
              defaultValue={employee.joinedOn}
              min={EARLIEST_JOIN}
              max={today}
            />

            <Field
              label={`${t.noteLabel} (${common.optional})`}
              name="note"
              defaultValue={employee.note ?? ''}
              placeholder={t.notePlaceholder}
              maxLength={MAX_TEXT}
              autoComplete="off"
            />

            <Button type="submit" disabled={saving} full>
              {saving ? common.saving : common.save}
            </Button>
          </form>

          <div className="border-t border-line pt-3">
            {/* An error survives here because nothing moved: a refused change leaves
                the row, this panel and this list exactly as they were. */}
            {switched?.error && <Alert>{switched.error}</Alert>}

            {employee.active ? (
              <form action={activeAction} className="flex flex-col gap-3">
                <input type="hidden" name="employeeId" value={employee.id} />
                <input type="hidden" name="next" value="off" />

                {/* Optional, and floored at their own start date rather than at the
                    year: the action refuses a last day before a first one, so the
                    picker should refuse it too. Capped at today for the same reason
                    the action caps it — the table will not hold a last day on
                    somebody who is still switched on, so a date next Thursday would
                    take them off the payroll this afternoon. */}
                <Field
                  label={`${t.leftLabel} (${common.optional})`}
                  hint={t.leftHint}
                  name="leftOn"
                  type="date"
                  min={employee.joinedOn}
                  max={today}
                />

                <div>
                  <Button type="submit" variant="secondary" disabled={switching}>
                    {switching ? common.saving : t.turnOff}
                  </Button>
                  {/* Under the button rather than above it, because losing the record
                      is what an owner is afraid of and this is the answer to it. */}
                  <p className="mt-2 text-sm text-ink-soft">{t.turnOffHint}</p>
                </div>
              </form>
            ) : (
              <form action={activeAction}>
                <input type="hidden" name="employeeId" value={employee.id} />
                <input type="hidden" name="next" value="on" />
                <Button type="submit" variant="secondary" disabled={switching}>
                  {switching ? common.saving : t.turnOn}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
