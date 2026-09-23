import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { REJECT_REASONS } from '../src/lib/i18n/recharge.ts'

/**
 * The founder's recharge queue — §11.9 step 7, the half of build-order step 25 that spends
 * somebody else's money into a balance.
 *
 * WHAT THIS GUARDS, and why none of it is a layout assertion. Three failures, each of which
 * renders perfectly:
 *
 * 1. THE REASON RIDING ALONG ON THE CREDIT. One form per claim — amount and reason
 *    together — means a founder typing what actually arrived also files whichever reason
 *    the dropdown happened to be showing, and the customer is told their transfer was not
 *    found on the same day it was credited. Two forms, and the count is asserted rather
 *    than the intent.
 *
 * 2. A FUNCTION CROSSING THE CLIENT BOUNDARY. `RechargeWords` is full of functions
 *    (`queueCentre`, `queueSent`) and a server component cannot hand one to a client
 *    component at all — so the failure is a runtime error on a page only a platform admin
 *    ever loads, which is to say a page nobody's test suite visits. The rule is therefore
 *    asserted from the other side: the client file names no dictionary and no formatter,
 *    and the page does.
 *
 * 3. THE LIST DRILLING ITS OWN HOLE. The four reasons exist in three places — the `<select>`,
 *    the column's check constraint, and the RPC's own refusal — and a reason added to two of
 *    them is a claim a founder can file and the database then rejects with a constraint name.
 *    The migration is read and compared, the way tests/recharge-quote.test.ts reads the
 *    promotion's ladder out of its own `.sql` rather than restating it.
 */

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const QUEUE = read('src', 'app', 'founder', 'recharge-queue.tsx')
const PAGE = read('src', 'app', 'founder', 'page.tsx')
const ACTIONS = read('src', 'app', 'founder', 'actions.ts')
const CLAIMS = read('src', 'lib', 'billing', 'claims.ts')
const MIGRATION = read('supabase', 'migrations', '20260811000084_recharge_claims.sql')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/**
 * Prose out, because half the notes in these files name the thing they are written about —
 * the queue's own header says what it does not import, and a gate that reads its own
 * documentation as code is a gate nobody can write about. Same masking check-scoping.mjs
 * does before it reads a `.from()` out of a comment.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The text of one exported function, up to the declaration that follows it. */
function body(source: string, from: string, to: string): string {
  const at = source.indexOf(from)
  if (at < 0) return ''
  const end = source.indexOf(to, at + from.length)
  return source.slice(at, end < 0 ? source.length : end)
}

/* -------------------------------------------------------------------------- */
/* One decision per form, and the reason is not on the credit                 */
/* -------------------------------------------------------------------------- */

test('a claim is two forms with two independent answers', () => {
  // The credit and the refusal are separate posts with separate state, so neither can carry
  // the other's field and neither shows the other's message.
  assert.equal(count(QUEUE, 'useActionState<FounderState, FormData>('), 2)
  assert.equal(count(QUEUE, '<form action='), 2)
  assert.equal(count(QUEUE, 'name="claimId"'), 2, 'both decisions name their own claim')

  // And the amount box belongs to exactly one of them.
  assert.equal(count(QUEUE, 'name="arrived"'), 1)
  assert.equal(count(QUEUE, 'name="reason"'), 1)
})

test('the amount is blank, and the quote is a placeholder rather than a value', () => {
  // What arrives is read off a bKash statement. A box prefilled with the quote is a figure
  // nobody checked, and a founder who taps Credit without reading it has credited a number
  // the customer chose.
  assert.ok(QUEUE.includes('placeholder={claim.quotedTaka}'))

  // Exactly one default in the file, and it is the reason list's first entry: a rejection
  // always files a reason, and a blank one would be a form the RPC refuses by code.
  assert.equal(count(QUEUE, 'defaultValue='), 1)
  assert.ok(QUEUE.includes('defaultValue={REJECT_REASONS[0]}'))

  // A rejection needs its own reason, so the two decisions cannot share one text box.
  assert.equal(count(QUEUE, 'name="note"'), 2, 'each decision carries its own note')
})

/* -------------------------------------------------------------------------- */
/* §38: strings across the boundary, nothing else                             */
/* -------------------------------------------------------------------------- */

test('every sentence is composed on the server and the client formats nothing', () => {
  // The client half: labels and finished sentences only.
  const client = code(QUEUE)

  for (const forbidden of ['rechargeWords', 'formatTaka', 'formatDate', 'digits(', "@/lib/i18n'"]) {
    assert.ok(
      !client.includes(forbidden),
      `the client component reached for ${forbidden} — the sentence belongs to the page`,
    )
  }
  assert.ok(!client.includes("from '@/lib/bd/"), 'no date or numeral formatting in the client')

  // The server half: the sentences, so a claim's line is composed once, next to the read
  // that produced it.
  for (const composer of [
    'words.queueCentre(',
    'words.queueSent(',
    'words.queueQuoted(',
    'words.queueTrx(',
  ]) {
    assert.ok(PAGE.includes(composer), `the page never composes ${composer}`)
  }
  assert.ok(PAGE.includes('rechargeWords(locale)'))

  // The size on that line is the claim's own snapshot — the counts the quote was priced
  // from — and not the roster as it stands today, which is what the founder is checking
  // the quote against.
  assert.ok(PAGE.includes('const usage = claim.usage'))
})

test('a failed queue read and an empty one are two different sentences', () => {
  // §38's rule, and the one that matters most here: an unread queue tells the founder to go
  // and look at the database, and "nothing is waiting" tells them to go back to work.
  assert.ok(PAGE.includes('claims={queue === null ? null : queueClaims}'))
  assert.ok(QUEUE.includes('claims === null ? ('))
  assert.ok(QUEUE.includes('{words.queueUnreadable}'))
  assert.ok(QUEUE.includes('{words.queueEmpty}'))
  assert.ok(QUEUE.includes('claims.length === 0 ? ('))
})

/* -------------------------------------------------------------------------- */
/* The four reasons, in all three places                                      */
/* -------------------------------------------------------------------------- */

test('the select, the column and the function agree on one list', () => {
  assert.deepEqual([...REJECT_REASONS], ['not_received', 'wrong_amount', 'duplicate', 'other'])

  // The column's own check, read out of the migration rather than restated: a fifth reason
  // added to the module and not to the table is a claim that can never be rejected.
  const inColumn = /reject_reason in \(([^)]*)\)/.exec(MIGRATION)
  assert.ok(inColumn, 'the migration still lists the reasons it accepts')
  assert.deepEqual(
    [...inColumn[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    [...REJECT_REASONS],
    'the column accepts a different list than the screen offers',
  )

  // And the function refuses anything else itself, so the panel reads a sentence rather
  // than a constraint name.
  assert.match(MIGRATION, /p_reason not in \('not_received'/)

  // One list, two readers: the `<select>` maps it, the action checks against it.
  assert.ok(QUEUE.includes('{REJECT_REASONS.map((reason) => ('))
  assert.ok(QUEUE.includes('value={reason}'))
  assert.ok(ACTIONS.includes('new Set<RejectReason>(REJECT_REASONS)'))
  assert.ok(ACTIONS.includes('REASONS.has(reason)'))
})

/* -------------------------------------------------------------------------- */
/* The two decisions, and what they are allowed to say                        */
/* -------------------------------------------------------------------------- */

test('an approval credits the session, and the anti-replay refusal is named', () => {
  // The two decisions only: this file holds six other actions that legitimately reach for
  // the admin key, and the question here is which client these two use.
  const approve = body(
    ACTIONS,
    'export async function approveRechargeClaim',
    'export async function rejectRechargeClaim',
  )
  const reject = body(
    ACTIONS,
    'export async function rejectRechargeClaim',
    'export async function setCenterPlan',
  )
  assert.ok(approve && reject, 'the two decisions are still in this file')

  // The founder's own session, not the admin key: `approve_recharge_claim` writes
  // `auth.uid()` into `reviewed_by` and into the payment's `recorded_by`, and a
  // service-role call would credit the same money with nobody's name on it.
  for (const decision of [approve, reject]) {
    assert.ok(!decision.includes('createAdminClient'))
    assert.ok(decision.includes('await createClient()'))
  }
  assert.ok(approve.includes('await approveClaim(supabase, {'))
  assert.ok(reject.includes('await rejectClaim(supabase, {'))

  // A transaction ID already credited to another claim is the one refusal a founder must
  // not paper over, and it is the customer's own sentence so it can be repeated down the
  // phone. Everything else is one answer.
  assert.ok(CLAIMS.includes("if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: 'duplicate' }"))
  assert.ok(ACTIONS.includes("outcome.reason === 'duplicate' ? t.reason.duplicate : t.queueFailed"))

  // The credited figures come back off the wire rather than being recomputed here: the
  // bonus was re-derived inside the function from the amount that actually arrived.
  assert.ok(CLAIMS.includes('numberOrNull(out.arrivedPoisha)'))
  assert.ok(CLAIMS.includes('numberOrNull(out.bonusPoisha)'))
  assert.ok(ACTIONS.includes('t.creditedLine('))
})

test('the queue is read across centres, and says so where the gate can see it', () => {
  // The one read in the product that is every centre on purpose. `check-scoping.mjs` refuses
  // an unfiltered `select` without a reason, and the reason is the policy: an owner reads
  // their own claims, a platform admin reads all of them.
  assert.ok(CLAIMS.includes('founderQueue'))
  assert.ok(
    /\/\/ scoped-by:[^\n]*/.test(CLAIMS),
    'the platform-wide read carries no scoped-by note',
  )
  // The read goes through the caller's own session — the gate is
  // `recharge_claims_owner_read` answering `app.is_platform_admin()` inside the database,
  // and the founder's name lands on nothing here because nothing is written.
  assert.ok(CLAIMS.includes('.from(\'recharge_claims\')'))
  assert.ok(!/asBilling\(/.test(CLAIMS), 'the provisional cast is gone — types are generated')

  // Oldest first, because the claim that has been waiting longest is the one to check —
  // and there is a partial index on exactly that order.
  assert.ok(CLAIMS.includes(".eq('state', 'submitted')"))
  assert.ok(CLAIMS.includes(".order('submitted_at', { ascending: true })"))

  // Read in the same round trip as the rest of the panel rather than after it — one
  // `Promise.all`, and the destructuring names every result in order: the centres, the open
  // purchases, the reconciliation, the queue, and (since 20260811000086) the balances the
  // two founder levers work from.
  assert.ok(PAGE.includes('founderQueue(supabase),'))
  assert.match(
    PAGE,
    /const \[[\s\S]{0,200}?queue,[\s\S]{0,80}?\{ data: moneyRows \},[\s\S]{0,80}?\] = await Promise\.all\(\[/,
  )
})

test('closing a claim credits nothing and keeps the row', () => {
  // A rejection is a state and a reason, never a delete: the customer's own card says what
  // happened, and a table with no UPDATE path would otherwise leave it saying nothing.
  assert.ok(CLAIMS.includes("decide('reject_recharge_claim'"))
  assert.ok(ACTIONS.includes('await rejectClaim(supabase, { claimId, reason, note: note || null })'))
  assert.ok(!/delete\(\)/.test(CLAIMS), 'nothing here deletes a claim')
  assert.ok(!/\.update\(/.test(CLAIMS), 'the RPCs own every write to a claim')
})
