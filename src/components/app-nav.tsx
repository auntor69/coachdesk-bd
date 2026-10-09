'use client'

/**
 * The two shapes the same navigation takes, and the only thing in the shell that
 * needs to know which screen the reader is on.
 *
 * WHY A CLIENT COMPONENT AT ALL, in a file whose neighbours go to some length to
 * avoid being one: `usePathname` is the only way to read the current route, and
 * Next's own note on the hook is explicit that reading it from a Server Component
 * is unsupported by design. Nothing here depends on the bundle having arrived,
 * though — the links are plain anchors and the active one is already marked in the
 * first HTML, because a client component still renders on the server. On a 3G
 * connection in Mymensingh the menu works, and highlights, before any JavaScript
 * lands.
 *
 * NO `Suspense` AROUND IT, and this is worth writing down because the hook's docs
 * say a sidebar in a layout must have one: that applies with `cacheComponents`
 * enabled, where a route with an unknown dynamic param cannot resolve its pathname
 * while prerendering and the build fails. next.config.ts does not enable it, and
 * every screen behind this shell reads a session and so is dynamic regardless. If
 * that flag is ever turned on, this is the component to wrap.
 *
 * WHY THE ACTIVE STATE IS NEW. Neither bar had one before, on any screen — five
 * identical grey tabs, and the only way to know where you were was to read the
 * heading. That is survivable on a phone with four tabs and unusable on a desktop
 * sidebar with nine rows.
 */
import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'

/**
 * A destination, with its label already resolved.
 *
 * The label is a string and not a dictionary key, unlike the table in app-shell.tsx:
 * the shell holds the key so a missing one fails the build, and hands over the
 * sentence so this file needs no dictionary and no locale.
 */
export type NavEntry = {
  href: Route
  label: string
  icon: string
  /**
   * True when the reader's plan does not include this screen.
   *
   * The row is still drawn, and still a link, because the screen behind it already
   * refuses nobody — it draws the card naming the plan that has it. MASTERPLAN.md §20.3:
   * "the one place a locked door beats a hidden one, because that door is also the
   * upgrade path". A capability a reader lacks is different and never reaches here; the
   * shell drops those rows.
   */
  locked?: boolean
}

/**
 * A run of destinations under one heading, or under none.
 *
 * Grouped because the sidebar now carries ten rows where the phone bar carried five,
 * and ten flat rows is a list somebody reads top to bottom every time instead of
 * jumping to the third of the four places they ever go. `label` is null for the first
 * group: a heading over Home is a heading over the whole app.
 */
export type NavSection = { label: string | null; items: NavEntry[] }

/**
 * Whether a link is the screen the reader is on.
 *
 * Prefix matching, not equality, because half these destinations have children a
 * reader spends most of their time in: `/teach/[batchId]` is where a register
 * actually gets marked, and `/settings/students/[studentId]` is three levels down.
 * Equality would light the tab up for a second and then drop it the moment somebody
 * opened a batch.
 *
 * The trailing slash matters. Without it `/fees` would claim `/fees-something`, and
 * more to the point `/me` would claim nothing while `/settings` would claim a future
 * `/settings-export`.
 */
function isHere(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * One sidebar row, shared by both groups so an active row cannot look different in one.
 *
 * A locked row is greyed and carries a word. Not a padlock glyph on its own: a padlock
 * reads as "broken" or "forbidden" to plenty of people and as "there is a better plan"
 * to almost none, and it is the same 10px smudge in both languages. The word is
 * "Upgrade", which is what the row actually does — the screen behind it names the tier —
 * and it is read out as itself by a screen reader, which a colour is not.
 */
function SideRow({
  item,
  here,
  lockedLabel,
}: {
  item: NavEntry
  here: boolean
  lockedLabel: string
}) {
  return (
    <li>
      <Link
        href={item.href}
        // `aria-current`, not just a colour. The whole point of the state is
        // "you are here", and a screen reader has no access to a background.
        aria-current={here ? 'page' : undefined}
        className={`flex min-h-tap items-center gap-3 rounded-xl px-3
          text-sm ${
            here
              ? 'bg-brand-50 font-semibold text-brand-800'
              : item.locked
                ? 'font-medium text-ink-faint hover:bg-surface-alt'
                : 'font-medium text-ink-soft hover:bg-surface-alt hover:text-ink'
          }`}
      >
        {/* Fixed width so ten labels start on the same pixel — a ৳ and a ⌂
            are nothing like the same width in any font we ship. */}
        <span aria-hidden className="w-5 shrink-0 text-center text-lg leading-none">
          {item.icon}
        </span>
        <span className="truncate">{item.label}</span>
        {item.locked && (
          <span
            className="ml-auto shrink-0 rounded-full bg-surface-alt px-1.5
              text-[0.625rem] font-semibold uppercase tracking-wide text-ink-faint"
          >
            {lockedLabel}
          </span>
        )}
      </Link>
    </li>
  )
}

/**
 * The desktop sidebar: a labelled row per destination, grouped, with the current one
 * filled in.
 *
 * Fill and not a left border, because the sidebar is already a column of text and a
 * 3px rule on one row of it is the kind of signal that reads as an accident. The
 * label goes semibold as well, so the state survives being photographed in a bright
 * room and read by somebody who cannot tell brand-50 from white.
 *
 * One `<nav>` and one `<ul>` per group rather than one list of everything: a screen
 * reader announcing "Money, list of 3" is the whole point of the headings, and a
 * `<ul>` interrupted by an `<h3>` is not a list any more.
 */
export function SideNav({
  sections,
  label,
  lockedLabel,
}: {
  sections: NavSection[]
  label: string
  lockedLabel: string
}) {
  const pathname = usePathname()

  return (
    <nav aria-label={label} className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.label ?? '·'}>
          {section.label && (
            <h3
              className="px-3 pb-1 text-[0.6875rem] font-semibold uppercase
                tracking-wide text-ink-faint"
            >
              {section.label}
            </h3>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <SideRow
                key={item.href}
                item={item}
                here={isHere(pathname, item.href)}
                lockedLabel={lockedLabel}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/**
 * The phone's bottom bar: four destinations, and a sheet for everything else.
 *
 * The accent is a bar along the top edge of the tab rather than a fill: a filled tab
 * in a 56px-tall bar is a large block of colour at the bottom of every screen, and
 * the icon and label carry the change well enough on their own.
 *
 * WHY A SHEET AND NOT MORE TABS. Six screens — spending, salaries, notices, the week,
 * drifting away, the head office — had no navigation entry anywhere and were reachable
 * only from a card on the dashboard, which is how the dashboard turned into a menu.
 * The sidebar has room for all ten. A 375px phone does not: ten tabs is 37px each, and
 * even six is a row of truncated first syllables. So the bar keeps the four a centre
 * touches daily and the rest live one tap deeper.
 *
 * A `<details>` and not a client-side sheet, for the reason CenterName is one: this
 * works before the bundle arrives, which on a 3G connection is most of the first ten
 * seconds. Navigating away closes it, because the next page renders it closed.
 */
export function TabBar({
  items,
  more,
  label,
  moreLabel,
  lockedLabel,
}: {
  /** Never a locked row — the shell keeps those out of the bar. See `splitForPhone`. */
  items: NavEntry[]
  /** Empty for every role that fits in the bar — a teacher, a student, a guardian. */
  more: NavEntry[]
  label: string
  moreLabel: string
  lockedLabel: string
}) {
  const pathname = usePathname()
  const moreHere = more.some((item) => isHere(pathname, item.href))

  /*
   * The pad under the tabs, and the reason there is anything to pad: layout.tsx
   * sets `viewportFit: 'cover'`, so on a notched iPhone the home indicator is
   * drawn *over* the bottom of the viewport — which is exactly where this bar is
   * fixed. Without it the lower third of every tab sits under the indicator: the
   * tap lands in the system gesture area instead of on the link, and the More
   * sheet's last row cannot be reached at all. `env()` is 0 on a screen with no
   * indicator, so a laptop, an Android and print all keep the bar they had.
   */
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white
        pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    >
      <ul className="relative mx-auto flex w-full max-w-3xl">
        {items.map((item) => {
          const here = isHere(pathname, item.href)
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={here ? 'page' : undefined}
                className={`relative flex min-h-tap flex-col items-center
                  justify-center gap-0.5 py-2 ${
                    here ? 'text-brand-700' : 'text-ink-soft hover:text-brand-700'
                  }`}
              >
                {here && <TabAccent />}
                <span aria-hidden className="text-xl leading-none">
                  {item.icon}
                </span>
                <TabLabel label={item.label} here={here} />
              </Link>
            </li>
          )
        })}

        {more.length > 0 && (
          <li className="flex-1">
            <details className="group">
              <summary
                // `true` rather than `page`: this is the current item in the bar, but it
                // is not a link to the page — the row inside the sheet is.
                aria-current={moreHere ? 'true' : undefined}
                className={`relative flex min-h-tap cursor-pointer list-none flex-col
                  items-center justify-center gap-0.5 py-2 marker:hidden
                  [&::-webkit-details-marker]:hidden ${
                    moreHere ? 'text-brand-700' : 'text-ink-soft'
                  }`}
              >
                {moreHere && <TabAccent />}
                {/* Rotates when open, so the control says which way it goes. */}
                <span
                  aria-hidden
                  className="text-xl leading-none transition-transform
                    group-open:-rotate-180"
                >
                  ⌃
                </span>
                <TabLabel label={moreLabel} here={moreHere} />
              </summary>

              {/*
                Positioned against the `<ul>`, not the tab: a panel one-fifth of the
                screen wide would put every label on two lines. max-h so a ten-row
                sheet on a 568px iPhone SE scrolls instead of running off the top.
              */}
              <ul
                className="absolute inset-x-0 bottom-full mb-px max-h-[60vh]
                  overflow-y-auto border-t border-line bg-white p-2 shadow-lg"
              >
                {more.map((item) => {
                  const here = isHere(pathname, item.href)
                  return (
                    <SideRow
                      key={item.href}
                      item={item}
                      here={here}
                      lockedLabel={lockedLabel}
                    />
                  )
                })}
              </ul>
            </details>
          </li>
        )}
      </ul>
    </nav>
  )
}

/** The 2px rule along the top edge of the tab a reader is on. */
function TabAccent() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-brand-600"
    />
  )
}

/**
 * truncate, not wrap: "Attendance" is ten characters where হাজিরা is six, and a
 * wrapped label makes one tab taller than the other four.
 */
function TabLabel({ label, here }: { label: string; here: boolean }) {
  return (
    <span
      className={`w-full truncate px-1 text-center text-xs ${
        here ? 'font-semibold' : 'font-medium'
      }`}
    >
      {label}
    </span>
  )
}
