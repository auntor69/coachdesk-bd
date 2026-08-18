import Link from 'next/link'

import type { Dictionary } from '@/lib/i18n'

/**
 * The way into today's reminder worklist — the same door on the fee board and on
 * the owner's dashboard.
 *
 * One component for both, because two doors to one screen have to say the same
 * sentence and carry the same number. The number is what makes the link work at
 * all: an owner who cannot see whether the day's chasing is done will not open a
 * screen to find out, and the point of the worklist is that they never have to
 * wonder. Both screens compute it with countChasesDue, so neither can promise
 * six and deliver four.
 *
 * Shown at zero on purpose. "Nobody needs chasing today" is the answer the owner
 * came for, not an empty state to be hidden.
 *
 * A link rather than the list itself, on both screens. The board is ordered by
 * who owes most for longest and the dashboard by biggest debt; the worklist is
 * ordered by who has not been told yet, which is a different set in a different
 * order. Putting both on one screen would mean the owner deciding which of two
 * overlapping lists to trust.
 *
 * `Dictionary['reminders']` and not `T<'reminders'>`: this is a server component,
 * so it can be handed the group as it is, functions and all. It borrows the
 * worklist's own words rather than owning any — a door and the room behind it
 * disagreeing about what is in there is how an owner stops believing the number.
 */
export function ReminderEntry({
  dueToday,
  t,
}: {
  dueToday: number
  t: Dictionary['reminders']
}) {
  return (
    <Link
      href="/fees/reminders"
      className="flex min-h-tap items-center justify-between gap-3 rounded-xl
        border border-line bg-white px-4 py-3"
    >
      <span>
        <span className="font-medium text-ink">{t.title}</span>
        <span className="block text-sm text-ink-faint">
          {dueToday > 0 ? (
            <>
              {/* Still two nodes rather than one filled sentence: the number is
                  red and bold and the words are not, and a count that reads as
                  ordinary text is one an owner scrolling past does not see. Both
                  languages put it first, so the tail is all the dictionary
                  carries. */}
              <span className="num font-medium text-absent">{dueToday}</span>{' '}
              {t.entryDueSuffix}
            </>
          ) : (
            t.noneTitle
          )}
        </span>
      </span>
      <span className="shrink-0 text-ink-faint">→</span>
    </Link>
  )
}
