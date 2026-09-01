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
 * TWO SECTIONS AND NO THIRD, like the branch row. The first moves them between the head
 * office and one building, which is the whole of §6.2's distinction between an HQ admin and
 * a branch admin. The second takes the appointment back. Their employment row, their login
 * and their teaching survive either — see removeManager.
 */
import { useActionState, useState } from 'react'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button } from '@/components/ui'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import type { Administrator } from '@/lib/staff/admins'
import { removeManager, setManagerBranch, type ManagerState } from './actions'

export function ManagerRow({
  admin,
  name,
  roleLabel,
  branchLabel,
  branches,
  t,
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
  branchAccess: T<'branchAccess'>
  common: T<'common'>
}) {
  const [open, setOpen] = useState(false)

  const [moved, branchAction, moving] = useActionState<ManagerState, FormData>(
    setManagerBranch,
    null,
  )
  const [gone, removeAction, removing] = useActionState<ManagerState, FormData>(
    removeManager,
    null,
  )

  const editable = admin.role === 'manager'

  return (
    <li className="rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{name}</p>
          <p className="truncate text-sm text-ink-soft">
            {[roleLabel, admin.job, branchLabel].filter(Boolean).join(' · ')}
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

          <div className={branches === null ? '' : 'border-t border-line pt-3'}>
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
