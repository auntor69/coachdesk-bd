'use client'

/**
 * One person on the payroll, with their repairs behind a tap.
 *
 * SHUT UNTIL ASKED, the same way the subject and exam-kind rows are, and for a reason
 * that is stronger here: this list is read to answer "who works here" far more often
 * than it is edited, and a row carries somebody's mobile number. Six open forms down
 * the screen would be six phone numbers and six job titles competing with the names.
 *
 * THREE ALIGNED CELLS FROM `lg`, under the strip the page draws: who they are, how long
 * they have been here, what number to ring. Aligned so a column can be read down, and
 * the number is on the row at all — this screen's whole subject is employment, and the
 * one fact an owner most often comes for was behind the Edit tap.
 *
 * TWO SECTIONS AND NO THIRD. The first corrects what was typed; the second records that
 * somebody left, or came back. There is no remove — `salary_payments` has a foreign key
 * onto this row with no `on delete` behind it, so anybody who has ever been paid cannot
 * be deleted, and deleting the ones who have not been paid yet would be a different rule
 * for the same kind of person. See the head of ./actions.ts.
 *
 * A BUTTON AND NOT A `<details>`, unlike the teacher row it now matches in shape. That
 * row's panel is three independent forms and can be left mounted; this one is a single
 * form whose defaults are the row's own columns, and `{open && …}` remounts it — which
 * is what makes a reopened panel show what was actually saved. See lib/i18n on React 19
 * resetting a `<form action>` whatever the outcome.
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
import { formatBdMobile } from '@/lib/bd/phone'
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
  noPhoneLabel,
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
  /**
   * What the phone cell says when there is no number.
   *
   * Not a blank: an empty cell under a column head reads as a figure that failed to
   * arrive, and "no number" is a thing an owner can act on. A scalar prop like
   * `offLabel`, because the page owns `settings.staff` and this component is handed
   * `staffForm` — the words for the strip and the words for the form live apart.
   */
  noPhoneLabel: string
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
    <li className="rounded-xl border border-line bg-white px-4 py-3">
      {/* Three cells, and from `lg` the three columns the page's strip names. The same
          widths on every row, so "who joined this year" can be read down a column
          instead of one line at a time. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 lg:grid lg:grid-cols-2 lg:gap-4">
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
          </div>

          {/* Wraps rather than truncates, unlike the two lines beside it. Whether
              somebody can sign in is the one fact on this row that must not be the
              part a narrow phone cuts off. */}
          <p className="min-w-0 text-sm text-ink-faint">{employee.meta}</p>
        </div>

        {/* The number, which was behind the Edit tap until this step and is the fact
            this screen exists to hold. Same `w-44` the teacher roster reserves, so the
            two lists a hub sends an owner between scan alike. */}
        <div className="shrink-0 text-right lg:w-44">
          {employee.phone ? (
            <p className="num text-sm text-ink-soft">
              {formatBdMobile(employee.phone)}
            </p>
          ) : (
            <p className="text-xs text-ink-faint">{noPhoneLabel}</p>
          )}
        </div>
      </div>

      {/* Under the row rather than beside it, where the teacher list puts its summary:
          the three cells above are data an owner is reading, and a control in the middle
          of them is a fourth column that means nothing. A plain underlined word and not
          a button, for the reason CancelBill gives — the wide buttons in this app do the
          thing the screen is for. */}
      <div className="mt-2 border-t border-line pt-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-tap items-center text-sm font-medium
            text-brand-700"
        >
          {open ? common.cancel : common.edit}
        </button>
      </div>

      {open && (
        <div className="mt-1 flex flex-col gap-4">
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

            {/*
             * SEVEN FIELDS PAIRED RATHER THAN STACKED, which is the §26 half of this
             * step: one column of seven inside a panel 1,184px wide is the narrow-column
             * defect with the width thrown away beside it. Two-up from `lg`, three from
             * `2xl`, and the note across the row because free text is the one field that
             * wants the width.
             */}
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              <Field
                label={t.nameLabel}
                name="name"
                id={`employee-name-${employee.id}`}
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
                id={`employee-designation-${employee.id}`}
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
                id={`employee-phone-${employee.id}`}
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
                id={`employee-joined-${employee.id}`}
                type="date"
                required
                defaultValue={employee.joinedOn}
                min={EARLIEST_JOIN}
                max={today}
              />

              <div className="lg:col-span-2 2xl:col-span-3">
                <Field
                  label={`${t.noteLabel} (${common.optional})`}
                  name="note"
                  id={`employee-note-${employee.id}`}
                  defaultValue={employee.note ?? ''}
                  placeholder={t.notePlaceholder}
                  maxLength={MAX_TEXT}
                  autoComplete="off"
                />
              </div>
            </div>

            <Button type="submit" disabled={saving} className="self-start">
              {saving ? common.saving : common.save}
            </Button>
          </form>

          {/* The one thing here that is not a correction, last and under a rule of its
              own — across the width rather than beside the fields, because it is not a
              thing to reach for while fixing a spelling. The teacher row puts its own
              off button in the same place for the same reason. */}
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
                    take them off the payroll this afternoon.

                    Capped in width too: a date box set across a 1,184px panel is the
                    §26 defect turned inside out. And a per-row id, because two rows can
                    be open at once and `Field` falls back to the field name — which
                    would point both labels at the first row's date. */}
                <div className="sm:max-w-xs">
                  <Field
                    label={`${t.leftLabel} (${common.optional})`}
                    hint={t.leftHint}
                    name="leftOn"
                    id={`employee-left-${employee.id}`}
                    type="date"
                    min={employee.joinedOn}
                    max={today}
                  />
                </div>

                <div>
                  <Button type="submit" variant="secondary" disabled={switching}>
                    {switching ? common.saving : t.turnOff}
                  </Button>
                  {/* Under the button rather than above it, because losing the record
                      is what an owner is afraid of and this is the answer to it. */}
                  <p className="mt-2 max-w-prose text-sm text-ink-soft">
                    {t.turnOffHint}
                  </p>
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
