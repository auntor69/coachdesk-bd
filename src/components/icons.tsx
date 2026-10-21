/**
 * The shapes a list row draws instead of a word, and the first SVG in the product.
 *
 * Drawn inline rather than pulled from an icon package: two shapes are not worth a
 * dependency, and an `<img>` could not take `currentColor` — these sit inside a button
 * whose border and text change on hover, and an icon that stayed one colour while the
 * box around it moved would look broken.
 *
 * `aria-hidden` on both, always, and never a `<title>` inside the svg. An icon-only
 * control gets its name from its own `aria-label`; a second name in here would leave a
 * screen reader picking between two, and which one it picks differs by engine.
 * `focusable="false"` keeps a decorative shape out of the tab order, which some engines
 * still put it in.
 *
 * Server components. There is nothing here to make interactive.
 */

type IconProps = {
  /**
   * A size, and nothing else — the colour comes from the button around it.
   *
   * `shrink-0` in the default because the card's button is a flex row holding an icon
   * and a word, and a Bangla label long enough to fill it would otherwise squeeze the
   * shape instead of the button growing.
   */
  className?: string
}

/** One stroke weight, one join, one viewBox: everything in this file looks like a pair. */
function Stroked({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Open the record: read it, change nothing. */
export function EyeIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Stroked>
  )
}

/**
 * The way to a piece of paper.
 *
 * The third shape, and the one a button needed rather than a list row: "Print receipt" is
 * a noun with a verb in front of it, and a wallet of controls that all read as words makes
 * the one control that leaves the screen look like the ones that do not. The paper tray is
 * the whole difference from the eye — a rectangle with a slot, and not an outline that
 * would read as a second document icon beside it.
 */
export function PrintIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="M7 9V3.5h10V9" />
      <path d="M7 18.5H5.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H17" />
      <path d="M7 14.5h10v6H7z" />
    </Stroked>
  )
}

/** Change the record. Kept apart from the eye by the nib, not by colour. */
export function PencilIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="M4 20.5 4.8 16 16.2 4.6a2.3 2.3 0 0 1 3.2 3.2L8 19.2l-4 1.3Z" />
      <path d="m15.2 5.6 3.2 3.2" />
    </Stroked>
  )
}

/*
 * THE NAVIGATION SET.
 *
 * The menu used to carry text glyphs (⌂ ✓ ✎ ৳ …) — zero bytes, but in whatever
 * weight the Bangla font gives them, and visibly an approximation next to the
 * rest of the sheet: the fee tab drawn by the font and the print button above
 * shared no stroke weight at all. These redraw the interface's own vocabulary
 * to one rule — 24 viewBox, this file's stroke, colour from the row they sit
 * in. They only ever appear beside their own label, never alone, so no screen
 * reader meets an unlabelled shape (§20.7). One visual grammar for every
 * navigation surface, in both languages, at every width.
 */

/** The screen everything comes back to. A house, roof first. */
export function HomeIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="M3 10.75 12 3.5l9 7.25" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-5.5h5V21" />
    </Stroked>
  )
}

/** A register: the box every mark lands in, and the check that fills it. */
export function RegisterIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8 12.5 2.6 2.6L16 9.5" />
    </Stroked>
  )
}

/** Money in: a note, which is what the fee board is about. */
export function BanknoteIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.75" />
      <path d="M6 12h.1M18 12h.1" />
    </Stroked>
  )
}

/** The roster: more than one person, one behind the other. */
export function StudentsIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3A4.5 4.5 0 0 1 15 18.5V20" />
      <path d="M15.5 4.75a3.5 3.5 0 0 1 0 6.5" />
      <path d="M17.5 14.25A4.5 4.5 0 0 1 21 18.6V20" />
    </Stroked>
  )
}

/** Money out: an arrow leaving by the drawer. */
export function ExpensesIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="M12 3v9.5" />
      <path d="m7.5 8.5 4.5 4 4.5-4" />
      <path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
    </Stroked>
  )
}

/** Salaries: the calendar a wage bill falls due against. */
export function CalendarIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </Stroked>
  )
}

/** Somebody is drifting away: the empty warning triangle, never a person crossed out. */
export function AlertIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="M10.35 4.2 2.9 17.4a2 2 0 0 0 1.75 3h14.7a2 2 0 0 0 1.75-3L13.65 4.2a1.9 1.9 0 0 0-3.3 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 16.9h.1" />
    </Stroked>
  )
}

/** A message to a family: the folded corner is what says so. */
export function EnvelopeIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.8 7.2 8.2 5.6 8.2-5.6" />
    </Stroked>
  )
}

/** The week's report: a star, the shape the screen itself carries. */
export function StarIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="m12 3.5 2.6 5.4 5.9.7-4.35 4.1 1.1 5.85L12 16.7l-5.25 2.85 1.1-5.85-4.35-4.1 5.9-.7Z" />
    </Stroked>
  )
}

/** The head office: one building in front of another. */
export function BuildingsIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <rect x="3" y="9" width="9" height="12" rx="1.5" />
      <rect x="12" y="4" width="9" height="17" rx="1.5" />
      <path d="M6.5 13h2M6.5 16.5h2M15.5 8h2M15.5 11.5h2M15.5 15h2" />
    </Stroked>
  )
}

/** Settings: sliders — the knobs a business adjusts, not a gear nobody ever fixes. */
export function SlidersIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <path d="M4 7.5h10M18 7.5h2" />
      <circle cx="16" cy="7.5" r="2" />
      <path d="M4 16.5h2M10 16.5h10" />
      <circle cx="8" cy="16.5" r="2" />
    </Stroked>
  )
}

/** A reader's own record: a person with the shape of an account around them. */
export function PersonBadgeIcon({ className = 'size-4 shrink-0' }: IconProps) {
  return (
    <Stroked className={className}>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5.5 20.5a6.5 6.5 0 0 1 13 0" />
    </Stroked>
  )
}
