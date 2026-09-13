/**
 * Every query against a centre-scoped table must name the centre.
 *
 * RLS is the boundary and it holds: a row belonging to a centre you are not a
 * member of never reaches the app. What RLS deliberately does not do is pick
 * *which* of your centres you meant. A user with two memberships passes
 * `is_center_member` for both, so an unfiltered `.from('students')` returns
 * both rosters and every screen above it is quietly wrong — the fee board adds
 * up two centres' outstanding money, the SMS ledger mixes two credit histories,
 * and the opt-out list hands over the other centre's guardians' phone numbers
 * behind a switch that writes to them.
 *
 * That is a supported case, not a hypothetical one: the app has a centre
 * switcher, and a coaching-centre owner who opens a second branch as its own
 * centre is the customer we most want. So `.eq('coaching_center_id', ...)` is
 * not defence in depth here. It is the query being correct.
 *
 * The scoped relations are read out of the generated types rather than listed,
 * so a table added by a migration is covered the moment `npm run gen:types`
 * runs — the alternative is a list that is right today and silently short by
 * one for a year.
 *
 * Escape hatch, for the cases where a filter would be redundant rather than
 * missing — a child row reached by an id that a scoped query already proved
 * belongs to this centre:
 *
 *     // scoped-by: examId, verified against this centre above
 *     .from('exam_results')
 *
 * The reason is mandatory and it is read by people, not by this script. A hatch
 * with no reason is how the rule stops meaning anything.
 *
 * THE TABLE NAME MUST BE IN QUOTES, and that is a rule about this script rather
 * than about PostgREST, which does not care. A query is found here by matching
 * `.from('students')` as text, so `.from(table)` with a variable in it was never
 * a query judged wrongly — it was a query never looked at, and the total printed
 * at the end came out lower with nobody the wiser. Five of them shipped in one
 * afternoon inside a pair of perfectly reasonable helpers. So a `.from()` that
 * goes on to select, insert, update, upsert or delete and does not name its
 * relation in quotes is refused, and the fix is to write the tables out one at a
 * time with a filter on each.
 *
 * WHY THIS DOES NOT CHECK `.rpc(...)`, which looks like a hole and is not. There
 * are eleven rpc call sites and nine distinct functions. Four are the SMS worker's
 * — reap_stranded_sms, cancel_opted_out_sms, claim_sms_batch, finish_sms — which
 * are platform-wide by design and revoked from every role a browser can hold, so
 * a centre filter would be meaningless. platform_centers and
 * platform_reconciliation are deliberately every centre, gated inside the
 * function on app.is_platform_admin(). bootstrap_center
 * creates the centre, so there is nothing yet to scope to. (The phone-code
 * functions that used to be listed here are gone — signup verifies an email
 * through the platform now, MASTERPLAN §5.4.) settle_payment_intent
 * takes the intent's own id and the intent row already says which centre it belongs
 * to. That leaves exactly one function that takes a centre id:
 * import_students(p_center_id uuid, ...).
 *
 * Its p_center_id has no default, which makes it a required argument, which makes
 * omitting it a tsc error against the generated types. A check here would restate
 * what the compiler already refuses to build.
 *
 * Passing the *wrong* centre id is the more interesting case and it is not this
 * script's either: import_students is `security invoker` on purpose — see the
 * note at 20260811000009:27 — so every insert it makes is checked by the same
 * policies as a hand-typed one, and an owner naming another centre's id is
 * refused by a `with check` that raises rather than filters.
 *
 * So if you add an RPC that takes a centre id, the thing to look at is whether it
 * is SECURITY DEFINER, not whether this script learned to parse it. A definer
 * function that accepts a centre id and trusts it is the actual hazard, and no
 * amount of grepping the call sites would catch it — the call site would look
 * perfectly correct.
 *
 * Run: node scripts/check-scoping.mjs
 */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import {
  balancedEnd,
  dynamicQueriesIn,
  maskComments,
  queriesIn,
  sourceFiles,
} from './lib/query-chains.mjs'

const ROOT = process.cwd()

/* -------------------------------------------------------------------------- */
/* Which relations are scoped                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read the column list of every Row type in the generated types.
 *
 * Views count. `fee_invoice_balances` is the fee board's entire data source and
 * carries the column, so leaving views out would exempt the screen that has the
 * most to get wrong.
 */
function scopedRelations() {
  const types = readFileSync(join(ROOT, 'src/lib/supabase/types.ts'), 'utf8')
  const scoped = new Set()
  const all = new Set()

  const blocks = types.matchAll(/\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)
  for (const block of blocks) {
    const [, name, body] = block
    all.add(name)
    if (/^\s+coaching_center_id:/m.test(body)) scoped.add(name)
  }

  if (all.size === 0) {
    fail('Could not read any Row types out of src/lib/supabase/types.ts.')
  }
  return { scoped, all }
}

/* -------------------------------------------------------------------------- */
/* Finding the queries                                                        */
/* -------------------------------------------------------------------------- */

/* `sourceFiles`, `queriesIn` and `balancedEnd` live in
   scripts/lib/query-chains.mjs — check-embeds.mjs reads the same chains for a
   different reason, and two parsers that disagree about where a query ends would
   have the two gates checking two different programs. */

/**
 * The chain with every `.select()` argument blanked out.
 *
 * A column named in `.select()` is data coming back, not a filter going out, and
 * a plain substring search cannot tell the two apart. `sendResultSms` — the one
 * action that spends a centre's money — read
 * `.select('id, title, sms_sent_at, coaching_center_id').eq('id', examId)` and
 * passed this check for exactly that reason: it named the column while filtering
 * on nothing but a form field.
 *
 * Only `.select()`. An `.insert({ coaching_center_id })` or `.upsert()` payload
 * is how a write scopes itself, so those stay visible.
 */
function filtersOnly(chain) {
  let out = chain
  // Searching from `at + 1` and not from 0: the replacement contains `.select(`
  // itself, so restarting the scan finds the text it just wrote and loops for
  // ever. Found the honest way, by hanging.
  for (let at = out.indexOf('.select('); at !== -1; at = out.indexOf('.select(', at + 1)) {
    const close = balancedEnd(out, at + '.select'.length)
    if (close === -1) return out
    out = `${out.slice(0, at)}.select()${out.slice(close)}`
  }
  return out
}

/**
 * The comment lines directly above a position, nearest last.
 *
 * Bare identifiers are stepped over, because inside a `Promise.all` the receiver
 * gets its own line:
 *
 *     // scoped-by: user_id — this query *is* the centre list
 *     supabase
 *       .from('center_members')
 *
 * A person writing that note puts it above the statement, not wedged between
 * `supabase` and `.from(`. Requiring the wedge would be a rule about this
 * script's convenience rather than about the code.
 */
function commentsAbove(src, offset) {
  const lines = src.slice(0, offset).split('\n')
  const out = []
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === '') break
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
      out.unshift(line)
      continue
    }
    if (/^[\w$.]+,?$/.test(line)) continue
    break
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* The check                                                                  */
/* -------------------------------------------------------------------------- */

const problems = []
const hatches = []

function fail(message) {
  console.error(message)
  process.exit(1)
}

const { scoped, all } = scopedRelations()

let checked = 0
for (const file of [
  ...sourceFiles(join(ROOT, 'src', 'app')),
  ...sourceFiles(join(ROOT, 'src', 'lib')),
]) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('.from(')) continue
  const where = relative(ROOT, file).split(sep).join('/')

  for (const { relation, offset, line, chain } of queriesIn(src)) {
    // A name the generated types do not know is a typo or a stale migration,
    // and PostgREST answers it with a 404 the screen renders as "empty".
    if (!all.has(relation)) {
      problems.push({
        where,
        line,
        relation,
        why: 'no such relation in the generated types — run npm run gen:types',
      })
      continue
    }
    if (!scoped.has(relation)) continue

    checked++
    if (filtersOnly(chain).includes('coaching_center_id')) continue

    const hatch = [...commentsAbove(src, offset), ...chain.split('\n')]
      .map((text) => /\/\/\s*scoped-by:\s*(.+)$/.exec(text.trim()))
      .find(Boolean)

    if (hatch) {
      const reason = hatch[1].trim()
      if (reason.length < 8) {
        problems.push({
          where,
          line,
          relation,
          why: `scoped-by needs a reason a person can check, got "${reason}"`,
        })
      } else {
        hatches.push({ where, line, relation, reason })
      }
      continue
    }

    problems.push({
      where,
      line,
      relation,
      why: 'no coaching_center_id filter and no scoped-by note',
    })
  }

  /*
   * And the queries this gate would otherwise never have looked at. Comments masked
   * first, because half the notes in this codebase discuss `.from(table)` by name and a
   * gate that reads its own documentation as code is a gate nobody can write about.
   */
  for (const { argument, line } of dynamicQueriesIn(maskComments(src))) {
    problems.push({
      where,
      line,
      relation: argument === '' ? '(no argument)' : argument,
      why: 'the relation is not a quoted name, so this gate cannot see the query',
    })
  }
}

if (problems.length > 0) {
  console.error(
    `\n${problems.length} quer${problems.length === 1 ? 'y' : 'ies'} this check `
      + 'cannot vouch for:\n',
  )
  for (const p of problems) {
    console.error(`  ${p.where}:${p.line}  ${p.relation}`)
    console.error(`      ${p.why}`)
  }
  console.error(
    '\nAdd .eq(\'coaching_center_id\', session.active.centerId) — or, if an id in'
      + '\nthe filter was already proved to belong to this centre, say so:'
      + '\n\n      // scoped-by: examId, verified against this centre above\n'
      + '\nAnd write the table name out in quotes. A .from(table) taking a variable is'
      + '\ninvisible here, however correct the query around it looks, and a query this'
      + '\ncheck cannot see is a query it cannot prove names the centre.\n',
  )
  process.exit(1)
}

console.log(
  `check-scoping: ${checked} queries against ${scoped.size} centre-scoped `
    + `relations, all scoped (${hatches.length} by note).`,
)
for (const h of hatches) {
  console.log(`  note  ${h.where}:${h.line}  ${h.relation} — ${h.reason}`)
}
