'use client'

/**
 * One building, with its repairs behind a tap.
 *
 * SHUT UNTIL ASKED, like the staff row and the subject row. This list is read to answer
 * "which branches do we have, and how big is each" far more often than it is edited, and
 * an organisation with six buildings would otherwise be six open forms deep.
 *
 * TWO SECTIONS AND NO THIRD. The first corrects the name and the address; the second
 * closes the building, or opens it again. There is no remove, and the reason is stronger
 * than the employees one: every foreign key onto `branches` is `on delete set null`, so a
 * delete would unfile a year of fees and salaries from the building that took them and
 * promote every manager pinned to it to reading the whole organisation. See the head of
 * ./actions.ts.
 *
 * `SettingsListRow` was not reused, though the shape rhymes. That component is two names
 * and three verbs — its second field is `name_bn`, which this table does not have — and
 * its third verb is the delete this screen must not offer.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { MAX_NAME, MAX_TEXT } from '@/lib/limits'
import { saveBranch, setBranchActive, type BranchState } from './actions'

export type BranchListItem = {
  id: string
  name: string
  address: string | null
  active: boolean
  /**
   * Students standing in this building today, and `null` when the count did not run. A
   * failed count draws no figure rather than a nought, for the reason the hub gives: "0
   * students" beside the branch that holds half the organisation is the one number on
   * this screen an owner would act on.
   */
  studentCount: number | null
}

export function BranchRow({
  branch,
  countNoun,
  t,
  common,
}: {
  branch: BranchListItem
  /** The noun for that figure, already agreed with it. The page owns the dictionary. */
  countNoun: string
  t: T<'branchForm'>
  common: T<'common'>
}) {
  const [open, setOpen] = useState(false)

  const [saved, saveAction, saving] = useActionState<BranchState, FormData>(
    saveBranch,
    null,
  )
  const [switched, activeAction, switching] = useActionState<BranchState, FormData>(
    setBranchActive,
    null,
  )

  return (
    <li className="rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className="truncate">{branch.name}</span>
            {!branch.active && (
              <span
                className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-xs
                  font-semibold text-ink-faint"
              >
                {t.off}
              </span>
            )}
          </p>
          {branch.address && (
            <p className="truncate text-sm text-ink-soft">{branch.address}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {branch.studentCount !== null && (
            <span className="text-sm text-ink-soft">
              <span className="num">{branch.studentCount}</span> {countNoun}
            </span>
          )}
          {/* A plain underlined word and not a button, for the reason CancelBill gives:
              the wide buttons in this app do the thing the screen is for. */}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="inline-flex min-h-tap items-center text-sm font-medium
              text-brand-700"
          >
            {open ? common.cancel : common.edit}
          </button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          {/* The repair, first and in the ordinary shape of a form. A mistyped name is
              what nearly every visit here is about; closing a building is one section
              further down and happens once. */}
          <form action={saveAction} className="flex flex-col gap-3">
            <input type="hidden" name="branchId" value={branch.id} />

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
              defaultValue={branch.name}
              placeholder={t.namePlaceholder}
              required
              maxLength={MAX_NAME}
              autoComplete="off"
            />

            <Field
              label={`${t.addressLabel} (${common.optional})`}
              hint={t.addressHint}
              name="address"
              defaultValue={branch.address ?? ''}
              maxLength={MAX_TEXT}
              autoComplete="off"
            />

            <Button type="submit" disabled={saving} full>
              {saving ? common.saving : common.save}
            </Button>
          </form>

          <div className="border-t border-line pt-3">
            {/* An error survives here because nothing moved: a refused change leaves the
                row, this panel and this list exactly as they were. */}
            {switched?.error && <Alert>{switched.error}</Alert>}

            <form action={activeAction}>
              <input type="hidden" name="branchId" value={branch.id} />
              <input
                type="hidden"
                name="next"
                value={branch.active ? 'off' : 'on'}
              />
              <Button type="submit" variant="secondary" disabled={switching}>
                {switching
                  ? common.saving
                  : branch.active
                    ? t.turnOff
                    : t.turnOn}
              </Button>
              {/* Under the button rather than above it, because what closing does to
                  everything already filed here is the worry, and this is the answer to
                  it. Only on the way out: nobody is afraid of opening a building. */}
              {branch.active && (
                <p className="mt-2 text-sm text-ink-soft">{t.turnOffHint}</p>
              )}
            </form>
          </div>
        </div>
      )}
    </li>
  )
}
