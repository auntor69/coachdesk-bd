/**
 * The shape a streamed card has while its data is still arriving.
 *
 * WHY IT EXISTS AT ALL, given `(app)/loading.tsx` already draws a whole-page skeleton: that
 * one covers the gap between a tap and the *shell*, which is now short. These two cards are
 * the expensive half of the dashboard (audit §4.1) and they arrive after the shell has
 * painted, so without a placeholder the page would reflow under the reader's thumb the
 * moment they land — the one kind of jank a skeleton exists to prevent.
 *
 * DELIBERATELY DUMB: same radius, border and padding as `Card`, three grey bars, and no
 * words. A placeholder that says "loading attendance" is a sentence the reader has to read
 * to learn nothing, and `aria-hidden` keeps it out of a screen reader entirely — the
 * regions below it announce themselves when they arrive. It is also why there is no
 * `role="status"`: a live region firing on every dashboard open is noise, and the app's
 * announcement duties are already handled by the offline banner and the read-only notice.
 *
 * `animate-pulse` is Tailwind's own and respects `prefers-reduced-motion` through the
 * `motion-safe:` variant — the bars simply stay still for a reader who has asked for
 * that, which is the only honest way to draw a shimmer.
 *
 * THE BAR WIDTHS DESCEND because a list of rows does: full, then shorter, then shorter
 * again. Three identical bars read as a loading *box*; a descending set reads as the card
 * it is standing in for, which is the whole point of a placeholder.
 */
const WIDTHS = ['w-full', 'w-11/12', 'w-3/4']

export function LoadingCard({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="h-4 w-1/3 rounded bg-surface-alt motion-safe:animate-pulse" />
      <div className="mt-4 flex flex-col gap-3">
        {WIDTHS.slice(0, rows).map((width) => (
          <div
            key={width}
            className={`h-3 rounded bg-surface-alt motion-safe:animate-pulse ${width}`}
          />
        ))}
      </div>
    </div>
  )
}
