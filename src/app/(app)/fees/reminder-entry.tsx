import Link from 'next/link'

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
 */
export function ReminderEntry({ dueToday }: { dueToday: number }) {
  return (
    <Link
      href="/fees/reminders"
      className="flex min-h-tap items-center justify-between gap-3 rounded-xl
        border border-line bg-white px-4 py-3"
    >
      <span>
        <span className="font-medium text-ink">আজকের রিমাইন্ডার</span>
        <span className="block text-sm text-ink-faint">
          {dueToday > 0 ? (
            <>
              <span className="num font-medium text-absent">{dueToday}</span> জনকে আজ
              মনে করিয়ে দেওয়ার কথা
            </>
          ) : (
            'আজ কাউকে মনে করানোর দরকার নেই'
          )}
        </span>
      </span>
      <span className="shrink-0 text-ink-faint">→</span>
    </Link>
  )
}
