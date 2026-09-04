/**
 * The page bar (§20.1), and the two contracts every screen that adopts it depends on.
 *
 * WHAT THIS FILE IS GUARDING. The bar is 56px tall at `lg` and sticks to the top of the
 * workspace. Both numbers are load-bearing outside this component:
 *
 *   - Every sticky rail in the app starts at `top-16` — this bar's 56px plus 8px of air.
 *     A bar that grew a second line would slide over the first line of all of them, and
 *     a rail left at `top-8` would have its own first line painted over instead. The
 *     repo-wide half of that is at the bottom of this file: no rail anywhere may use
 *     `top-8`, and the bar may not be given a second line's worth of layout.
 *
 *   - A sticky box only travels inside its containing block. So the bar returns a
 *     FRAGMENT: wrapped in a `flex flex-col` div with its subtitle it would have a
 *     containing block about 90px tall and stick for 34px before leaving with it. It is
 *     also why no screen may hand it to a grid as a `col-span-12` cell — a cell's block
 *     is one grid row — and why the grid-rooted screens nest their grid under it.
 *
 * The subtitle is the other half of the fragment, and it is deliberately OUTSIDE the
 * `</header>`: in the bar it would be the second line that breaks both contracts above.
 * `-mt-3` pulls it back under the bar so no screen has to tune its own root gap.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const SRC = read('src', 'components', 'page-header.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** The `<header>` alone, so a match cannot be satisfied by the subtitle below it. */
const BAR = SRC.slice(SRC.indexOf('<header'), SRC.indexOf('</header>'))
/** And everything after it, which is where the subtitle has to be. */
const AFTER = SRC.slice(SRC.indexOf('</header>'))

/* -------------------------------------------------------------------------- */
/* The height, which is every rail's `top`                                    */
/* -------------------------------------------------------------------------- */

test('the bar is one line of 56px from lg and nothing above a phone', () => {
  assert.match(BAR, /lg:min-h-14/, '56px, the number every rail is offset by')

  // One line means wrapping is the escape hatch and not the layout: `flex-wrap` with
  // `items-center` puts a long title and its action on one line until they cannot fit,
  // and drops the action below rather than growing a permanent second row.
  assert.match(BAR, /flex flex-wrap items-center justify-between gap-x-4 gap-y-2/)

  // No `flex-col` at any width, which is the shape that would make it two lines for
  // every screen at once.
  assert.doesNotMatch(BAR, /flex-col/)
  // And no vertical padding on top of the min-height, which would do the same thing
  // more quietly.
  assert.doesNotMatch(BAR, /(?<=["\s])(?:lg:|xl:|2xl:)?py-\d/)
})

test('the bar sticks from lg, over everything, and never on a phone', () => {
  assert.match(BAR, /lg:sticky lg:top-0 lg:z-10/)

  // A phone already carries the shell's own sticky header and a fixed tab bar. A third
  // band would leave a 6.5" screen showing about six rows of anything.
  assert.doesNotMatch(BAR, /(?<![:\w-])sticky/, 'the bar sticks on a phone')
  assert.doesNotMatch(BAR, /(?<![:\w-])top-\d/, 'the bar is pinned on a phone')
})

test('the background reaches the workspace edges and is not transparent', () => {
  // `-mx-8` against the workspace's own `lg:px-8`, then `lg:px-8` back on the bar: the
  // background spans the full width so rows do not scroll up through the 32px gutters
  // either side of it, while the text stays on the page's own left edge.
  assert.match(BAR, /lg:-mx-8/)
  assert.match(BAR, /lg:px-8/)

  // `surface-alt` and not white, because that is the body's background — a white bar
  // would read as a card floating over the page. `/95` plus `backdrop-blur` so a row
  // passing under it is dimmed rather than showing through sharply.
  assert.match(BAR, /lg:bg-surface-alt\/95/)
  assert.match(BAR, /lg:backdrop-blur/)
  assert.match(BAR, /lg:border-b lg:border-line/)
})

test('the bar is not printed', () => {
  // §9.9's five sheets carry their own letterhead, and a bordered, blurred, sticky band
  // has no business on an A4 receipt. Both halves of the fragment, because the subtitle
  // would otherwise print as a caption under a heading that is not there.
  assert.match(BAR, /print:hidden/)
  assert.match(AFTER, /print:hidden/)
})

/* -------------------------------------------------------------------------- */
/* The fragment, which is what lets it stick at all                           */
/* -------------------------------------------------------------------------- */

test('it returns a fragment, and the subtitle is outside the bar', () => {
  assert.match(SRC, /return \(\n {4}<>\n/, 'a wrapper of its own would kill the stickiness')
  assert.equal(count(SRC, '<header'), 1)

  // Outside `</header>`, in flow, and pulled back up under it. Inside the bar it would be
  // the second line that breaks every rail's `top-16`.
  assert.ok(AFTER.includes('{subtitle && ('))
  assert.ok(!BAR.includes('subtitle'), 'the subtitle is in the bar')
  assert.match(AFTER, /className="-mt-3 max-w-2xl text-sm text-ink-soft print:hidden"/)
})

test('the title is one truncating line and the action keeps its own size', () => {
  // `min-w-0` on both the group and the `<h1>`: without it a long centre name refuses to
  // shrink below its content and pushes the action off the line instead of truncating.
  assert.ok(BAR.includes('<div className="flex min-w-0 flex-wrap items-center gap-x-3">'))
  assert.ok(BAR.includes('<h1 className="min-w-0 truncate text-xl font-bold text-ink lg:text-2xl">'))
  assert.equal(count(BAR, '<h1'), 1, 'one bar, one heading')

  // The crumb and the title travel together, so a wrapping action drops below both
  // rather than landing between them.
  assert.ok(BAR.indexOf('{back && (') < BAR.indexOf('<h1'))
  assert.ok(BAR.includes('{actions && <div className="flex shrink-0 items-center gap-2">'))
})

test('the crumb is a typed route and a tap target on a phone', () => {
  // `Route` and not `string`, for the reason the nav table gives: a crumb pointing at a
  // route that does not exist fails the build rather than the click.
  assert.match(SRC, /back\?: \{ href: Route; label: string \}/)
  assert.match(SRC, /import type \{ Route \} from 'next'/)

  // 44px on a phone, and released past `lg` where the bar is 56px tall and the crumb is
  // one of two things on the line.
  assert.match(BAR, /min-h-tap items-center text-sm text-ink-soft\n\s+hover:text-ink lg:min-h-0/)
  assert.ok(BAR.includes('← {back.label}'))
})

test('it is a server component and takes nodes, not strings', () => {
  // No 'use client': the bar is furniture. A directive here would pull every screen's
  // title into the client bundle and make `actions` a serialisation problem.
  assert.doesNotMatch(SRC, /use client/)

  // `ReactNode` on all three, because callers pass `{t.title}`, a `<form>` of filters,
  // and a count built from two dictionary calls.
  assert.match(SRC, /title: ReactNode/)
  assert.match(SRC, /subtitle\?: ReactNode/)
  assert.match(SRC, /actions\?: ReactNode/)
})

/* -------------------------------------------------------------------------- */
/* Repo-wide: nothing is tucked under the bar                                 */
/* -------------------------------------------------------------------------- */

/** Every `.tsx` under src/, which is every screen that could hold a rail. */
function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFiles(full))
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const TSX = tsxFiles(path.join(ROOT, 'src')).map((file) => ({
  path: path.relative(ROOT, file).replaceAll('\\', '/'),
  source: readFileSync(file, 'utf8').replaceAll('\r\n', '\n'),
}))

test('no sticky rail in the app is still offset by the old 8px', () => {
  // The retune the bar forced, in one place instead of nine. 32px of `main`'s own
  // `lg:py-8` used to be the whole offset a rail needed; now 56px of bar paints over
  // that space, and a rail left at `top-8` has its first line covered — which on
  // fees/reminders is the count of families to chase and on fees/arrears is the total
  // about to be written.
  //
  // Anchored at a class boundary on both sides, because `top-8` is also two words in a
  // comment: every file that made this change explains it, and half of them name the
  // value they moved away from.
  const offenders = TSX.filter((f) =>
    /(?<=["\s])(?:sm:|md:|lg:|xl:|2xl:)?top-8(?=[\s"])/.test(f.source),
  ).map((f) => f.path)

  assert.deepEqual(offenders, [])
})

test('the bar is never wrapped in a box of its own or handed to a grid', () => {
  // The two shapes that silently un-stick it. A `col-span-N` on the bar means somebody
  // made it a grid cell, whose containing block is one grid row; a `<div>` around it and
  // its subtitle means a containing block 90px tall. Neither fails to compile and
  // neither looks wrong in a screenshot — the bar simply scrolls away again.
  for (const { path: file, source } of TSX) {
    if (!source.includes('<PageHeader')) continue

    assert.doesNotMatch(
      source,
      /<PageHeader[^>]*\bcol-span-/,
      `${file}: the bar is a grid cell`,
    )
    assert.doesNotMatch(
      source,
      /<div[^>]*>\s*\n?\s*<PageHeader[^>]*\/>\s*\n?\s*<\/div>/,
      `${file}: the bar is wrapped in a box of its own`,
    )
  }
})

test('every screen that draws the bar imports it from the one place', () => {
  const users = TSX.filter((f) => f.source.includes('<PageHeader'))
  // A floor and not a target: it goes up as the rest of §20.8's screens are converted,
  // and it is here so a refactor that quietly unhooks the bar from most of the app is a
  // failure rather than a diff nobody reads. Thirty-four screens carry it as this is
  // written, out of forty-nine under `(app)` — and a handful of those may never have it,
  // because a printed sheet draws no bar and `PageHeader` is `print:hidden`.
  assert.ok(users.length >= 34, `only ${users.length} screens carry the bar`)

  for (const { path: file, source } of users) {
    assert.ok(
      source.includes("import { PageHeader } from '@/components/page-header'"),
      `${file}: draws the bar without importing it`,
    )
    // And no screen keeps a hand-rolled heading beside it. The bar is the `<h1>`; a
    // second one is two page titles, and a screen reader lists both.
    assert.equal(count(source, '<h1'), 0, `${file}: still writes its own <h1>`)
  }
})
