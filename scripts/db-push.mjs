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
 */
import { readFileSync, readdirSync } from 'node:fs'
import pg from 'pg'

const MIGRATIONS_DIR = 'supabase/migrations'

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

await client.query(`
  create table if not exists schema_migrations (
    filename    text primary key,
    applied_at  timestamptz not null default now()
  );
`)

const applied = new Set(
  (await client.query('select filename from schema_migrations')).rows.map(
    (r) => r.filename,
  ),
)

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

let ran = 0

for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip     ${file} (already applied)`)
    continue
  }

  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8')

  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('insert into schema_migrations (filename) values ($1)', [
      file,
    ])
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
