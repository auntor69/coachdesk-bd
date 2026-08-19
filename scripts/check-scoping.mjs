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
 * Run: node scripts/check-scoping.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

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

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

/**
 * Index just past the `)` matching the `(` at `open`, honouring strings.
 *
 * A `.eq('a', foo(bar))` must not end the chain early, and a `'` inside a
 * template literal must not swallow the rest of the file.
 */
function balancedEnd(src, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * The whole builder chain starting at a `.from(...)` call.
 *
 * Walks method calls one at a time, tracking depth so a `.eq('a', foo(bar))`
 * does not end the chain early, and stops as soon as what follows a balanced
 * call is not another `.method(`. That is what makes the answer exact rather
 * than a fixed window of characters — two queries in one `Promise.all` sit a
 * few lines apart, and a window would let the second one's filter vouch for the
 * first.
 */
function chainFrom(src, start) {
  let i = start
  const end = src.length

  while (i < end) {
    // Expect `.name(`, possibly after whitespace and comments.
    while (i < end && /\s/.test(src[i])) i++
    if (src.startsWith('//', i)) {
      i = src.indexOf('\n', i)
      if (i === -1) return src.slice(start, end)
      continue
    }
    if (src.startsWith('/*', i)) {
      const close = src.indexOf('*/', i)
      if (close === -1) return src.slice(start, end)
      i = close + 2
      continue
    }
    if (src[i] !== '.') break

    const open = src.indexOf('(', i)
    if (open === -1) break
    if (!/^\.\s*\w+\s*$/.test(src.slice(i, open))) break

    const close = balancedEnd(src, open)
    if (close === -1) break
    i = close
  }

  return src.slice(start, i)
}

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

  for (const match of src.matchAll(/\.from\(\s*'([\w]+)'\s*\)/g)) {
    const relation = match[1]

    // A name the generated types do not know is a typo or a stale migration,
    // and PostgREST answers it with a 404 the screen renders as "empty".
    if (!all.has(relation)) {
      problems.push({
        where,
        line: lineOf(src, match.index),
        relation,
        why: 'no such relation in the generated types — run npm run gen:types',
      })
      continue
    }
    if (!scoped.has(relation)) continue

    checked++
    const chain = chainFrom(src, match.index)
    if (filtersOnly(chain).includes('coaching_center_id')) continue

    const hatch = [...commentsAbove(src, match.index), ...chain.split('\n')]
      .map((line) => /\/\/\s*scoped-by:\s*(.+)$/.exec(line.trim()))
      .find(Boolean)

    if (hatch) {
      const reason = hatch[1].trim()
      if (reason.length < 8) {
        problems.push({
          where,
          line: lineOf(src, match.index),
          relation,
          why: `scoped-by needs a reason a person can check, got "${reason}"`,
        })
      } else {
        hatches.push({ where, line: lineOf(src, match.index), relation, reason })
      }
      continue
    }

    problems.push({
      where,
      line: lineOf(src, match.index),
      relation,
      why: 'no coaching_center_id filter and no scoped-by note',
    })
  }
}

function lineOf(src, offset) {
  return src.slice(0, offset).split('\n').length
}

if (problems.length > 0) {
  console.error(
    `\n${problems.length} quer${problems.length === 1 ? 'y' : 'ies'} against a `
      + 'centre-scoped table does not name the centre:\n',
  )
  for (const p of problems) {
    console.error(`  ${p.where}:${p.line}  ${p.relation}`)
    console.error(`      ${p.why}`)
  }
  console.error(
    '\nAdd .eq(\'coaching_center_id\', session.active.centerId) — or, if an id in'
      + '\nthe filter was already proved to belong to this centre, say so:'
      + '\n\n      // scoped-by: examId, verified against this centre above\n',
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
