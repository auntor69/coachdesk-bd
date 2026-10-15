/**
 * The two shapes a list row draws instead of a word, and the first SVG in the product.
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

/** One stroke weight, one join, one viewBox: two icons that look like a pair. */
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
