/**
 * Flips one account's profiles.locale, so a screen can be walked in both
 * languages before the settings toggle exists.
 *
 * Throwaway: task #13 ships a real language switch and this goes with it.
 *   node --env-file=.env.local scripts/set-locale.mjs owner@example.com en
 */
import pg from 'pg'

const [email, locale] = process.argv.slice(2)
if (!email || !['bn', 'en'].includes(locale)) {
  console.error('usage: set-locale.mjs <email> <bn|en>')
  process.exit(1)
}

const url = new URL(process.env.SUPABASE_DB_URL)
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, '') || 'postgres',
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

await client.connect()
const { rows } = await client.query(
  `update profiles set locale = $2
     where id = (select id from auth.users where email = $1)
   returning id, locale`,
  [email, locale],
)
console.log(rows.length ? `${email} -> ${rows[0].locale}` : `no such user: ${email}`)
await client.end()
