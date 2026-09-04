'use client'

/**
 * The teacher list, with each teacher's record editable in place.
 *
 * Three errands behind one summary, in the order an owner needs them: their name,
 * subjects and building, which is the repair almost everybody eventually wants and the
 * one that can never be refused; their permissions; and their account. Side by side from
 * `lg` rather than stacked, because that is what §20.8's seventh step is for — the record
 * and the access in one place, close enough to read one while changing the other.
 *
 * A row is three aligned cells at that width, under a strip that names them: who they
 * are, what they carry, whether they can sign in. Aligned so a column can be read down
 * — "who can send SMS" was nine sentences to read one at a time.
 *
 * Permissions are per-teacher rather than per-role because real centres are not
 * tidy: one senior teacher collects fees and edits the roster, another only marks
 * attendance. Collapsed behind a summary, because on a phone five checkboxes per
 * teacher would bury the list itself — and reading the list is the common case,
 * editing is the rare one.
 */
import { useActionState, useState } from 'react'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
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
  deleteTeacher,
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
  /**
   * What they type to sign in, for an account minted against their name (§5.2).
   *
   * Null where they sign in with the number already on the row, and null where there is no
   * account at all. Read from `profiles` by the page, because it is the one fact about a
   * login that is knowable nowhere else in the app — see usernamesFor.
   */
  username: string | null
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
  /**
   * Which branch their login may reach, or `undefined` for "do not ask".
   *
   * `center_members.branch_id` — a permission and not a filing. Undefined where there is
   * no membership row to pin: no account, or an account switched off.
   */
  accessBranchId?: string | null
  /** The reader's own teacher record, which `trim` refuses to switch off. */
  isSelf: boolean
}

export function TeacherList({
  teachers,
  subjects,
  t,
  branchPick,
  branchAccess,
  branches,
  permissions: labels,
  common,
  trim = false,
}: {
  teachers: TeacherRow[]
  subjects: SubjectOption[]
  t: T<'teacherList'>
  branchPick: T<'branchPick'>
  branchAccess: T<'branchAccess'>
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

  /**
   * Which row has its removal armed, and it is at most one.
   *
   * Per row for `loginRow`'s reason and one more of its own: this is the destructive
   * control, so an armed confirm step must be visibly attached to the name it is
   * about. It also carries the refusal — a removal that is refused changes nothing on
   * screen, so the sentence explaining why has to appear inside the row that asked
   * rather than in the banner at the top, which belongs to the five forms that save.
   */
  const [removeRow, setRemoveRow] = useState<string | null>(null)

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

  /*
   * The sixth form, and the one that stays out of `last`. The other five report into
   * the banner above the list because each of them leaves the row where it was; this
   * one either makes the row disappear — no sentence needed, and none that would have
   * anywhere to sit — or refuses, and a refusal about one teacher among nine belongs
   * beside that teacher. So it needs no wrapper: `removeRow` is already set by the
   * button that armed the step.
   */
  const [removeState, removeAction, removePending] = useActionState<ActionState, FormData>(
    deleteTeacher,
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

      {/* The column heads, from `lg` only. Below that each row is three stacked lines
          that explain themselves, and a strip of labels over them would be furniture.
          Not a <table>: every row opens into forms, and a <details> cannot wrap <tr>s. */}
      <div
        aria-hidden
        className="hidden px-4 text-xs font-medium uppercase tracking-wide text-ink-faint
          lg:flex lg:gap-3"
      >
        <div className="grid flex-1 grid-cols-2 gap-4">
          <span>{t.colTeacher}</span>
          <span>{trim ? t.colBatches : t.colWork}</span>
        </div>
        <span className="w-44 text-right">{t.colLogin}</span>
      </div>

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
           * Removing the record, which is not the same repair as the switch above it and
           * is drawn to look like it: a quiet underlined word that arms a step, the way
           * every other removal in settings does (see list-row.tsx, whose three-state
           * shape this follows — armed-and-blocked, armed-and-confirming, or closed).
           *
           * The arm word is drawn for a teacher who is still switched on as well, and
           * answers with `removeNeedsOff`. Hiding it there would be tidier and worse:
           * the whole reason this control exists is that an owner reported not being
           * able to find any way to delete a teacher, and a control that appears only
           * after an unrelated step is one they never find either.
           *
           * Everything past those two facts is the server's. The row knows whether the
           * teacher is off and whether they are the reader; it does not know how many
           * registers they took, and counting that for every row would be four queries
           * per teacher on a page that already does four. So `deleteTeacher` re-reads
           * both facts and adds the four counts, and its refusal lands here.
           */
          const armed = removeRow === teacher.id
          const remove = (
            <>
              {/* An error survives on screen because nothing moved: a refused removal
                  leaves the row, this panel and this list exactly as they were. On
                  success there is no row left to render it in. */}
              {armed && removeState?.error && <Alert>{removeState.error}</Alert>}

              {!armed ? (
                <button
                  type="button"
                  onClick={() => setRemoveRow(teacher.id)}
                  className="inline-flex min-h-tap items-center text-sm text-ink-faint
                    underline"
                >
                  {t.removeOpen}
                </button>
              ) : teacher.active ? (
                <>
                  <p className="font-medium text-ink">{t.removeBlockedTitle}</p>
                  <p className="mt-1 max-w-prose text-sm text-ink-soft">
                    {t.removeNeedsOff}
                  </p>
                  <div className="mt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setRemoveRow(null)}
                    >
                      {t.keep}
                    </Button>
                  </div>
                </>
              ) : (
                <form action={removeAction} className="flex flex-col gap-3">
                  <input type="hidden" name="teacherId" value={teacher.id} />

                  <div>
                    <p className="font-medium text-ink">{t.removeHeading}</p>
                    <p className="mt-1 max-w-prose text-sm text-ink-soft">
                      {t.removeWarning}
                    </p>
                  </div>

                  {/* Keep-it first and full width, remove second and narrow, which is
                      the order every confirm step in this app uses: the habit the
                      product builds is "the wide one at the bottom is the one you
                      press", and a confirm step is the worst place to break it.
                      `self-start` is what keeps the second one narrow — a flex column
                      stretches its children otherwise. */}
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRemoveRow(null)}
                      full
                    >
                      {t.keep}
                    </Button>
                    <Button
                      type="submit"
                      variant="danger"
                      disabled={removePending}
                      className="self-start"
                    >
                      {removePending ? t.removing : t.removeConfirm}
                    </Button>
                  </div>
                </form>
              )}
            </>
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
            <form action={detailsAction} className="flex flex-col gap-3">
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

              {/* And what that login may reach, which is the other thing a branch means
                  about a person. Only where there is a membership row to pin — no field
                  at all otherwise, so the action leaves the column alone rather than
                  reading a silence as head office. */}
              {teacher.accessBranchId !== undefined && (
                <BranchPicker
                  t={branchAccess}
                  branches={branches}
                  current={teacher.accessBranchId}
                  name="accessBranchId"
                  id={`teacher-access-${teacher.id}`}
                />
              )}

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
            <div className="border-t border-line pt-3 lg:border-t-0 lg:pt-0">
              <p className="font-medium text-ink">{t.loginSummary}</p>
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
            </div>
          )

          /*
           * The only "forgot password" this product has, and it is here rather than
           * on a screen of its own because there is nowhere to send a reset link:
           * login is a number and a password, no email and no OTP. No longer behind a
           * second summary inside the first: a password box was three clicks away, and
           * one closed row is already enough to keep it off a list of twelve.
           *
           * Drawn only where it would work — an account that exists, switched on,
           * and not the reader's own. All three are refused by the action too, since
           * a Server Action is a public endpoint, but a control that can only say no
           * is worse than no control. The fourth refusal is the one that cannot be
           * predicted from this list: an account that belongs to another centre as
           * well, which an owner is not allowed to be shown.
           */
          const reset = teacher.hasLogin && teacher.active && !teacher.isSelf && (
            <div className="border-t border-line pt-3 lg:border-t-0 lg:pt-0">
              <p className="font-medium text-ink">{t.resetSummary}</p>
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
            </div>
          )

          return (
            <li
              key={teacher.id}
              className="rounded-xl border border-line bg-white px-4 py-3"
            >
              {/* Three cells, and from `lg` they are the three columns the strip above
                  the list names: who they are, what they carry, whether they can sign
                  in. The same widths on every row, so a column can be read down —
                  "who can send SMS" was nine sentences to read before this. */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 lg:grid lg:grid-cols-2 lg:gap-4">
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
                  </div>

                  {/* Their batches and their grants, which used to be one joined line
                      and are now a column of their own. `noExtras` rather than a blank
                      cell: an empty space under a heading reads as a figure that did
                      not arrive, and "attendance and marks only" is the answer. */}
                  <div className="min-w-0">
                    <p className="text-sm text-ink-faint">{teacher.batchLabel}</p>
                    {!trim && (
                      <p className="text-sm text-ink-faint">
                        {granted.length > 0 ? granted.join(', ') : t.noExtras}
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-right lg:w-44">
                  {teacher.phone && (
                    <p className="num text-sm text-ink-soft">
                      {formatBdMobile(teacher.phone)}
                    </p>
                  )}
                  {/* What they type, for the ones who type a name rather than a number,
                      and on the row rather than behind the disclosure: an owner asked for
                      it by a teacher on the phone should not have to open anything, and
                      `break-all` because a thirty-character username in a 176px cell must
                      wrap rather than end in an ellipsis — a login id cut short is the
                      same defect in a new place. */}
                  {teacher.username && (
                    <p className="break-all text-sm text-ink-soft">
                      <span className="text-ink-faint">{t.usernameLabel} </span>
                      <span className="font-medium text-ink">{teacher.username}</span>
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

                  {/*
                   * THE RECORD AND THE ACCESS SIDE BY SIDE, WHICH IS THE ERRAND (§20.8.7).
                   *
                   * Three forms that used to be a stack roughly twice a laptop screen
                   * tall: an owner ticking a permission could not see the name it was
                   * about, and the account form was below both. Two columns from `lg`
                   * and three from `2xl`, which is also what keeps a name box from being
                   * set six hundred pixels wide on a big monitor.
                   *
                   * Below `lg` the same blocks stack in the same order, each with the
                   * rule above it that used to separate them.
                   */}
                  <div
                    className="mt-1 flex flex-col gap-4 lg:grid lg:grid-cols-2
                      lg:items-start lg:gap-6 2xl:grid-cols-3"
                  >
                    {details}

                    <form
                      action={permAction}
                      className="flex flex-col gap-2 border-t border-line pt-3
                        lg:border-t-0 lg:pt-0"
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

                    {/* At most one of the two is ever drawn — one asks for an account,
                        the other repairs one — so they share the third column. */}
                    {login}
                    {reset}
                  </div>

                  {/* The one destructive control, under all three and across the width:
                      it is not part of any of them, and it is not a thing to reach for
                      while correcting a spelling. */}
                  <div className="mt-4 border-t border-line pt-3">{toggle}</div>

                  {/* And below it the record itself, for the row that should never have
                      existed. Not offered on the reader's own — see deleteSelf — so the
                      panel simply ends there rather than explaining a rule about a
                      button that is not drawn. */}
                  {!teacher.isSelf && (
                    <div className="mt-4 border-t border-line pt-3">{remove}</div>
                  )}
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
