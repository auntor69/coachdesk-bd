'use client'

/**
 * Which building a new row belongs to, on the one screen that has to ask.
 *
 * IN components/ RATHER THAN IN settings/, for MethodPicker's reason and more of it:
 * six add forms in three different route folders ask this — a student, a batch, a
 * teacher, an employee, a cost and a notice — and a sibling route reaching across into
 * another one to borrow a control would be the wrong shape. Sharing it is also the only
 * way the six cannot drift, which matters here because the drift would be silent: a
 * form that stopped drawing the field would file its rows at head office and look
 * perfectly normal doing it.
 *
 * ALMOST NOBODY SEES IT, and that is by design rather than by neglect.
 * 20260811000054 files a new row under the branch of whoever wrote it, so a manager
 * pinned to Mirpur is never asked — there is one answer and the database already knows
 * it. `mayChooseBranch` is the whole of the audience: the head office of an
 * organisation that runs more than one building, which is the one desk that is not in
 * any of them.
 *
 * A `<select>` and not the row of chips MethodPicker uses. The lists are different
 * shapes: seven wallets are seven and always will be, while an institution may have
 * fifteen buildings with names that are places rather than words, and fifteen chips is
 * a wall. This is also the only field on these forms whose answer is usually the
 * default, so it should take up a line and not a paragraph.
 *
 * UNCONTROLLED, unlike MethodPicker. There is nothing to react to — no total to
 * recompute, no second field to reveal — so the value is read off the form on submit
 * by `postedBranchId` and never mirrored into React state.
 *
 * DRAWS NOTHING FOR A CALLER WITH NOTHING TO ASK, rather than making six forms each
 * write their own `branches && …`. `branchChoicesFor` already folds every such reason
 * into one `null` — the wrong plan, a pinned reader, no open building, a dropped read —
 * and six copies of the test is six chances to write it differently.
 */
import type { T } from '@/lib/i18n'
import type { BranchChoice } from '@/lib/branches'

/** The expense form's select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

export function BranchPicker({
  t,
  branches,
}: {
  t: T<'branchPick'>
  /** The open buildings from `branchChoicesFor`, or `null` for "there is nothing to ask". */
  branches: BranchChoice[] | null
}) {
  if (branches === null) return null

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="branchId" className="font-medium text-ink">
        {t.label}
      </label>
      {/* Above the control and wired up with aria-describedby, the way Field does it:
          this hint is a consequence rather than a format note, and somebody using a
          screen reader has to hear it before choosing rather than after. */}
      <span id="branchId-hint" className="text-sm text-ink-soft">
        {t.hint}
      </span>
      {/*
        Head office first, selected, and carrying an empty string.

        NOT `required`, and not defaulted to a building either, because the default has
        to be what every row in every centre already holds. An institution that opens
        its second branch on a Tuesday must not find its add forms quietly filing
        Wednesday's students into whichever name sorts first — and the value that means
        "the whole organisation" is a real answer here, not a blank the owner forgot.
        The hint above is what makes it a choice instead of an oversight.
      */}
      <select
        id="branchId"
        name="branchId"
        defaultValue=""
        aria-describedby="branchId-hint"
        className={SELECT_CLASS}
      >
        <option value="">{t.hq}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </div>
  )
}
