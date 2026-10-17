import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
 * will open. Four of the six belong to a plan feature and five turn on one of the six
 * capability boxes, so the row and the page each hold half of the same rule, in two
 * files, with nothing between them. If they drift, the failure is not a crash: a
 * narrowed manager is offered Salaries and gets a 403, or an owner who has paid for
 * the Institution plan is never shown the head office. `tsc` catches neither.
 *
 * AND THE TWO HALVES ARE NOT THE SAME HALF. A capability a reader lacks hides the row; a
 * plan the centre has not bought greys it and leaves it there, because that row is the
 * only place the product ever mentions the tier — MASTERPLAN.md §20.3. Swapping one for
 * the other type-checks perfectly and is a silent revenue defect in one direction and a
 * silent privacy defect in the other, so both are asserted per row.
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

/** Read out of the shell rather than repeated here, so the two cannot disagree. */
const PHONE_TABS = Number(SHELL.match(/const PHONE_TABS = (\d+)/)?.[1])

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
 *
 * THE TWO KINDS OF GATE ARE NOT INTERCHANGEABLE and this table is where that is held.
 * `row` is a capability or a membership fact, and a row that fails it is not drawn.
 * `needs` is a plan feature, and a row that fails it IS drawn, greyed, because
 * MASTERPLAN.md §20.3 asks for the locked door over the hidden one where the door is also
 * the upgrade path. Writing a plan check into `when` would hide four rows a centre is
 * being sold; writing a capability into `needs` would advertise a colleague's job to
 * somebody the owner deliberately narrowed. Both are asserted per row, in both
 * directions.
 */
const GATED: { href: string; page: string[]; row: string[]; needs?: string }[] = [
  {
    href: '/fees',
    page: ["if (!(await canReadFees())) forbidden()"],
    row: ["can(member.capabilities, 'fees')"],
  },
  {
    href: '/expenses',
    page: ["pageCapability('expenses')", "has(session.plan, 'centerWideReporting')"],
    row: ["can(member.capabilities, 'expenses')"],
    needs: 'centerWideReporting',
  },
  {
    href: '/payroll',
    page: ["pageCapability('payroll')", "has(session.plan, 'centerWideReporting')"],
    row: ["can(member.capabilities, 'payroll')"],
    needs: 'centerWideReporting',
  },
  {
    href: '/notices',
    page: ["pageCapability('messages')"],
    row: ["can(member.capabilities, 'messages')"],
  },
  {
    href: '/progress',
    page: ["pageCapability('messages')", "has(session.plan, 'parentSummary')"],
    row: ["can(member.capabilities, 'messages')"],
    needs: 'parentSummary',
  },
  {
    href: '/hq',
    page: [
      "has(session.plan, 'multipleBranches')",
      'isHqMember(session.active)',
      'canReadMoney(session.active.capabilities)',
    ],
    row: ['isHqMember(member)', 'canReadMoney(member.capabilities)'],
    needs: 'multipleBranches',
  },
]

/** The rows that are open to anybody who can reach the shell at all. */
const UNGATED = ['/dashboard', '/teach', '/exams', '/at-risk', '/settings', '/settings/students']

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
  for (const { href, page, row, needs } of GATED) {
    const source = read('src', 'app', '(app)', href.slice(1), 'page.tsx')

    for (const demand of page) {
      assert.ok(source.includes(demand), `${href}/page.tsx no longer has: ${demand}`)
    }

    const literal = ROWS.get(href)
    assert.ok(literal, `${href} is in no menu`)
    for (const gate of row) {
      assert.ok(literal.includes(gate), `the ${href} row does not ask: ${gate}`)
    }

    // The plan half, on the other side of the row. A `has(plan, …)` inside `when` is the
    // regression this catches: it would type fine, pass every other test in this file,
    // and silently hide the four rows that are the product's upgrade path.
    assert.doesNotMatch(literal, /when:[\s\S]*?\bhas\(/, `the ${href} row hides a plan gate`)
    if (needs) {
      assert.ok(literal.includes(`needs: '${needs}'`), `the ${href} row does not need: ${needs}`)
    } else {
      assert.doesNotMatch(literal, /needs:/, `the ${href} row claims a plan feature`)
    }
  }
})

test('a plan the centre does not have locks a row rather than hiding it', () => {
  // MASTERPLAN.md §20.3, which is the rule this pair of fields exists to keep: a group a
  // reader's plan does not include "is drawn, and says what would unlock it — the one
  // place a locked door beats a hidden one, because that door is also the upgrade path".
  const needed = GATED.filter((entry) => entry.needs)
  assert.equal(needed.length, 4, 'four screens belong to a plan feature')

  const carriers = [...ROWS].filter(([, literal]) => literal.includes('needs:'))
  assert.equal(carriers.length, needed.length, `${carriers.length} rows carry a plan feature`)

  // Locked is decided once, on the plan the session already holds, and it reaches the
  // client component as data rather than as a second copy of the rule.
  assert.match(SHELL, /locked: item\.needs !== undefined && !has\(session\.plan, item\.needs\)/)
  assert.match(NAV_MODULE, /locked\?: boolean/)
  assert.match(NAV_MODULE, /item\.locked && \(/)

  // Still a link, because the screen behind it draws the card naming the plan that has
  // it. A locked row that did not navigate would be an advertisement with no page.
  assert.doesNotMatch(NAV_MODULE, /disabled|aria-disabled|pointer-events-none/)
})

test('a locked row never takes one of the four phone tabs', () => {
  // The bar's first four are unlocked in the table's own order, but the order is not
  // fixed: a manager who has lost `fees` loses the fourth row, and /expenses slides into
  // it — locked, on a Teacher Pro plan. One tab in four is too much of a 375px screen to
  // give an advertisement, so the split skips them.
  assert.match(SHELL, /const tabs = entries\.filter\(\(entry\) => !entry\.locked\)\.slice\(0, PHONE_TABS\)/)
  assert.match(SHELL, /more: entries\.filter\(\(entry\) => !tabs\.includes\(entry\)\)/)

  // And the shortcut for the roles that fit in the bar cannot swallow a locked row: a
  // five-row reader with one locked gets four tabs and a sheet, not five tabs.
  assert.match(SHELL, /entries\.length <= PHONE_TABS \+ 1 && !locked/)

  // None of the four in the table's order carries one anyway, which is the belt to that
  // brace: if a future reorder puts /payroll fourth, this fails and says so.
  for (const href of ORDER.slice(0, PHONE_TABS)) {
    const literal = ROWS.get(href!)
    assert.ok(literal, `${href} is in no menu`)
    assert.doesNotMatch(literal, /needs:/, `${href} is a phone tab and belongs to a plan`)
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
    assert.ok(!literal.includes('needs:'), `${href} has a plan gate that GATED does not name`)

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
  // The bar shows the first four unlocked rows of the table and the rest go behind More,
  // so the table's order is not cosmetic: reordering it moves a screen out of one tap.
  // These four are the register, the marks, the money and the dashboard they are read from.
  assert.deepEqual(ORDER.slice(0, 4), ['/dashboard', '/teach', '/exams', '/fees'])
  assert.match(SHELL, /const PHONE_TABS = 4/)
})

test('under five destinations there is no More at all', () => {
  // A teacher has two rows, or four with both permissions granted; a student has one.
  // None of them should be offered an empty sheet, and the bar they have always had
  // should not change shape underneath them.
  assert.match(SHELL, /entries\.length <= PHONE_TABS \+ 1/)
  assert.match(NAV_MODULE, /more\.length > 0 &&/)
})

test('the roster is a row of the menu itself, not only a card behind the hub', () => {
  // The register in the navigation. The roster was the one screen a centre opens
  // several times a day that still lived two taps deep behind the settings hub —
  // so this asserts the row exists, is in the staff-admin order (the labels test
  // above then holds its wording in both languages), and gates nobody it need not.
  assert.ok(ROWS.has('/settings/students'), 'the roster is in no menu')
  assert.ok(
    ORDER.includes('/settings/students'),
    'the roster is in the staff-admin table, not only in a const beside it',
  )

  // `pagePermission('can_manage_students')` is cleared by rank for every reader of
  // that table, so a `when` would offer the screen to nobody new — and `needs` would
  // make the roster an advertisement for a tier, which it has never been.
  const literal = ROWS.get('/settings/students')!
  assert.ok(!literal.includes('when:'), 'the roster row gates a reader it need not gate')
  assert.ok(!literal.includes('needs:'), 'the roster is not a plan feature')

  // The promise on the other side of the row: the route it names is a real screen.
  // (The menu-wide version of this is the first test in this file.)
  assert.ok(existsSync(path.join(ROOT, 'src', 'app', '(app)', 'settings', 'students', 'page.tsx')))
})

test('the phone bar pads itself out from under the home indicator', () => {
  // The safe-area fix: on a notched iPhone with `viewportFit: 'cover'` the home
  // indicator is drawn over the bottom of the viewport, and this bar is fixed to
  // that edge — so without a pad the last stretch of every tab is under the
  // system gesture area. The assertion reads the pad off the bar's own `fixed`
  // className rather than anywhere in the file, because a pad on the sheet or on
  // a page would satisfy a looser pattern and fix nothing.
  assert.match(
    NAV_MODULE,
    /fixed inset-x-0 bottom-0[\s\S]{0,160}pb-\[env\(safe-area-inset-bottom\)\]/,
    'the tab bar carries padding-bottom: env(safe-area-inset-bottom)',
  )

  // env() resolves to 0 unless the document lays out under the indicator, so the
  // pad only does anything because the layout asks for it. Either half without the
  // other is a change that type-checks, ships, and moves nothing on the phone it
  // was written for.
  assert.match(
    read('src', 'app', 'layout.tsx'),
    /viewportFit: 'cover'/,
    'the layout must opt into the safe area for the pad to be non-zero',
  )
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

  // The two words the bars add to the table's rows, for the same reason: an empty More
  // tab is a fifth of the bar with nothing in it, and an empty badge is a grey smudge
  // beside a greyed row.
  for (const d of [en, bn]) {
    for (const key of ['more', 'locked'] as const) {
      assert.equal(typeof d.shell[key], 'string')
      assert.ok(d.shell[key].length > 0, key)
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
  assert.match(NAV_MODULE, /<details ref=\{sheet\} className="group">/)
  assert.match(NAV_MODULE, /<summary/)
  // Still nothing that needs React to *open* it: no controlled state, no click handler —
  // the browser opens a `<details>`. The one ref is for closing it afterwards.
  assert.doesNotMatch(NAV_MODULE, /useState|onClick/)
})

test('the sheet closes itself when the route changes', () => {
  /*
   * A layout is not re-rendered when a route inside it changes, so the `<details>` kept
   * its `open` attribute after a tap on one of its own rows and covered the screen the
   * tap had just opened. The effect writes the DOM property rather than React state, which
   * is why `useState` is still absent above: no render happens, and the element's first
   * paint is the server's.
   */
  assert.match(NAV_MODULE, /const sheet = useRef<HTMLDetailsElement>\(null\)/)
  assert.match(NAV_MODULE, /if \(sheet\.current\) sheet\.current\.open = false/)
  // Keyed on the pathname, so the back button and a server redirect close it too — a
  // handler on the row would catch neither.
  assert.match(NAV_MODULE, /\}, \[pathname\]\)/)
})

/* -------------------------------------------------------------------------- */
/* The other direction: the way back out of a screen                          */
/* -------------------------------------------------------------------------- */

/**
 * What a screen demands of its reader, as a rank plus the two things rank does not imply.
 *
 * `pageRole('teacher')` and `pageCenter()` are the same demand — teacher is the lowest
 * role — so both are 0: any member of the centre. A roster permission sits at 1 because a
 * staff-admin clears it without the box being ticked, and `pageCapability` defaults to
 * `minimum: 'manager'`, so it is a rank of 2 *and* a capability, which rank alone never
 * grants below owner.
 */
type Guard = { rank: number; permission?: string; capability?: string }

function guardOf(body: string): Guard | null {
  const role = body.match(/await pageRole\('(\w+)'\)/)?.[1]
  if (role) return { rank: role === 'owner' ? 3 : role === 'manager' ? 2 : 0 }

  const permission = body.match(/await pagePermission\('(\w+)'\)/)?.[1]
  if (permission) return { rank: 1, permission }

  const capability = body.match(/await pageCapability\('(\w+)'\)/)?.[1]
  if (capability) return { rank: 2, capability }

  if (/await (pageCenter|getSession)\(\)/.test(body)) return { rank: 0 }
  return null
}

/** Does a reader who cleared `from` necessarily clear `to`? */
function reaches(from: Guard, to: Guard): boolean {
  if (from.rank < to.rank) return false
  if (to.permission && from.rank < 2 && from.permission !== to.permission) return false
  if (to.capability && from.rank < 3 && from.capability !== to.capability) return false
  return true
}

/** Every screen under (app): its route, its whole file, and its own function's body. */
const SCREENS = (function walk(dir: string): { route: string; source: string; body: string }[] {
  const out: { route: string; source: string; body: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name === 'page.tsx') {
      const source = readFileSync(full, 'utf8').replaceAll('\r\n', '\n')
      const from = source.search(/^export default (async )?function/m)
      const rest = source.slice(Math.max(from, 0))
      const close = rest.search(/^\}$/m)
      out.push({
        route:
          '/' +
          path
            .relative(path.join(ROOT, 'src', 'app', '(app)'), full)
            .replaceAll('\\', '/')
            .replace(/\/?page\.tsx$/, ''),
        source,
        body: close < 0 ? rest : rest.slice(0, close),
      })
    }
  }
  return out
})(path.join(ROOT, 'src', 'app', '(app)'))

test('every screen carries a way back that its own reader can open', () => {
  /*
   * THE DEFECT THIS CAUGHT. `/students/[studentId]` opens to `pageRole('teacher')` and
   * crumbed to `/settings/students`, which is `pagePermission('can_manage_students')` — a
   * box an owner ticks per teacher. A teacher without it reaches a child from the
   * dashboard's at-risk card, which is drawn off the risk view's rows rather than a role,
   * and the one link out of that screen answered "you do not have access to this".
   *
   * Which is the same rule the menu already keeps in the other direction: a row is a
   * promise that a screen will open, and so is a crumb. The menu's half is above; this is
   * the half nothing was holding, and it is the half a *narrowed* reader meets, because
   * every screen here is one the reader was allowed into.
   *
   * A crumb chosen at runtime is out of scope by construction — that shape is the fix, and
   * which check it turns on is asserted where the check is, on the screen's own test.
   */
  const guards = new Map(SCREENS.map((s) => [s.route, guardOf(s.body)]))

  /*
   * A ROUTE THAT ONLY REDIRECTS ADMITS EXACTLY THE READERS ITS TARGET ADMITS, so its
   * guard is the target's. `/settings/plan` is one since §16.1 step 27 demolished the
   * page — it carries no guard of its own because it shows nobody anything, and reading
   * that as "anybody may be here" would let the next screen behind a redirect claim the
   * menu's promise on the strength of a route that opens no door.
   *
   * Resolved in a second pass because the map this reads is the one being built.
   */
  for (const { route, body } of SCREENS) {
    if (guards.get(route)) continue
    /*
     * A literal target, or the literal head of one that keeps the route's own segment:
     * `/settings/plan/receipt/[paymentId]` forwards the id into
     * `/settings/billing/receipt/`, and a gate that only read whole literals would call
     * that route unreadable rather than resolve it to the one screen living under the
     * prefix. Exactly one, because a prefix that names two screens names no guard.
     */
    const target =
      body.match(/^\s*redirect\('([^']+)'\)/m)?.[1] ??
      body.match(/^\s*redirect\('([^']*)'\s*\+/m)?.[1] ??
      body.match(/^\s*redirect\(`([^`$]*)/m)?.[1]
    if (target) {
      const under = [...guards].filter(([candidate]) => candidate.startsWith(target))
      guards.set(route, guards.get(target) ?? (under.length === 1 ? under[0][1] : null))
    }
  }

  const offenders: string[] = []

  for (const { route, body } of SCREENS) {
    const from = guards.get(route)
    assert.ok(from, `${route}: no guard this test knows how to read`)

    const targets = new Set<string>()
    for (const m of body.matchAll(/back=\{\{\s*href: '([^']+)'/g)) targets.add(m[1])
    for (const m of body.matchAll(/^ {2}const \w+ = \{ href: '([^']+)' as const/gm)) {
      targets.add(m[1])
    }
    for (const m of body.matchAll(/<Link\s+href="([^"]+)"[\s\S]{0,200}?←/g)) targets.add(m[1])

    for (const target of targets) {
      const to = guards.get(target)
      if (!to || reaches(from, to)) continue
      offenders.push(`${route} -> ${target}`)
    }
  }

  assert.deepEqual(offenders, [])
})

/* -------------------------------------------------------------------------- */
/* And the links in the middle of a screen, for the six capability boxes       */
/* -------------------------------------------------------------------------- */

/**
 * Every href a page body writes, with the query string and any `${}` cut out.
 *
 * The template case keeps the shape rather than the value — `/exams/${id}` becomes
 * `/exams/x` — because what is being resolved is which route file answers, and any
 * non-empty segment answers the same one.
 */
function hrefsIn(body: string): Set<string> {
  return new Set(
    [
      ...[...body.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]),
      ...[...body.matchAll(/href=\{`(\/[^`]*)`\}/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, 'x')),
      ...[...body.matchAll(/href: '(\/[^']*)'/g)].map((m) => m[1]),
    ].map((href) => href.split(/[?#]/)[0]),
  )
}

/** Which route file answers `href`, segment by segment: `[studentId]` takes anything. */
function routeFor(href: string): string | null {
  const want = href.split('/').filter(Boolean)
  for (const { route } of SCREENS) {
    const have = route.split('/').filter(Boolean)
    if (have.length !== want.length) continue
    if (have.every((seg, i) => seg.startsWith('[') || seg === want[i])) return route
  }
  return null
}

test('a link into a capability screen is drawn only where that box was asked about', () => {
  /*
   * THE TWO DEFECTS THIS CAUGHT, both on the money screens and both the same slip: the
   * link was gated on the *role*, which is what `isStaffAdmin` answers, and the screen at
   * the other end asks for a capability, which is a separate box on the same form. So a
   * manager whose owner ticked `fees` and left `expenses` and `payroll` unticked read the
   * fee board — correctly, it is their job — and was offered "Spending →" and "Salaries →"
   * under the month's takings, both of which answer "you do not have access to this".
   * `/settings/staff` had the same pair: `staff` is written down who works here, `payroll`
   * is what they are paid, and one does not imply the other.
   *
   * The shell was already right — every capability row in app-nav.tsx carries a `when` —
   * which is why this direction needed its own gate. A screen body is where the drift
   * happens, because the reader is already inside and the link looks like part of the page.
   *
   * ASKED ABOUT, NOT ADJACENT. This reads the file for a mention of the capability rather
   * than trying to evaluate the JSX condition around the link: which of `mayReadPayroll`,
   * `canWrite && can(…)` or a nested `mayReadFees` is the true gate is a question about
   * runtime, and a test that guessed would be a test that argued with correct code. The
   * defect this catches is the one that actually happens — nobody thought about the box at
   * all — and the screen's own test asserts which check it turned on.
   *
   * `pageRole('owner')` is exempt because nothing narrows an owner: `can` reads their null
   * column as the whole role, so every capability screen opens for them.
   */
  const capOf = new Map<string, string>()
  for (const { route, body } of SCREENS) {
    const capability = body.match(/await pageCapability\('(\w+)'\)/)?.[1]
    if (capability) capOf.set(route, capability)
  }
  assert.equal(capOf.size, 18, 'the set of capability screens moved — check the exemptions')

  /** `canReadFees` and `canReadMoney` are `can` under another name. See both. */
  const MONEY = ['fees', 'expenses', 'payroll']
  const offenders: string[] = []

  for (const { route, source, body } of SCREENS) {
    if (/await pageRole\('owner'\)/.test(body)) continue
    const own = capOf.get(route)

    for (const href of hrefsIn(body)) {
      const target = routeFor(href)
      if (target === null || target === route) continue
      const need = capOf.get(target)
      if (!need || need === own) continue
      const asks =
        new RegExp(`can\\([^)]*'${need}'\\)`).test(source) ||
        (need === 'fees' && /canReadFees\(\)/.test(source)) ||
        (MONEY.includes(need) && /canReadMoney\(/.test(source))
      if (!asks) offenders.push(`${route} -> ${target} (${need})`)
    }
  }

  assert.deepEqual(offenders, [])
})

