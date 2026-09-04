/**
 * The page's furniture: what the screen is called, the way back out, and its one
 * primary action — in a bar that does not scroll away. MASTERPLAN.md §20.1 asks for
 * exactly this, and it was the last thing in §20.8 no screen had.
 *
 * A COMPONENT AND NOT PART OF THE SHELL. The shell's `children` are opaque: it cannot
 * know a screen's title, and threading one up through a context or a per-segment slot
 * buys nothing this does not. It also keeps the title beside each of a screen's own
 * refusal arms — a page with three endings draws three bars, each naming the screen
 * that refused.
 *
 * STICKY FROM `lg` AND NOWHERE BELOW IT. A phone already carries a sticky header and a
 * fixed tab bar, and a third band would leave a 6.5" screen showing about six rows of
 * anything.
 *
 * ONE LINE, AND ITS HEIGHT IS PART OF THE CONTRACT. `lg:min-h-14` is 56px, which is why
 * the crumb sits beside the title rather than above it and the subtitle sits below the
 * bar rather than in it. Every sticky rail in the app starts at `top-16` — this bar and
 * 8px — so a bar that grew a second line would slide over the first line of all of them.
 * tests/page-header.test.ts asserts both halves of that rather than trusting this note.
 *
 * IT MUST BE A DIRECT CHILD OF THE PAGE'S OWN COLUMN. A sticky box only travels inside
 * its containing block, so a bar wrapped in a short `<div>` — or dropped into a grid as
 * a `col-span-12` cell — sticks for the height of that box and then leaves with it. That
 * is why this returns a fragment, and why the grid-rooted screens hoist the bar out of
 * the grid instead of styling the cell they already had.
 *
 * `-mx-8` against the workspace's own `lg:px-8`, so the bar's background reaches the
 * edges of the workspace instead of letting rows scroll up through the 32px gutters
 * either side of it. `print:hidden` because the five sheets in §9.9 carry their own
 * letterhead and a bordered, blurred bar has no business on an A4 receipt.
 */
import Link from 'next/link'
import type { Route } from 'next'
import type { ReactNode } from 'react'

export function PageHeader<RouteType extends string>({
  title,
  back,
  subtitle,
  actions,
  className = '',
}: {
  title: ReactNode
  /**
   * The way out, one level up. `Route` and not `string`, for the reason the nav table
   * gives: a crumb pointing at a route that does not exist fails the build rather than
   * the click.
   *
   * Generic for the same reason `Link` is. Bare `Route` resolves its dynamic-route
   * branch against `string`, which is `never`, so it admits `/exams` and rejects
   * `/exams/${id}` — and half the screens that need a crumb are sub-screens of a
   * dynamic route. Inferring the argument from the href is what lets both through
   * while a path that matches no route at all still fails the build.
   */
  back?: { href: Route<RouteType>; label: string }
  /** Under the bar and in flow, because it is read once and can scroll away. */
  subtitle?: ReactNode
  /**
   * The screen's primary action, and its filters where it has them. Keeps its own size
   * at the far end of the line and drops under the title when the two outgrow it.
   */
  actions?: ReactNode
  /** For a screen that has to place the bar itself — an `order-N`, mostly. */
  className?: string
}) {
  return (
    <>
      <header
        className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2
          lg:sticky lg:top-0 lg:z-10 lg:-mx-8 lg:min-h-14 lg:border-b lg:border-line
          lg:bg-surface-alt/95 lg:px-8 lg:backdrop-blur print:hidden ${className}`}
      >
        {/* The crumb and the title travel together, so a wrapping action drops below
            both rather than between them. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3">
          {back && (
            <Link
              href={back.href}
              className="inline-flex min-h-tap items-center text-sm text-ink-soft
                hover:text-ink lg:min-h-0"
            >
              ← {back.label}
            </Link>
          )}
          <h1 className="min-w-0 truncate text-xl font-bold text-ink lg:text-2xl">
            {title}
          </h1>
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      {/* Pulled back up under the bar. The page column's own gap would otherwise put a
          subtitle 20px below the thing it is a subtitle of; `-mt-3` leaves 4px in a
          `gap-4` column and 8px in a `gap-5` one, so no screen has to tune its root. */}
      {subtitle && (
        <p className="-mt-3 max-w-2xl text-sm text-ink-soft print:hidden">{subtitle}</p>
      )}
    </>
  )
}
