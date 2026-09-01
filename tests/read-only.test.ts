import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

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
