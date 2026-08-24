'use client'

/**
 * The week's roster, and the tick that says a family has been told.
 *
 * Client-side for one reason, the same one the fee chase list gives: the
 * confirmation. An owner works down a hundred and fifty names on a phone between
 * classes, and the difference between a tool and a chore is whether the fortieth row
 * still remembers that the third one is done. Tapping a chip switches the phone to
 * its messaging app; coming back, the row has to say so.
 *
 * Rows never leave the list when they are dealt with — they dim and grow a tick. A
 * row that vanished under the thumb would take the next row into the space the
 * finger was already moving towards, which on a 375px screen is how the wrong
 * family gets messaged. The list is recomputed on the next visit, where the ticked
 * rows are simply gone.
 *
 * Every string on a row arrives already written, in the reader's language, because
 * the counts English inflects on are functions and a function cannot cross into a
 * client component. See lib/i18n's note on `T`.
 */
import { useState } from 'react'

import type { T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import type { OutreachChannel } from '@/lib/supabase/types'
import { ProgressChips, type ProgressTarget } from './progress-chips'

export type ProgressRowView = ProgressTarget & {
  studentCode: string | null
  /**
   * The week in one line — 'হাজিরা 5/6 · ১ দিন দেরি · পদার্থবিজ্ঞান 45/50' — as
   * separate facts so the row can join them with its own separator and drop any
   * that do not apply. Written by the server; ratios stay ASCII in both languages
   * because the parent reads them back down the phone.
   */
  facts: string[]
  /** 'Told 12 August', for a family last heard from before the window reopened. */
  told: string | null
}

/**
 * The words this list changes for itself, plus the two groups it hands to the chips.
 *
 * `chaseList` rather than a second copy of the same four strings: an owner working
 * down a worklist is told a row is done and how much is left in exactly the same
 * words whether the errand was a fee or a child's week, and two names for one
 * sentence is how the two screens start disagreeing about the tick.
 */
type ListWords = {
  t: T<'chaseList'>
  chase: T<'chase'>
  channels: T<'channels'>
}

export function ProgressList({
  rows,
  centerName,
  words,
}: {
  rows: ProgressRowView[]
  centerName: string
  words: ListWords
}) {
  const { t } = words

  // Which families have been told since this page loaded, and how. Kept here rather
  // than in each row so the counter at the top can be honest about what is left.
  const [done, setDone] = useState<Record<string, OutreachChannel>>({})

  // The list as it was when the screen opened, frozen on purpose — later props are
  // ignored. Logging a note is a Server Action that revalidates this path, so fresh
  // props arrive a moment after every tap and no longer contain the row that was
  // tapped. See the longer note on reminder-list.tsx, where this was walked in a
  // browser: the row below jumps into the space the thumb is already moving towards.
  const [shown] = useState(rows)

  const left = shown.length - Object.keys(done).length

  return (
    <div className="flex flex-col gap-3">
      {/* Only once something has been sent. Before that it would be a progress bar
          at 0%, which tells the owner nothing they cannot see. */}
      {left !== shown.length && (
        <p role="status" className="num font-medium text-brand-700">
          {left === 0 ? t.allDone : fill(t.moreLeft, { n: left })}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {shown.map((row) => (
          <Row
            key={row.studentId}
            row={row}
            centerName={centerName}
            words={words}
            sentVia={done[row.studentId]}
            onSent={(channel) =>
              setDone((d) => ({ ...d, [row.studentId]: channel }))
            }
          />
        ))}
      </ul>
    </div>
  )
}

function Row({
  row,
  centerName,
  words,
  sentVia,
  onSent,
}: {
  row: ProgressRowView
  centerName: string
  words: ListWords
  sentVia: OutreachChannel | undefined
  onSent: (channel: OutreachChannel) => void
}) {
  const { t, chase, channels } = words

  return (
    <li
      className={`rounded-xl border border-line bg-white px-4 py-3 transition-opacity ${
        sentVia ? 'opacity-60' : ''
      }`}
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">
          {row.name}
          {row.studentCode && (
            <span className="num ml-2 text-sm text-ink-faint">{row.studentCode}</span>
          )}
        </p>
        {/* `.num` on the paragraph rather than around each ratio: the class is only
            tabular figures, so it costs nothing on the Bangla words and keeps
            '5/6' and '45/50' aligned down the list. */}
        <p className="num text-sm text-ink-faint">{row.facts.join(' · ')}</p>
        {/* Only for a family last told before the window reopened. It is the answer
            to "have I ever messaged these people", which an owner asks about the
            quiet families and nobody else. */}
        {row.told && <p className="text-xs text-ink-faint">{row.told}</p>}
      </div>

      <div className="mt-3">
        <ProgressChips
          target={row}
          centerName={centerName}
          onSent={onSent}
          t={chase}
          channels={channels}
        />
      </div>

      {sentVia && (
        <p className="mt-2 text-sm font-medium text-present">
          {fill(t.sent, { channel: channels[sentVia] })}
        </p>
      )}
    </li>
  )
}
