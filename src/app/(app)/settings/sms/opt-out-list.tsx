'use client'

/**
 * Who does not get messages.
 *
 * Every switch here is a decision the centre already made in real life — a
 * number that belongs to someone else, a parent who asked to be left alone, a
 * student who stopped coming. The product's job is to obey it without needing
 * the record deleted, because attendance and marks history should survive a
 * parent opting out of SMS.
 */
import { useActionState } from 'react'

import { Alert } from '@/components/ui'
import { toggleSmsOptOut, type ActionState } from '../actions'
import { formatBdMobile } from '@/lib/bd/phone'

export type OptOutStudent = {
  id: string
  name: string
  guardianPhone: string | null
  optOut: boolean
}

export function OptOutList({ students }: { students: OptOutStudent[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    toggleSmsOptOut,
    null,
  )

  const off = students.filter((s) => s.optOut).length

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold text-ink">কে SMS পাবে না</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          {off === 0 ? (
            'এখন সবাই SMS পাচ্ছে।'
          ) : (
            <>
              <span className="num">{off}</span> জনের SMS বন্ধ আছে।
            </>
          )}
        </p>
      </div>

      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {state.ok}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {students.map((student) => (
          <li
            key={student.id}
            className="flex items-center gap-3 rounded-xl border border-line
              bg-white px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{student.name}</p>
              <p className="num truncate text-sm text-ink-faint">
                {student.guardianPhone
                  ? formatBdMobile(student.guardianPhone)
                  : 'নম্বর নেই'}
              </p>
            </div>

            <form action={formAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input
                type="hidden"
                name="optOut"
                value={student.optOut ? 'false' : 'true'}
              />
              {/* aria-pressed rather than a checkbox, because the switch is the
                  submit — there is no separate save step to forget. */}
              <button
                type="submit"
                disabled={pending}
                aria-pressed={!student.optOut}
                aria-label={`${student.name} — SMS ${student.optOut ? 'চালু' : 'বন্ধ'} করুন`}
                className={`min-h-tap rounded-lg border-2 px-4 text-sm font-semibold
                  disabled:opacity-50 ${
                    student.optOut
                      ? 'border-line bg-surface-alt text-ink-soft'
                      : 'border-brand-500 bg-brand-50 text-brand-700'
                  }`}
              >
                {student.optOut ? 'বন্ধ' : 'চালু'}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  )
}
