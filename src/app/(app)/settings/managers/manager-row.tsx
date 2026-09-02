'use client'

/**
 * One administrator, with the two things an owner can change about them behind a tap.
 *
 * OWNERS ARE DRAWN AND NOT EDITED. `members_owner_write` would let an owner move or remove
 * another owner's row, and every read and write in ./actions.ts carries `.eq('role',
 * 'manager')` so that this screen cannot: a second owner cannot be removed by the first,
 * which makes a mistap here permanent from inside the app. There is no product reason to
 * offer it yet, so the row is a line of text.
 *
 * THREE SECTIONS. The first moves them between the head office and one building, which is
 * §6.2's distinction between an HQ admin and a branch admin. The second is what parts of
 * the job they were given, and the collapsed line says it in a word so an owner scanning
 * six administrators can see which one is only the accountant — `bundleOf` picks that word
 * and answers null for a hand-picked set, which is what `custom` is for. The third takes
 * the appointment back; their employment row, their login and their teaching survive it —
 * see removeManager.
 */
import { useActionState, useState } from 'react'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button } from '@/components/ui'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import type { Administrator } from '@/lib/staff/admins'
import { bundleOf } from '@/lib/staff/capabilities'
import {
  removeManager,
  setManagerBranch,
  setManagerCapabilities,
  type ManagerState,
} from './actions'
import { CapabilityPicker } from './capability-picker'

export function ManagerRow({
  admin,
  name,
  roleLabel,
  branchLabel,
  branches,
  t,
  caps,
  branchAccess,
  common,
}: {
  admin: Administrator
  /** Already resolved by the page: their name, "you", or the sentence for neither. */
  name: string
  roleLabel: string
  /** What they can see, in words, and `null` on a centre with nothing to distinguish. */
  branchLabel: string | null
  branches: BranchChoice[] | null
  t: T<'managerForm'>
  caps: T<'capabilities'>
  branchAccess: T<'branchAccess'>
  common: T<'common'>
}) {
  const [open, setOpen] = useState(false)

  const [moved, branchAction, moving] = useActionState<ManagerState, FormData>(
    setManagerBranch,
    null,
  )
  const [scoped, capAction, scoping] = useActionState<ManagerState, FormData>(
    setManagerCapabilities,
    null,
  )
  const [gone, removeAction, removing] = useActionState<ManagerState, FormData>(
    removeManager,
    null,
  )

  const editable = admin.role === 'manager'

  /*
   * The word for what they were given, on the collapsed line — and nothing at all for a
   * deputy or an owner. "Deputy owner" beside every name is a column of the same word,
   * which reads as decoration; the line is worth a glance only when somebody is narrower
   * than the screen's default.
   */
  const bundle = editable ? bundleOf(admin.capabilities) : null
  const capLabel =
    bundle === 'deputy' ? null : bundle === null ? caps.custom : caps.bundle[bundle]

  return (
    <li className="rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{name}</p>
          <p className="truncate text-sm text-ink-soft">
            {[roleLabel, admin.job, branchLabel, capLabel].filter(Boolean).join(' · ')}
          </p>
        </div>
        {/* A plain underlined word and not a button, the way the branch row opens its
            own panel: the wide buttons in this app do the thing the screen is for. */}
        {editable && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="inline-flex min-h-tap shrink-0 items-center text-sm font-medium
              text-brand-700"
          >
            {open ? common.cancel : common.edit}
          </button>
        )}
      </div>

      {open && editable && (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          {/* Only where there is more than one building to move them between. On a
              single-building centre this form would be a save button that writes the null
              it read, which is a control that cannot do anything. */}
          {branches !== null && (
            <form action={branchAction} className="flex flex-col gap-3">
              <input type="hidden" name="memberId" value={admin.memberId} />

              <p className="font-medium text-ink">{t.branchTitle}</p>

              {moved?.error && <Alert>{moved.error}</Alert>}
              {moved?.ok && (
                <p role="status" className="font-medium text-brand-700">
                  {moved.ok} ✓
                </p>
              )}

              {/* Per-row id: an organisation with six administrators has six of these in
                  one document, and a shared id would point every label at the first. */}
              <BranchPicker
                t={branchAccess}
                branches={branches}
                current={admin.branchId}
                id={`manager-branch-${admin.memberId}`}
              />

              <Button type="submit" disabled={moving} full>
                {moving ? common.saving : common.save}
              </Button>
            </form>
          )}

          <form
            action={capAction}
            className={`flex flex-col gap-3 ${
              branches === null ? '' : 'border-t border-line pt-4'
            }`}
          >
            <input type="hidden" name="memberId" value={admin.memberId} />

            {scoped?.error && <Alert>{scoped.error}</Alert>}
            {scoped?.ok && (
              <p role="status" className="font-medium text-brand-700">
                {scoped.ok} ✓
              </p>
            )}

            {/* Prefilled from the row, so an owner opening this panel is looking at what
                is true rather than at the form's own default. The picker's legend is this
                section's heading — see capability-picker.tsx. */}
            <CapabilityPicker t={caps} current={admin.capabilities} />

            <Button type="submit" disabled={scoping} full>
              {scoping ? common.saving : common.save}
            </Button>
          </form>

          <div className="border-t border-line pt-3">
            <p className="font-medium text-ink">{t.removeTitle}</p>

            {/* An error survives here because nothing moved: a refused removal leaves the
                row, this panel and this list exactly as they were. */}
            {gone?.error && <Alert>{gone.error}</Alert>}

            <form action={removeAction} className="mt-2">
              <input type="hidden" name="memberId" value={admin.memberId} />
              <Button type="submit" variant="secondary" disabled={removing}>
                {removing ? common.saving : t.removeButton}
              </Button>
              {/* Under the button, where the branch row puts its own consequence: what
                  survives being removed is the worry, and this is the answer to it. */}
              <p className="mt-2 text-sm text-ink-soft">{t.removeHint}</p>
            </form>
          </div>
        </div>
      )}
    </li>
  )
}
