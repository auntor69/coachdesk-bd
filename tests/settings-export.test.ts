/**
 * The download screen, and the shape it has on something wider than a phone.
 *
 * WHAT THIS FILE IS GUARDING. Five descriptions and five buttons ran down the middle
 * of a 1,216px page, with the month picker that decides what all five of them fetch
 * scrolling off the top. It is two columns of cards from `xl` now, the picker is capped
 * to the width of one month, and every card in a row is the same height so the buttons
 * land on one line — `h-full` with `mt-auto`, both no-ops on a phone.
 *
 * §38 IS WHY THE GUARDS ARE PINNED HARDER THAN THE MARKUP. This screen is the one place
 * a whole centre's roster leaves the product in one tap, so the gate is `pageRole`
 * rather than a permission, `exportReports` is checked before any work is done, and the
 * month off the query string is tested against a regex rather than trusted. None of
 * those is load-bearing on its own — /api/export re-checks all three, because a URL is
 * reachable without ever loading this page — and that is exactly why a redesign must
 * not quietly drop one and leave the screen offering a link the handler will refuse.
 *
 * The five sheets themselves are tested in export.test.ts, against a stubbed Supabase.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const SRC = read('src', 'app', '(app)', 'settings', 'export', 'page.tsx')
const ROUTE = read('src', 'app', 'api', 'export', 'route.ts')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('the five sheets are two columns of cards from xl', () => {
  assert.ok(
    SRC.includes('<ul className="flex flex-col gap-3 xl:grid xl:grid-cols-2 xl:gap-4">'),
  )

  // Not three: 960px of content makes three 309px columns, and the longest
  // description is 200 characters of Bangla — eight lines in a column that narrow.
  assert.doesNotMatch(SRC, /grid-cols-[3-9]/)

  // A menu of five equal items, not a list with a rail: neither half would be
  // commentary on the other, and the picker above is one control rather than a form.
  assert.doesNotMatch(SRC, /xl:col-span/)
  assert.doesNotMatch(SRC, /xl:sticky/)
  assert.doesNotMatch(SRC, /(?<=["\s`])order-\d/)
})

test('a row of cards is one height, so the buttons land on one line', () => {
  assert.ok(SRC.includes('<Card className="flex h-full flex-col">'))
  // Counted on the pair, not on `mt-auto` alone: the comment above it says the word too.
  assert.equal(count(SRC, 'mt-auto pt-3'), 1, 'the period and its button move together')
  assert.ok(SRC.includes('<div className="mt-auto pt-3">'))

  // The period stays attached to the button it describes, inside the block that
  // `mt-auto` pushes down — not left behind under the description.
  const block = SRC.indexOf('<div className="mt-auto pt-3">')
  assert.ok(block !== -1)
  assert.ok(block < SRC.indexOf('formatMonth(month, locale)'))
  assert.ok(SRC.indexOf('formatMonth(month, locale)') < SRC.indexOf('{t.download}'))
})

test('the month picker is a month wide and the prose is a sentence wide', () => {
  assert.ok(SRC.includes('<form method="get" className="flex max-w-sm items-end gap-2">'))
  assert.ok(SRC.includes('<p className="max-w-2xl text-sm text-ink-faint">{t.opensIn}</p>'))
  assert.ok(SRC.includes('<Card className="max-w-2xl">'), 'the paywall is two sentences')
  assert.equal(count(SRC, 'max-w-2xl'), 2, 'the card grid is capped by its columns')
  assert.equal(count(SRC, 'max-w-sm'), 1)
})

test('the furniture is the one the other settings screens use', () => {
  assert.ok(
    SRC.includes(
      'className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"',
    ),
  )
  assert.ok(SRC.includes('<h1 className="mt-1 text-xl font-bold text-ink lg:text-2xl">'))
  assert.equal(count(SRC, '<h1'), 2, 'the paywall arm has its own')
  assert.equal(count(SRC, '<h2'), 1, 'one per card, inside the map')
})

/* -------------------------------------------------------------------------- */
/* §38: what the redesign may not drop                                        */
/* -------------------------------------------------------------------------- */

test('the gate is the role, and the plan is checked before any work', () => {
  // Not a permission: nothing here is narrowed to one teacher's batches, so a teacher
  // handed can_manage_students must not be able to walk out with the whole roster.
  assert.ok(SRC.includes("const session = await pageRole('manager')"))
  assert.doesNotMatch(SRC, /pagePermission/)

  // Ahead of the month arithmetic: a locked screen needs no month list, and building
  // one to throw away is work for a page that cannot use it.
  const plan = SRC.indexOf("if (!has(session.plan, 'exportReports')) {")
  const params = SRC.indexOf('await searchParams')
  assert.ok(plan !== -1, 'the plan gate is still here')
  assert.ok(params !== -1)
  assert.ok(plan < params)
  assert.ok(SRC.includes('{t.lockedTitle}'))
  assert.ok(SRC.includes('{t.seePlans} →'), 'and a way out of the refusal')

  // The handler checks all three again, because a URL is reachable without this page.
  assert.ok(ROUTE.includes('if (!isStaffAdmin(session)) return refuse(403, t.errors.forbidden)'))
  assert.ok(
    ROUTE.includes("if (!has(session.plan, 'exportReports')) return refuse(403, t.errors.needsPlan)"),
  )
  assert.ok(ROUTE.includes('if (!isReportId(kind)) return refuse(400, t.errors.unknownKind)'))
})

test('the month off the query string is tested, not trusted', () => {
  assert.ok(SRC.includes('const MONTH_RE = /^\\d{4}-\\d{2}-01$/'))
  assert.ok(SRC.includes("MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : thisMonth"))
  assert.ok(ROUTE.includes('const MONTH_RE = /^\\d{4}-\\d{2}-01$/'), 'the handler has its own')

  // Next month, this one, and the eleven before — forwards by exactly one, because the
  // fee board bills a month ahead and a list stopping at today would deny September.
  assert.ok(SRC.includes('Array.from({ length: 13 }, (_, i) => {'))
  assert.ok(SRC.includes('addMonths(thisMonth, 1 - i)'))
})

test('the download is a plain anchor and the month rides only where it counts', () => {
  // A <Link> is intercepted by the client router, which tries to render the
  // destination as a route; there is no route, there is a Content-Disposition.
  assert.ok(
    SRC.includes(`                    <a
                      href={href}`),
  )
  assert.doesNotMatch(SRC, /<Link[\s\S]{0,80}\/api\/export/)

  // The catalogue drives the list, so a sixth sheet needs no edit here.
  assert.ok(SRC.includes('{REPORT_IDS.map((id) => {'))
  assert.ok(SRC.includes('{t.reports[id].title}'))
  assert.ok(SRC.includes('{t.reports[id].body}'))

  // A `month` on the roster's URL would be a parameter the handler ignores — which is
  // a promise the file then breaks. Once for the href, once for the period line.
  assert.equal(count(SRC, 'NEEDS_MONTH[id]'), 2)
  assert.ok(SRC.includes('? `/api/export?kind=${id}&month=${month}`'))
  assert.ok(SRC.includes(': `/api/export?kind=${id}`'))
  assert.ok(SRC.includes('t.asOf(formatDate(todayInDhaka(), locale))'))
})
