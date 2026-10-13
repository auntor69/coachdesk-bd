'use client'

import { useActionState, useState } from 'react'

import { createCenter, type FormState } from './actions'
import { Alert, Button, Field } from '@/components/ui'
import { ACCOUNT_KINDS, isAccountKind } from '@/lib/accounts/kind'
import { MAX_NAME } from '@/lib/limits'
import { digits } from '@/lib/bd/time'
import { fill } from '@/lib/i18n/fill'
import type { Locale, T } from '@/lib/i18n'

/**
 * The one irreversible-feeling choice in the product, so it is asked plainly
 * and framed by who the person is rather than by what the software does.
 *
 * THREE ANSWERS, AND THE DATABASE KEEPS THE ONE GIVEN (20260811000091). This form used to
 * offer two, and neither was written down: a boolean decided whether the owner also got a
 * `teachers` row, and the trial a signup was given had nothing to do with the answer. Every
 * account — including a coaching centre — was handed a fortnight of Teacher Pro, which is
 * one batch, one teacher and no staff list, and then dropped to Teacher Free. The three
 * answers below are now a column, the trial each one gets is chosen from it, and the
 * sentence under each option says what that trial actually is.
 *
 * ITS WORDS ARRIVE, in the reader's own language. They used to be typed here, on the
 * argument that a signup has expressed no language preference yet — which stopped being
 * true the moment the signup screen above it asked, through `readerLocale`, and the form one
 * second earlier was in English. The group's note in lib/i18n/bn.ts has the whole story.
 *
 * The four labels per option are indexed by `AccountKind`, which is the same union
 * `ACCOUNT_KINDS` is made of and the same one `bootstrap_center` refuses a fourth value of —
 * so an answer added to the database without copy here is a compile error rather than a
 * nameless row.
 */
export type TrialDays = Record<(typeof ACCOUNT_KINDS)[number], number>

export function OnboardingForm({
  trialDays,
  t,
  locale,
}: {
  trialDays: TrialDays
  /** `auth.onboarding`, including one set of words per `ACCOUNT_KINDS` entry. */
  t: T<'auth'>['onboarding']
  /** For the days count, which is Bangla numerals in a Bangla sentence. */
  locale: Locale
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createCenter,
    null,
  )
  // Narrowed through `isAccountKind` rather than asserted: the list is the same one the
  // action validates against and the database holds, so a fourth kind added there fails to
  // compile here instead of rendering an option the server would refuse.
  const [mode, setMode] = useState<(typeof ACCOUNT_KINDS)[number]>(ACCOUNT_KINDS[0])

  const selected = t.modes[mode]
  const days = trialDays[mode] ?? 0

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="mode" value={mode} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold text-ink">{t.question}</legend>

        {ACCOUNT_KINDS.map((id) => {
          const option = t.modes[id]
          const active = id === mode
          return (
            <label
              key={id}
              className={`flex cursor-pointer gap-3 rounded-2xl border-2 p-4
                transition-colors ${
                  active
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-line bg-white hover:border-brand-200'
                }`}
            >
              <input
                type="radio"
                name="modeChoice"
                value={id}
                checked={active}
                onChange={() => {
                  if (isAccountKind(id)) setMode(id)
                }}
                className="mt-1.5 h-5 w-5 shrink-0 accent-brand-600"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-ink">{option.title}</span>
                <span className="text-sm text-ink-soft">{option.body}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      {/*
       * What the choice costs for the first days, said before the name is typed. The number
       * is not this file's: the onboarding page reads it from `platform_settings`, which is
       * the same row `bootstrap_center` reads when it writes the trial — so the promise on
       * the screen and the grant in the database are one number, and changing it in the
       * founder panel changes both.
       *
       * A `{days}`/`{how}` template rather than a function, because the number and the
       * closing verb both depend on the answer chosen in the browser. `{how}` is one of two
       * variants rather than a second sentence, so Bangla can put the verb where Bangla puts
       * it and English can put it where English does.
       */}
      {days > 0 && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          {fill(t.trialLine, {
            days: digits(days, locale),
            how: mode === 'teacher' ? t.thenSubscribe : t.thenTopUp,
          })}
        </p>
      )}

      <Field
        label={selected.nameLabel}
        name="centerName"
        placeholder={selected.namePlaceholder}
        maxLength={MAX_NAME}
        required
        error={state?.field === 'center' ? state.error : undefined}
      />

      {state?.error && !state.field && <Alert>{state.error}</Alert>}

      <Button type="submit" full disabled={pending}>
        {pending ? t.submitting : t.submit}
      </Button>

      {/*
       * This used to end 'শিক্ষক যোগ করলে এটি সেন্টার হয়ে যাবে' — adding a teacher turns
       * this into a centre. It does not, and could not: `maxTeachers` is 1 on the free
       * tier and 1 on Pro too, at any price, because one colleague is the whole line
       * between a teacher plan and a centre plan. So the sentence described a self-serve
       * promotion that no screen performs, to the exact reader most likely to need it —
       * somebody choosing 'I teach alone' partly because they were told staff was one
       * tap away later. What actually happens is a plan request from /settings/billing and
       * a phone call, so that is what it says now.
       *
       * AND THE CHOICE IS NOT A LOCK: `account_kind` is what the signup said, not what the
       * account may ever be. Moving between them is a plan request, which the last line
       * already points at.
       */}
      <p className="text-center text-sm text-ink-faint">{t.nameNote}</p>
    </form>
  )
}
