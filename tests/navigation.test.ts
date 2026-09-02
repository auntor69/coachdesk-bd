import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { en } from '../src/lib/i18n/en.ts'
import { bn } from '../src/lib/i18n/bn.ts'

/**
 * The navigation table, held to the guards on the screens it points at.
 *
 * WHAT WENT WRONG AND IS BEING FIXED HERE. Six built, tested and guarded screens —
 * /expenses, /payroll, /at-risk, /notices, /progress, /hq — were in no menu at all.
 * The only way to any of them was a card on the dashboard, so the dashboard became the
 * product's menu and recording an expense was two hops through a summary of something
 * else. The sidebar now carries them.
 *
 * WHY THAT NEEDS A TEST RATHER THAN A GLANCE. A menu row is a promise that a screen
 * will open. Four of the six turn on a plan feature and four on one of the six
 * capability boxes, so the row and the page each hold half of the same rule, in two
 * files, with nothing between them. If they drift, the failure is not a crash: a
 * narrowed manager is offered Salaries and gets a 403, or an owner who has paid for
 * the Institution plan is never shown the head office. `tsc` catches neither.
 *
 * So this file is the third party. For each row it asserts what the page demands and
 * what the row gates on, and a change to either side without the other fails here.
 * Same arrangement as capacity.test.ts, which holds a migration and a constant to one
 * string for the same reason.
 */

const ROOT = path.join(import.meta.dirname, '..')

function read(...parts: string[]): string {
  return readFileSync(path.join(ROOT, ...parts), 'utf8')
}

const SHELL = read('src', 'components', 'app-shell.tsx')
const NAV_MODULE = read('src', 'components', 'app-nav.tsx')

/**
 * The staff-admin table and the three shared consts, and nothing after them.
 *
 * Bounded so `NAV`'s per-role arrays are out of scope: they repeat /teach and /me, and a
 * map keyed by href would quietly keep whichever copy came last.
 */
const TABLE = SHELL.slice(
  SHELL.indexOf('const FEES_TAB'),
  SHELL.indexOf('const NAV_GROUPS'),
)

/** `FEES_TAB` → `/fees`, so the table's order can be read through its references. */
const TAB_CONSTS = new Map<string, string>(
  [...TABLE.matchAll(/const ([A-Z][A-Z_]*_TAB): NavItem = \{[\s\S]*?href: '([^']+)'/g)]
    .map((m) => [m[1], m[2]]),
)

/**
 * Every row, keyed by its href, holding the source text of its literal — which is where
 * its `when` lives when it has one.
 *
 * Chunked from one `href:` to the next rather than parsed properly: a row is a flat
 * object literal, the file is in the repo, and a TypeScript parser here would be a
 * second implementation of the thing under test.
 */
function rowsOf(source: string): Map<string, string> {
  const marks = [...source.matchAll(/href: '([^']+)'/g)]
  const rows = new Map<string, string>()

  marks.forEach((mark, i) => {
    const from = mark.index
    const to = i + 1 < marks.length ? marks[i + 1].index : source.length
    rows.set(mark[1], source.slice(from, to))
  })

  return rows
}

const ROWS = rowsOf(TABLE)

/** The staff-admin rows in the order they are written, references resolved. */
const ORDER = [
  ...TABLE.slice(TABLE.indexOf('const STAFF_ADMIN_NAV')).matchAll(
    /href: '([^']+)'|\b([A-Z][A-Z_]*_TAB)\b/g,
  ),
].map((m) => m[1] ?? TAB_CONSTS.get(m[2]))

/**
 * What each screen demands of a reader before it will draw, and therefore what its row
 * has to ask before it will offer it.
 *
 * Written out rather than inferred from the page, because a page holds more `has(...)`
 * calls than the one that guards it — the dashboard alone has three, for the cards it
 * draws — and a test that guessed which was the gate would be guessing.
 *
 * `page` is what must still be in the page for the row's gate to be the right gate.
 * `row` is what must be in the row. Both halves are asserted, so removing the plan check
 * from /payroll fails here rather than silently making the sidebar wrong.
 */
const GATED: { href: string; page: string[]; row: string[] }[] = [
  {
    href: '/fees',
    page: ["if (!(await canReadFees())) forbidden()"],
    row: ["can(member.capabilities, 'fees')"],
  },
  {
    href: '/expenses',
    page: ["pageCapability('expenses')", "has(session.plan, 'centerWideReporting')"],
    row: ["can(member.capabilities, 'expenses')", "has(plan, 'centerWideReporting')"],
  },
  {
    href: '/payroll',
    page: ["pageCapability('payroll')", "has(session.plan, 'centerWideReporting')"],
    row: ["can(member.capabilities, 'payroll')", "has(plan, 'centerWideReporting')"],
  },
  {
    href: '/notices',
    page: ["pageCapability('messages')"],
    row: ["can(member.capabilities, 'messages')"],
  },
  {
    href: '/progress',
    page: ["pageCapability('messages')", "has(session.plan, 'parentSummary')"],
    row: ["can(member.capabilities, 'messages')", "has(plan, 'parentSummary')"],
  },
  {
    href: '/hq',
    page: [
      "has(session.plan, 'multipleBranches')",
      'isHqMember(session.active)',
      'canReadMoney(session.active.capabilities)',
    ],
    row: [
      "has(plan, 'multipleBranches')",
      'isHqMember(member)',
      'canReadMoney(member.capabilities)',
    ],
  },
]

/** The rows that are open to anybody who can reach the shell at all. */
const UNGATED = ['/dashboard', '/teach', '/exams', '/at-risk', '/settings']

test('every row in the menu points at a screen that exists', () => {
  // `typedRoutes` already fails the build on an href with no route, which is most of
  // this. What it does not check is that the route is a page under (app) — a row
  // pointing at a route group's layout or at an API handler would type fine and open
  // nothing.
  for (const href of ROWS.keys()) {
    const page = path.join(ROOT, 'src', 'app', '(app)', href.slice(1), 'page.tsx')
    assert.ok(existsSync(page), `${href} has no page at ${page}`)
  }
})

test('the six screens that had no way in are in the menu', () => {
  // The defect this table was changed to fix, asserted as itself so a future tidy-up
  // that drops one of them fails rather than quietly restoring the dashboard-as-menu.
  for (const href of ['/expenses', '/payroll', '/at-risk', '/notices', '/progress', '/hq']) {
    assert.ok(ROWS.has(href), `${href} is in no menu`)
  }
})

test('a row asks exactly what its screen asks', () => {
  for (const { href, page, row } of GATED) {
    const source = read('src', 'app', '(app)', href.slice(1), 'page.tsx')

    for (const demand of page) {
      assert.ok(source.includes(demand), `${href}/page.tsx no longer has: ${demand}`)
    }

    const literal = ROWS.get(href)
    assert.ok(literal, `${href} is in no menu`)
    for (const gate of row) {
      assert.ok(literal.includes(gate), `the ${href} row does not ask: ${gate}`)
    }
  }
})

test('a row with no gate points at a screen that needs none', () => {
  // The other direction, and the one that offers a 403. A page that grows a
  // `pageCapability` or a plan gate has to be added to GATED above; until it is, this
  // fails, because its row would still be offering it to everybody.
  for (const href of UNGATED) {
    const literal = ROWS.get(href)
    assert.ok(literal, `${href} is in no menu`)
    assert.ok(!literal.includes('when:'), `${href} has a gate that GATED does not name`)

    const source = read('src', 'app', '(app)', href.slice(1), 'page.tsx')
    assert.doesNotMatch(source, /pageCapability\(/, `${href}/page.tsx narrowed itself`)
  }
})

test('deciding the menu costs no query', () => {
  // The claim in `navFor`'s docblock, and the reason the six rows could be added without
  // a round trip each: `can`, `has`, `isHqMember` and `canReadMoney` are pure functions
  // of the session the layout already holds. An `await` in a gate would put one query
  // per row on the critical path of every screen in the product.
  const gated = [...ROWS].filter(([, literal]) => literal.includes('when:'))

  assert.equal(gated.length, GATED.length, `${gated.length} rows carry a gate`)
  for (const [href, literal] of gated) {
    assert.doesNotMatch(literal.slice(literal.indexOf('when:')), /\bawait\b/, href)
  }
})

test('the phone bar keeps the four a centre touches daily', () => {
  // The bar shows the first four rows of the table and the rest go behind More, so the
  // table's order is not cosmetic: reordering it moves a screen out of one tap. These
  // four are the register, the marks, the money and the dashboard they are read from.
  assert.deepEqual(ORDER.slice(0, 4), ['/dashboard', '/teach', '/exams', '/fees'])
  assert.match(SHELL, /const PHONE_TABS = 4/)

  // And the sheet holds the rest in the same order, rather than a second list that
  // could word or order them differently.
  assert.match(SHELL, /entries\.slice\(0, PHONE_TABS\), more: entries\.slice\(PHONE_TABS\)/)
})

test('under five destinations there is no More at all', () => {
  // A teacher has two rows, or four with both permissions granted; a student has one.
  // None of them should be offered an empty sheet, and the bar they have always had
  // should not change shape underneath them.
  assert.match(SHELL, /entries\.length <= PHONE_TABS \+ 1/)
  assert.match(NAV_MODULE, /more\.length > 0 &&/)
})

test('every row the sidebar can draw has a label in both languages', () => {
  // A missing key renders as an empty menu row: a tap target with nothing in it, which
  // reads as a broken app rather than as a menu.
  const labels = [...TABLE.matchAll(/label: '(\w+)'/g)].map((m) => m[1])

  assert.ok(labels.length >= 11, `found ${labels.length} labels`)
  for (const label of labels) {
    for (const [lang, d] of [['en', en], ['bn', bn]] as const) {
      const sentence = d.shell.nav[label as keyof typeof d.shell.nav]
      assert.equal(typeof sentence, 'string', `${lang}.nav.${label}`)
      assert.ok(sentence.length > 0, `${lang}.nav.${label}`)
    }
  }
})

test('every group heading exists in both languages, and none is unused', () => {
  const used = [...new Set([...TABLE.matchAll(/group: '(\w+)'/g)].map((m) => m[1]))].sort()
  const listed = SHELL.match(/const NAV_GROUPS: NavGroup\[\] = \[([^\]]*)\]/)
  assert.ok(listed, 'NAV_GROUPS is not where this test expects it')
  const declared = [...listed[1].matchAll(/'(\w+)'/g)].map((m) => m[1])

  // The order NAV_GROUPS lists is the order the sidebar draws, and a group used by a row
  // but missing from it would be a row that never appears in any section.
  assert.ok(declared.length > 0)
  assert.deepEqual([...declared].sort(), used)
  assert.deepEqual(Object.keys(en.shell.navGroups).sort(), used)
  assert.deepEqual(Object.keys(bn.shell.navGroups).sort(), used)
})

test('the sheet and the sidebar draw a row the same way', () => {
  // One component for both, so an active row cannot be filled in one place and outlined
  // in the other — and so the sheet inherits `aria-current` rather than being a second
  // list of links that says nothing about where the reader is.
  assert.match(NAV_MODULE, /function SideRow\(/)
  assert.match(NAV_MODULE, /aria-current=\{here \? 'page' : undefined\}/)

  const usages = [...NAV_MODULE.matchAll(/<SideRow\b/g)]
  assert.equal(usages.length, 2, 'SideRow should draw both the sidebar and the sheet')
})

test('the phone sheet works before the bundle arrives', () => {
  // A `<details>`, for the reason the centre switcher is one: on a 3G connection the
  // first ten seconds have no JavaScript in them, and a menu that needs React to open
  // is a menu that does not open. `usePathname` is the only client-side thing here and
  // it renders into the first HTML.
  assert.match(NAV_MODULE, /<details className="group">/)
  assert.match(NAV_MODULE, /<summary/)
  assert.doesNotMatch(NAV_MODULE, /useState|onClick/)
})
