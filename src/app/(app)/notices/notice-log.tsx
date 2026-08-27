'use client'

/**
 * What the centre has told its families, and the two chips that do the telling.
 *
 * A record and a worklist at once, which is unusual here and is the honest shape of a
 * product that cannot send. The row is written when the notice is composed; the chips
 * beside it are how it actually leaves the building. So the newest row is both "this is
 * what we said on Thursday" and "here is Thursday's message, ready to paste".
 *
 * WHY THE NUMBERS COME IN GROUPS. The recipient box on a real handset stops accepting
 * names at around twenty — silently — so one chip holding a hundred and fifty numbers
 * is a chip that half works and says nothing about it. `chunkPhones` splits them and
 * each group is its own chip, labelled with the range it covers, so an owner pasting
 * eight times knows which eight they are and which one they were on when the class
 * bell went. See ../../../lib/notices/audience.ts.
 *
 * Nothing is logged when a chip is tapped, unlike every other copy chip in this app.
 * The record already exists — it was written before the clipboard was ever touched —
 * so there is no second row to write and no cooldown to start.
 */
import type { ReactNode } from 'react'

import { CopyChip } from '@/components/chase-chip'
import type { T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'

export type NoticeRowView = {
  id: string
  title: string
  /** The owner's own words, shown so they can check what they said. */
  body: string
  when: string
  /** A batch name and its subject, or the word for the whole centre. */
  audience: string
  /** The words plus the centre's name, built by `buildNoticeSms` on the server. */
  sms: string
  /** How many SMS the message above costs to send once. */
  segments: number
  /** The numbers in pasteable groups. Always at least one, possibly empty. */
  groups: string[][]
}

export function NoticeLog({
  rows,
  t,
  chase,
}: {
  rows: NoticeRowView[]
  t: T<'notices'>
  /** Borrowed whole, as all four chase screens borrow it: copying is copying. */
  chase: T<'chase'>
}) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 font-semibold text-ink">{row.title}</p>
            <p className="num shrink-0 text-sm text-ink-faint">{row.when}</p>
          </div>
          <p className="mt-0.5 text-sm text-ink-soft">{row.audience}</p>

          {/* `whitespace-pre-wrap`, because an owner who laid a notice out over three
              lines meant the three lines, and this is where they check that. */}
          <p className="mt-2 whitespace-pre-wrap text-ink">{row.body}</p>

          {row.segments > 1 && (
            <p className="num mt-2 text-sm text-ink-faint">
              {fill(t.segments, { n: String(row.segments) })}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <CopyChip
              text={row.sms}
              label={chase.copySms}
              hint={t.copyMessageHint}
              copied={chase.copied}
              failed={chase.copyFailed}
            />
            {numberChips(row.groups, t, chase)}
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * One chip per pasteable group of numbers, or a sentence when there are none.
 *
 * The single-group case gets a plain label and no range, because "Copy the numbers
 * 1–14" on a chip that holds all of them is arithmetic the owner has to read to
 * discover it means nothing.
 *
 * Comma-separated, and in +8801 form rather than the 01712345678 a Bangladeshi reads
 * their own number in. This string is not for reading: it goes into a recipient box,
 * where the international form is the one every app parses the same way.
 */
function numberChips(
  groups: string[][],
  t: T<'notices'>,
  chase: T<'chase'>,
): ReactNode {
  const total = groups.reduce((n, g) => n + g.length, 0)
  if (total === 0) {
    return <span className="text-sm text-ink-faint">{t.noNumbers}</span>
  }

  let from = 1
  return groups.map((group, i) => {
    const to = from + group.length - 1
    const label =
      groups.length === 1
        ? t.copyNumbers
        : fill(t.copyNumbersRange, { from: String(from), to: String(to) })
    from = to + 1

    return (
      <CopyChip
        key={i}
        text={group.join(', ')}
        label={label}
        hint={t.copyNumbersHint}
        copied={chase.copied}
        failed={chase.copyFailed}
      />
    )
  })
}
