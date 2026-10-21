/**
 * Reports what the live database actually holds, through the REST API.
 *
 * A diagnostic, not a test: it answers "is this project migrated" without
 * needing the Postgres password. Delete it once the schema is current.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

const probe = async (path, label) => {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers })
  const body = response.ok ? '' : (await response.text()).slice(0, 160)
  console.log(`${String(response.status).padEnd(4)} ${label}${body ? ` — ${body}` : ''}`)
}

console.log(`Project: ${url}\n`)
await probe('coaching_centers?select=id,name,plan,status,balance_poisha,charged_through', 'centre')
await probe('billing_ledger?select=kind,amount_poisha&limit=1', 'billing_ledger')
await probe('price_versions?select=id&limit=1', 'price_versions')
await probe('promotions?select=id,code,tiers', 'promotions')
await probe('recharge_claims?select=id&limit=1', 'recharge_claims')

// The one centre, settled on its own session. Balance zero, so nothing can be
// charged whatever it owes — what this reads is the *shape* of the answer, which
// is how migration 82 announces itself: `balanceAfter` and `chargedThrough` are
// on it, and 81's version of the function has neither.
//
// The two levers are then asked for without a session, at the bottom of this file:
// the service key with nobody signed in is what a browser cheaply is, and a refusal is
// the fence working.
const centre = (
  await fetch(`${url}/rest/v1/coaching_centers?select=id`, { headers }).then((r) => r.json())
)[0]

const settled = await fetch(`${url}/rest/v1/rpc/settle_billing`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_center: centre?.id, p_ran_by: 'system' }),
})

console.log(`\n${String(settled.status).padEnd(4)} settle_billing -> ${await settled.text()}`)

// §11.7's two levers, asked for with the service key but with no session — which is the
// one thing a browser cheaply is: a caller with a key and nobody signed in. A 403 is the
// fence: `app.is_platform_admin()` reads auth.uid() and there is none.
for (const [fn, body] of [
  ['founder_grant_days', { p_center: centre?.id, p_days: 1, p_reason: 'probe' }],
  ['founder_adjust_balance', { p_center: centre?.id, p_amount_poisha: 100, p_reason: 'probe' }],
]) {
  const answer = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  console.log(`${String(answer.status).padEnd(4)} ${fn} -> ${(await answer.text()).slice(0, 120)}`)
}
