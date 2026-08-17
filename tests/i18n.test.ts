import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'
import { dict, LOCALES, asLocale, DEFAULT_LOCALE } from '../src/lib/i18n/index.ts'

/** Every leaf as "group.key", so a failure names the string and not a depth. */
function leaves(node: unknown, path = ''): [string, unknown][] {
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) =>
      leaves(v, path ? `${path}.${k}` : k),
    )
  }
  return [[path, node]]
}

const BENGALI = /[ঀ-৿]/

test('the two dictionaries have exactly the same keys', () => {
  // tsc already proves this — en.ts is typed as bn's shape. Asserted again here
  // because `npm test` runs without a type check in front of it, and because the
  // failure this guards against is silent: a reader gets a blank label, not an
  // error.
  assert.deepEqual(
    leaves(en).map(([k]) => k),
    leaves(bn).map(([k]) => k),
  )
})

test('no string in either dictionary is empty', () => {
  for (const [locale, d] of [['bn', bn], ['en', en]] as const) {
    for (const [key, value] of leaves(d)) {
      assert.equal(typeof value, 'string', `${locale}.${key} is not a string`)
      assert.notEqual(String(value).trim(), '', `${locale}.${key} is empty`)
    }
  }
})

test('nothing in the English dictionary was left in Bangla', () => {
  // The failure the compiler cannot see. `en.ts` is typed as bn's *shape*, so a
  // key pasted across with its Bangla value still compiles, and the only person
  // who finds out is an English-medium teacher holding the phone.
  for (const [key, value] of leaves(en)) {
    assert.ok(
      !BENGALI.test(String(value)),
      `en.${key} still contains Bangla: ${String(value)}`,
    )
  }
})

test('nothing in the Bangla dictionary is secretly English', () => {
  // The mirror of the above, and the one that catches a string added in a hurry
  // to whichever file was already open.
  for (const [key, value] of leaves(bn)) {
    assert.ok(
      BENGALI.test(String(value)),
      `bn.${key} has no Bangla in it: ${String(value)}`,
    )
  }
})

test('every locale resolves to a dictionary', () => {
  for (const locale of LOCALES) {
    assert.equal(leaves(dict(locale)).length, leaves(bn).length)
  }
  assert.equal(dict('bn'), bn)
  assert.equal(dict('en'), en)
})

test('a locale from the database that is neither falls back to Bangla', () => {
  // profiles.locale is text and user_metadata is unvalidated JSON. Both reach
  // the app as string, and indexing DICTS with 'hi' would hand a screen
  // undefined and render nothing.
  assert.equal(DEFAULT_LOCALE, 'bn')
  for (const bad of [null, undefined, '', 'hi', 'BN', 'en-GB', 7, {}]) {
    assert.equal(asLocale(bad), 'bn')
  }
  assert.equal(asLocale('en'), 'en')
  assert.equal(asLocale('bn'), 'bn')
})
