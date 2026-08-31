import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Every service-role write says who asked for it, or says why nobody did.
 *
 * MASTERPLAN.md §10 wants an actor on "capacity purchases · plan changes · permission
 * changes · login accounts created", and migration 46's trigger reads `auth.uid()` to get
 * one. A service-role request carries no JWT, so `auth.uid()` is null and every one of
 * those writes lands anonymous — the exact rows §10 names are the ones our own server
 * makes with the service key. Migration 56 added the third source: the `x-app-actor`
 * header, which `createAdminClient(actor)` sends.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION. Passing the actor is one optional argument at
 * eleven call sites, and a twelfth added next month with the argument left off produces no
 * error, no failing gate and no visible symptom — just a plan change in the log with
 * nobody's name on it, discovered during the support conversation the log exists for. So
 * the rule is held structurally, the way tests/read-only.test.ts holds the write check:
 * EVERY `createAdminClient()` CALL EITHER NAMES A HUMAN OR CARRIES AN `actor-less:`
 * REASON, and the set of reasoned ones is pinned.
 *
 * The `actor-less:` marker is check-scoping.mjs's `scoped-by:` idiom, chosen so a reason
 * survives the line moving.
 */

const ROOT = path.join(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')

/** Repo-relative, POSIX-slashed, so the pins below read the same on both platforms. */
function rel(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/')
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

type Call = { file: string; line: number; named: boolean; reason: string | null }

/**
 * Every call to createAdminClient outside its own module.
 *
 * `ReturnType<typeof createAdminClient>` is skipped by requiring the paren: that is a type
 * position, and there is no request to attribute. The import line is skipped the same way.
 */
function adminCalls(): Call[] {
  const out: Call[] = []

  for (const full of sources(SRC)) {
    const file = rel(full)
    if (file === 'src/lib/supabase/admin.ts') continue

    const lines = readFileSync(full, 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      // Prose that names the function is not a call: founder/actions.ts's own header
      // explains why it uses one, `createAdminClient()` and all.
      const trimmed = text.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return

      const call = /createAdminClient\(([^)]*)\)/.exec(text)
      if (!call) return

      // The nearest comment above, blank lines allowed between marker and call the way
      // check-scoping.mjs allows none — here a `//` block often ends where a paragraph
      // does, so the search walks up through comment lines only and stops at code.
      let reason: string | null = null
      for (let j = i - 1; j >= 0; j -= 1) {
        const above = lines[j].trim()
        if (above === '') continue
        if (!above.startsWith('//') && !above.startsWith('*')) break
        const marked = /actor-less:\s*(.+)/.exec(above)
        if (marked) {
          reason = marked[1].trim()
          break
        }
      }

      out.push({ file, line: i + 1, named: call[1].trim() !== '', reason })
    })
  }

  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

/**
 * The two calls that write with no human behind them, and why each has to.
 *
 * Not a list to shorten: naming somebody at either of these would be a lie about who did
 * it. A third entry means a third genuine machine, and writing the reason down is the
 * price of adding one.
 */
const ACTOR_LESS = [
  // The queue worker. `actor_role = 'service_role'` with a null actor is the truth.
  'src/app/api/cron/sms/route.ts',
  // Signup, where the account being created is the actor and does not exist yet. Nothing
  // audited is written: the trigger behind this writes `profiles`, which migration 46
  // does not watch.
  'src/app/(auth)/actions.ts',
].sort()

test('every service-role client either names its actor or explains itself', () => {
  const calls = adminCalls()

  // Vacuous-pass guard, the same one read-only.test.ts opens with.
  assert.ok(calls.length >= 10, `found only ${calls.length} createAdminClient calls`)

  for (const call of calls) {
    if (call.named) continue
    assert.ok(
      call.reason !== null,
      `${call.file}:${call.line} creates a service-role client with no actor and no ` +
        `\`// actor-less: <reason>\` above it. Pass the session user's id, or write down ` +
        `why the write has no human behind it.`,
    )
    // A marker with nothing after it is a way to pass this test without answering it.
    assert.ok(
      (call.reason ?? '').length >= 8,
      `${call.file}:${call.line} has an actor-less marker with no reason in it`,
    )
  }
})

test('the calls that name nobody are exactly the two machines', () => {
  const anonymous = [...new Set(adminCalls().filter((c) => !c.named).map((c) => c.file))].sort()
  assert.deepEqual(anonymous, ACTOR_LESS)
})

test('the human-facing modules are all still in the set that names an actor', () => {
  const named = [...new Set(adminCalls().filter((c) => c.named).map((c) => c.file))].sort()

  // Named rather than counted, so a module that quietly stops passing an actor shows up as
  // itself. These are §10's own list: money the centre pays us, the plan and capacity it
  // buys, the logins it hands out, and the credits it spends.
  assert.deepEqual(named, [
    'src/app/(app)/exams/actions.ts',
    'src/app/(app)/settings/actions.ts',
    'src/app/founder/actions.ts',
  ])
})

test('the actor is optional at the boundary and sent only when present', () => {
  const source = readFileSync(path.join(SRC, 'lib', 'supabase', 'admin.ts'), 'utf8')

  assert.match(source, /createAdminClient\(actor\?: string\)/)
  assert.match(source, /'x-app-actor'/)
  // Spread on a conditional rather than `{ 'x-app-actor': actor! }`: an undefined actor
  // must send no header at all, because a header reading "undefined" is a malformed uuid
  // where migration 56 expects either a real one or nothing.
  assert.match(source, /\.\.\.\(actor \?/)
})

test('the header can only fill a null, never outrank a session', () => {
  const migration = readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '20260811000056_audit_actor_header.sql'),
    'utf8',
  )

  // The whole security argument is this ordering: a request carrying a JWT is recorded as
  // that JWT's user, and the header it also carries is never reached. Reversed, any holder
  // of the anon key could stamp a write with somebody else's id.
  // No `s` flag: `[^;]` already crosses newlines, and the flag needs an es2018 target.
  const coalesce =
    /coalesce\(\s*auth\.uid\(\),\s*nullif\([^)]*'app\.actor'[^;]*?app\.request_actor\(\)\s*\)/
  assert.match(migration, coalesce)

  // A malformed header costs the attribution, not the payment.
  assert.match(migration, /exception\s*\n\s*when others then\s*\n\s*return null/)

  // Reachable only with the service key. Without this revoke, `authenticated` could call
  // the function directly — harmless in itself, but the grant is what a later RPC would
  // inherit.
  assert.match(
    migration,
    /revoke all on function app\.request_actor\(\) from public, anon, authenticated/,
  )
})
