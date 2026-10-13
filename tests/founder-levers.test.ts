/**
 * The two founder levers — MASTERPLAN §11.7, build-order step 26.
 *
 * WHAT THIS FILE GUARDS, and why none of it is a layout assertion:
 *
 * 1. THE GRANT IS DAYS AND NOT FAKE MONEY. `founder_grant_days` was declared in
 *    20260811000078 with a comment that priced it "at the rate in force so that the balance
 *    stays the only currency" and a sign pinned to `> 0`. §11.7 says the opposite in as many
 *    words, and the masterplan is the intent (§0) — so migration 86 corrects it, and the
 *    sign is asserted here from the migration text rather than restated. A grant that
 *    credited taka would be indistinguishable from a recharge the customer never sent.
 *
 * 2. THE DATE THE SCREEN PROMISES IS THE DATE THE DATABASE WRITES. The days form draws the
 *    date it reaches *before* the tap, from `grantReach` in TypeScript; the function computes
 *    the same date inside Postgres from the line the row actually holds. Two engines, one
 *    arithmetic — `tests/recharge-quote.test.ts`'s arrangement for the bonus ladder, and
 *    `scripts/test-levers.mjs` runs the SQL half against the same literals.
 *
 * 3. NEITHER LEVER TAKES A FIGURE FROM THE BROWSER. The adjustment takes an amount the
 *    founder typed and nothing else; the grant takes a count of days and works the date out
 *    itself. A form that could post a date could buy a decade, and a form that could post a
 *    balance could credit itself.
 *
 * 4. NOTHING CROSSES THE CLIENT BOUNDARY THAT CANNOT. `LeverLabels` is handed to a client
 *    component whole, so every value in it must be a string — the defect §21 records for
 *    `RechargeWords`, asserted here in the direction that catches it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { MAX_GRANT_DAYS, grantReach, parseDays } from '../src/lib/billing/levers.ts'
import { LOCALES } from '../src/lib/i18n/locale.ts'
import { leverLabels, leverSentences } from '../src/lib/i18n/levers.ts'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, for the reason tests/founder-queue.test.ts gives: a `\n` anchor matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

/**
 * Prose out, because these files document themselves and a gate that reads its own
 * documentation as code is a gate nobody can write about. Same masking `check-scoping.mjs`
 * and tests/founder-queue.test.ts do before reading a call out of a comment.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '').replace(/^\s*\/\/.*$/gm, '')

const MIGRATION = read('supabase', 'migrations', '20260811000086_founder_levers.sql')
const MIGRATION_CODE = code(MIGRATION)
const ACTIONS = read('src', 'app', 'founder', 'actions.ts')
const LEVERS_UI = read('src', 'app', 'founder', 'center-levers.tsx')
const CARD = read('src', 'app', 'founder', 'center-billing.tsx')
const PAGE = read('src', 'app', 'founder', 'page.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** The text of one exported function, up to the declaration that follows it. */
function body(source: string, from: string, to: string): string {
  const at = source.indexOf(from)
  assert.ok(at > -1, `${from} is in the file`)
  const end = source.indexOf(to, at + from.length)
  return source.slice(at, end === -1 ? undefined : end)
}

/* -------------------------------------------------------------------------- */
/* The arithmetic, which is the half the SQL half is checked against          */
/* -------------------------------------------------------------------------- */

test('a grant runs from the line, and from today when the line is behind it', () => {
  // The ordinary case: paid to the 20th, granted 10 days.
  assert.equal(grantReach('2026-09-20', 10, '2026-09-20'), '2026-09-30')
  // A year of trial: 30 days from a line already ahead of today.
  assert.equal(grantReach('2026-10-01', 30, '2026-09-20'), '2026-10-31')

  // THE ONE THAT MATTERS. A centre that ran dry a fortnight ago is read-only, and three
  // days added to the line it lapsed at leaves it read-only — so the grant starts today.
  assert.equal(grantReach('2026-09-06', 3, '2026-09-20'), '2026-09-23')
  // And the month boundary and a leap February, because `addDays` is the fee board's own
  // helper and this is the first billing caller of it.
  assert.equal(grantReach('2026-09-28', 5, '2026-09-28'), '2026-10-03')
  assert.equal(grantReach('2028-02-27', 3, '2028-02-27'), '2028-03-01')
})

test('a grant of one day buys the day it is made on', () => {
  // §11.6 counts a day as a day: a line of today means today is paid for, so one granted
  // day reaches tomorrow — which is the figure a founder reads back and the only reading
  // that does not surprise them by a day.
  assert.equal(grantReach('2026-09-20', 1, '2026-09-20'), '2026-09-21')
})

test('days are read from either keyboard, and only whole ones in range', () => {
  assert.equal(parseDays('30'), 30)
  // Bangla digits, because a phone set to Bangla produces them — the same reason parseTaka
  // accepts them.
  assert.equal(parseDays('৩০'), 30)
  assert.equal(parseDays(' 7 '), 7)
  assert.equal(parseDays(String(MAX_GRANT_DAYS)), MAX_GRANT_DAYS)

  for (const bad of ['', '0', '-3', '3.5', '366.5', '367', '1000', 'thirty', '৩.৫']) {
    assert.equal(parseDays(bad), null, `${JSON.stringify(bad)} is not a number of days`)
  }
  // The cap is the year, and it is exclusive of nothing past it.
  assert.equal(parseDays(String(MAX_GRANT_DAYS + 1)), null)
})

/* -------------------------------------------------------------------------- */
/* The migration, because a wrong sign here is money nobody meant to give     */
/* -------------------------------------------------------------------------- */

test('a grant carries no money, which is the correction 78 needed', () => {
  assert.match(MIGRATION_CODE, /when 'founder_grant_days' then amount_poisha = 0/)
  // And the old arm is gone rather than sitting beside the new one.
  assert.doesNotMatch(MIGRATION_CODE, /when 'founder_grant_days' then amount_poisha > 0/)
})

test('the grant names the day it reaches, and the trigger moves the line on it', () => {
  assert.match(
    MIGRATION_CODE,
    /kind in \(\s*'daily_charge', 'settlement_failure', 'settlement_retry', 'founder_grant_days'\s*\)/,
  )
  assert.match(MIGRATION_CODE, /new\.kind in \('daily_charge', 'founder_grant_days'\)/)
  assert.match(MIGRATION_CODE, /greatest\(c\.charged_through, new\.charge_date\)/)
  // The line never moves backwards, on any kind.
  assert.doesNotMatch(MIGRATION_CODE, /least\(c\.charged_through/)
})

test('the grant starts at today when the line is behind it, in Dhaka days', () => {
  assert.match(
    MIGRATION_CODE,
    /v_from := greatest\(v_line, \(pg_catalog\.now\(\) at time zone 'Asia\/Dhaka'\)::date\)/,
  )
  assert.match(MIGRATION_CODE, /v_to := v_from \+ p_days/)
  // §11.7's rule for the whole product, and the one a test can hold: the day is a Dhaka
  // calendar day and never the database clock.
  assert.doesNotMatch(MIGRATION_CODE, /current_date/)
})

test('both levers are the platform admin, and both demand a written reason', () => {
  for (const fn of ['founder_adjust_balance', 'founder_grant_days']) {
    assert.equal(
      count(MIGRATION_CODE, `create or replace function public.${fn}(`),
      1,
      `${fn} is defined once`,
    )
    assert.ok(
      MIGRATION_CODE.includes(`${fn} requires the platform admin`),
      `${fn} asks for the platform admin itself`,
    )
  }

  const adjust = body(MIGRATION_CODE, 'function public.founder_adjust_balance', 'comment on function')
  const grant = body(MIGRATION_CODE, 'function public.founder_grant_days', 'comment on function')

  for (const [name, source] of [['adjust', adjust], ['grant', grant]] as const) {
    // The gate is the function's own, not the Server Action's: that is the whole reason
    // these are definer functions rather than writes through the admin key.
    assert.match(source, /if not app\.is_platform_admin\(\) then/, `${name} asks inside itself`)
    assert.match(source, /using errcode = '42501'/, `${name} refuses with the standard code`)
    // A blank reason is refused by the function and not only by the field's `required`.
    assert.match(
      source,
      /pg_catalog\.btrim\(p_reason\) = ''/,
      `${name} refuses a reason nobody wrote`,
    )
    assert.match(source, /needs a written reason/, `${name} says why`)
  }
})

test('no browser may write the ledger, so the grant is granted and not opened', () => {
  assert.match(
    MIGRATION_CODE,
    /revoke all on function public\.founder_grant_days\(uuid, integer, text\)\s*from public, anon;/,
  )
  assert.match(
    MIGRATION_CODE,
    /grant execute on function public\.founder_grant_days\(uuid, integer, text\)\s*to authenticated, service_role;/,
  )
  assert.match(MIGRATION_CODE, /created_by\s*\)\s*values \(/)
  assert.match(MIGRATION_CODE, /auth\.uid\(\)/)
})

test('the balance is read under the ledger lock, and cannot be overdrawn', () => {
  const adjust = body(MIGRATION_CODE, 'function public.founder_adjust_balance', 'comment on function')
  // The lock is taken before the sum is read, in the ledger's own namespace.
  assert.ok(
    adjust.indexOf("hashtext('billing_ledger.balance')") < adjust.indexOf('pg_catalog.sum('),
    'the advisory lock is taken before the balance is read',
  )
  assert.match(adjust, /v_after < 0/)
  assert.match(adjust, /using errcode = '23514'/)
  // And zero is refused in the function, not only in the form.
  assert.match(adjust, /p_amount_poisha = 0/)
})

test('the reconciliation counts a grant as an explanation', () => {
  // §11.13's third question asks what explains a line past today; 20260811000081's own
  // comment says a grant becomes the third answer when this step lands. Without the arm
  // every lever the founder pulls comes back tomorrow as a finding.
  assert.match(
    MIGRATION_CODE,
    /where l\.coaching_center_id = c\.id\s*and l\.kind = 'founder_grant_days'\s*and l\.charge_date >= c\.charged_through/,
  )
})

/* -------------------------------------------------------------------------- */
/* The actions, because a Server Action is a public endpoint                  */
/* -------------------------------------------------------------------------- */

test('neither lever reads a date or a balance off the form', () => {
  const adjust = body(ACTIONS, 'export async function adjustCenterBalance', 'export async function grantCenterDays')
  const grant = body(ACTIONS, 'export async function grantCenterDays', 'type LeverRpc')

  // Exactly three fields each — the centre, its own figure, and the reason — and nothing
  // that names a day, a line or a balance.
  const fieldsOf = (source: string) =>
    [...new Set([...source.matchAll(/formData\.get\('([^']+)'\)/g)].map((m) => m[1]))].sort()

  assert.deepEqual(fieldsOf(adjust), ['amount', 'centerId', 'reason'])
  assert.deepEqual(fieldsOf(grant), ['centerId', 'days', 'reason'])

  // The grant posts no date at all, whatever the preview on the screen drew.
  assert.doesNotMatch(grant, /formData\.get\('(chargedThrough|line|date)'\)/)
  // And the amount the adjustment writes is the founder's typed figure, signed — never a
  // balance, a rate or a total.
  assert.match(adjust, /amountPoisha: Math\.round\(taka \* 100\)/)
})

test('both levers go through the database gate rather than the admin key', () => {
  const adjust = body(ACTIONS, 'export async function adjustCenterBalance', 'export async function grantCenterDays')
  const grant = body(ACTIONS, 'export async function grantCenterDays', 'type LeverRpc')

  for (const source of [adjust, grant]) {
    assert.match(source, /const gate = await founder\(\)/)
    // The session's own client: `createAdminClient` would bypass the function's own
    // `app.is_platform_admin()` check and would leave `auth.uid()` empty on the row.
    assert.match(source, /await createClient\(\)/)
    assert.doesNotMatch(source, /createAdminClient/)
  }

  // The RPC arguments are the function's own names, so the cast is a no-op once the types
  // are regenerated — the note `lib/billing/claims.ts` carried for migration 84.
  assert.match(ACTIONS, /adjust\('founder_adjust_balance', \{[\s\S]*?p_center: input\.centerId,[\s\S]*?p_amount_poisha: input\.amountPoisha,[\s\S]*?p_reason: input\.reason,/)
  assert.match(ACTIONS, /grant\('founder_grant_days', \{[\s\S]*?p_center: input\.centerId,[\s\S]*?p_days: input\.days,[\s\S]*?p_reason: input\.reason,/)
})

test('the receipt is built from what the database answered with', () => {
  // The grant reports the date the row now holds, never the one the screen predicted.
  assert.match(ACTIONS, /typeof out\.chargedThrough === 'string' \? out\.chargedThrough\.slice\(0, 10\)/)
  assert.match(ACTIONS, /leverSentences\(session\.locale\)\.grantedDays\(/)
  assert.match(ACTIONS, /leverSentences\(session\.locale\)\.adjusted\(/)
})

/* -------------------------------------------------------------------------- */
/* The screen, because the founder's card is the only place either is pulled  */
/* -------------------------------------------------------------------------- */

test('the card draws both levers, as two forms and not one', () => {
  assert.match(CARD, /<CenterLevers/)
  // Two separate submits, so the days box cannot ride along on an adjustment.
  assert.equal(count(LEVERS_UI, '<form'), 2)
  assert.equal(count(LEVERS_UI, '</form>'), 2)
  assert.equal(count(LEVERS_UI, '= useActionState<'), 2)
  assert.match(LEVERS_UI, /grantCenterDays/)
  assert.match(LEVERS_UI, /adjustCenterBalance/)
})

test('the days preview is the same arithmetic the database runs', () => {
  assert.match(LEVERS_UI, /grantReach\(line, parsed, today\)/)
  assert.match(LEVERS_UI, /fill\(labels\.reaches, \{ date:/)
  // The line and the day come from the server, never from the browser's clock.
  assert.match(LEVERS_UI, /line: string/)
  assert.match(LEVERS_UI, /today: string/)
  assert.doesNotMatch(LEVERS_UI, /new Date\(\)/)
})

test('the card has the figures to draw them, and says so when it does not', () => {
  // One extra read, and it is the centre's own columns: `centers_member_read` answers a
  // platform admin, so there is nothing for a definer function to do.
  //
  // TWO READS OF ONE TABLE, and the split is deliberate rather than an oversight. The balance
  // and the line are what the levers work from and they have been in the schema since the first
  // migration; `account_kind` arrived in 20260811000091 and feeds one filter. Named together, a
  // database one migration behind would fail the read the levers depend on, and the whole panel
  // would refuse to move a balance over a column that only labels a customer.
  assert.match(PAGE, /from\('coaching_centers'\)\s*\.select\('id, balance_poisha, charged_through'\)/)
  assert.match(PAGE, /from\('coaching_centers'\)\.select\('id, account_kind'\)/)
  // And the filter is withheld when that second read does not answer, because filtering every
  // customer into "teacher" is a wrong answer shaped like a right one.
  assert.match(PAGE, /const kindsReadable = !kindsError/)
  assert.match(PAGE, /kindsReadable && ACCOUNT_KINDS\.includes/)
  assert.match(PAGE, /\{kindsReadable && \(/)
  assert.match(PAGE, /scoped-by: every centre is the point of this panel/)
  assert.match(PAGE, /leverLabels\(locale\)/)
  // A failed read draws the refusal instead of the levers — a grant worked out from a line
  // nobody has is a date nobody can predict.
  assert.match(CARD, /levers\.unreadable/)
})

/* -------------------------------------------------------------------------- */
/* The words, in both languages, and none of them a function on the wire      */
/* -------------------------------------------------------------------------- */

test('every label is a string, because the group crosses into a client component', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(leverLabels(locale))) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`)
    }
  }
})

test('the sentences are functions and carry the two figures each needs', () => {
  for (const locale of LOCALES) {
    const { holding, adjusted, grantedDays } = leverSentences(locale)
    for (const [key, value] of [['holding', holding], ['adjusted', adjusted], ['grantedDays', grantedDays]] as const) {
      assert.equal(typeof value, 'function', `${locale}.${key} is composed on the server`)
    }

    // Both placeholders are filled with real text, not left standing.
    assert.ok(holding('৳12,400', '২৬ জানুয়ারি ২০২৭').includes('৳12,400'))
    assert.ok(adjusted('৳3,000', '৳15,400').includes('৳3,000'))
    assert.ok(grantedDays('৩০', '২০ অক্টোবর ২০২৬').includes('২০ অক্টোবর ২০২৬'))
  }
})

test('the one template says what it wants filled', () => {
  for (const locale of LOCALES) {
    assert.match(leverLabels(locale).reaches, /\{date\}/)
  }
})

test('the grant hint says what a grant does to money that is already there', () => {
  /*
   * THE SENTENCE THAT WAS MISSING, and it is the one that makes a working engine look
   * broken: a founder reads "nothing is charged and the balance does not move" and expects
   * the centre's balance to keep burning day by day. It does not — the granted days are
   * consumed first, and the money waits behind them. This is not hypothetical: UDVASH's
   * line carries two identical thirty-day grants and ৳1,999 that nothing will touch until
   * 30 November.
   */
  const needle: Record<string, string> = {
    en: 'not spent until these days run out',
    bn: 'সেই টাকা খরচ হবে না',
  }

  for (const locale of LOCALES) {
    assert.ok(
      leverLabels(locale).grantHint.includes(needle[locale]),
      `grantHint (${locale}): ${leverLabels(locale).grantHint}`,
    )
  }
})

test('the days box clears on success, and never on submit', () => {
  /*
   * IT USED TO CLEAR ON SUBMIT (§20.7's family of defects, and the one that wrote a second
   * grant onto a real centre): a refusal emptied the box before the action had answered, so
   * the founder retyped a figure the screen had just thrown away — and a tap whose only
   * visible effect is the field going blank is how the same thirty days gets granted twice.
   * `./settings/billing/recharge-form.tsx`'s rule, which this now follows: a refusal leaves
   * what was typed alone.
   */
  assert.match(
    LEVERS_UI,
    /useEffect\(\(\) => \{\n\s+if \(grantState\?\.ok\) setDays\(''\)\n\s+\}, \[grantState\]\)/,
  )
  assert.doesNotMatch(LEVERS_UI, /onSubmit=\{\(\) => setDays\(''\)\}/)
})
