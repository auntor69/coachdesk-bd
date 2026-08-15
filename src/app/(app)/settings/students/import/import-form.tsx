'use client'

/**
 * Loading a centre's register.
 *
 * The screen is a paste box and a preview, and the preview is the whole point.
 * We are typing somebody else's two hundred students in from a notebook, and the
 * only thing worse than refusing a line is accepting it wrongly — a name filed
 * under the wrong number is a parent who hears nothing for a month and then
 * leaves. So every line is read back before anything is written: what it parsed
 * to, what it could not read, and who is already on the roster.
 *
 * The parser is the same module the Server Action re-runs, so the count on the
 * button is the count the database will report.
 */
import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'

import { Alert, Button } from '@/components/ui'
import { formatBdMobile } from '@/lib/bd/phone'
import {
  MAX_IMPORT_ROWS,
  parseRoster,
  rosterKey,
  type RosterProblem,
} from '@/lib/bd/roster'
import { importStudents, type ActionState } from '../../actions'

type BatchOption = { id: string; label: string }

const PROBLEM_LABEL: Record<RosterProblem, string> = {
  'no-phone': 'নম্বর নেই',
  'bad-phone': 'নম্বরটি ঠিক নেই',
  'no-name': 'নাম নেই',
  'name-too-long': 'নামটি অনেক বড় — এটা কি নাম?',
  duplicate: 'এই তালিকায় দুইবার',
}

/** A parse failure needs a human; a duplicate has already been dealt with. */
const NEEDS_FIXING = new Set<RosterProblem>([
  'no-phone',
  'bad-phone',
  'no-name',
  'name-too-long',
])

const PLACEHOLDER = [
  'রাফিদ হাসান 01712345678',
  'সাদিয়া আক্তার, করিম মিয়া, 01812345678',
  '৩। তানভীর ইসলাম ০১৯১২৩৪৫৬৭৮',
].join('\n')

/** How many parsed names are listed at once. A phone renders 500 rows slowly. */
const PREVIEW_LIMIT = 100

export function ImportForm({
  batches,
  existingKeys,
  room,
}: {
  batches: BatchOption[]
  /** null when the roster is too big to hint with. The import still checks. */
  existingKeys: string[] | null
  /** Plan headroom left; null when unlimited. */
  room: number | null
}) {
  const [text, setText] = useState('')

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await importStudents(prev, formData)
      // On success the box keeps exactly the lines that still need a human, so
      // it becomes the to-do list. Clearing it would throw away the twelve lines
      // that failed along with the hundred that worked, and the owner would have
      // to find them again in the notebook.
      if (result?.ok) {
        setText(
          parseRoster(String(formData.get('roster') ?? ''))
            .filter((row) => row.problem !== null && NEEDS_FIXING.has(row.problem))
            .map((row) => row.raw)
            .join('\n'),
        )
      }
      return result
    },
    null,
  )

  const rows = useMemo(() => parseRoster(text), [text])
  const known = useMemo(() => new Set(existingKeys ?? []), [existingKeys])
  const preview = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        alreadyThere:
          row.problem === null && row.name !== null && row.phone !== null
            ? known.has(rosterKey(row.name, row.phone))
            : false,
      })),
    [rows, known],
  )

  const problems = preview.filter((row) => row.problem !== null)
  const ready = preview.filter((row) => row.problem === null)
  const alreadyThere = ready.filter((row) => row.alreadyThere).length
  const hinting = existingKeys !== null
  const newCount = hinting ? ready.length - alreadyThere : ready.length
  const tooMany = rows.length > MAX_IMPORT_ROWS
  const overRoom = room !== null && newCount > room

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <Alert tone="ok">
          {state.ok}{' · '}
          <Link href="/settings/students" className="underline">
            তালিকা দেখুন
          </Link>
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="roster" className="font-medium text-ink">
          নামের তালিকা
        </label>
        <span id="roster-hint" className="text-sm text-ink-soft">
          প্রতি লাইনে একজন — নাম আর অভিভাবকের মোবাইল। ক্রমিক নম্বর, কমা বা ড্যাশ
          থাকলে অসুবিধা নেই, আর নাম আগে না নম্বর আগে সেটাও দেখা হয় না।
        </span>
        <textarea
          id="roster"
          name="roster"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          aria-describedby="roster-hint"
          // text-base for the same reason Field uses it: iOS Safari zooms the
          // page when a focused field is under 16px and never zooms back.
          className="rounded-xl border-2 border-line bg-white p-4 text-base
            leading-7 outline-none transition-colors placeholder:text-ink-faint
            focus:border-brand-500"
        />
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold text-ink">
            <span className="num">{newCount}</span> জন নতুন
          </span>
          {hinting && alreadyThere > 0 && (
            <span className="text-ink-soft">
              <span className="num">{alreadyThere}</span> জন আগেই আছে
            </span>
          )}
          {problems.length > 0 && (
            <span className="font-medium text-absent">
              <span className="num">{problems.length}</span> লাইন বাদ পড়বে
            </span>
          )}
        </div>
      )}

      {tooMany && (
        <Alert tone="warn">
          একবারে <span className="num">{MAX_IMPORT_ROWS}</span> লাইনের বেশি নেওয়া
          যায় না। এখানে <span className="num">{rows.length}</span> লাইন আছে — বাকিটা
          পরের বার দিন।
        </Alert>
      )}

      {overRoom && (
        <Alert tone="warn">
          এই প্ল্যানে আর <span className="num">{room}</span> জন যোগ করা যাবে, কিন্তু
          তালিকায় <span className="num">{newCount}</span> জন নতুন।
        </Alert>
      )}

      {problems.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">
            এই লাইনগুলো যোগ হবে না — ঠিক করে আবার দিন
          </p>
          <ul className="flex flex-col gap-1.5">
            {problems.slice(0, PREVIEW_LIMIT).map((row) => (
              <li
                key={row.line}
                className="rounded-xl border border-absent/30 bg-absent/5 px-3 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="num shrink-0 text-xs text-ink-faint">{row.line}</span>
                  <span className="min-w-0 break-words text-sm text-ink">{row.raw}</span>
                </div>
                <span className="mt-0.5 block text-xs font-medium text-absent">
                  {row.problem !== null && PROBLEM_LABEL[row.problem]}
                </span>
              </li>
            ))}
          </ul>
          {problems.length > PREVIEW_LIMIT && (
            <p className="text-xs text-ink-soft">
              আরও <span className="num">{problems.length - PREVIEW_LIMIT}</span> লাইনে
              সমস্যা আছে।
            </p>
          )}
        </div>
      )}

      {ready.length > 0 && (
        <details className="rounded-2xl border border-line bg-white p-4">
          <summary className="min-h-tap cursor-pointer font-medium text-ink-soft">
            যা পড়া গেছে দেখে নিন (<span className="num">{ready.length}</span>)
          </summary>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {ready.slice(0, PREVIEW_LIMIT).map((row) => (
              <li key={row.line} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words font-medium text-ink">
                    {row.name}
                  </span>
                  <span className="num shrink-0 text-sm text-ink-soft">
                    {formatBdMobile(row.phone)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-ink-soft">
                  {row.guardianName && <span>অভিভাবক: {row.guardianName}</span>}
                  {row.alreadyThere && (
                    <span className="font-medium text-late">আগেই আছে</span>
                  )}
                  {row.dropped.length > 0 && (
                    <span className="num">
                      বাদ: {row.dropped.map(formatBdMobile).join(', ')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {ready.length > PREVIEW_LIMIT && (
            <p className="mt-2 text-xs text-ink-soft">
              প্রথম <span className="num">{PREVIEW_LIMIT}</span> জন দেখানো হলো, বাকিরাও
              যোগ হবে।
            </p>
          )}
        </details>
      )}

      {batches.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium text-ink">
            সবাইকে কোন ব্যাচে ভর্তি করব
          </legend>
          <p className="mb-1 text-sm text-ink-soft">
            এই তালিকার সবাই একই ব্যাচে যাবে। আলাদা ব্যাচ হলে ব্যাচ ধরে ধরে তালিকা দিন।
          </p>
          <div className="flex flex-col gap-2">
            {batches.map((batch) => (
              <label
                key={batch.id}
                className="flex min-h-tap cursor-pointer items-center gap-3
                  rounded-xl border-2 border-line bg-white px-4
                  has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input
                  type="checkbox"
                  name="batchIds"
                  value={batch.id}
                  className="h-5 w-5 shrink-0 accent-brand-600"
                />
                <span className="min-w-0 truncate text-ink">{batch.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Button
        type="submit"
        full
        disabled={pending || newCount === 0 || tooMany || overRoom}
      >
        {pending
          ? 'যোগ হচ্ছে…'
          : newCount > 0
            ? `${newCount} জন যোগ করুন`
            : 'যোগ করুন'}
      </Button>
    </form>
  )
}
