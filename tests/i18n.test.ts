import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'
import {
  dict,
  LOCALES,
  asLocale,
  DEFAULT_LOCALE,
  localName,
  type T,
} from '../src/lib/i18n/index.ts'

/** Every leaf as "group.key", so a failure names the string and not a depth. */
function leaves(node: unknown, path = ''): [string, unknown][] {
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) =>
      leaves(v, path ? `${path}.${k}` : k),
    )
  }
  return [[path, node]]
}

/**
 * What a leaf actually shows a reader.
 *
 * A count-dependent string is a function, so the template inside it is invisible
 * until it is called — and `n => \`${n} জন\`` pasted into en.ts is exactly the
 * failure the two regex tests below exist to catch. Called with 1 and 3, which
 * covers both branches of an English plural. The argument is untyped on purpose:
 * a function taking a name gets 1 and returns "1 — attendance", which is
 * nonsense but is nonsense in the right language, and that is all this checks.
 */
function renderings(value: unknown): string[] {
  if (typeof value === 'function') {
    const fn = value as (arg: unknown) => string
    return [fn(1), fn(3)]
  }
  return [String(value)]
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

test('a count-dependent string is a function in both dictionaries', () => {
  // The other half of the same guarantee: a plural translated as a fixed string
  // would render "3 students" as "1 students", or drop the count entirely.
  const shapes = (d: unknown) => leaves(d).map(([k, v]) => `${k}: ${typeof v}`)
  assert.deepEqual(shapes(en), shapes(bn))
})

test('a count-dependent string cannot be handed to a client component', () => {
  // A compile-time test wearing a runtime test's clothes. The assertion below is
  // trivially true; what matters is that the annotation stops compiling if `T`
  // ever stops poisoning function leaves.
  //
  // This is the failure that got through everything once already: `roster.saved`
  // was a function, the register took `T<'roster'>` as a prop, and tsc, npm test
  // and next build all passed. React refuses to serialise a function across the
  // boundary, so the register 500'd on first render — the one screen a teacher
  // opens with thirty students waiting.
  //
  // `[X] extends [never]` and not `X extends never`: a bare conditional
  // distributes over the empty union and yields never, so the check would pass
  // by accident whatever T did.
  type Poisoned = [T<'teach'>['saved']] extends [never] ? true : false
  const savedCannotCrossTheWire: Poisoned = true
  assert.equal(savedCannotCrossTheWire, true)

  // And the other half: a plain string still comes through as a string, or the
  // type would poison the whole dictionary and no group could be passed at all.
  type Kept = T<'roster'>['note'] extends string ? true : false
  const noteStillCrosses: Kept = true
  assert.equal(noteStillCrosses, true)
})

test('no string in either dictionary is empty', () => {
  for (const [locale, d] of [['bn', bn], ['en', en]] as const) {
    for (const [key, value] of leaves(d)) {
      assert.ok(
        typeof value === 'string' || typeof value === 'function',
        `${locale}.${key} is neither a string nor a function`,
      )
      for (const text of renderings(value)) {
        assert.notEqual(text.trim(), '', `${locale}.${key} is empty`)
      }
    }
  }
})

test('nothing in the English dictionary was left in Bangla', () => {
  // The failure the compiler cannot see. `en.ts` is typed as bn's *shape*, so a
  // key pasted across with its Bangla value still compiles, and the only person
  // who finds out is an English-medium teacher holding the phone.
  for (const [key, value] of leaves(en)) {
    for (const text of renderings(value)) {
      assert.ok(!BENGALI.test(text), `en.${key} still contains Bangla: ${text}`)
    }
  }
})

test('nothing in the Bangla dictionary is secretly English', () => {
  // The mirror of the above, and the one that catches a string added in a hurry
  // to whichever file was already open.
  for (const [key, value] of leaves(bn)) {
    for (const text of renderings(value)) {
      assert.ok(BENGALI.test(text), `bn.${key} has no Bangla in it: ${text}`)
    }
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

test('a subject with both names is shown in the reader’s language', () => {
  const maths = { name: 'Maths', name_bn: 'গণিত' }
  assert.equal(localName(maths, 'bn'), 'গণিত')
  assert.equal(localName(maths, 'en'), 'Maths')
})

test('a name the centre never typed falls back to the one they did', () => {
  // name_bn is optional in the settings form, so this is the common case, not an
  // edge one: most centres type "Physics" and stop. Falling through to '' would
  // render "Class 9 · " and read as a bug in the app.
  assert.equal(localName({ name: 'Physics', name_bn: null }, 'bn'), 'Physics')
  assert.equal(localName({ name: '', name_bn: 'পদার্থ' }, 'en'), 'পদার্থ')
  assert.equal(localName({ name_bn: 'রসায়ন' }, 'en'), 'রসায়ন')

  // A missing embed, which PostgREST returns for a batch with no subject.
  for (const locale of LOCALES) {
    assert.equal(localName(null, locale), '')
    assert.equal(localName(undefined, locale), '')
    assert.equal(localName({ name: null, name_bn: null }, locale), '')
  }
})
