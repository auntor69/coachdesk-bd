/**
 * Which migrations this database has not had, read-only.
 *
 * `db-push.mjs` applies them and writes the platform's ledger; this only looks. It exists because
 * "the app is newer than the database" is a real state — a Vercel deploy lands before the
 * migrations in its pipeline do, and a local `.env.local` can point at a project that was set up
 * last month — and from the outside that state is indistinguishable from a code bug: screens that
 * read a new column fail their read, and a read that fails renders as an empty or "could not read"
 * screen rather than as an error.
 *
 * IT TOUCHES NOTHING: two SELECTs and a directory listing. Run it before believing a rendering
 * failure is a rendering failure:
 *
 *     node scripts/migration-status.mjs
 *
 * Exit status is 0 whether or not there is drift — the answer is the output, not the code.
 */
import { readdirSync } from 'node:fs'
import pg from 'pg'

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set. Add it to .env.local.')
  process.exit(2)
}

const url = new URL(dbUrl)
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, '') || 'postgres',
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

try {
  await client.connect()
} catch (error) {
  console.error(`Could not connect: ${error.message.split('\n')[0]}`)
  process.exit(2)
}

const local = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .map((file) => ({ version: file.match(/^(\d+)_/)?.[1] ?? '', file }))
  .filter((entry) => entry.version !== '')
  .sort((a, b) => a.version.localeCompare(b.version))

let applied = new Set()
let ledger = 'supabase_migrations.schema_migrations'
try {
  const { rows } = await client.query(`select version from ${ledger}`)
  applied = new Set(rows.map((row) => row.version))
} catch {
  // A project that has never been pushed has no ledger at all. That is drift, not an error:
  // `db-push` creates it on the way through.
  ledger = '(absent)'
}

const missing = local.filter((entry) => !applied.has(entry.version))

console.log(`host: ${url.hostname}`)
console.log(`ledger: ${ledger}, ${applied.size} version(s) recorded`)
console.log(`local: ${local.length} migration(s)`)
console.log(missing.length === 0 ? 'nothing missing' : `MISSING (${missing.length}):`)
for (const entry of missing) console.log(`  ${entry.version}  ${entry.file}`)

await client.end()
