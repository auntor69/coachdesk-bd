import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The nightly settle, as §11.7 and §11.13 wrote it.
 *
 * READINGS RATHER THAN CALLS. The route cannot be imported here — it pulls the service-role
 * client, which imports `server-only`, which throws outside a request — so what is pinned is
 * the source, the way `tests/purchases.test.ts` pins the provider layer. Every assertion
 * below is a rule from the plan that a later edit could break silently: an endpoint that
 * falls open when its secret is missing, a second calculation of the burn, a log line that
 * grows a field it must never carry.
 */

const ROOT = path.join(import.meta.dirname, '..')

const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8')

const ROUTE = 'src/app/api/cron/settle/route.ts'

const route = read(ROUTE)
const settlement = read('src/lib/billing/settlement.ts')

/** The body of one `function name(` … `}` block, by brace matching from its first line. */
function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature)
  assert.ok(start > -1, `not found: ${signature}`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`unterminated: ${signature}`)
}

test('the schedule names this route and this route exists', () => {
  // vercel.json cannot hold a comment, so the reasoning for the hour is in the route's
  // docblock: 18:10 UTC is 00:10 in Dhaka, ten minutes after the day flips. An edit here
  // that moves the hour is an edit to when every centre's day is charged.
  const crons = JSON.parse(read('vercel.json')).crons as { path: string; schedule: string }[]

  const entry = crons.find((cron) => cron.path === '/api/cron/settle')
  assert.ok(entry, 'the settle cron is scheduled')
  assert.equal(entry.schedule, '10 18 * * *')
  assert.equal(entry.schedule.split(' ').length, 5, 'a cron expression, not a guess')

  // And the other direction, for every entry: a path with no route is a job that 404s every
  // night and reports nothing, which is the failure a schedule file cannot show you.
  for (const cron of crons) {
    const file = path.join(ROOT, 'src/app', `${cron.path}/route.ts`)
    assert.ok(existsSync(file), `${cron.path} has a route`)
  }
})

test('the endpoint refuses everything when the secret is not set', () => {
  // The direction that ends up in a postmortem is the other one — no secret set, so allow
  // anyone — and this endpoint writes ledger rows.
  assert.match(route, /const secret = process\.env\.CRON_SECRET/)
  assert.match(route, /if \(!secret\) return false/)
  assert.ok(!/return true/.test(route), 'no path falls open')

  // Constant time, and hashed first because `timingSafeEqual` throws on unequal lengths —
  // comparing raw secrets would leak the length through that exception.
  assert.match(route, /createHash\('sha256'\)/)
  assert.match(route, /timingSafeEqual\(digest\(offered\), digest\(secret\)\)/)

  // Nothing tells a caller which half was wrong, and there is no interactive login to offer.
  assert.match(route, /unauthorized/)
  assert.ok(!/WWW-Authenticate/.test(route))
})

test('it asks the session path’s own function, and holds no second calculation', () => {
  assert.match(route, /import \{ settleDay \} from '@\/lib\/billing\/settlement'/)

  // One call site, and the caller is the machine's word for itself.
  const calls = route.match(/settleDay\(/g) ?? []
  assert.equal(calls.length, 1, 'one call to the shared helper')
  assert.match(route, /await settleDay\(db, centre\.id, 'system'\)/)

  // No call built here, no RPC named here, no arithmetic: §11.13's rule is that a nightly
  // figure and an on-use figure out of two implementations are two billing engines.
  assert.ok(!/\.rpc\(/.test(route), 'the route does not call PostgREST itself')
  assert.ok(!/p_ran_by/.test(route), 'and does not build a call')
  assert.ok(!/'settle_billing'/.test(route), 'the RPC name belongs to one file')

  // Which is this one, and it is the only place the name is pinned.
  const rpcNames = settlement.match(/fn: 'settle_billing'/g) ?? []
  assert.equal(rpcNames.length, 1, 'one cast, one parse, one implementation')
  assert.match(settlement, /ranBy: SettleCaller = 'session'/, 'the session is the default')
  assert.match(settlement, /export type SettleCaller = 'session' \| 'system' \| 'founder'/)
})

test('the free tier is skipped by the shared rule and not by a plan name', () => {
  assert.match(route, /import \{ burnsMoney \} from '@\/lib\/entitlement'/)
  assert.match(route, /if \(!burnsMoney\(centre\.plan\)\) continue/)

  // A hard-coded plan id here would be the second copy of a money rule that `burnsMoney`
  // exists to prevent: the day the free tier gained a rate, one of the two would keep
  // skipping it.
  assert.ok(!/teacher_free/.test(route), 'the rule is not restated as a plan name')
  assert.match(read('src/lib/entitlement.ts'), /export function dailyBurn[\s\S]{0,80}return burnsMoney\(org\.plan\)/)
})

test('the log line is §11.13’s four fields and nothing that is a customer’s', () => {
  const log = bodyOf(route, 'function logFailure(')

  for (const field of ['centre=', 'date=', 'status=', 'sqlstate=']) {
    assert.ok(log.includes(field), `logs ${field}`)
  }

  // Exactly four interpolations: a fifth would be a field the plan does not allow there.
  const interpolations = log.match(/\$\{[^}]*\}/g) ?? []
  assert.equal(interpolations.length, 4, `four fields, got ${interpolations.join(', ')}`)

  // The four things §11.13 forbids in a log, anywhere in the line or the values it takes.
  for (const forbidden of ['balance', 'phone', 'student', 'guardian', 'provider_ref', 'trx']) {
    assert.ok(!log.toLowerCase().includes(forbidden), `no ${forbidden} in a log line`)
  }

  // And the response cannot carry one either — Vercel keeps it. Read as the field list
  // rather than by grepping the prose, which is the trap this test file already fell into
  // once: a comment explaining what a field must never be is not that field.
  const summary = route.slice(route.indexOf('type Summary = {'))
  const summaryBody = summary.slice(0, summary.indexOf('\n}'))
  // Two spaces of indent is a field of the type; one of them, `ok`, is not optional.
  const fields = [...summaryBody.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1])
  assert.deepEqual(
    [...fields].sort(),
    ['asked', 'centres', 'dry', 'failed', 'left', 'ms', 'nothingDue', 'ok', 'reason', 'settled'],
  )
})

test('a run cannot outlive its host', () => {
  // The budget exists because serverless functions are killed rather than paused, and the
  // ceiling because a database that answers in a millisecond would let one run walk a whole
  // country inside the budget.
  assert.match(route, /const BUDGET_MS = 6_000/)
  assert.match(route, /const ROW_CEILING = 500/)
  assert.match(route, /if \(performance\.now\(\) - startedAt > BUDGET_MS\) break/)

  // The stalest line first: a run that stops short must have served the centres nobody has
  // settled in longest, or a big fleet starves its tail.
  assert.match(route, /\.order\('charged_through', \{ ascending: true, nullsFirst: true \}\)/)

  // Same reason as the SMS worker: a `maxDuration` export raises the ceiling on a plan that
  // allows it and fails the deployment on a plan that does not.
  assert.ok(!/export const maxDuration/.test(route), 'no route segment config')

  assert.match(route, /'Cache-Control': 'no-store'/)
})

test('both verbs are one run', () => {
  // Vercel Cron issues GET; POST is the alias pg_net and curl want. Two verbs, one `handle`,
  // because two ways to settle is one way too many.
  const handles = route.match(/return handle\(request\)/g) ?? []
  assert.equal(handles.length, 2, 'GET and POST both delegate')
  assert.match(route, /async function handle\(request: NextRequest\)/)
})

test('the machine leaves no actor behind it', () => {
  // A service-role request carries no JWT, so an actor header would be invented; the honest
  // record is `ran_by = 'system'` on the run row, which the database writes from its own
  // check constraint.
  assert.match(route, /createAdminClient\(\)/)
  assert.ok(!/createAdminClient\([^)]/.test(route), 'no actor is passed')
  assert.match(read('src/lib/supabase/admin.ts'), /Leave it out for a machine/)
})

test('the session path reads the same attempt, and it is not a second parse', () => {
  // `settleDay` answers with the settlement *and* the two fields only a log reads. The
  // session destructures what it needs rather than asking again, which is what keeps a
  // single call shape between the cron and every page load.
  assert.match(read('src/lib/auth/session.ts'), /const \{ settlement: settled \} = await settleDay\(/)
  assert.match(settlement, /export type SettlementAttempt = \{/)
})
