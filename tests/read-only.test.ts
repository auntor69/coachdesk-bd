import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * Read-only enforcement, checked the only way it can be: structurally.
 *
 * MASTERPLAN.md §4.4 — a centre whose plan has lapsed keeps every screen and stops
 * being able to save. The check itself is one line (`session.access !== 'full'`) and
 * there is nothing to unit-test about it. What is genuinely at risk is *coverage*: the
 * enforcement lives in one guard per action module, so a module added in six months
 * with its own local guard is a hole that nothing else in this repo would notice —
 * every gate passes, every screen works, and a suspended centre keeps running its
 * branches or its payroll for as long as nobody checks.
 *
 * So the rule these tests hold is deliberately about the source: EVERY ACTION MODULE
 * UNDER (app) EITHER RUNS THE CHECK OR SAYS WHY IT DOES NOT. The three that do not are
 * named below with the reason, and adding a fourth means writing the reason down.
 *
 * AND THE OTHER HALF, at the bottom of this file: EVERY SCREEN THAT CAN REACH ONE OF
 * THOSE WRITES ASKS WHETHER THE CENTRE MAY SAVE. The fence above holds, but a screen that
 * does not ask draws the form anyway — so a manager opened Add Student, filled in twelve
 * fields with a family at the desk, and learned the subscription had lapsed by pressing
 * save. The fence refusing is not the same as the reader being told.
 *
 * `requireWritable` cannot be imported here — it lives in src/lib/auth/session.ts, which
 * pulls in the Supabase server client and next/headers. That is also why the pure part
 * of entitlement lives in src/lib/entitlement.ts and is tested properly next door.
 */

const ROOT = path.join(import.meta.dirname, '..')
const APP = path.join(ROOT, 'src', 'app', '(app)')

function read(...parts: string[]): string {
  return readFileSync(path.join(ROOT, ...parts), 'utf8')
}

/** Every `actions.ts` under the signed-in route group, repo-relative and POSIX-slashed. */
function actionModules(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...actionModules(full))
    else if (entry.name === 'actions.ts') out.push(path.relative(ROOT, full).split(path.sep).join('/'))
  }
  return out.sort()
}

/** Every `.ts`/`.tsx` under a directory, same shape as above. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'))
  }
  return out.sort()
}

/**
 * The modules that write without the check, and why each one has to.
 *
 * Not a list of exceptions to be shortened over time: each of these would be a bug to
 * "fix". They are here so the test below can tell a deliberate omission from a
 * forgotten one, and so the reason is written down in the place somebody adding a
 * fourth entry will read.
 */
const EXEMPT: Record<string, string> = {
  // A cookie on their own browser. Somebody who teaches at a suspended centre and a
  // paying one has to be able to get from the first to the second.
  'src/app/(app)/actions.ts': 'switches centres, writes no centre row',
  // Their own name and their own password. Freezing those because the centre owes us
  // money is a security failure with a billing excuse on it.
  'src/app/(app)/account/actions.ts': 'the account, not the centre',
  // The button that says "put me on a plan". Refusing it would refuse the exact thing
  // read-only exists to provoke.
  'src/app/(app)/settings/plan/actions.ts': 'asking to pay is the way out',
}

test('every action module under (app) either runs the write check or explains itself', () => {
  const modules = actionModules(APP)

  // Sanity: if the walk finds nothing the rest of this test passes vacuously, which is
  // the one way a coverage test can lie.
  assert.ok(modules.length >= 8, `found only ${modules.length} action modules`)

  for (const file of modules) {
    assert.match(
      read(file),
      /requireWritable/,
      `${file} neither runs requireWritable nor says why it does not`,
    )
  }
})

test('the modules that skip the check are exactly the three that should', () => {
  const modules = actionModules(APP)

  const enforcing = modules.filter((file) => /requireWritable\(/.test(read(file)))
  const exempt = modules.filter((file) => !/requireWritable\(/.test(read(file)))

  assert.deepEqual(exempt, Object.keys(EXEMPT).sort())

  // Named rather than counted, so a module that quietly stops enforcing shows up as
  // itself. These are the writes a lapsed subscription has to stop: attendance, marks,
  // money in and money out, what the centre agrees to pay its people and the salaries it
  // actually hands over, messages, and the whole of settings.
  assert.deepEqual(enforcing, [
    'src/app/(app)/exams/actions.ts',
    'src/app/(app)/expenses/actions.ts',
    'src/app/(app)/fees/actions.ts',
    'src/app/(app)/notices/actions.ts',
    'src/app/(app)/payroll/actions.ts',
    // A salary is the one write here that cannot be undone: `salary_payments` revokes
    // DELETE, so a payment let through after a subscription lapsed is permanent.
    'src/app/(app)/payroll/pay/actions.ts',
    'src/app/(app)/progress/actions.ts',
    'src/app/(app)/settings/actions.ts',
    // Opening a branch raises the organisation's own monthly bill, so a lapsed
    // subscription adding buildings would be a centre growing what it owes us while it
    // is not paying. The head-office check in that module is a separate question.
    'src/app/(app)/settings/branches/actions.ts',
    // An appointment can mint a login, and a login with a membership behind it is a
    // person who can reach a lapsed centre's roster and money. Nothing about the centre
    // owing us fees makes handing out new keys the right write to let through.
    'src/app/(app)/settings/managers/actions.ts',
    'src/app/(app)/settings/staff/actions.ts',
    'src/app/(app)/teach/[batchId]/actions.ts',
  ])
})

test('the check is written to fail closed', () => {
  const source = read('src', 'lib', 'auth', 'session.ts')
  const body = source.slice(source.indexOf('export function requireWritable'))

  // `!== 'full'` and not `=== 'read_only'`, for the reason ACCESS_BY_STATUS is a total
  // lookup rather than a two-way test: a third value added to Access one day must
  // refuse writes until somebody decides it should not, and the equality form would
  // hand it full access silently.
  assert.match(body.slice(0, 400), /access !== 'full'/)
  assert.doesNotMatch(body.slice(0, 400), /=== 'read_only'/)
})

test('the read-only sentence is written in one place', () => {
  // Every module's guard reaches its refusal through `authRefusal`, which is what makes
  // read-only outrank the module's own "you are not allowed" line. A module composing
  // the sentence itself would be a module that could get the precedence wrong.
  const users = actionModules(APP).filter((file) => /readOnly\.refused/.test(read(file)))
  assert.deepEqual(users, [])
  assert.match(read('src', 'lib', 'auth', 'session.ts'), /d\.readOnly\.refused/)
})

test('so is the narrowed-membership sentence, and for the same reason', () => {
  // The other code `authRefusal` answers itself (MASTERPLAN.md §6.2). A module reaching
  // for `capabilities.refused` would be a module deciding which of the two refusals wins,
  // in the seventh place that decision is made.
  const users = actionModules(APP).filter((file) => /capabilities\.refused/.test(read(file)))
  assert.deepEqual(users, [])
  assert.match(read('src', 'lib', 'auth', 'session.ts'), /d\.capabilities\.refused/)
})

test('pageGuard handles every AuthError code', () => {
  // A page never runs the write check — read-only means the screens stay — but the
  // switch is exhaustive over the code union, and a case dropped from it would compile
  // into a guard that returns undefined for a live error.
  const source = read('src', 'lib', 'auth', 'session.ts')
  const guard = source.slice(source.indexOf('async function pageGuard'))

  const codes = [
    'forbidden',
    'no_center',
    'unauthenticated',
    'unreadable',
    'read_only',
    'narrowed',
  ]
  for (const code of codes) {
    assert.match(guard.slice(0, 1800), new RegExp(`case '${code}':`), code)
  }

  // And the union has no seventh, because the switch above is only exhaustive against the
  // list it was written for. Read off the constructor rather than counted.
  const union = source.slice(source.indexOf('export class AuthError'))
  const declared = [...union.slice(0, 400).matchAll(/\| '(\w+)'/g)].map((m) => m[1])
  assert.deepEqual(declared.sort(), [...codes].sort())
})

/**
 * The write check only reaches `(app)`, and the walk above only looks there. One write in
 * this product spends money the moment it succeeds — queueing an SMS debits credits — so
 * the question of where that write may live is asked here rather than left to the walk.
 *
 * IT IS ASKED ABOUT THE QUEUE AND NOT ABOUT THE WORKER. `claim_sms_batch` has no centre
 * filter on purpose (20260811000016): credits are spent when a message is queued, so a
 * centre suspended in the minutes before the cron ran has already paid for what is
 * sitting there, and refusing to deliver it would be keeping the money and the message
 * both. The gate belongs where the money moves, which is why this test names the
 * insert sites and says nothing about the drain.
 */
test('the only thing that queues an SMS is inside the write check', () => {
  const writers = sourceFiles(path.join(ROOT, 'src')).filter((file) =>
    /\.from\('sms_logs'\)\s*\.insert\(/.test(read(file)),
  )

  // Named, not counted: a second queue writer is only safe if it is somewhere the write
  // check reaches, and deciding that is not something a passing test should do quietly.
  assert.deepEqual(writers, ['src/app/(app)/exams/actions.ts'])
  assert.match(read(writers[0]), /requireWritable\(/)
})

test('the banner explains what the refusal only names', () => {
  // The form-level sentence points at the shell, so the shell has to be the thing that
  // carries the whole explanation — both statuses, and a way to act on it.
  const shell = read('src', 'components', 'app-shell.tsx')

  assert.match(shell, /session\.access === 'read_only'/)
  // Gated on `active` as well: entitlement fails closed for a reader with no centre,
  // and without this an account midway through onboarding is told its centre lapsed.
  assert.match(shell, /session\.active && session\.access === 'read_only'/)
  assert.match(shell, /cancelledTitle/)
  assert.match(shell, /suspendedTitle/)
  // print:hidden, like the header and the nav. A receipt handed to a parent is not the
  // place to tell them the centre owes us money.
  assert.match(shell, /border-late\/40 bg-late\/5 px-4 py-3 print:hidden/)
})

/* -------------------------------------------------------------------------- */
/* The other half: which screens ask before drawing a form                    */
/* -------------------------------------------------------------------------- */

const SRC = path.join(ROOT, 'src')
/** Absolute path in, CRLF out — a `\n` anchor in a CRLF file silently matches nothing. */
const readAt = (file: string) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/** Every module that refuses a lapsed centre, discovered rather than listed. */
const GUARDED = new Set(actionModules(APP).filter((file) => /requireWritable\(/.test(read(file))))

/** An import specifier as written, resolved to a file on disk, or null if it leaves src. */
function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Every module a screen pulls in, transitively — because the action is almost never
 * imported by the page. `settings/students/new/page.tsx` renders `./student-form`, and the
 * form is what imports `createStudent`. A walk one level deep would find nothing on the
 * screens that matter most.
 *
 * WHAT IT CANNOT SEE, and it is a real gap rather than an oversight: a screen whose only
 * door to a write is a `<Link>` imports nothing guarded, so the roster — whose New button,
 * paste-box tile and per-row Edit all lead somewhere else — is not in the set below. The
 * alternative rule, "every screen that links to a write screen must ask", would flag the
 * dashboard for linking to fees, which is not a defect: the screen at the end of that link
 * explains itself. So link-only doors are held by their own screens' tests — see
 * students-roster.test.ts, "a lapsed centre keeps the list and loses all three doors".
 */
function closure(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const m of readAt(file).matchAll(/from '([^']+)'/g)) {
      const next = resolveImport(file, m[1])
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return [...seen].map(rel)
}

const PAGES = sourceFiles(APP).filter((f) => f.endsWith('/page.tsx'))

/** The screens that can reach a write a lapsed centre would be refused. */
const WRITE_SCREENS = PAGES.filter((file) =>
  closure(path.join(ROOT, file)).some((dep) => GUARDED.has(dep)),
)

/**
 * The sweep, screen by screen, and the list only ever shrinks.
 *
 * Every name here draws a control whose action `requireWritable` refuses, without first
 * asking whether the centre can save — so the form is drawn, filled in, and refused. They
 * are listed rather than tolerated in bulk so that a screen cannot join them silently: a
 * new form wired to a guarded action fails this gate on the day it is written, which is
 * the only day its author is holding the context needed to fix it.
 *
 * NOTHING MAY BE ADDED TO THIS LIST. A screen leaves it by branching on `session.access`.
 */
const PENDING: string[] = [
  'src/app/(app)/exams/[examId]/page.tsx',
  'src/app/(app)/fees/arrears/page.tsx',
  'src/app/(app)/fees/charge/page.tsx',
  'src/app/(app)/fees/page.tsx',
  'src/app/(app)/fees/reminders/page.tsx',
  'src/app/(app)/fees/scholarships/page.tsx',
  'src/app/(app)/notices/page.tsx',
  'src/app/(app)/progress/page.tsx',
  'src/app/(app)/settings/batches/[batchId]/page.tsx',
  'src/app/(app)/settings/branches/page.tsx',
  'src/app/(app)/settings/center/page.tsx',
  'src/app/(app)/settings/exam-types/page.tsx',
  'src/app/(app)/settings/managers/page.tsx',
  'src/app/(app)/settings/sms/page.tsx',
  'src/app/(app)/settings/staff/page.tsx',
  'src/app/(app)/settings/subjects/page.tsx',
  'src/app/(app)/settings/teachers/page.tsx',
  'src/app/(app)/teach/[batchId]/page.tsx',
]

test('every screen that can reach a guarded write asks whether the centre may save', () => {
  // Sanity, for the reason the walk above has one: a discovery that quietly found nothing
  // would pass every screen in the app.
  assert.ok(WRITE_SCREENS.length >= 20, `only ${WRITE_SCREENS.length} screens reach a write`)

  const asks = (file: string) => /session\.access\s*(?:===|!==)/.test(read(file))

  const offenders = WRITE_SCREENS.filter((f) => !asks(f) && !PENDING.includes(f)).sort()
  assert.deepEqual(offenders, [], 'these screens draw a form a lapsed centre cannot save')

  // And the list is a debt, not a shape: a name that has been fixed comes off it, or the
  // next reader learns nothing from what is left.
  const settled = PENDING.filter((f) => asks(f)).sort()
  assert.deepEqual(settled, [], 'these screens now ask, so they no longer belong in PENDING')

  // A name that no longer names a screen reaching a write is stale the other way — the
  // route was renamed or the form moved — and would go on excusing nothing.
  const stale = PENDING.filter((f) => !WRITE_SCREENS.includes(f)).sort()
  assert.deepEqual(stale, [], 'these PENDING entries no longer name a write screen')
})

test('the screens that ask do it with the standing, not with a role', () => {
  /*
   * The mistake this catches is one already in this codebase: `fees/page.tsx` gates its
   * write controls on `isStaffAdmin(session)`, which is a role, and a role answers a
   * different question — an owner of a lapsed centre is a staff admin all day.
   *
   * So a screen that consults `access` must compare it against the union's own members.
   * `access` is `'full' | 'read_only'`; a typo compares against a string it can never be,
   * and TypeScript is happy because both sides are strings.
   */
  for (const file of WRITE_SCREENS) {
    for (const m of read(file).matchAll(/\.access\s*(?:===|!==)\s*'([^']*)'/g)) {
      assert.ok(
        m[1] === 'full' || m[1] === 'read_only',
        `${file}: compares access against '${m[1]}', which it can never be`,
      )
    }
  }
})

/* -------------------------------------------------------------------------- */
/* What is drawn where the form was                                           */
/* -------------------------------------------------------------------------- */

const NOTE = read('src', 'components', 'read-only-note.tsx')
/** The same file with its prose taken off: a docblock naming a class is not that class. */
const NOTE_CODE = NOTE.replace(/\/\*[\s\S]*?\*\//g, '')

test('the note is one sentence of furniture, not a second alert', () => {
  // A server component: this is furniture, and a directive here would pull it into the
  // client bundle on every screen that draws it.
  assert.doesNotMatch(NOTE_CODE, /use client/)

  // `Dictionary['readOnly']` and not a pair of strings, so a caller passes `d.readOnly`
  // and cannot hand it the wrong two sentences.
  assert.match(NOTE, /t: Dictionary\['readOnly'\]/)
  assert.match(NOTE, /\{t\.noFormTitle\}/)
  assert.match(NOTE, /\{t\.noFormBody\}/)

  /*
   * NEITHER TINTED NOR AN ALERT, and that is the decision most likely to be "fixed" by a
   * later pass. The shell's banner at the top of the same screen is the alert: it says
   * which of the two states this is, when the coverage ran out, and what to do — with the
   * buttons. A second red box for the same fact reads as two separate things going wrong,
   * and §4.4's one-ask-per-screen rule is the one that holds the trial notice back while
   * that banner is up.
   */
  assert.doesNotMatch(NOTE_CODE, /role="alert"/)
  assert.doesNotMatch(NOTE_CODE, /aria-live/)
  assert.doesNotMatch(NOTE_CODE, /border-late|bg-late|text-late/)
  assert.match(NOTE_CODE, /rounded-2xl border border-line bg-surface-alt/)

  // And it names no date and no state: the banner above does both, and this one sentence
  // is drawn on a dozen screens whose reader already knows which one they opened.
  assert.doesNotMatch(NOTE_CODE, /paidThrough|trialEndsAt|status ===/)
})

test('every screen that draws the note draws the shared one', () => {
  const drawn = sourceFiles(SRC).filter((f) => /<ReadOnlyNote\b/.test(read(f)))
  assert.ok(drawn.length >= 3, `only ${drawn.length} screens draw the note`)

  for (const file of drawn) {
    const source = read(file)
    assert.match(
      source,
      /import \{ ReadOnlyNote \} from '@\/components\/read-only-note'/,
      `${file}: draws the note without importing it`,
    )
    // The whole dictionary group, so the two sentences travel together.
    assert.match(source, /<ReadOnlyNote t=\{d\.readOnly\}/, `${file}: passes the note something else`)
    // Capped, because it stands where a form stood and 1,216px of one sentence is not a
    // paragraph anybody reads. On the note and not on the column that holds the bar — see
    // page-header.test.ts for what a capped column does to that bar's background.
    assert.match(
      source,
      /<ReadOnlyNote t=\{d\.readOnly\} className="max-w-2xl" \/>/,
      `${file}: the note is not capped`,
    )
  }
})

test('both languages say it, and neither suggests the records are gone', () => {
  for (const [name, dict] of [['en', en], ['bn', bn]] as const) {
    const t = dict.readOnly
    for (const [key, least] of [['noFormTitle', 20], ['noFormBody', 90]] as const) {
      assert.equal(typeof t[key], 'string', `${name}.readOnly.${key} is missing`)
      assert.ok(
        t[key].trim().length >= least,
        `${name}.readOnly.${key} is ${t[key].trim().length} characters — too short to say it`,
      )
    }

    // The half of §4.4 a reader panics about: nothing recorded has changed, and all of it
    // still reads. A sentence that left that out would have an owner believe the term's
    // register had been taken away over an unpaid bill.
    assert.match(
      t.noFormBody,
      /still reads|দেখা যাবে/,
      `${name}.readOnly.noFormBody does not say the records are still there`,
    )

    // And the title points up rather than repeating what the banner already dated.
    assert.doesNotMatch(
      t.noFormTitle,
      /\d/,
      `${name}.readOnly.noFormTitle names a figure the banner above already names`,
    )
  }
})

/* -------------------------------------------------------------------------- */
/* Where in the screen the question is asked                                  */
/* -------------------------------------------------------------------------- */

/** The screens that answer a lapsed centre with a whole arm rather than a hidden button. */
const ARMED = PAGES.filter((f) => read(f).includes("if (session.access !== 'full') {"))

test('the arm names the one standing that may write, and not the one that may not', () => {
  /*
   * `requireWritable` is written `access !== 'full'` and deliberately not
   * `=== 'read_only'`, so a third `Access` value would be refused rather than admitted.
   * A screen written the other way round is the same fail-open one layer up — and it
   * would also drop out of `ARMED` above, taking the ordering rule below with it.
   *
   * The `if` is what makes this a decision. `settings/plan/page.tsx` reads
   * `access === 'read_only'` to pick a badge colour, which is a tone and not a refusal.
   */
  for (const file of PAGES) {
    assert.doesNotMatch(
      read(file),
      /if \([^)]*access\s*===\s*'read_only'/,
      `${file}: refuses on the state that may not write instead of the one that may`,
    )
  }
})

test('the arm is written above every read it would otherwise pay for', () => {
  assert.ok(ARMED.length >= 8, `only ${ARMED.length} screens return early on standing`)

  /*
   * Standing comes off the session, so this arm never needs a query to know it applies —
   * which makes a read above it pure waste, charged to the centre least able to use the
   * answer. Supabase auto-pauses on the free tier and these screens run four reads each,
   * so "wasted" is not academic: a lapsed centre browsing the product it cannot write to
   * is exactly the traffic worth not serving.
   *
   * It is also the ordering that keeps the arm honest. Below the reads, an arm sits after
   * the dropped-read and empty-list cards, so whichever of those fires first answers a
   * reader whose real answer is this one.
   *
   * A permission gate above it is not a read this rule can see, and is meant to be there:
   * `canManageExams()` on the two exam screens asks whether this reader may be here at
   * all, which is a different and earlier question than whether the centre may save.
   */
  for (const file of ARMED) {
    const source = read(file)
    const arm = source.indexOf("if (session.access !== 'full') {")
    for (const marker of [".from('", 'await Promise.all', 'supabase.rpc(']) {
      const first = source.indexOf(marker)
      if (first === -1) continue
      assert.ok(arm < first, `${file}: \`${marker}\` runs for a centre that cannot write`)
    }
  }
})

test('a lapsed centre is asked for the bill before it is offered a bigger plan', () => {
  /*
   * §4.4's one-ask-per-screen rule, in the one place two arms both want to talk about the
   * plan. `settings/teachers/new` and `settings/staff/new` refuse a teacher-tier centre
   * with an upsell to Coaching Center; a lapsed centre reaching the same screen would be
   * sold a tier while the subscription it already has is the thing that stopped. Places
   * and seats bought on a lapsed subscription are capacity nobody can use until the bill
   * is settled, so the bill is the one ask worth making — the same call the shell makes
   * when it suppresses the trial notice behind the read-only banner.
   */
  for (const file of ARMED) {
    const source = read(file)
    const upsell = source.indexOf('PLANS.center')
    if (upsell === -1) continue
    assert.ok(
      source.indexOf("if (session.access !== 'full') {") < upsell,
      `${file}: sells a bigger plan to a centre that has not paid for this one`,
    )
  }
})
