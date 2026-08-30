'use client'

/**
 * Adding a teacher.
 *
 * Two things are being created here and they are separable: a *record* of a
 * teacher, and a *login* for them. Plenty of centres have a part-timer who takes
 * two batches a week and will never open the app — that person still needs to
 * exist so batches and marks can be attributed to them. So the login is a
 * deliberate opt-in rather than a required step.
 *
 * The permission boxes default to what the database defaults to: marks and SMS
 * on, students and fees off. That is the ordinary case — a teacher teaches and
 * reports results; who has paid is the owner's business. Those defaults live in
 * `@/lib/permissions` beside the list of five, because the list screen falls back
 * to the same values when a teacher has no permissions row at all.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { PERMISSION_KEYS, PERMISSION_DEFAULTS } from '@/lib/permissions'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import { createTeacher, type ActionState } from '../../actions'
import { MAX_NAME } from '@/lib/limits'

type SubjectOption = { id: string; label: string }

export function TeacherForm({
  t,
  permissions: labels,
  common,
  subjects,
  branchPick,
  branches,
}: {
  t: T<'teacherForm'>
  permissions: T<'teacherPermissions'>
  common: T<'common'>
  /** `null` is the list that could not be read — see the aside below the ticks. */
  subjects: SubjectOption[] | null
  branchPick: T<'branchPick'>
  /** `null` draws no branch field at all — see branchChoicesFor. */
  branches: BranchChoice[] | null
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await createTeacher(prev, formData)
      // Redirect on the ordinary success only. Two successes stay on this screen
      // because the sentence itself is the deliverable: a linked account names
      // whose it was, which is where a mistyped digit shows up, and a minted
      // username is the one thing here the owner has to read out loud to somebody.
      if (result?.ok && !result.linked && !result.username) {
        router.push('/settings/teachers')
      }
      return result
    },
    null,
  )

  const [phone, setPhone] = useState('')
  const [wantsLogin, setWantsLogin] = useState(false)
  const normalized = normalizeBdMobile(phone)
  const showEcho = phone.trim().length > 0

  // The form is finished with, but the message it produced is not: `ok` carries
  // either the name of the account that was joined or the username that was minted,
  // and both have to survive being read. `wrongPerson` belongs only to the first —
  // there is nobody else a fresh username could have been.
  if (state?.linked || state?.username) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="ok">{state.ok}</Alert>
        {state.linked && <p className="text-sm text-ink-soft">{t.wrongPerson}</p>}
        <Button type="button" full onClick={() => router.push('/settings/teachers')}>
          {t.seeList}
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.confirm && <Alert tone="warn">{state.confirm}</Alert>}

      <Field
        label={t.nameLabel}
        name="name"
        placeholder={t.namePlaceholder}
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <div>
        <Field
          label={`${t.phone} (${common.optional})`}
          hint={t.phoneHint}
          name="phone"
          type="tel"
          inputMode="numeric"
          placeholder="01712345678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={showEcho && !normalized ? t.phoneBad : undefined}
        />
        {showEcho && normalized && (
          <p className="num mt-1 text-sm font-medium text-brand-700">
            {formatBdMobile(normalized)} ✓
          </p>
        )}
      </div>

      {/* WHERE THEY TEACH, NOT WHAT THEY MAY SEE, and the two are easy to confuse
          because both are a branch. This one is `teachers.branch_id`: it puts them on
          the Mirpur staff list and in Mirpur's salary bill. What a colleague may reach
          is `center_members.branch_id`, which is a permission and has to be typed on
          its own screen — 20260811000054 declines to infer it for exactly this reason.
          A teacher filed under Mirpur still reads the whole organisation until
          somebody says otherwise. */}
      <BranchPicker t={branchPick} branches={branches} />

      {/* A line where the ticks would be, when the list of subjects could not be read.
          The same call the new-student form makes and for the same reasons: the ticks
          are optional, nothing exists yet to be overwritten, and the teacher list is
          where a missing one gets put right. Silence is the only thing ruled out. */}
      {subjects === null ? (
        <p className="text-sm text-ink-soft">{t.subjectsUnreadable}</p>
      ) : (
        subjects.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium text-ink">{t.whichSubjects}</legend>
            <div className="flex flex-col gap-2">
              {subjects.map((subject) => (
                <label
                  key={subject.id}
                  className="flex min-h-tap cursor-pointer items-center gap-3
                    rounded-xl border-2 border-line bg-white px-4
                    has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
                >
                  <input
                    type="checkbox"
                    name="subjectIds"
                    value={subject.id}
                    className="h-5 w-5 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0 truncate text-ink">{subject.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ink">{t.whatTheyCanDo}</legend>
        <div className="flex flex-col gap-2">
          {PERMISSION_KEYS.map((key) => (
            <label
              key={key}
              className="flex min-h-tap cursor-pointer items-start gap-3 rounded-xl
                border-2 border-line bg-white px-4 py-3
                has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
            >
              <input
                type="checkbox"
                name={key}
                defaultChecked={PERMISSION_DEFAULTS[key]}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
              />
              <span className="min-w-0">
                <span className="block text-ink">{labels[key].label}</span>
                <span className="block text-sm text-ink-soft">{labels[key].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
        <label className="flex min-h-tap cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="wantsLogin"
            checked={wantsLogin}
            onChange={(e) => setWantsLogin(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
          />
          <span className="min-w-0">
            <span className="block font-medium text-ink">{t.loginNow}</span>
            <span className="block text-sm text-ink-soft">{t.loginNowBody}</span>
          </span>
        </label>

        {wantsLogin && (
          <>
            <Field
              label={t.password}
              hint={t.passwordHint}
              name="password"
              type="text"
              required
              minLength={MIN_PASSWORD}
              autoComplete="off"
              placeholder={t.passwordPlaceholder}
            />
            <p className="text-sm text-ink-soft">{t.passwordNote}</p>
          </>
        )}

        {/*
          Only rendered once the server has said the number belongs to an existing
          account. Unchecked by default and deliberately not remembered, so the
          owner has to look at the name in the banner above and agree to it.
        */}
        {state?.confirm && (
          <label
            className="flex min-h-tap cursor-pointer items-center gap-3 rounded-xl
              border-2 border-late/40 bg-late/5 px-4 py-3"
          >
            <input
              type="checkbox"
              name="confirmLink"
              className="h-5 w-5 shrink-0 accent-brand-600"
            />
            <span className="text-ink">{t.confirmLink}</span>
          </label>
        )}
      </fieldset>

      <Button type="submit" full disabled={pending}>
        {pending ? common.adding : t.submit}
      </Button>
    </form>
  )
}
