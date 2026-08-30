'use client'

/**
 * Which building a row belongs to, on the screens that have to ask.
 *
 * IN components/ RATHER THAN IN settings/, for MethodPicker's reason and more of it:
 * nine forms under five different routes ask this — five that add a student, a batch, a
 * teacher, an employee or a cost, and four that correct one of them afterwards — and a
 * sibling route reaching across into another one to borrow a control would be the wrong
 * shape. Sharing it is also the only way the nine cannot drift, which matters here
 * because the drift would be silent: a form that stopped drawing the field would file its
 * rows at head office and look perfectly normal doing it.
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
 * IT ANSWERS EVEN WHEN IT DOES NOT ASK, which is the whole of why `current` is required
 * rather than optional. An add form has nothing to carry and passes null; an edit form
 * passes the building the row is already filed under, and when there is no select to draw
 * that value goes back out in a hidden field so the update writes the row's own branch
 * back onto it.
 *
 * Saying nothing instead would be much worse than untidy. The four update actions write
 * `branch_id` unconditionally, because a form that submits the field on some readers'
 * screens and not others is a form whose action cannot tell "head office" from "not
 * asked" — and 20260811000053's `<table>_branch_scope` policies are `for all … using(…)`
 * with no `with check`, so Postgres tests the new row against the same expression. A
 * pinned manager posting nothing would therefore be writing null, and null is head
 * office, and head office is a row `app.branch_ok` will not let them have. Their ordinary
 * correction — fixing a spelling in a student's name — would come back as "could not
 * save". The batch edit form has carried its own `teacherId` along for the smaller
 * version of this reason since the one-teacher plans existed: a save that quietly clears
 * a column takes the row off the list it belongs on.
 *
 * DRAWS NOTHING TO CHOOSE FROM FOR A CALLER WITH NOTHING TO ASK, rather than making nine
 * forms each write their own `branches && …`. `branchChoicesFor` already folds every such
 * reason into one `null` — the wrong plan, a pinned reader, no open building, a dropped
 * read — and nine copies of the test is nine chances to write it differently.
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
  current,
  id = 'branchId',
}: {
  t: T<'branchPick'>
  /** The open buildings from `branchChoicesFor`, or `null` for "there is nothing to ask". */
  branches: BranchChoice[] | null
  /**
   * The building this row is filed under today, or `null` for head office — and `null`
   * from an add form, which has no row yet. Required and not defaulted, so a call site
   * cannot drift into posting head office by leaving it out.
   */
  current: string | null
  /**
   * The element id, where one form on the screen is not enough.
   *
   * The submitted field is always called `branchId`; this is only what the label points
   * at. The teacher list and the staff list draw a panel per row, so nine of these are
   * in one document at once and a shared id would point all nine labels at the first
   * row's select. Every other caller is the only form on its screen and takes the
   * default. Field does the same thing for the same reason.
   */
  id?: string
}) {
  /*
   * No list, or a list this row's own building is not on: no select either way, and the
   * answer rides along in a hidden field. See the head of this file for why it has to be
   * an answer and not a silence.
   *
   * The second case is a row filed under a building that has since been closed.
   * `branchChoicesFor` offers open branches only — a picker whose list included closed
   * ones would be an invitation to file next month's rent in a building the centre left —
   * so the row keeps its filing and the way to move it is to reopen the branch. Better
   * than the alternative, which is a select that silently rewrites the answer to whatever
   * happens to be first the moment somebody corrects a phone number.
   */
  if (branches === null || (current !== null && !branches.some((b) => b.id === current))) {
    return <input type="hidden" name="branchId" value={current ?? ''} />
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-ink">
        {t.label}
      </label>
      {/* Above the control and wired up with aria-describedby, the way Field does it:
          this hint is a consequence rather than a format note, and somebody using a
          screen reader has to hear it before choosing rather than after. */}
      <span id={`${id}-hint`} className="text-sm text-ink-soft">
        {t.hint}
      </span>
      {/*
        Head office first and carrying an empty string, selected when that is where the
        row is — which on an add form is always.

        NOT `required`, and not defaulted to a building either, because the default has
        to be what the row already holds. An institution that opens its second branch on
        a Tuesday must not find its add forms quietly filing Wednesday's students into
        whichever name sorts first — and the value that means "the whole organisation" is
        a real answer here, not a blank the owner forgot. The hint above is what makes it
        a choice instead of an oversight.
      */}
      <select
        id={id}
        name="branchId"
        defaultValue={current ?? ''}
        aria-describedby={`${id}-hint`}
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
