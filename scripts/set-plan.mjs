/**
 * Flips one centre's plan, so a plan-gated screen can be walked on every tier
 * before there is a billing page to change plan from.
 *
 * With no plan argument it just reports what each centre is on.
 *
 *   node --env-file=.env.local scripts/set-plan.mjs
 *   node --env-file=.env.local scripts/set-plan.mjs "কোচিং" teacher_free
 *
 * Throwaway, like set-locale.mjs: it goes when the subscription screen lands.
 * Not a substitute for testing the real path — a plan set here skips whatever
 * the upgrade flow will do around it.
 */
import pg from 'pg'

const PLANS = ['teacher_free', 'teacher_plus', 'center', 'institution']
const [match, plan] = process.argv.slice(2)

if (plan && !PLANS.includes(plan)) {
  console.error(`usage: set-plan.mjs [<name fragment> <${PLANS.join('|')}>]`)
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

if (plan) {
  const { rows } = await client.query(
    `update coaching_centers set plan = $2 where name ilike '%' || $1 || '%'
     returning id, name, plan`,
    [match, plan],
  )
  if (!rows.length) console.log(`no centre matching: ${match}`)
  for (const row of rows) console.log(`${row.plan}\t${row.name}`)
} else {
  const { rows } = await client.query(
    `select c.name, c.plan,
            (select count(*) from teachers t
              where t.coaching_center_id = c.id and t.active) as teachers,
            (select count(*) from batches b
              where b.coaching_center_id = c.id and b.active) as batches
       from coaching_centers c order by c.created_at`,
  )
  for (const row of rows) {
    console.log(`${row.plan}\t${row.teachers} teachers\t${row.batches} batches\t${row.name}`)
  }
}

await client.end()
