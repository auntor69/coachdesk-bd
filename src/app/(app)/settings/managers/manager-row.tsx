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
 * the job they were given, and the row says it in a word on the right so an owner scanning
 * six administrators can see which one is only the accountant — `bundleOf` picks that word
 * and answers null for a hand-picked set, which is what `custom` is for. The third takes
 * the appointment back; their employment row, their login and their teaching survive it —
 * see removeManager.
 *
 * THE WORD ON THE RIGHT IS WHAT THEY MAY DO, and it is never blank. An owner's cell says
 * Owner, because that is the complete answer for them; a manager's says the bundle, or the
 * words for a set chosen one by one, or Deputy owner for all six. It used to be the fourth
 * item in a dot-joined line that truncated, on the screen whose subject is exactly this.
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
   * What they may do, in one word, for the cell on the right of the row.
   *
   * An owner's is their role: nothing narrows an owner, so "Owner" is the whole answer and
   * a bundle word would be a smaller claim than the truth. A manager's is the bundle they
   * were given, the words for a hand-picked set, or "Deputy owner" for all six — which is
   * worth printing here even on a centre where every manager has it, because the cell is
   * labelled by its position and an empty one reads as a fact that failed to arrive.
   */
  const bundle = editable ? bundleOf(admin.capabilities) : null
  const accessLabel = !editable
    ? roleLabel
    : bundle === null
      ? caps.custom
      : caps.bundle[bundle]

  return (
    <li className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{name}</p>
          {/* Wraps rather than truncates, unlike the name above it: on a branch of an
              organisation this line is a job and a building, and the building is the half
              that used to be cut off. */}
          <p className="text-sm text-ink-soft">
            {[admin.job, branchLabel].filter(Boolean).join(' · ')}
          </p>
          {/* What they type to sign in, where that is a name rather than a number. On the
              row and not behind the panel, because an owner asked for it over the phone
              should not have to open anything, and `break-all` because a login id that
              ends in an ellipsis is the same defect as one shown only once. */}
          {admin.username && (
            <p className="break-all text-sm text-ink-soft">
              <span className="text-ink-faint">{t.usernameLabel} </span>
              <span className="font-medium text-ink">{admin.username}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className="rounded-full bg-surface-alt px-2 py-0.5 text-xs font-semibold
              text-ink-soft"
          >
            {accessLabel}
          </span>
          {/* A plain underlined word and not a button, the way the branch row opens its
              own panel: the wide buttons in this app do the thing the screen is for. */}
          {editable && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="inline-flex min-h-tap items-center text-sm font-medium
                text-brand-700"
            >
              {open ? common.cancel : common.edit}
            </button>
          )}
        </div>
      </div>

      {open && editable && (
        <div className="mt-3 flex flex-col gap-4 border-t border-line pt-3">
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

              <Button type="submit" disabled={moving} className="self-start">
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

            <Button type="submit" disabled={scoping} className="self-start">
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
              <p className="mt-2 max-w-prose text-sm text-ink-soft">{t.removeHint}</p>
            </form>
          </div>
        </div>
      )}
    </li>
  )
}
