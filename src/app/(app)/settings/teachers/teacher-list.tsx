'use client'

/**
 * The teacher list, with each teacher's record editable in place.
 *
 * Three errands behind one summary, in the order an owner needs them: their name,
 * subjects and building, which is the repair almost everybody eventually wants and the
 * one that can never be refused; their permissions; and their account.
 *
 * Permissions are per-teacher rather than per-role because real centres are not
 * tidy: one senior teacher collects fees and edits the roster, another only marks
 * attendance. Collapsed behind a summary, because on a phone five checkboxes per
 * teacher would bury the list itself — and reading the list is the common case,
 * editing is the rare one.
 */
import { useActionState, useState } from 'react'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Field } from '@/components/ui'
import { formatBdMobile } from '@/lib/bd/phone'
import { MIN_PASSWORD } from '@/lib/auth/password'
import type { BranchChoice } from '@/lib/branches'
import { MAX_NAME } from '@/lib/limits'
import { PERMISSION_KEYS } from '@/lib/permissions'
import type { T } from '@/lib/i18n'
import {
  updateTeacher,
  saveTeacherPermissions,
  toggleTeacherActive,
  resetTeacherPassword,
  giveTeacherLogin,
  type ActionState,
} from '../actions'

/**
 * One subject the centre has, for the tick list.
 *
 * `off` is not decoration: a switched-off subject is drawn only on the rows already
 * linked to it, because it is not on offer any more but the link is still real. The
 * label arrives already marked — see settings.teachers.subjectOff.
 */
export type SubjectOption = { id: string; label: string; off: boolean }

export type TeacherRow = {
  id: string
  name: string
  phone: string | null
  active: boolean
  hasLogin: boolean
  subjects: string[]
  /** Which subject ids they are linked to, for the tick list. */
  subjectIds: string[]
  /** Already a sentence — see settings.teachers.batches for why. */
  batchLabel: string
  permissions: Record<string, boolean>
  /**
   * Which building they teach in, and null for head office.
   *
   * `teachers.branch_id`, which is which building's list they appear on and whose salary
   * bill they land in — not `center_members.branch_id`, which is what they may read and
   * is a different screen's business. See the note in the add form.
   */
  branchId: string | null
  /** The reader's own teacher record, which `trim` refuses to switch off. */
  isSelf: boolean
}

export function TeacherList({
  teachers,
  subjects,
  t,
  branchPick,
  branches,
  permissions: labels,
  common,
  trim = false,
}: {
  teachers: TeacherRow[]
  subjects: SubjectOption[]
  t: T<'teacherList'>
  branchPick: T<'branchPick'>
  /** `null` draws no branch field — see branchChoicesFor. */
  branches: BranchChoice[] | null
  permissions: T<'teacherPermissions'>
  common: T<'common'>
  /**
   * Names and one button, for a plan with no staff features that has more
   * teachers switched on than it covers.
   *
   * Everything this hides is a thing that plan does not sell: the name and subject
   * form (there is one teacher and it is the reader), the permission checkboxes
   * (there is nobody to delegate to), the granted-permissions summary (those grants
   * no longer take effect — see lib/auth/session), and the button that switches a
   * teacher back on (`toggleTeacherActive` would refuse it at the seat cap anyway,
   * and offering growth on the screen for shrinking is a way to be told no). What is
   * left is who is switched on and how to change that.
   */
  trim?: boolean
}) {
  /**
   * Which of the five forms spoke last.
   *
   * There are five actions on this screen and each keeps its own last result, so
   * "Permissions saved" was still on the page after a teacher had been turned off
   * — a confirmation naming an action the owner did not just take, sitting above a
   * list that had changed underneath it. Recording the submit is enough to show
   * one message: the newest one, and only that one.
   */
  const [last, setLast] = useState<
    'details' | 'permissions' | 'active' | 'password' | 'login' | null
  >(null)

  /**
   * Which row's login form is mid-conversation.
   *
   * Only the login action asks a question back, and the answer has to appear in the
   * row that asked: a shared banner saying "this number already has an account" is
   * unreadable on a list of nine teachers, and the tick box that agrees to it must
   * sit inside the form that will carry it.
   */
  const [loginRow, setLoginRow] = useState<string | null>(null)

  const [detailsState, detailsAction, detailsPending] = useActionState<
    ActionState,
    FormData
  >(async (prev, formData) => {
    setLast('details')
    return updateTeacher(prev, formData)
  }, null)
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
  const [loginState, loginAction, loginPending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      setLast('login')
      setLoginRow(String(formData.get('teacherId') ?? ''))
      return giveTeacherLogin(prev, formData)
    },
    null,
  )

  const state
    = last === 'active'
      ? activeState
      : last === 'details'
        ? detailsState
        : last === 'permissions'
          ? permState
          : last === 'password'
            ? pwState
            : last === 'login'
              ? loginState
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
           * Their name, and what they teach. First in the panel because it is the
           * repair that can never be refused — a misspelt teacher is on this list
           * and on every batch they run — and because everything under it is either
           * rarer or riskier.
           *
           * The tick list is the live subjects plus any switched-off one this
           * teacher is already linked to. A form that showed only the live ones
           * would quietly cut the other link the next time a name was saved, since
           * the action moves the set to exactly what was ticked.
           */
          const offered = subjects.filter(
            (subject) => !subject.off || teacher.subjectIds.includes(subject.id),
          )

          const details = (
            <form action={detailsAction} className="mt-2 flex flex-col gap-3">
              <input type="hidden" name="teacherId" value={teacher.id} />
              <p className="font-medium text-ink">{t.detailsTitle}</p>

              {/* Per-row id: Field falls back to the field name, and nine rows
                  would otherwise share one and point every label at the first. */}
              <Field
                label={t.nameLabel}
                id={`teacher-name-${teacher.id}`}
                name="name"
                defaultValue={teacher.name}
                required
                maxLength={MAX_NAME}
                autoComplete="off"
              />

              {/* Where they teach, which the add form asks in the same place — after
                  the name, before the subjects. Per-row id for the reason the name
                  field has one: every row's panel is in the document whether it is
                  open or not, so one shared id would point nine labels at the first
                  row's select. Everybody who is not asked still submits the branch
                  they are filed under, which is what keeps a spelling correction from
                  moving them to head office; see BranchPicker. */}
              <BranchPicker
                t={branchPick}
                branches={branches}
                current={teacher.branchId}
                id={`teacher-branch-${teacher.id}`}
              />

              {offered.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-ink">
                    {t.whichSubjects}
                  </legend>
                  {offered.map((subject) => (
                    <label
                      key={subject.id}
                      className="flex min-h-tap cursor-pointer items-center gap-3"
                    >
                      <input
                        type="checkbox"
                        name="subjectIds"
                        value={subject.id}
                        defaultChecked={teacher.subjectIds.includes(subject.id)}
                        className="h-5 w-5 shrink-0 accent-brand-600"
                      />
                      <span className="min-w-0 truncate text-ink">{subject.label}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              <button
                type="submit"
                disabled={detailsPending}
                className="min-h-tap self-start rounded-lg border-2 border-brand-500
                  bg-brand-50 px-4 text-sm font-semibold text-brand-700
                  disabled:opacity-50"
              >
                {detailsPending ? common.saving : common.save}
              </button>
            </form>
          )

          /*
           * The other half of the account story, and the one the add form promised:
           * a teacher who was entered as a name in June, taking their own register
           * in September. Drawn only where there is no account yet — an account that
           * exists is the password box below, not this.
           *
           * The number is editable here and nowhere else in the app, because here it
           * is still just a field. A moment after this form succeeds the same number
           * is the login id, copied onto the profile and into the account itself, and
           * a list showing a number that does not sign in is worse than no edit at
           * all. So the one chance to fix a mistyped digit is before it becomes one.
           *
           * And it is optional, because §5.2 does not need it: an empty box means the
           * login id is a username made from the name on this row. Which is also why
           * an empty box is not "clear the stored number" — see giveTeacherLogin.
           */
          const asking = loginRow === teacher.id && loginState?.confirm

          const login = !teacher.hasLogin && (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="min-h-tap cursor-pointer text-sm font-medium text-brand-700">
                {t.loginSummary}
              </summary>
              <p className="mt-1 text-sm text-ink-soft">{t.loginBody}</p>
              <form action={loginAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="teacherId" value={teacher.id} />
                {/* Per-row ids for the same reason the password box has them: Field
                    falls back to the field name, and nine rows would share one. */}
                <Field
                  label={`${t.loginPhone} (${common.optional})`}
                  hint={t.loginPhoneHint}
                  id={`login-phone-${teacher.id}`}
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="01712345678"
                  defaultValue={teacher.phone ?? ''}
                />
                <Field
                  label={t.loginPassword}
                  hint={t.loginPasswordHint}
                  id={`login-password-${teacher.id}`}
                  name="password"
                  type="text"
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="off"
                />
                {/* Only once the server has said this number already belongs to
                    somebody, and never ticked ahead of time: the owner has to read
                    the name in the banner and agree to it. See createTeacher. */}
                {asking && (
                  <>
                    <Alert tone="warn">{asking}</Alert>
                    <label
                      className="flex min-h-tap cursor-pointer items-center gap-3
                        rounded-xl border-2 border-late/40 bg-late/5 px-4 py-3"
                    >
                      <input
                        type="checkbox"
                        name="confirmLink"
                        className="h-5 w-5 shrink-0 accent-brand-600"
                      />
                      <span className="text-ink">{t.loginConfirm}</span>
                    </label>
                  </>
                )}
                <button
                  type="submit"
                  disabled={loginPending}
                  className="min-h-tap self-start rounded-lg border-2 border-brand-500
                    bg-brand-50 px-4 text-sm font-semibold text-brand-700
                    disabled:opacity-50"
                >
                  {loginPending ? common.saving : t.loginSubmit}
                </button>
              </form>
            </details>
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

                  {details}

                  <form
                    action={permAction}
                    className="mt-3 flex flex-col gap-2 border-t border-line pt-3"
                  >
                    <input type="hidden" name="teacherId" value={teacher.id} />
                    <p className="font-medium text-ink">{t.permissionsTitle}</p>
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

                  {login}
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
