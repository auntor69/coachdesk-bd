/**
 * Parses every migration with the real PostgreSQL grammar (libpg_query).
 * Catches syntax errors before we spend a push against the live project.
 * Run: node scripts/check-sql.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { parse } from 'pgsql-parser'

const dir = 'supabase/migrations'
let failed = false

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
  const sql = readFileSync(`${dir}/${file}`, 'utf8')
  try {
    const stmts = await parse(sql)
    console.log(`OK   ${file} — ${stmts.length} statements`)
  } catch (error) {
    console.log(`FAIL ${file} — ${error.message}`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
