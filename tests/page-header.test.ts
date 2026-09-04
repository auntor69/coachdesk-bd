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
  //
  // Generic, because bare `Route` resolves its dynamic branch against `string` — which
  // is `never` — so `/exams` compiles and `/exams/${id}` does not. Half the screens
  // that carry a crumb are sub-screens of a dynamic route, so the argument is inferred
  // from the href exactly as `next/link` infers its own.
  assert.match(SRC, /export function PageHeader<RouteType extends string>\(/)
  assert.match(SRC, /back\?: \{ href: Route<RouteType>; label: string \}/)
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
    // The third shape, which un-bleeds it instead of un-sticking it. The bar's background
    // spans the workspace with `lg:-mx-8`, so a `max-w-*` on the column that holds it
    // stops that background at 672px and leaves rows scrolling up through bare page
    // either side. Every screen with a narrow form caps the CARD instead — see the note
    // on account/page.tsx, which is where this was got wrong.
    assert.doesNotMatch(
      source,
      /<div className="[^"]*\bmax-w-[^"]*"[^>]*>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<PageHeader/,
      `${file}: the column holding the bar is capped, so its background is too`,
    )
  }
})

/**
 * Every screen under `(app)`, which is every screen that owes the reader a heading.
 * `error.tsx` and the rest are not here: a page file is what a route resolves to.
 */
const PAGES = TSX.filter(
  (f) => f.path.startsWith('src/app/(app)/') && f.path.endsWith('/page.tsx'),
)

/**
 * The five that draw no bar, and each is settled rather than pending.
 *
 * Four are printed sheets — a guardian's receipt, a payslip, an expense voucher, a plan
 * receipt — and `PageHeader` is `print:hidden`, so a bar on them would be furniture that
 * exists only on the screen it is printed from. The fifth is the fee register, whose
 * `<h1>` is the centre's own name because that sheet gets handed across a desk.
 *
 * A list and not a floor: the rollout is done, so the failure worth catching now is the
 * next screen somebody adds without a heading, and a `>=` count can never catch that.
 */
const NO_BAR = [
  'src/app/(app)/expenses/voucher/[expenseId]/page.tsx',
  'src/app/(app)/fees/receipt/[paymentId]/page.tsx',
  'src/app/(app)/fees/register/page.tsx',
  'src/app/(app)/payroll/payslip/[paymentId]/page.tsx',
  'src/app/(app)/settings/plan/receipt/[paymentId]/page.tsx',
]

test('every screen in the app draws the bar, or is one of the five printed exceptions', () => {
  const without = PAGES.filter((f) => !f.source.includes('<PageHeader')).map((f) => f.path)
  assert.deepEqual(without.sort(), [...NO_BAR].sort())


  // Over every `.tsx` and not just the pages, because a shared block that drew a bar of
  // its own would owe the same two things.
  for (const { path: file, source } of TSX) {
    if (!source.includes('<PageHeader')) continue
    assert.ok(
      source.includes("import { PageHeader } from '@/components/page-header'"),
      `${file}: draws the bar without importing it`,
    )
    // And no screen keeps a hand-rolled heading beside it. The bar is the `<h1>`; a
    // second one is two page titles, and a screen reader lists both.
    assert.equal(count(source, '<h1'), 0, `${file}: still writes its own <h1>`)
  }
})

/* -------------------------------------------------------------------------- */
/* Repo-wide: every arm of every screen, not just the one an owner reaches     */
/* -------------------------------------------------------------------------- */

/**
 * A page's own default-exported function, from its `export default` to the first `}` in
 * column 0. Helper components live below that line and draw their own headings or not on
 * their own terms; what is being counted here is the screen's own arms.
 */
function pageBody(source: string, file: string) {
  const from = source.search(/^export default (async )?function/m)
  assert.ok(from >= 0, `${file}: no default-exported page function`)
  const rest = source.slice(from)
  const close = rest.search(/^\}$/m)
  return close < 0 ? rest : rest.slice(0, close)
}

/**
 * The page's own `const` blocks that hold JSX, by name. Two shapes, because both are in
 * use: `const header = (…)`, which an arm draws as `{header}`, and hq's and arrears'
 * `const refusal = (problem) => (…)`, which an arm returns outright.
 */
function localBlocks(body: string) {
  const out = new Map<string, string>()
  for (const m of body.matchAll(/^ {2}const (\w+) = (?:\([^)]*\) => )?\(\n(?:.*\n)*?^ {2}\)\n/gm)) {
    out.set(m[1], m[0])
  }
  return out
}

/** Local components that draw a bar when handed a `refusal`, which is hq's `Shell`. */
function refusalShells(source: string) {
  return [...source.matchAll(/^function (\w+)\(\{\n(?:.*\n)*?^\}$/gm)]
    .filter((m) => m[0].includes('<PageHeader') && m[0].includes('refusal'))
    .map((m) => m[1])
}

test('every arm of every screen draws the bar, not just the one an owner reaches', () => {
  /*
   * WHY ARMS AND NOT FILES. The test above reads each page as one string, so a screen
   * passes it on the strength of a single `<PageHeader` anywhere inside — and every one of
   * these screens returns early several times before it gets to the arm an owner with
   * everything enabled sees. A trialling teacher hits the paywall arm, a lapsed centre the
   * read-only one, a narrowed accountant the refusal, and anybody at all hits the dropped
   * read. Those are the arms that most need to say which screen is refusing: the reader is
   * already surprised, and a bare card in the middle of the workspace names nothing.
   *
   * §20.9's first obligation, made mechanical — "a layout that only works for an owner with
   * everything enabled has not been tested".
   *
   * The five printed sheets are out, for the reason they are out of the bar entirely: the
   * bar is `print:hidden`, so on a page whose whole purpose is paper it would be furniture
   * that exists only on the screen it is printed from. Their refusals carry a crumb back to
   * the list and a card whose first line names what happened instead, and the two that are
   * paywalls rather than dropped reads — the voucher and the payslip — write a real `<h1>`.
   */
  const offenders: string[] = []

  for (const { path: file, source } of PAGES) {
    if (NO_BAR.includes(file)) continue

    const body = pageBody(source, file)
    const blocks = localBlocks(body)
    const holders = [...blocks].filter(([, b]) => b.includes('<PageHeader')).map(([n]) => n)
    const shells = refusalShells(source)
    const at = (index: number) =>
      source.slice(0, source.indexOf(body) + index).split('\n').length

    const arms = [...body.matchAll(/^ {2,4}return \(\n/gm)]
    assert.ok(arms.length > 0, `${file}: no arm found, so this file is going unchecked`)

    arms.forEach((arm, i) => {
      const next = arms[i + 1]
      const text = body.slice(arm.index, next ? next.index : body.length)
      const draws =
        text.includes('<PageHeader') ||
        holders.some((h) => text.includes(`{${h}}`)) ||
        shells.some((s) => new RegExp(`<${s}[^>]*refusal=`).test(text))
      if (!draws) offenders.push(`${file}:${at(arm.index)}`)
    })

    // And the arms that hand the whole screen to a local block instead of returning JSX,
    // which is how arrears refuses three different reads with one card. Skipped when the
    // name is imported rather than declared here — a `.map()` callback returning a helper
    // is not an arm — and flagged when it is declared but its block cannot be read, so a
    // holder written in a shape this test does not know fails loudly instead of quietly.
    const declared = new Set([...body.matchAll(/^ {2}const (\w+) = /gm)].map((m) => m[1]))
    for (const m of body.matchAll(/^ {2,4}return (\w+)\(/gm)) {
      if (!declared.has(m[1])) continue
      if (blocks.get(m[1])?.includes('<PageHeader')) continue
      offenders.push(`${file}:${at(m.index)} (via ${m[1]})`)
    }
  }

  assert.deepEqual(offenders, [])
})

