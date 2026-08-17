'use client'

/**
 * The day's chase list, and the tick that says a family has been dealt with.
 *
 * Client-side for one reason: the confirmation. An owner works down this list on
 * a phone, and the difference between a tool and a chore is whether the fourteenth
 * row still remembers that the third one is done. Tapping a chip switches the
 * phone to its messaging app; coming back, the row has to say so.
 *
 * Rows never leave the list when they are dealt with — they dim and grow a tick.
 * A row that vanished under the thumb would take the next row into the space the
 * finger was already moving towards, which on a 375px screen is how the wrong
 * family gets messaged. The list is recomputed on the next visit, where the ticked
 * rows are simply gone.
 */
import { useState } from 'react'

import { formatTaka as taka } from '@/lib/money'
import { toBanglaDigits } from '@/lib/bd/time'
import type { ReminderStage } from '@/lib/fees/reminder-schedule'
import type { FeeReminderChannel } from '@/lib/supabase/types'
import { ChaseChips, CHANNEL_LABEL, type ChaseTarget, type ReminderCenter } from './reminder-chips'

export type ChaseRow = ChaseTarget & {
  studentCode: string | null
  /** "আগস্ট ২০২৬" — which month's fee, rendered on the server. */
  monthLabel: string
  /** How many times this invoice has already come round, 0 for the first. */
  cycle: number
}

export type ChaseGroup = {
  stage: ReminderStage
  label: string
  note: string
  rows: ChaseRow[]
}

export function ReminderList({
  groups,
  center,
}: {
  groups: ChaseGroup[]
  center: ReminderCenter
}) {
  // Which invoices have been chased since this page loaded, and how. Kept here
  // rather than in each row so the counter at the top can be honest about how
  // much of the list is left.
  const [done, setDone] = useState<Record<string, FeeReminderChannel>>({})

  // The list as it was when the screen opened, frozen on purpose — later props
  // are ignored.
  //
  // Logging a reminder is a Server Action, and a Server Action that revalidates
  // any path makes Next re-render the route the owner is standing on. This one
  // revalidates the fee board, which is a different path but the same tree, so
  // fresh props arrive a moment after every tap — and they no longer contain the
  // row that was tapped, because the server now rightly considers that family
  // chased today. Walked in the browser before this line existed: tapping the
  // third of four rows deleted it, and the row below jumped into the space the
  // thumb was already moving towards, which on a 375px screen is how the wrong
  // family gets messaged.
  //
  // Freezing costs nothing. Nothing else can add to today's list while it is
  // open, the ticked rows are gone on the next visit, and the header card above
  // is server-rendered, so it counts down as the work gets done.
  const [shown] = useState(groups)

  const total = shown.reduce((n, g) => n + g.rows.length, 0)
  const left = total - Object.keys(done).length

  return (
    <div className="flex flex-col gap-5">
      {/* Only once something has been sent. Before that it would be a progress
          bar at 0%, which tells the owner nothing they cannot see. */}
      {left !== total && (
        <p role="status" className="font-medium text-brand-700">
          {left === 0 ? (
            'সবাইকে বলা হয়ে গেছে ✓'
          ) : (
            <>
              আরও <span className="num">{left}</span> জন বাকি
            </>
          )}
        </p>
      )}

      {shown.map((group) => (
        <section key={group.stage}>
          <h2 className="font-semibold text-ink">
            {group.label}{' '}
            <span className="num text-ink-faint">{group.rows.length}</span>
          </h2>
          <p className="mt-0.5 text-sm text-ink-faint">{group.note}</p>

          <ul className="mt-2 flex flex-col gap-2">
            {group.rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                center={center}
                sentVia={done[row.id]}
                onSent={(channel) => setDone((d) => ({ ...d, [row.id]: channel }))}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Row({
  row,
  center,
  sentVia,
  onSent,
}: {
  row: ChaseRow
  center: ReminderCenter
  sentVia: FeeReminderChannel | undefined
  onSent: (channel: FeeReminderChannel) => void
}) {
  return (
    <li
      className={`rounded-xl border bg-white px-4 py-3 transition-opacity ${
        sentVia ? 'border-line opacity-60' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {row.name}
            {row.studentCode && (
              <span className="num ml-2 text-sm text-ink-faint">{row.studentCode}</span>
            )}
          </p>
          <p className="text-sm text-ink-faint">
            {row.monthLabel}
            {row.daysLate > 0 && (
              <span className="font-medium text-absent">
                {' · '}
                <span className="num">{toBanglaDigits(row.daysLate)}</span> দিন দেরি
              </span>
            )}
            {/* Only from the second time round. "১ম বার" on a first reminder is
                noise; "৩ বার বলা হয়েছে" on a two-month-old debt is the fact that
                tells an owner to stop texting and pick up the phone. */}
            {row.cycle > 0 && (
              <span>
                {' · '}
                <span className="num">{toBanglaDigits(row.cycle + 1)}</span> বার
              </span>
            )}
          </p>
        </div>

        <span className="num shrink-0 font-semibold text-ink">{taka(row.remaining)}</span>
      </div>

      <div className="mt-3">
        <ChaseChips target={row} center={center} onSent={onSent} />
      </div>

      {sentVia && (
        <p className="mt-2 text-sm font-medium text-present">
          {CHANNEL_LABEL[sentVia]} পাঠানো হয়েছে ✓
        </p>
      )}
    </li>
  )
}
