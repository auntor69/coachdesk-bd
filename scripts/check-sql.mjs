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

process.exit(failed ? 1 : 0)
