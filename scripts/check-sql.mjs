/**
 * Parses every migration with the real PostgreSQL grammar (libpg_query).
 * Catches syntax errors before we spend a push against the live project.
 * Run: node scripts/check-sql.mjs
 *
 * THE PARSER'S MAJOR VERSION IS THE POSTGRES VERSION, and it has to be the one
 * Supabase is running — 17.6 as of 2026-08-26, so `pgsql-parser@17`. Both
 * directions of a mismatch cost something, and they cost differently:
 *
 *   * Too old and it rejects valid SQL. This is not hypothetical: the checker
 *     sat pinned to `pgsql-parser@13` and failed 20260811000005 on
 *     `on delete set null (branch_id)`, which is a PostgreSQL 15 feature that
 *     the live database and PGlite both accept. Because it failed, it was left
 *     out of `npm test`, which is the real damage — a red checker nobody runs
 *     protects nothing, and it had been protecting nothing since migration 5.
 *   * Too new and it accepts SQL the live database will reject, which is worse,
 *     because that is the failure this script exists to prevent and it would
 *     report OK. Note PGlite is on 18.3, so the RLS suite applying a migration
 *     cleanly is NOT evidence that Supabase will: this checker is the only thing
 *     in the repo that reads the migrations at the server's own version.
 *
 * So when Supabase upgrades the project's Postgres, bump this dependency to
 * match — do not reach for `latest`. `npm view pgsql-parser dist-tags` lists one
 * tag per major (pg13 … pg18), and `show server_version` on the live database
 * says which one to take.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { parse } from 'pgsql-parser'

const dir = 'supabase/migrations'
let failed = false

/*
 * Read the directory before trusting it. Run from the wrong working directory
 * this throws ENOENT, which does exit non-zero but does it as an uncaught stack
 * trace — and a gate step whose failure looks like a crash gets diagnosed as a
 * broken script rather than as the wrong cwd.
 */
let files
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.sql'))
} catch (error) {
  console.log(`FAIL cannot read ${dir} — ${error.code ?? error.message}`)
  console.log('     Run this from the repository root.')
  process.exit(1)
}

/*
 * A checker with nothing to check must not print a clean bill of health. The
 * directory exists and holds no migrations, which is what a moved or renamed
 * folder looks like — and without this it would exit 0 having read no SQL at
 * all, inside `npm test`, in green.
 */
if (files.length === 0) {
  console.log(`FAIL no .sql files in ${dir} — did they move?`)
  process.exit(1)
}

/*
 * THE FILENAME IS A KEY, NOT A LABEL. Supabase records an applied migration in
 * `supabase_migrations.schema_migrations` under the 14-digit prefix, and its
 * GitHub integration decides what a database is missing by comparing that list
 * to these filenames. A file the prefix cannot be read from is a file the
 * platform can never mark as done, so it gets applied again on every deploy —
 * which for anything creating a type, table or policy means a red check on every
 * commit until someone notices. This repo shipped exactly that failure for
 * thirty-four migrations, from the other direction (see scripts/db-push.mjs), so
 * the shape of the name is now a gate rather than a convention.
 *
 * Lowercase and underscores only in the name half: it becomes the `name` column,
 * and a space or a capital there is the kind of thing that works locally and
 * argues with tooling later.
 */
const NAME_SHAPE = /^\d{14}_[a-z0-9_]+\.sql$/

for (const file of files.filter((f) => !NAME_SHAPE.test(f))) {
  console.log(`FAIL ${file} — name must be <14 digits>_<lower_snake_case>.sql`)
  failed = true
}

for (const file of files) {
  const sql = readFileSync(`${dir}/${file}`, 'utf8')
  try {
    const parsed = await parse(sql)
    // pgsql-parser returns the raw ParseResult ({ version, stmts }) on current
    // versions and a bare array on older ones. Reading .length off the wrong one
    // printed "undefined statements" — a checker whose own output is wrong is
    // not worth reading.
    const stmts = Array.isArray(parsed) ? parsed : (parsed?.stmts ?? [])
    /*
     * An empty statement list is a pass today and should not be: a file of
     * nothing but comments parses fine and applies nothing, which is what a
     * migration truncated by a bad merge looks like. Named rather than counted,
     * because the point is which file is empty.
     */
    if (stmts.length === 0) {
      console.log(`FAIL ${file} — parsed, but contains no statements`)
      failed = true
      continue
    }
    console.log(`OK   ${file} — ${stmts.length} statements`)
  } catch (error) {
    console.log(`FAIL ${file} — ${error.message}`)
    failed = true
  }
}

/*
 * ONE RULE PER `CD` CODE, AND EVERY CODE NAMED IN src/lib.
 *
 * `CD` is not a class Postgres allocates, so these five characters are ours to hand out
 * and there is nowhere that records which are taken. 20260811000075 was written raising
 * `CD002` — already the teacher clash in 20260811000071 — and both halves of that are
 * real bugs. Two rules on one code means `isPlanCeilingRefusal` is true for a
 * double-booked teacher, so a screen offers to sell a bigger plan to fix a timetable. A
 * code raised in SQL and named nowhere in src/lib is the quieter one: the refusal works,
 * every screen shows it as an unknown error, and nothing fails.
 *
 * A RULE IS A MIGRATION, NOT A FUNCTION, and that is the whole subtlety. Four sibling
 * guards may share a code and 20260811000075's four do — one plan ceiling, four
 * dimensions, told apart by `detail` — and a later migration replacing a guard wholesale
 * re-raises its code by definition, which 20260811000060 does to
 * app.guard_student_capacity. Both are one owner. So each code is traced to the
 * migrations that first DECLARED the functions raising it, and two of those is the bug.
 *
 * A text scan and not the parse tree, because `using errcode = '...'` is a plpgsql
 * statement inside a string literal that libpg_query hands back whole.
 */
const DECLARES = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi
const RAISED = /errcode\s*=\s*'(CD\d{3})'/gi

/** Every function's first migration. `files` is sorted, so the first sighting is it. */
const born = new Map()
const raises = new Map()

for (const file of files) {
  const sql = readFileSync(`${dir}/${file}`, 'utf8')
  const declared = [...sql.matchAll(DECLARES)].map((m) => ({ at: m.index, name: m[1] }))
  for (const { name } of declared) if (!born.has(name)) born.set(name, file)

  for (const raise of sql.matchAll(RAISED)) {
    const code = raise[1].toUpperCase()
    // The function it sits inside is the last one declared above it. A raise outside any
    // function — a `do $$` block — belongs to the file itself.
    const inside = declared.filter((d) => d.at < raise.index).pop()
    if (!raises.has(code)) raises.set(code, new Set())
    raises.get(code).add(inside?.name ?? file)
  }
}

const named = readdirSync('src/lib', { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.ts'))
  .map((f) => readFileSync(`src/lib/${f}`, 'utf8'))
  .join('\n')

for (const [code, from] of [...raises].sort()) {
  const rules = new Set([...from].map((name) => born.get(name) ?? name))

  if (rules.size > 1) {
    console.log(`FAIL ${code} is raised by rules from ${rules.size} migrations: ${[...rules].join(', ')}`)
    failed = true
  } else if (!named.includes(`'${code}'`)) {
    console.log(`FAIL ${code} is raised by ${[...rules][0]} and named nowhere in src/lib`)
    failed = true
  }
}

if (!failed) console.log(`OK   ${raises.size} CD code(s), one rule each, all named in src/lib`)

process.exit(failed ? 1 : 0)
