'use client'

/**
 * The appoint-an-administrator form.
 *
 * ONE SELECT AND NO PHONE BOX, which is the whole difference from `giveTeacherLogin`.
 * The people offered are rows the centre has already written down, so their name, their
 * number and their building are recorded on the screens where each is editable — and the
 * mistyped digit that form guards against with a confirm step cannot be introduced here at
 * all. The confirm step survives for the case that is not about typing: the number belongs
 * to somebody who already has an account, and linking to it hands them a manager's reach.
 *
 * THE PASSWORD BOX IS THE ONE PIECE OF PER-CANDIDATE STATE. Most colleagues can already
 * sign in; the accountant written down this morning cannot, and appointing them has to mint
 * an account. Asking everybody for a password would be a required field with nothing behind
 * it, and asking nobody would send the owner to a second screen for a step nobody explained.
 *
 * WHAT THEY MAY READ DEFAULTS TO WHERE THEY WORK, and it is a visible default rather than
 * an inferred one. 20260811000054 declines to guess this column precisely because a guess
 * either confines a new colleague with nothing on the screen saying so or hands them the
 * whole organisation — so the control is drawn, labelled and hinted, and the answer it
 * starts on is the narrower of the two.
 */
import { useActionState, useState } from 'react'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
import { MIN_PASSWORD } from '@/lib/auth/password'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import type { Candidate } from '@/lib/staff/admins'
import { appointManager, type ManagerState } from './actions'

/** The branch picker's own select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

export function AppointManager({
  title,
  candidates,
  branches,
  t,
  branchAccess,
  common,
}: {
  /** The page owns the heading, so its own two fallback cards can share it. */
  title: string
  /** Never empty — the page draws a card of its own when there is nobody to offer. */
  candidates: Candidate[]
  /** `null` draws no branch field at all — see branchChoicesFor. */
  branches: BranchChoice[] | null
  t: T<'managerForm'>
  branchAccess: T<'branchAccess'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<ManagerState, FormData>(
    appointManager,
    null,
  )
  const [picked, setPicked] = useState('')

  /*
   * Undefined once the appointment lands: the action revalidates this page, the new
   * administrator drops off the candidate list, and `picked` stops matching anything. That
   * is what clears the password box and returns the select to its prompt — a form reset in
   * an effect would do the same thing while tripping react-hooks/set-state-in-effect.
   */
  const selected = candidates.find((candidate) => candidate.value === picked)

  /*
   * Their own building, but only one the picker is offering. Somebody filed under a branch
   * that has since been closed defaults to head office with a select they can use, rather
   * than to a hidden field pinning them to a building the centre has left.
   */
  const pin =
    selected && branches?.some((branch) => branch.id === selected.branchId)
      ? selected.branchId
      : null

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5"
    >
      <h2 className="font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-soft">{t.body}</p>

      {state?.error && <Alert>{state.error}</Alert>}
      {/* An ordinary success is a line; a minted username is the deliverable, because the
          owner has to read it out to somebody. Both survive the form being used again. */}
      {state?.ok && <Alert tone="ok">{state.ok}</Alert>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="person" className="font-medium text-ink">
          {t.whoLabel}
        </label>
        <span id="person-hint" className="text-sm text-ink-soft">
          {t.whoHint}
        </span>
        <select
          id="person"
          name="person"
          required
          value={selected ? picked : ''}
          onChange={(event) => setPicked(event.target.value)}
          aria-describedby="person-hint"
          className={SELECT_CLASS}
        >
          <option value="">{t.pickPrompt}</option>
          {candidates.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.job ? `${candidate.name} — ${candidate.job}` : candidate.name}
            </option>
          ))}
        </select>
      </div>

      {/* Remounted with the candidate, so changing who is being appointed moves the default
          back to that person's own building instead of leaving the last one's showing. */}
      <BranchPicker key={picked} t={branchAccess} branches={branches} current={pin} />

      {selected?.needsLogin && (
        <Field
          label={t.passwordLabel}
          hint={selected.byUsername ? t.passwordHintUsername : t.passwordHintPhone}
          name="password"
          type="text"
          required
          minLength={MIN_PASSWORD}
          autoComplete="off"
        />
      )}

      {/* Only once the server has said this number already belongs to somebody, and never
          ticked ahead of time: the owner has to read the name in the banner and agree to
          it. See appointManager. */}
      {state?.confirm && (
        <>
          <Alert tone="warn">{state.confirm}</Alert>
          <label
            className="flex min-h-tap cursor-pointer items-center gap-3 rounded-xl border-2
              border-late/40 bg-late/5 px-4 py-3"
          >
            <input
              type="checkbox"
              name="confirmLink"
              className="h-5 w-5 shrink-0 accent-brand-600"
            />
            <span className="text-ink">{t.confirmTick}</span>
          </label>
        </>
      )}

      <Button type="submit" disabled={pending} full>
        {pending ? common.adding : t.submit}
      </Button>
    </form>
  )
}
