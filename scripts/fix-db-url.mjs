/**
 * Repairs SUPABASE_DB_URL in .env.local without ever printing the password.
 *
 * The password contains a literal '@', which is not URL-encoded. Parsers
 * disagree about that: node-pg splits on the LAST '@' and connects fine, but
 * the Supabase CLI, psql, and most libraries split on the FIRST one and would
 * read the password as a hostname. Percent-encoding it makes every parser agree.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = '.env.local'
const raw = readFileSync(PATH, 'utf8')
const lines = raw.split(/\r?\n/)

const idx = lines.findIndex((l) => l.startsWith('SUPABASE_DB_URL='))
if (idx === -1) {
  console.log('SUPABASE_DB_URL not found')
  process.exit(1)
}

const value = lines[idx].slice('SUPABASE_DB_URL='.length).trim()
const scheme = 'postgresql://'
const rest = value.slice(scheme.length)

// Split on the LAST '@' — everything before it is credentials.
const at = rest.lastIndexOf('@')
const creds = rest.slice(0, at)
const hostPart = rest.slice(at + 1)

const colon = creds.indexOf(':')
const user = creds.slice(0, colon)
const password = creds.slice(colon + 1)

// Decode first so re-running this is a no-op rather than double-encoding.
const decoded = decodeURIComponent(password)
const encoded = encodeURIComponent(decoded)

const fixed = `${scheme}${user}:${encoded}@${hostPart}`

if (fixed === value) {
  console.log('already correctly encoded — no change')
} else {
  lines[idx] = `SUPABASE_DB_URL=${fixed}`
  writeFileSync(PATH, lines.join('\n'))
  console.log('encoded the password; every parser now reads the same host')
}

console.log('host parses as:', new URL(fixed.replace('postgresql://', 'https://')).host)
