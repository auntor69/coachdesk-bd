'use client'

/**
 * The marks sheet's other half: who has been told, and who has not.
 *
 * A client component for the one reason the fee chase and the weekly note are —
 * the confirmation. Tapping a chip switches the phone to its messaging app, and
 * coming back, the row has to say so. On a forty-name sheet worked through between
 * classes, the difference between a tool and a chore is whether the thirty-eighth
 * row still remembers the second one is done.
 *
 * Every row stays, told or not, which is where this differs from the progress
 * worklist. That list is today's errand and a finished row is simply gone
 * tomorrow; an exam happened once, and the teacher's question — "who is left" —
 * can only be answered by a list that still shows the ones who are not. Told rows
 * dim and carry a tick, and a row never leaves under a thumb.
 *
 * Every string on a row arrives already written, in the reader's language, because
 * the counts English inflects on are dictionary functions and a function cannot
 * cross into a client component. See lib/i18n's note on `T`.
 */
import { useState } from 'react'

import type { T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import type { OutreachChannel } from '@/lib/supabase/types'
import { ResultChips, type ResultTarget } from './result-chips'

export type ResultRowView = ResultTarget & {
  studentCode: string | null
  /** '45/50' or 'অনুপস্থিত', written by the server so the ratio stays ASCII. */
  fact: string
  /**
   * 'Told 12 August', when result_notices already holds a row for this pair —
   * from an earlier visit, or from before the power cut. Null for a family that
   * has never been told about this exam.
   */
  told: string | null
}

/**
 * The words this section changes for itself, plus the two groups it hands down.
 *
 * `chase` and `chaseList` are borrowed rather than copied: somebody working down a
 * list of families is told a row is done in the same words whether the errand was
 * a fee, a week, or an exam, and two names for one sentence is how two screens
 * start disagreeing about the tick.
 */
type NoticeWords = {
  t: T<'resultNotices'>
  list: T<'chaseList'>
  chase: T<'chase'>
  channels: T<'channels'>
}

export function ResultNotices({
  examId,
  rows,
  notes,
  words,
}: {
  examId: string
  rows: ResultRowView[]
  /**
   * Who could not be reached and why, as finished sentences — the same counts the
   * metered gate lists, written on the server where the plural can branch. Empty
   * when everybody with a mark has a number.
   */
  notes: string[]
  words: NoticeWords
}) {
  const { t, list } = words

  // Which families were told since this page opened, and how. Held here rather
  // than in each row so the counter can be honest about what is left.
  const [done, setDone] = useState<Record<string, OutreachChannel>>({})

  // Frozen on purpose — later props are ignored. Logging a notice revalidates this
  // path, so fresh props arrive a moment after every tap; taking them would
  // re-render the row's `told` line under the thumb that just tapped it.
  const [shown] = useState(rows)

  const left = shown.filter((r) => !r.told && !done[r.studentId]).length
  const anyTold = shown.some((r) => r.told) || Object.keys(done).length > 0

  return (
    <section
      className="rounded-2xl border border-line bg-white p-5"
      aria-labelledby="result-notices-heading"
    >
      <h2 id="result-notices-heading" className="font-bold text-ink">
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">{t.body}</p>

      {/* Only once something has been sent. Before that it is a progress bar at
          0%, which tells the teacher nothing the list does not. */}
      {anyTold && (
        <p role="status" className="num mt-3 font-medium text-brand-700">
          {left === 0 ? list.allDone : fill(list.moreLeft, { n: left })}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {shown.map((row) => (
          <Row
            key={row.studentId}
            examId={examId}
            row={row}
            words={words}
            sentVia={done[row.studentId]}
            onSent={(channel) => setDone((d) => ({ ...d, [row.studentId]: channel }))}
          />
        ))}
      </ul>

      {notes.length > 0 && (
        <ul className="num mt-3 flex flex-col gap-1 text-sm text-ink-faint">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({
  examId,
  row,
  words,
  sentVia,
  onSent,
}: {
  examId: string
  row: ResultRowView
  words: NoticeWords
  sentVia: OutreachChannel | undefined
  onSent: (channel: OutreachChannel) => void
}) {
  const { list, chase, channels } = words

  // Either half dims the row: a tick from this visit and a tick from last week
  // mean the same thing to somebody looking for who is left.
  const settled = Boolean(sentVia) || Boolean(row.told)

  return (
    <li
      className={`rounded-xl border border-line px-4 py-3 transition-opacity ${
        settled ? 'bg-surface-alt opacity-60' : 'bg-white'
      }`}
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">
          {row.name}
          {row.studentCode && (
            <span className="num ml-2 text-sm text-ink-faint">{row.studentCode}</span>
          )}
        </p>
        {/* `.num` on the paragraph rather than around the ratio: the class is only
            tabular figures, so it costs nothing on the Bangla words and keeps
            '45/50' aligned down the list. */}
        <p className="num text-sm text-ink-faint">{row.fact}</p>
        {/* Kept even after a tap this visit. "Told on the 12th" and "told just
            now" are different facts, and a teacher chasing a complaint wants the
            first one. */}
        {row.told && <p className="text-xs text-ink-faint">{row.told}</p>}
      </div>

      <div className="mt-3">
        <ResultChips
          examId={examId}
          target={row}
          onSent={onSent}
          t={chase}
          channels={channels}
        />
      </div>

      {sentVia && (
        <p className="mt-2 text-sm font-medium text-present">
          {fill(list.sent, { channel: channels[sentVia] })}
        </p>
      )}
    </li>
  )
}
