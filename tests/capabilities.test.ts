import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  ALL_BUNDLES_LISTED,
  BUNDLE_NAMES,
  CAPABILITIES,
  CAPABILITY_BUNDLES,
  bundleOf,
  can,
  isCapability,
  narrowingOf,
  parseCapabilities,
} from '../src/lib/staff/capabilities.ts'

/**
 * The capability vocabulary (MASTERPLAN.md §6.2).
 *
 * The fence is 20260811000063's restrictive policies and tests/../test-rls.mjs proves it.
 * What is tested here is the half a browser sees, and it fails in one direction only: this
 * file agreeing with the database about what is allowed, and never being softer than it. A
 * screen that draws the fee card for somebody the policies will refuse produces a centre
 * that looks like it has no bills.
 */

/* -------------------------------------------------------------------------- */
/* The veto                                                                   */
/* -------------------------------------------------------------------------- */

test('null is the whole of the role, which is every row that existed before the column', () => {
  // The claim §6.2's first consequence rests on: existing Center accounts keep working.
  for (const capability of CAPABILITIES) {
    assert.equal(can(null, capability), true, capability)
    assert.equal(can(undefined, capability), true, capability)
  }
})

test('an array is exactly what it says and nothing beside it', () => {
  assert.equal(can(['fees', 'expenses'], 'fees'), true)
  assert.equal(can(['fees', 'expenses'], 'expenses'), true)
  assert.equal(can(['fees', 'expenses'], 'payroll'), false)
  assert.equal(can(['fees', 'expenses'], 'students'), false)
})

test('an empty array is the administrator who may look and not touch', () => {
  // Allowed by the migration's constraint on purpose, so it must not read as null here.
  for (const capability of CAPABILITIES) {
    assert.equal(can([], capability), false, capability)
  }
})

test('a word the vocabulary does not have narrows rather than widens', () => {
  // The reason the schema has no enum and no word list: a typo in a stored row has to fail
  // closed, or a misspelled capability is a capability nobody notices was never enforced.
  assert.equal(can(['fee', 'expence'], 'fees'), false)
  assert.equal(can(['fee', 'expence'], 'expenses'), false)
  assert.equal(isCapability('fee'), false)
  assert.equal(isCapability('fees'), true)
  assert.equal(isCapability(''), false)
})

/* -------------------------------------------------------------------------- */
/* Two memberships, one person                                                */
/* -------------------------------------------------------------------------- */

test('the narrowing that survives is the intersection, because the database is a not-exists', () => {
  // `app.member_allows` is refused by ANY active row that leaves the capability out, so a
  // second membership can never lift a veto. This is the same sentence read forwards.
  const rows = (...caps: (string[] | null)[]) => caps.map((capabilities) => ({ capabilities }))

  assert.equal(narrowingOf(rows(null, null)), null)
  assert.deepEqual(narrowingOf(rows(null, ['fees'])), ['fees'])
  assert.deepEqual(narrowingOf(rows(['fees', 'expenses'], ['fees', 'payroll'])), ['fees'])
  assert.deepEqual(narrowingOf(rows(['fees'], ['students'])), [])
  assert.equal(narrowingOf([]), null)
})

test('the teacher who also keeps the books loses the capability, not keeps it', () => {
  // The bug this design was rewritten to avoid. A teacher membership is unnarrowed, so a
  // reading that deferred to it would hand a manager narrowed away from `fees` the whole
  // fee book back — through app.is_staff_admin, which the manager row satisfies.
  const karim = [{ capabilities: null }, { capabilities: ['students'] }]

  assert.deepEqual(narrowingOf(karim), ['students'])
  assert.equal(can(narrowingOf(karim), 'fees'), false)
  assert.equal(can(narrowingOf(karim), 'students'), true)
})

/* -------------------------------------------------------------------------- */
/* What an owner ticked                                                       */
/* -------------------------------------------------------------------------- */

test('every box ticked is stored as null, so a seventh capability is not a downgrade', () => {
  assert.equal(parseCapabilities([...CAPABILITIES]), null)
  // And order is not how it is recognised — a form posts fields in DOM order.
  assert.equal(parseCapabilities([...CAPABILITIES].reverse()), null)
})

test('no box ticked is an empty array and never null', () => {
  // The opposite reading of the same form, and the difference between "give them the lot"
  // and "give them nothing" is the whole of what this function decides.
  assert.deepEqual(parseCapabilities([]), [])
})

test('what comes back is the vocabulary in its own order, with the rubbish dropped', () => {
  assert.deepEqual(parseCapabilities(['messages', 'fees']), ['fees', 'messages'])
  assert.deepEqual(parseCapabilities(['fees', 'plan', 'branches', '']), ['fees'])
  assert.deepEqual(parseCapabilities(['fees', 'fees']), ['fees'])

  // A posted capability list is a browser's word about permissions, so the shape it
  // produces has to be one `can` can read: anything else stored would be a row that
  // narrows a manager in a way no screen can explain.
  for (const posted of [['fees'], ['staff', 'payroll'], []]) {
    const parsed = parseCapabilities(posted)
    assert.ok(parsed !== null)
    assert.ok(parsed.every(isCapability), String(posted))
  }
})

/* -------------------------------------------------------------------------- */
/* Roles as bundles                                                           */
/* -------------------------------------------------------------------------- */

test('a role is a named bundle of capabilities and nothing else', () => {
  // §6.2: "A role becomes a named bundle of capabilities rather than a branch in an `if`."
  assert.equal(ALL_BUNDLES_LISTED, true)
  assert.deepEqual([...BUNDLE_NAMES].sort(), Object.keys(CAPABILITY_BUNDLES).sort())

  for (const name of BUNDLE_NAMES) {
    const bundle = CAPABILITY_BUNDLES[name]
    if (bundle === null) continue
    assert.ok(bundle.every(isCapability), name)
    assert.equal(new Set(bundle).size, bundle.length, name)
  }
})

test('the accountant sees the money and admits nobody', () => {
  const accountant = CAPABILITY_BUNDLES.accountant
  assert.equal(can(accountant, 'fees'), true)
  assert.equal(can(accountant, 'payroll'), true)
  assert.equal(can(accountant, 'students'), false)
  assert.equal(can(accountant, 'staff'), false)
})

test('the receptionist admits the child and never sees what anybody paid', () => {
  // The request §6.2 is actually describing, and the one the whole file is shaped by.
  const receptionist = CAPABILITY_BUNDLES.receptionist
  assert.equal(can(receptionist, 'students'), true)
  assert.equal(can(receptionist, 'messages'), true)
  assert.equal(can(receptionist, 'fees'), false)
  assert.equal(can(receptionist, 'expenses'), false)
  assert.equal(can(receptionist, 'payroll'), false)
})

test('a stored narrowing is described in a word when it matches one', () => {
  assert.equal(bundleOf(null), 'deputy')
  assert.equal(bundleOf([]), 'observer')
  assert.equal(bundleOf(['fees', 'expenses', 'payroll']), 'accountant')
  // Order-insensitive, because the column is an array and nothing sorts it in the database.
  assert.equal(bundleOf(['messages', 'students']), 'receptionist')

  // And a hand-picked set is not forced into a name it does not have. The boxes are the
  // truth; the name is a summary.
  assert.equal(bundleOf(['fees']), null)
  assert.equal(bundleOf(['fees', 'expenses', 'payroll', 'students']), null)
})

/* -------------------------------------------------------------------------- */
/* Where it may be imported from                                              */
/* -------------------------------------------------------------------------- */

test('capabilities.ts stays importable from a client component', () => {
  // The appointment form is a client component and renders the tick boxes, so this module
  // is bundled for the browser. It must pull in nothing — no Supabase client, no
  // dictionary — for the sake of a list of six words.
  const source = readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'lib', 'staff', 'capabilities.ts'),
    'utf8',
  )

  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]), [])
})
