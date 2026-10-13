'use client'

import { useActionState, useState } from 'react'

import { createCenter, type FormState } from './actions'
import { Alert, Button, Field } from '@/components/ui'
import { ACCOUNT_KINDS, type AccountKind, isAccountKind } from '@/lib/accounts/kind'
import { MAX_NAME } from '@/lib/limits'

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
 * The words are Bangla throughout, like the rest of (auth): a signup has expressed no
 * language preference yet, and this is the first screen they read.
 */
const MODES: {
  id: AccountKind
  title: string
  body: string
  nameLabel: string
  namePlaceholder: string
}[] = [
  {
    id: 'teacher',
    title: 'আমি একা পড়াই',
    body: 'নিজের ব্যাচ, নিজের শিক্ষার্থী। হাজিরা আর ফলাফল আপনিই নেবেন।',
    nameLabel: 'আপনার কোচিং/ব্যাচের নাম',
    namePlaceholder: 'রফিক স্যারের গণিত',
  },
  {
    id: 'center',
    title: 'আমার কোচিং সেন্টার আছে',
    body: 'একাধিক শিক্ষক ও ব্যাচ, কর্মচারী আর হিসাব এক জায়গায়।',
    nameLabel: 'কোচিং সেন্টারের নাম',
    namePlaceholder: 'উত্তরা আইডিয়াল কোচিং',
  },
  {
    id: 'institution',
    title: 'আমার একাধিক শাখা আছে',
    body: 'প্রতিষ্ঠান — একাধিক শাখা, শাখাভিত্তিক হিসাব আর একসাথে রিপোর্ট।',
    nameLabel: 'প্রতিষ্ঠানের নাম',
    namePlaceholder: 'আদর্শ একাডেমি',
  },
]

/** Whole days, in Bangla numerals, for the offer line under each option. */
const bn = (value: number) => String(value).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)])

export type TrialDays = Record<AccountKind, number>

export function OnboardingForm({ trialDays }: { trialDays: TrialDays }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createCenter,
    null,
  )
  // Narrowed through `isAccountKind` rather than asserted: the list is the same one the
  // action validates against and the database holds, so a fourth kind added there fails to
  // compile here instead of rendering an option the server would refuse.
  const [mode, setMode] = useState<AccountKind>(ACCOUNT_KINDS[0])

  const selected = MODES.find((m) => m.id === mode)!
  const days = trialDays[mode] ?? 0

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="mode" value={mode} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold text-ink">
          আপনি কোনটি?
        </legend>

        {MODES.map((option) => {
          const active = option.id === mode
          return (
            <label
              key={option.id}
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
                value={option.id}
                checked={active}
                onChange={() => {
                  if (isAccountKind(option.id)) setMode(option.id)
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
       */}
      {days > 0 && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          প্রথম {bn(days)} দিন সম্পূর্ণ ফ্রি — কার্ড বা পেমেন্ট লাগবে না। এরপর ব্যবহার
          চালিয়ে যেতে {mode === 'teacher' ? 'সাবস্ক্রিপশন নিতে' : 'ব্যালেন্স যোগ করতে'} হবে।
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
        {pending ? 'তৈরি হচ্ছে…' : 'শুরু করুন'}
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
      <p className="text-center text-sm text-ink-faint">
        পরে নাম বদলাতে পারবেন। একাধিক শিক্ষক লাগলে সেন্টার প্ল্যান নিতে হবে — অ্যাপ থেকেই
        আমাদের বলতে পারবেন।
      </p>
    </form>
  )
}
