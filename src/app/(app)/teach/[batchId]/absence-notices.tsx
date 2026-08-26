'use client'

/**
 * The register's other half: which of today's empty seats a parent knows about.
 *
 * A client component for the one reason the fee chase, the weekly note and the
 * marks sheet are — the confirmation. Tapping a chip switches the phone to its
 * messaging app, and coming back, the row has to say so. A teacher works down this
 * list standing up, between two batches, and the difference between a tool and a
 * chore is whether the eleventh row still remembers the second one is done.
 *
 * Every row stays, told or not, which is where this differs from the progress
 * worklist. That list is today's errand and a finished row is simply gone
 * tomorrow; this register happened on one day, and the teacher's question — "who
 * is left" — can only be answered by a list that still shows the ones who are
 * not. Told rows dim and carry a tick, and a row never leaves under a thumb.
 *
 * NO PATTERN, NO COUNT. A row is a name and a date and nothing else: no "third
 * absence this month", no attendance percentage. That number belongs on a screen
 * an owner reads in their own time, not on a chip a teacher taps in ninety
 * seconds, because the message it would tempt somebody to write is the one this
 * feature must never send.
 *
 * Every string on a row arrives already written, in the reader's language, because
 * the counts English inflects on are dictionary functions and a function cannot
 * cross into a client component. See lib/i18n's note on `T`.
 */
import { useState } from 'react'

import type { T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import type { OutreachChannel } from '@/lib/supabase/types'
import { AbsenceChips, type AbsenceTarget } from './absence-chips'

export type AbsenceRowView = AbsenceTarget & {
  studentCode: string | null
  /**
   * 'Told 12 August', when absence_notices already holds a row for this pair —
   * from an earlier visit, or from before the power cut. Null for a family that
   * has never been told about this class.
   */
  told: string | null
}

/**
 * The words this section changes for itself, plus the two groups it hands down.
 *
 * `chase` and `chaseList` are borrowed rather than copied: somebody working down a
 * list of families is told a row is done in the same words whether the errand was
 * a fee, a week, an exam, or an empty seat, and two names for one sentence is how
 * two screens start disagreeing about the tick.
 */
type NoticeWords = {
  t: T<'absenceNotices'>
  list: T<'chaseList'>
  chase: T<'chase'>
  channels: T<'channels'>
}

export function AbsenceNotices({
  sessionId,
  rows,
  notes,
  words,
}: {
  sessionId: string
  rows: AbsenceRowView[]
  /**
   * Who could not be reached and why, as finished sentences written on the server
   * where the plural can branch. Empty when every absent child has a number.
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
      aria-labelledby="absence-notices-heading"
    >
      <h2 id="absence-notices-heading" className="font-bold text-ink">
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
            sessionId={sessionId}
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
  sessionId,
  row,
  words,
  sentVia,
  onSent,
}: {
  sessionId: string
  row: AbsenceRowView
  words: NoticeWords
  sentVia: OutreachChannel | undefined
  onSent: (channel: OutreachChannel) => void
}) {
  const { list, chase, channels } = words

  // Either half dims the row: a tick from this visit and a tick from an hour ago
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
        {/* Kept even after a tap this visit. "Told at four" and "told just now"
            are different facts, and a teacher answering a parent at the gate wants
            the first one. */}
        {row.told && <p className="text-xs text-ink-faint">{row.told}</p>}
      </div>

      <div className="mt-3">
        <AbsenceChips
          sessionId={sessionId}
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
