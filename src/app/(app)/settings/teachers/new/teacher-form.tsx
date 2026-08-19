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
 * reports results; who has paid is the owner's business.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, Field } from '@/components/ui'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { createTeacher, type ActionState } from '../../actions'
import { MAX_NAME } from '@/lib/limits'

type SubjectOption = { id: string; label: string }

const PERMISSIONS = [
  {
    name: 'can_manage_exams',
    label: 'পরীক্ষা ও নম্বর',
    hint: 'পরীক্ষা তৈরি করা আর নম্বর দেওয়া',
    default: true,
  },
  {
    name: 'can_send_sms',
    label: 'অভিভাবককে SMS',
    hint: 'নম্বর দেওয়ার পর অভিভাবককে SMS পাঠাতে পারবেন',
    default: true,
  },
  {
    name: 'can_manage_students',
    label: 'শিক্ষার্থী যোগ ও সম্পাদনা',
    hint: '',
    default: false,
  },
  { name: 'can_manage_batches', label: 'ব্যাচ তৈরি ও বদল', hint: '', default: false },
  {
    name: 'can_view_fees',
    label: 'ফি দেখা',
    hint: 'কে টাকা দিয়েছে, কত বাকি',
    default: false,
  },
] as const

export function TeacherForm({ subjects }: { subjects: SubjectOption[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await createTeacher(prev, formData)
      // Redirect on the ordinary success. When an existing account was linked,
      // the success message names whose account it was — redirecting past it
      // would hide exactly the sentence a mistyped digit shows up in.
      if (result?.ok && !result.linked) router.push('/settings/teachers')
      return result
    },
    null,
  )

  const [phone, setPhone] = useState('')
  const [wantsLogin, setWantsLogin] = useState(false)
  const normalized = normalizeBdMobile(phone)
  const showEcho = phone.trim().length > 0

  if (state?.linked) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="ok">{state.ok}</Alert>
        <p className="text-sm text-ink-soft">
          নামটা মিলছে না? তাহলে নম্বরে ভুল হয়েছে — শিক্ষকের তালিকা থেকে তাঁকে বন্ধ
          করে দিন, তাহলে তিনি আর কিছু দেখতে পাবেন না।
        </p>
        <Button type="button" full onClick={() => router.push('/settings/teachers')}>
          শিক্ষকের তালিকা দেখুন
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.confirm && <Alert tone="warn">{state.confirm}</Alert>}

      <Field
        label="শিক্ষকের নাম"
        name="name"
        placeholder="করিম স্যার"
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <div>
        <Field
          label="মোবাইল নম্বর"
          hint="লগইন দিতে চাইলে এই নম্বরটাই তাঁর আইডি হবে"
          name="phone"
          type="tel"
          inputMode="numeric"
          placeholder="01712345678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={showEcho && !normalized ? 'নম্বরটি ঠিক নেই' : undefined}
        />
        {showEcho && normalized && (
          <p className="num mt-1 text-sm font-medium text-brand-700">
            {formatBdMobile(normalized)} ✓
          </p>
        )}
      </div>

      {subjects.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium text-ink">কোন বিষয় পড়ান</legend>
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
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ink">কী কী করতে পারবেন</legend>
        <div className="flex flex-col gap-2">
          {PERMISSIONS.map((permission) => (
            <label
              key={permission.name}
              className="flex min-h-tap cursor-pointer items-start gap-3 rounded-xl
                border-2 border-line bg-white px-4 py-3
                has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
            >
              <input
                type="checkbox"
                name={permission.name}
                defaultChecked={permission.default}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
              />
              <span className="min-w-0">
                <span className="block text-ink">{permission.label}</span>
                {permission.hint && (
                  <span className="block text-sm text-ink-soft">{permission.hint}</span>
                )}
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
            <span className="block font-medium text-ink">এখনই লগইন দিন</span>
            <span className="block text-sm text-ink-soft">
              না দিলেও শিক্ষক যোগ হবে — আপনি নিজেই তাঁর ব্যাচের হাজিরা ও নম্বর দিতে
              পারবেন। পরে যেকোনো সময় লগইন দেওয়া যাবে।
            </span>
          </span>
        </label>

        {wantsLogin && (
          <>
            <Field
              label="শুরুর পাসওয়ার্ড"
              hint="শিক্ষককে বলে দিন — তিনি পরে নিজে বদলে নিতে পারবেন"
              name="password"
              type="text"
              required
              minLength={MIN_PASSWORD}
              autoComplete="off"
              placeholder="যেমন 123456"
            />
            <p className="text-sm text-ink-soft">
              লগইন দিলে শিক্ষক নিজের ফোন থেকে হাজিরা ও নম্বর দিতে পারবেন। উপরে যেসব
              অনুমতি টিক দেওয়া আছে, শুধু সেগুলোই তিনি করতে পারবেন।
            </p>
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
            <span className="text-ink">হ্যাঁ, এটাই তিনি — অ্যাকাউন্টটি যুক্ত করুন</span>
          </label>
        )}
      </fieldset>

      <Button type="submit" full disabled={pending}>
        {pending ? 'যোগ হচ্ছে…' : 'শিক্ষক যোগ করুন'}
      </Button>
    </form>
  )
}
