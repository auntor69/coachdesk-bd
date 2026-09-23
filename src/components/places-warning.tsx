import Link from 'next/link'

import type { Dictionary } from '@/lib/i18n'
import type { CapacityPressure } from '@/lib/plans'

/**
 * §3.7's capacity warning, written once for the three screens that owe it.
 *
 * The dashboard, the HQ table and the roster all have to say the same thing about the
 * same ceiling. Written three times they would eventually disagree about which figure
 * is loud, and the way that shows up is an owner reading "comfortable" on one screen and
 * "nearly full" on the next and believing neither.
 *
 * THE WORDS ESCALATE, not just the colour. A notice is the fact the dashboard already
 * prints, moved out of a footnote — same sentence, no longer faint. Urgent is a different
 * sentence in a tinted box with a second line telling the owner what the cost of ignoring
 * it is, because a red line reading exactly like the black one it replaced is a change
 * only the person who wrote it can see. Full is a third sentence again: the form is
 * refusing now, and that is not "before your next admission".
 *
 * Returns null while there is room, so a screen can render it unconditionally. In a
 * `flex … gap` column a null child costs no gap, which is why the roster needs no
 * wrapper round it.
 *
 * The thresholds are in lib/plans.ts and nothing here knows what a twentieth is.
 */
export function PlacesWarning({
  pressure,
  t,
  note,
  className,
}: {
  pressure: CapacityPressure
  /** `Dictionary['dashboard']`, not `T<'dashboard'>`: a server component, so the
      count-dependent leaves are callable. Same rule as risk-list.tsx. */
  t: Dictionary['dashboard']
  /** One extra sentence for a screen with something of its own to say — HQ's pool note. */
  note?: string
  /**
   * Classes for the root, for the one caller whose layout needs the block placed.
   *
   * The add-student screen orders its blocks with `order-N` and this one has to draw
   * above the form on a phone. A wrapper div there would be a flex child of its own and
   * so would cost a gap on every screen where there is nothing to warn about — which is
   * most of them, because the component returns null while there is room.
   */
  className?: string
}) {
  if (pressure.level === 'fine') return null

  const boxed = pressure.level !== 'notice'

  const headline =
    pressure.level === 'notice'
      ? t.placesLeft(pressure.remaining, pressure.ceiling)
      : pressure.level === 'urgent'
        ? t.placesTight(pressure.remaining, pressure.ceiling)
        : t.placesFull

  return (
    <div
      className={
        [boxed && 'rounded-xl border border-late/40 bg-late/5 p-3', className]
          .filter(Boolean)
          .join(' ') || undefined
      }
    >
      <p className="num font-medium text-ink">{headline}</p>

      {boxed && (
        <p className="mt-1 text-sm text-ink-soft">
          {pressure.level === 'full' ? t.placesFullBody : t.placesTightBody}
        </p>
      )}

      {note && <p className="mt-1 text-sm text-ink-soft">{note}</p>}

      {/* The door, on every level. The warning an owner cannot act on from where they
          are standing is the one they scroll past. */}
      <Link
        href="/settings/billing"
        className="mt-2 inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        {t.placesLink} →
      </Link>
    </div>
  )
}
