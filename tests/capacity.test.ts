import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { CAPACITY_EXCEEDED, isCapacityRefusal } from '../src/lib/capacity.ts'

/**
 * The five characters that turn a database refusal into a sentence an owner can act on.
 *
 * `app.guard_student_capacity` raises `CD001` when a centre is out of student places,
 * and three Server Actions — the one-at-a-time form, the edit that turns a student back
 * on, and the bulk paste — recognise it to say "you are using all 120 of your places"
 * rather than "could not add". The code is written in two files that cannot import each
 * other, which is exactly the arrangement that drifts: the assertions below hold the
 * migration and the constant to the same string.
 *
 * The failure this prevents is not a crash. A `CD001` nobody recognises falls through to
 * the generic "could not add", so a paying centre that has run out of the thing it pays
 * for is told the product is broken — and the fix they need to buy is never mentioned.
 */

const ROOT = path.join(import.meta.dirname, '..')
const MIGRATION = readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260811000036_student_capacity.sql'),
  'utf8',
)

test('the code the app looks for is the code the trigger raises', () => {
  // Parsed out of the migration rather than restated, for the reason
  // plan-allowances.test.ts parses the seed: a copy here would be a third source of
  // truth and would pass while the other two disagreed.
  const raised = /errcode\s*=\s*'([A-Z0-9]{5})'/g
  const codes = [...MIGRATION.matchAll(raised)].map((m) => m[1])

  assert.ok(codes.includes(CAPACITY_EXCEEDED), `migration 36 raises ${codes.join(', ')}`)
})

test('the capacity code is not one Postgres already means something by', () => {
  // The whole reason for a custom SQLSTATE. Each of these arrives at the same `if`
  // ladders from a different cause, and any collision would have one refusal wearing
  // another's sentence: a duplicate student code reported as "buy more places", or a
  // full centre reported as a permission problem.
  assert.equal(CAPACITY_EXCEEDED, 'CD001')

  for (const taken of ['23505', '23503', '23514', '42501', 'P0001']) {
    assert.notEqual(CAPACITY_EXCEEDED, taken)
  }

  // `CD` is not a class Postgres allocates, which is what makes the above safe rather
  // than lucky.
  assert.match(CAPACITY_EXCEEDED, /^CD\d{3}$/)
})

test('a capacity refusal is recognised through the shape Supabase hands over', () => {
  // What a PostgrestError actually looks like at the call site. The extra fields are
  // there because the check must not depend on the object being only a code.
  assert.equal(
    isCapacityRefusal({
      code: CAPACITY_EXCEEDED,
      message: 'this centre has 120 of 120 student places in use',
      details: 'coaching_center_id=adadcd99-e913-4617-9198-05a7ee96f259',
      hint: 'Buy more student places',
    }),
    true,
  )

  // And through a thrown Error carrying the same code, which is what a future
  // `try`/`catch` around an RPC would hold.
  const thrown = Object.assign(new Error('out of places'), { code: CAPACITY_EXCEEDED })
  assert.equal(isCapacityRefusal(thrown), true)
})

test('every other failure stays the failure it was', () => {
  // The direction that matters. A false positive here tells somebody to go and buy
  // student places to fix an error that had nothing to do with capacity — so they buy
  // them, and it is still broken. Each of these is a real error one of the three
  // callers can see: a duplicate student code, a batch id from another centre, the
  // billing-column guard, and a plain `raise` from any other trigger in the schema.
  for (const code of ['23505', '23503', '23514', '42501', 'P0001', '', 'cd001', 'CD002']) {
    assert.equal(isCapacityRefusal({ code }), false, code)
  }
})

test('nothing that is not an error object is a capacity refusal', () => {
  // `error` is null on every successful write, and these branches run on values that
  // have already gone wrong once — so the shape is not worth trusting.
  for (const junk of [null, undefined, '', 'CD001', 0, 1, true, [], () => 'CD001', NaN]) {
    assert.equal(isCapacityRefusal(junk), false, String(junk))
  }

  // A `code` that is not a string is not a match either, which is what stops a
  // truthy-but-wrong value from reading as the refusal.
  for (const code of [1, {}, ['CD001'], null, undefined]) {
    assert.equal(isCapacityRefusal({ code }), false, String(code))
  }
})

test('capacity.ts stays importable from a client component', () => {
  // The reason the module has no imports: `isCapacityRefusal` is wanted in an error
  // branch wherever a student is written, including in a client component, and pulling
  // in the dictionary or the plan table would ship all of it to a phone on 3G. An
  // import added here would not fail any other test — it would just make the bundle
  // bigger, quietly.
  const source = readFileSync(path.join(ROOT, 'src', 'lib', 'capacity.ts'), 'utf8')

  assert.doesNotMatch(source, /^\s*import\s/m)
})
