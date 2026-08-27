'use client'

/**
 * The teacher list, with each teacher's permissions editable in place.
 *
 * Permissions are per-teacher rather than per-role because real centres are not
 * tidy: one senior teacher collects fees and edits the roster, another only marks
 * attendance. Collapsed behind a summary, because on a phone five checkboxes per
 * teacher would bury the list itself — and reading the list is the common case,
 * editing is the rare one.
 */
import { useActionState, useState } from 'react'

import { Alert, Field } from '@/components/ui'
import { formatBdMobile } from '@/lib/bd/phone'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { PERMISSION_KEYS } from '@/lib/permissions'
import type { T } from '@/lib/i18n'
import {
  saveTeacherPermissions,
  toggleTeacherActive,
  resetTeacherPassword,
  type ActionState,
} from '../actions'

export type TeacherRow = {
  id: string
  name: string
  phone: string | null
  active: boolean
  hasLogin: boolean
  subjects: string[]
  /** Already a sentence — see settings.teachers.batches for why. */
  batchLabel: string
  permissions: Record<string, boolean>
  /** The reader's own teacher record, which `trim` refuses to switch off. */
  isSelf: boolean
}

export function TeacherList({
  teachers,
  t,
  permissions: labels,
  common,
  trim = false,
}: {
  teachers: TeacherRow[]
  t: T<'teacherList'>
  permissions: T<'teacherPermissions'>
  common: T<'common'>
  /**
   * Names and one button, for a plan with no staff features that has more
   * teachers switched on than it covers.
   *
   * Everything this hides is a thing that plan does not sell: the permission
   * checkboxes (there is nobody to delegate to), the granted-permissions summary
   * (those grants no longer take effect — see lib/auth/session), and the button
   * that switches a teacher back on (`toggleTeacherActive` would refuse it at the
   * seat cap anyway, and offering growth on the screen for shrinking is a way to
   * be told no). What is left is who is switched on and how to change that.
   */
  trim?: boolean
}) {
  /**
   * Which of the three forms spoke last.
   *
   * There are three actions on this screen and each keeps its own last result, so
   * "Permissions saved" was still on the page after a teacher had been turned off
   * — a confirmation naming an action the owner did not just take, sitting above a
   * list that had changed underneath it. Recording the submit is enough to show
   * one message: the newest one, and only that one.
   */
  const [last, setLast] = useState<'permissions' | 'active' | 'password' | null>(null)

  const [permState, permAction, permPending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      setLast('permissions')
      return saveTeacherPermissions(prev, formData)
    },
    null,
  )
  const [activeState, activeAction, activePending] = useActionState<
    ActionState,
    FormData
  >(async (prev, formData) => {
    setLast('active')
    return toggleTeacherActive(prev, formData)
  }, null)
  const [pwState, pwAction, pwPending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      setLast('password')
      return resetTeacherPassword(prev, formData)
    },
    null,
  )

  const state
    = last === 'active'
      ? activeState
      : last === 'permissions'
        ? permState
        : last === 'password'
          ? pwState
          : null
  const error = state?.error
  const ok = state?.ok

  /** The short summary line under each name. */
  const grantedLabels = (granted: Record<string, boolean>): string[] =>
    PERMISSION_KEYS.filter((key) => granted[key]).map((key) => labels[key].label)

  return (
    <section className="flex flex-col gap-2">
      {error && <Alert>{error}</Alert>}
      {ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {ok}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {teachers.map((teacher) => {
          const granted = grantedLabels(teacher.permissions)

          /*
           * Extracted because `trim` and the full list put it in different places
           * — directly in the row, or at the bottom of the collapsed panel — and
           * it is the one control both of them keep. The outer spacing belongs to
           * whichever branch renders it.
           */
          const toggle = (
            <form action={activeAction}>
              <input type="hidden" name="teacherId" value={teacher.id} />
              <input
                type="hidden"
                name="active"
                value={teacher.active ? 'false' : 'true'}
              />
              <p className="mb-2 text-sm text-ink-soft">
                {teacher.active ? t.deactivateBody : t.reactivateBody}
              </p>
              <button
                type="submit"
                disabled={activePending}
                className={`min-h-tap rounded-lg border-2 px-4 text-sm font-semibold
                  disabled:opacity-50 ${
                    teacher.active
                      ? 'border-absent/40 bg-absent/5 text-absent'
                      : 'border-brand-500 bg-brand-50 text-brand-700'
                  }`}
              >
                {teacher.active ? t.deactivate : t.reactivate}
              </button>
            </form>
          )

          /*
           * The only "forgot password" this product has, and it is here rather than
           * on a screen of its own because there is nowhere to send a reset link:
           * login is a number and a password, no email and no OTP. Behind its own
           * summary so a password box is not sitting open on twelve rows at once.
           *
           * Drawn only where it would work — an account that exists, switched on,
           * and not the reader's own. All three are refused by the action too, since
           * a Server Action is a public endpoint, but a control that can only say no
           * is worse than no control. The fourth refusal is the one that cannot be
           * predicted from this list: an account that belongs to another centre as
           * well, which an owner is not allowed to be shown.
           */
          const reset = teacher.hasLogin && teacher.active && !teacher.isSelf && (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="min-h-tap cursor-pointer text-sm font-medium text-brand-700">
                {t.resetSummary}
              </summary>
              <p className="mt-1 text-sm text-ink-soft">{t.resetBody}</p>
              <form action={pwAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="teacherId" value={teacher.id} />
                {/* id spelled out per row: Field falls back to the name for it, and
                    twelve inputs called "password" would give twelve rows the same
                    id and point every label at the first one. */}
                <Field
                  label={t.resetLabel}
                  hint={t.resetHint}
                  id={`reset-password-${teacher.id}`}
                  name="password"
                  type="text"
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={pwPending}
                  className="min-h-tap self-start rounded-lg border-2 border-brand-500
                    bg-brand-50 px-4 text-sm font-semibold text-brand-700
                    disabled:opacity-50"
                >
                  {pwPending ? common.saving : t.resetSubmit}
                </button>
              </form>
            </details>
          )

          return (
            <li
              key={teacher.id}
              className="rounded-xl border border-line bg-white px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {teacher.name}
                    {!teacher.active && (
                      <span className="ml-2 text-sm text-ink-faint">{t.inactive}</span>
                    )}
                  </p>
                  {teacher.subjects.length > 0 && (
                    <p className="truncate text-sm text-ink-soft">
                      {teacher.subjects.join(' · ')}
                    </p>
                  )}
                  <p className="text-sm text-ink-faint">
                    {teacher.batchLabel}
                    {!trim && granted.length > 0 && ` · ${granted.join(', ')}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {teacher.phone && (
                    <p className="num text-sm text-ink-soft">
                      {formatBdMobile(teacher.phone)}
                    </p>
                  )}
                  {!teacher.hasLogin && <p className="text-xs text-late">{t.noLogin}</p>}
                </div>
              </div>

              {trim ? (
                /* Inactive rows carry nothing at all here: they are already off,
                   and switching one back on is growth this plan does not sell. */
                teacher.active &&
                (teacher.isSelf ? (
                  <p className="mt-2 border-t border-line pt-2 text-sm text-ink-faint">
                    {t.yourSeat}
                  </p>
                ) : (
                  <div className="mt-2 border-t border-line pt-2">{toggle}</div>
                ))
              ) : (
                <details className="mt-2 border-t border-line pt-2">
                  <summary className="min-h-tap cursor-pointer text-sm font-medium text-brand-700">
                    {t.edit}
                  </summary>

                  <form action={permAction} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="teacherId" value={teacher.id} />
                    {PERMISSION_KEYS.map((key) => (
                      <label
                        key={key}
                        className="flex min-h-tap cursor-pointer items-start gap-3"
                      >
                        <input
                          type="checkbox"
                          name={key}
                          defaultChecked={teacher.permissions[key] ?? false}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                        />
                        <span className="min-w-0">
                          <span className="block text-ink">{labels[key].label}</span>
                          <span className="block text-sm text-ink-soft">
                            {labels[key].hint}
                          </span>
                        </span>
                      </label>
                    ))}
                    <button
                      type="submit"
                      disabled={permPending}
                      className="min-h-tap self-start rounded-lg border-2 border-brand-500
                        bg-brand-50 px-4 text-sm font-semibold text-brand-700
                        disabled:opacity-50"
                    >
                      {permPending ? common.saving : t.save}
                    </button>
                  </form>

                  {reset}

                  <div className="mt-3 border-t border-line pt-3">{toggle}</div>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
