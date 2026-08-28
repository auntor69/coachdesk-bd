/**
 * Applies supabase/migrations/*.sql to the real database, in filename order,
 * and records what it applied so re-running is safe.
 *
 * Uses a direct Postgres connection because the REST API cannot run DDL.
 * Reads SUPABASE_DB_URL from .env.local — run with:
 *   npm run db:push
 *
 * Each migration runs inside a transaction, so a syntax error halfway through
 * leaves the database exactly as it was rather than half-migrated.
 *
 * WHERE "WHAT WE APPLIED" IS WRITTEN DOWN, AND WHY IT IS NOT OUR OWN TABLE.
 * This script used to keep its own ledger, `public.schema_migrations`, keyed by
 * filename. It worked, and it was still a bug, because the platform keeps the
 * same list somewhere else: `supabase_migrations.schema_migrations`, keyed by the
 * 14-digit version prefix. That is the one Supabase's GitHub integration reads to
 * decide which migrations a database is missing, and for the whole life of this
 * project it read an empty table — so on every single commit it concluded that
 * nothing had ever been applied, replayed 20260811000001 against a database
 * already holding the schema, and failed on statement 2 with `type "member_role"
 * already exists`. A red check on every push, from a private ledger nobody else
 * could see.
 *
 * So there is one ledger now and it is the platform's. Two places to record the
 * same fact is not redundancy, it is a disagreement waiting to happen, and this
 * one had already happened and stayed unnoticed for thirty-four migrations.
 */
import { readFileSync, readdirSync } from 'node:fs'
import pg from 'pg'

const MIGRATIONS_DIR = 'supabase/migrations'

/** The ledger this script kept before the platform's became the only one. */
const LEGACY_LEDGER = 'public.schema_migrations'

/**
 * The two halves of a migration filename, the way Supabase reads it.
 *
 * `20260811000001_init_schema.sql` is version `20260811000001`, name
 * `init_schema`. scripts/check-sql.mjs refuses any filename this cannot parse,
 * because a file with no version prefix is one the platform can never record as
 * applied — and therefore one it retries forever.
 */
const versionOf = (filename) => filename.match(/^(\d+)_/)?.[1] ?? null
const nameOf = (filename) => filename.replace(/^\d+_/, '').replace(/\.sql$/, '')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set. Add it to .env.local.')
  process.exit(1)
}

const url = new URL(dbUrl)
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, '') || 'postgres',
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  // Supabase terminates TLS at the pooler with its own CA. We are connecting
  // to a known host over TLS; skipping chain verification here is what the
  // official tooling does too.
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

try {
  await client.connect()
} catch (error) {
  console.error(`Could not connect: ${error.message.split('\n')[0]}`)
  console.error('Check the password in SUPABASE_DB_URL, and that you copied the')
  console.error('Session pooler URI (not Direct connection — that is IPv6-only).')
  process.exit(1)
}

const { rows: [{ version }] } = await client.query('select version()')
console.log(`Connected: ${version.split(',')[0]}`)
console.log(`Host: ${url.hostname}\n`)

// ---------------------------------------------------------------------------
// The ledger. Created if absent and widened if old, because Supabase has added
// columns to this table over the years and a project made before `name` existed
// would otherwise fail the insert below rather than the migration.
// ---------------------------------------------------------------------------
await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key
  );
  alter table supabase_migrations.schema_migrations
    add column if not exists statements text[];
  alter table supabase_migrations.schema_migrations
    add column if not exists name text;
`)

// ---------------------------------------------------------------------------
// Carry the old ledger's rows across, once.
//
// This is the repair for a database that was migrated by this script before it
// learned where the platform looks: the objects are all there, the platform's
// list is empty, and every deploy therefore tries to create them again. Copying
// the versions over is the whole fix — the same thing `supabase migration repair
// --status applied` does, and it is why the first run after this change applies
// nothing and still has work to report.
//
// `statements` is left null for these rows on purpose. We know which files were
// applied; we do not know that their text is still what was run, because editing
// an applied migration and re-pushing it is a thing that has happened here. A
// null says "not recorded". Writing today's file text would say something we
// cannot check.
// ---------------------------------------------------------------------------
const legacy = await client
  .query(`select filename from ${LEGACY_LEDGER} order by filename`)
  .then((r) => r.rows.map((row) => row.filename))
  .catch(() => [])

let repaired = 0

for (const filename of legacy) {
  const version = versionOf(filename)
  if (!version) continue

  const { rowCount } = await client.query(
    `insert into supabase_migrations.schema_migrations (version, name)
     select $1, $2
     where not exists (
       select 1 from supabase_migrations.schema_migrations where version = $1
     )`,
    [version, nameOf(filename)],
  )

  if (rowCount > 0) {
    console.log(`  recorded ${filename} (applied earlier, was not in the ledger)`)
    repaired++
  }
}

const applied = new Set(
  (
    await client.query('select version from supabase_migrations.schema_migrations')
  ).rows.map((r) => r.version),
)

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

let ran = 0

for (const file of files) {
  if (applied.has(versionOf(file))) {
    console.log(`  skip     ${file} (already applied)`)
    continue
  }

  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8')

  try {
    await client.query('begin')
    await client.query(sql)
    // The whole file as one statement, because that is how it was just sent:
    // a single multi-statement query inside one transaction. Splitting it here
    // to look more like the CLI's output would be a guess at where the
    // boundaries are, and dollar-quoted function bodies are exactly where that
    // guess goes wrong.
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, array[$3])`,
      [versionOf(file), nameOf(file), sql],
    )
    await client.query('commit')
    console.log(`  applied  ${file}`)
    ran++
  } catch (error) {
    await client.query('rollback')
    console.error(`\n  FAILED   ${file}`)
    console.error(`  ${error.message}`)
    if (error.position) {
      const upto = sql.slice(0, Number(error.position))
      console.error(`  at line ${upto.split('\n').length}`)
    }
    await client.end()
    process.exit(1)
  }
}

const { rows: [counts] } = await client.query(`
  select
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
    (select count(*) from pg_policies where schemaname = 'public') as policies,
    (select count(*) from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and not exists (
          select 1 from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = t.table_name and c.relrowsecurity
        )) as tables_without_rls
`)

console.log(`\n${ran} migration(s) applied, ${files.length - ran} already current.`)
if (repaired > 0) {
  console.log(
    `${repaired} earlier migration(s) added to the platform's ledger — ` +
      `Supabase will stop trying to re-apply them on deploy.`,
  )
}
console.log(`Tables: ${counts.tables}   Policies: ${counts.policies}`)

if (Number(counts.tables_without_rls) > 0) {
  console.error(
    `\nWARNING: ${counts.tables_without_rls} table(s) have RLS disabled. ` +
      `Every table holding tenant data must have it on.`,
  )
  await client.end()
  process.exit(1)
}

console.log('RLS is enabled on every table.')
await client.end()
