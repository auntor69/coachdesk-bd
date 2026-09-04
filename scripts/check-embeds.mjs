/**
 * Asks the live PostgREST API to resolve every select the app sends.
 *
 * Why this exists: PostgREST does not read our code, it reads pg_constraint. It
 * decides what `batches (name)` means by looking for a foreign key between the
 * two tables. 20260811000005 dropped all 36 of those foreign keys and replaced
 * them with composite ones on (sibling_id, coaching_center_id), which changes
 * both their names and their shape.
 *
 * That leaves a specific, plausible failure: coaching_center_id now takes part
 * in several foreign keys on the same table — batches alone has four — and if
 * PostgREST cannot decide which one an embed means, it answers PGRST201
 * ("more than one relationship found") and the page renders empty. RLS would
 * still be intact; the screen would just be blank, which is the kind of bug that
 * looks like a data problem for a day before anyone suspects a constraint.
 *
 * A type check cannot catch it and the RLS suite cannot either — both talk to
 * Postgres directly, and this is the layer above. So ask the real API.
 *
 * Plain column lists are asked too, not only embeds. `tsc` checks them against
 * src/lib/supabase/types.ts, which is a file — generated from the database at some
 * point in the past, by somebody, on some branch. If a migration has been written
 * and not pushed, or pushed and not regenerated, the compiler is validating the app
 * against a fiction while live PostgREST answers 400. This is the only gate that
 * asks the database the app will actually talk to.
 *
 * THE LIST IS DERIVED, WHICH IS THE POINT. It used to be hand-typed, and by the time
 * anyone looked it had rotted exactly the way a hand-typed list of things to check
 * rots: six embeds had been added and never registered, every select whose columns
 * live in a `const COLUMNS = '…'` was invisible to it — which is the whole of the
 * export feature and both at-risk screens — and two entries had drifted from the code
 * they claimed to check, so the check went on passing against strings the app no
 * longer sent. One of those two was the busiest embed in the app, registered with
 * three of the five permission columns it reads. A checker that is quietly checking
 * the wrong thing is worse than no checker, because it is also a claim.
 *
 * So every select is read out of src/ at run time: the chain is parsed from its
 * `.from()`, the `.select()` argument is taken as written, and a select whose columns
 * are an identifier is resolved back to the `const` that defines it. Anything that
 * cannot be resolved fails the run rather than being skipped — see `unresolved`.
 *
 * WHAT TO LOOK AT FIRST WHEN THIS FAILS. In rough order of how badly the app breaks:
 *
 *   center_members -> coaching_centers, and teachers -> teacher_permissions, both in
 *   lib/auth/session.ts. Those two rows answer which batches /teach calls theirs,
 *   whether the fee board is drawn, whether the marks sheet is editable and whether
 *   the SMS button appears. An embed PostgREST could not resolve would answer "no
 *   batches" and "no permission" to all of it rather than failing loudly.
 *
 *   exam_results -> enrollments -> students -> guardians, in lib/sms/result-dispatch.
 *   Three hops, and the last one is the guardian phone number a result SMS is sent
 *   to. This is the one embed in the app that spends money when it resolves.
 *
 *   teachers in settings/teachers/page.tsx, which reaches teachers three ways at
 *   once and includes teacher_subjects — a junction table PostgREST may try to
 *   collapse into an implicit many-to-many.
 *
 *   Any of the four views (fee_invoice_balances, student_risk, student_progress_week,
 *   batch_attendance_monthly). These carry no embeds and are asked anyway, because
 *   PostgREST serves a view through the same schema cache as a table: a view added by
 *   a migration stays invisible to the API until that cache reloads, and the failure
 *   looks like a 404 on a relation that plainly exists in psql.
 *
 * Uses the anon key, so RLS applies and every response is legitimately empty:
 * we are checking that the *relationship resolves*, not that rows come back.
 * A select PostgREST cannot parse fails with 400 before RLS is consulted, which
 * is exactly the signal we want.
 *
 * Run: node --env-file=.env.local scripts/check-embeds.mjs
 */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { literalSelect, normalizeSelect, queriesIn, selectArg, sourceFiles } from './lib/query-chains.mjs'

const ROOT = process.cwd()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.')
  process.exit(1)
}

/* -------------------------------------------------------------------------- */
/* Reading the selects out of the app                                         */
/* -------------------------------------------------------------------------- */

const files = [
  ...sourceFiles(join(ROOT, 'src', 'app')),
  ...sourceFiles(join(ROOT, 'src', 'lib')),
]

const sources = new Map()
function read(file) {
  let src = sources.get(file)
  if (src === undefined) {
    src = readFileSync(file, 'utf8')
    sources.set(file, src)
  }
  return src
}

/** A quoted literal starting at `at`, quotes included, or null if none starts there. */
function readLiteral(src, at) {
  const quote = src[at]
  if (quote !== "'" && quote !== '"' && quote !== '`') return null
  for (let i = at + 1; i < src.length; i++) {
    if (src[i] === '\\') {
      i++
      continue
    }
    if (src[i] === quote) return src.slice(at, i + 1)
  }
  return null
}

/**
 * A list written as one list plus a column: `` const B = `${A}, extra` ``.
 *
 * `literalSelect` refuses a template with a hole in it, and is right to — a list built
 * from a value at run time is not a list this script can ask about. A hole that is
 * itself a module-level column list is the exception worth resolving, because writing
 * the second list as the first plus a column is what stops the two drifting: the replay
 * read-back in lib/billing/intents.ts is the intent columns plus `target_plan`, and
 * typing them out again would be the drift this gate exists to catch.
 *
 * Every hole must land. One that does not makes the whole list null, so it is reported
 * unresolved rather than asked as a half-filled string PostgREST would reject for the
 * wrong reason.
 */
function composedLiteral(src, raw, seen) {
  if (!raw || raw[0] !== '`') return null

  let out = ''
  let at = 1
  const body = raw.slice(0, -1)

  while (at < body.length) {
    const hole = body.indexOf('${', at)
    if (hole === -1) {
      out += body.slice(at)
      break
    }
    const close = body.indexOf('}', hole)
    if (close === -1) return null

    const name = body.slice(hole + 2, close).trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null
    const filled = resolveIdent(name, src, seen)
    if (filled === null) return null

    out += body.slice(at, hole) + filled
    at = close + 1
  }

  return normalizeSelect(out)
}

/**
 * The column list a `const NAME = '…'` holds, or null.
 *
 * Only a declaration whose value is a string literal, or a template composed of other
 * such declarations. `const COLUMNS = pick(x)` returns null and the caller reports it
 * unresolved, which is the honest answer — a list assembled at run time is not a list
 * this script can ask about.
 */
function constLiteral(src, name, { exported = false, seen } = {}) {
  const decl = new RegExp(
    `(?:^|\\n)\\s*${exported ? 'export\\s+' : '(?:export\\s+)?'}const\\s+${name}\\s*(?::[^=\\n]+)?=\\s*`,
    'g',
  )
  for (const match of src.matchAll(decl)) {
    const raw = readLiteral(src, match.index + match[0].length)
    const found = literalSelect(raw) ?? composedLiteral(src, raw, seen)
    if (found !== null) return found
  }
  return null
}

/**
 * An identifier resolved to its column list: this file first, then any export in src.
 *
 * This file first because the name is reused. Four screens define their own
 * `const COLUMNS` over three different relations, and resolving one of them against
 * another file's would be the drift this script exists to catch, committed by the
 * script itself.
 *
 * `seen` is what stops a list written in terms of itself spinning here forever.
 */
function resolveIdent(name, src, seen = new Set()) {
  if (seen.has(name)) return null
  // A copy, not an addition: two holes filled by the same list are fine, a list that
  // fills its own hole is not.
  const next = new Set(seen).add(name)

  const local = constLiteral(src, name, { seen: next })
  if (local !== null) return local
  for (const file of files) {
    const found = constLiteral(read(file), name, { exported: true, seen: next })
    if (found !== null) return found
  }
  return null
}

/** relation + select -> the call sites that send it. */
const shapes = new Map()
const unresolved = []
let callSites = 0

for (const file of files) {
  const src = read(file)
  if (!src.includes('.from(')) continue
  const where = relative(ROOT, file).split(sep).join('/')

  for (const query of queriesIn(src)) {
    const arg = selectArg(query.chain)

    // No select at all: an insert, update or delete. There is no shape to ask about
    // — a write's columns are checked by tsc against the Insert type, and asking
    // PostgREST about them would mean writing to the live project.
    if (arg === null) continue

    const site = `${where}:${query.line}`
    const select = literalSelect(arg) ?? (/^[A-Za-z_$][\w$]*$/.test(arg) ? resolveIdent(arg, src) : null)

    if (select === null) {
      unresolved.push({ site, relation: query.relation, arg: arg.replace(/\s+/g, ' ') })
      continue
    }

    callSites++
    const seenKey = `${query.relation}?${select}`
    const shape = shapes.get(seenKey)
    if (shape) shape.sites.push(site)
    else shapes.set(seenKey, { relation: query.relation, select, sites: [site] })
  }
}

if (unresolved.length > 0) {
  console.error(
    `\ncheck-embeds: ${unresolved.length} select(s) could not be read out of the source, `
      + 'so they cannot be\nchecked — and a check that silently skips things is a check '
      + 'nobody can rely on:\n',
  )
  for (const u of unresolved) {
    console.error(`  ${u.site}  ${u.relation}`)
    console.error(`      .select(${u.arg.slice(0, 120)})`)
  }
  console.error(
    '\nEither write the column list as a plain string literal, or move it to a'
      + '\nmodule-level `const NAME = \'…\'` that this can resolve. If it genuinely'
      + '\nhas to be built at run time, this script needs to learn about it on'
      + '\npurpose — do not leave it unasked.\n',
  )
  process.exit(1)
}

if (shapes.size === 0) {
  console.error(
    'check-embeds: found no selects in src/app or src/lib, which cannot be right.\n'
      + 'The chain parser in scripts/lib/query-chains.mjs has probably stopped\n'
      + 'matching — check it before trusting a green run.',
  )
  process.exit(1)
}

/* -------------------------------------------------------------------------- */
/* Asking the API                                                             */
/* -------------------------------------------------------------------------- */

const probes = [...shapes.values()]

async function ask(probe) {
  const endpoint = `${url}/rest/v1/${probe.relation}?select=${encodeURIComponent(probe.select)}&limit=1`
  const response = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (response.ok) return { ...probe, ok: true }
  const body = await response.json().catch(() => ({}))
  return { ...probe, ok: false, status: response.status, body }
}

// Eight at a time. Sequentially this is close to a hundred round trips to another
// continent, which is a slow enough gate that somebody starts skipping it; eight
// concurrent reads is nothing to PostgREST and keeps the whole run inside a few
// seconds.
const results = new Array(probes.length)
let next = 0
await Promise.all(
  Array.from({ length: Math.min(8, probes.length) }, async () => {
    for (let i = next++; i < probes.length; i = next++) results[i] = await ask(probes[i])
  }),
)

console.log(
  `check-embeds: ${probes.length} select shapes from ${callSites} call sites, `
    + 'asked of live PostgREST.\n',
)

const relations = [...new Set(probes.map((p) => p.relation))].sort()
for (const relation of relations) {
  const mine = results.filter((r) => r.relation === relation)
  const bad = mine.filter((r) => !r.ok).length
  const embedded = mine.filter((r) => r.select.includes('(')).length
  const shapeCount = `${mine.length} shape${mine.length === 1 ? '' : 's'}`
  const detail = embedded > 0 ? `${shapeCount}, ${embedded} embedded` : shapeCount
  console.log(
    bad === 0
      ? `  OK    ${relation.padEnd(24)} ${detail}`
      : `  FAIL  ${relation.padEnd(24)} ${detail} — ${bad} did not resolve`,
  )
}

const failures = results.filter((r) => !r.ok)
const passed = results.length - failures.length
console.log(`\n${passed}/${results.length} select shapes resolve against live PostgREST.`)

if (failures.length > 0) {
  for (const f of failures) {
    console.error(`\n  ${f.relation}  [${f.status} ${f.body.code ?? ''}]`)
    console.error(`      select: ${f.select}`)
    if (f.body.message) console.error(`      ${f.body.message}`)
    if (f.body.details) console.error(`      ${f.body.details}`)
    if (f.body.hint) console.error(`      hint: ${f.body.hint}`)
    for (const site of f.sites) console.error(`      read at ${site}`)
  }
  console.error(
    `
${failures.length} select(s) no longer resolve. If the code is PGRST201, the embed
is ambiguous and needs to name its constraint explicitly:

  subjects!batches_subject_id_center_fkey (name, name_bn)

If it is PGRST200 or PGRST205, PostgREST has not reloaded its schema cache since
the migration — send NOTIFY pgrst, 'reload schema' and try again before changing
any code.

If it is 42703 — "column X does not exist" — a column the app reads is not in the
database. Check whether the migration that adds it has been pushed:
src/lib/supabase/types.ts is a snapshot, and tsc will keep agreeing with the app
long after the schema moved under it.`,
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// And the doors that must stay shut.
//
// Every function in `public` is an endpoint at POST /rest/v1/rpc/<name>. The SMS
// worker's are the most dangerous in the schema: one marks a message sent, two
// credit a balance an owner cannot otherwise move by a single taka. They are
// granted to service_role alone.
//
// This is asked of the live project rather than only of the local suite because
// the local suite cannot fully prove it. Supabase ships its own default
// privileges — `grant all on functions to postgres, anon, authenticated,
// service_role` — so a function is handed to both browser-facing roles at the
// instant it is created, and the idiomatic `revoke all ... from public` does not
// touch either grant. pg-harness reproduces those defaults deliberately, but a
// harness that models a platform is a guess about the platform. This asks it.
//
// claim_sms_batch is deliberately NOT probed here. A successful probe would claim
// a real centre's message and leave it in 'sending' for ten minutes, and until
// the cron endpoint is live nothing would come back for it — a check that damages
// what it is checking. Its grant is identical to these three, written in the same
// migration by the same four lines, so the failure mode this catches is covered;
// its own ACL is asserted from the catalogue in test-rls.mjs.
// ---------------------------------------------------------------------------

/**
 * Each probe uses the function's REAL signature, so a 404 means "not exposed"
 * rather than "no such overload" — and each is harmless if it does execute:
 * finish_sms on the nil uuid finds no row and returns 'missing', and the other
 * two only tidy a queue that a worker would tidy anyway.
 */
const closedRpcs = [
  ['finish_sms', { p_id: '00000000-0000-0000-0000-000000000000', p_ok: false }],
  ['cancel_opted_out_sms', {}],
  ['reap_stranded_sms', {}],
  // Settling an intent writes a receipt and raises the student ceiling (migration 57). A
  // browser that could reach it would be buying places for free.
  ['settle_payment_intent', { p_intent: '00000000-0000-0000-0000-000000000000' }],
  // The signup gate (migration 65). Reachable from a browser, `issue_phone_code` would
  // hand the caller its own ceilings and `verify_phone_code` its own attempt limit —
  // and between them they are the only thing proving a phone number belongs to whoever
  // is typing it.
  [
    'issue_phone_code',
    {
      p_phone: '+8801700000000',
      p_purpose: 'signup',
      p_code_hash: 'x',
      p_ip: null,
      p_ttl_seconds: 300,
      p_cooldown_seconds: 60,
      p_phone_per_hour: 5,
      p_ip_per_hour: 20,
    },
  ],
  [
    'verify_phone_code',
    {
      p_phone: '+8801700000000',
      p_purpose: 'signup',
      p_code_hash: 'x',
      p_max_attempts: 5,
    },
  ],
  /*
   * The organisation's headcount (migration 76). Harmless if it runs — a signed-out
   * caller fails `app.is_staff_admin` and gets 42501 with no number in it — but the
   * grant is what is being asked about, not the body: this one is `security definer`
   * and takes a centre id, so an anon grant would put "how many students has this
   * centre" behind a uuid guess. The nil uuid belongs to nobody, so the probe cannot
   * count a real centre even if both fences were down.
   */
  ['center_student_count', { p_center_id: '00000000-0000-0000-0000-000000000000' }],
]

console.log('\nServer-only RPCs, asked with the anon key:')

let shut = 0
const open = []

for (const [name, body] of closedRpcs) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (response.status === 401 || response.status === 403) {
    shut++
    console.log(`  SHUT  ${name} (${response.status})`)
    continue
  }

  const detail = await response.json().catch(() => ({}))
  open.push({ name, status: response.status, code: detail.code, message: detail.message })
  console.log(`  OPEN  ${name} [${response.status} ${detail.code ?? ''}] ${detail.message ?? ''}`)
}

console.log(`${shut}/${closedRpcs.length} server-only RPCs refuse an anonymous call.`)

if (open.length > 0) {
  const cacheOnly = open.every((o) => o.code === 'PGRST202')
  console.error(
    cacheOnly
      ? `
INCONCLUSIVE — PostgREST cannot see these functions yet, so "not callable" here
means "not in the schema cache", which is not the same as "not granted". Send

  notify pgrst, 'reload schema';

and run this again. Do not read the 404 as a pass.`
      : `
SERVER-ONLY RPC IS PUBLICLY CALLABLE — ${open.length} of them, with no session.

Revoking PUBLIC is not enough on Supabase: the project's default privileges hand
EXECUTE to anon and authenticated by name at creation time, and PUBLIC is a
different grantee. Fix it in a new migration, naming the roles:

  revoke all on function public.<name>(<args>) from anon, authenticated, public;
  grant execute on function public.<name>(<args>) to service_role;`,
  )
  process.exit(1)
}
