import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'
import { fill } from '../src/lib/i18n/fill.ts'
import { nameTooLong, passwordTooShort } from '../src/lib/i18n/messages.ts'
import { MAX_NAME } from '../src/lib/limits.ts'
import { MIN_PASSWORD } from '../src/lib/auth/password.ts'
import { digits } from '../src/lib/bd/time.ts'
import { STAGE_ORDER } from '../src/lib/fees/reminder-schedule.ts'
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

test('a template string carries the same placeholders in both languages', () => {
  // The other kind of count-dependent string: a `{n}` template, for the few
  // sentences a client component has to write for itself. The compiler cannot see
  // inside one — `fill` takes a plain string — so this stands in for the argument
  // check a function gets for free.
  //
  // Both halves matter. A translation that drops `{n}` renders "still to tell"
  // with no number, and one that renames it to `{count}` renders a literal
  // "{count}" on the screen, which is the failure `fill` deliberately makes
  // visible rather than blanking.
  const placeholders = (s: string) =>
    [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

  const bnLeaves = new Map(leaves(bn))
  for (const [key, value] of leaves(en)) {
    const original = bnLeaves.get(key)
    if (typeof value !== 'string' || typeof original !== 'string') continue
    assert.deepEqual(
      placeholders(value),
      placeholders(original),
      `en.${key} does not fill the same values as bn.${key}`,
    )
  }
})

test('filling a template substitutes by name and leaves nothing behind', () => {
  assert.equal(fill('আরও {n} জন বাকি', { n: 4 }), 'আরও 4 জন বাকি')
  assert.equal(fill('{n} still to tell', { n: 4 }), '4 still to tell')

  // Named, not positional, so a translator may reorder freely — which is the
  // whole reason the placeholders are named.
  assert.equal(
    fill('{paid} / {net} paid', { paid: '৳500', net: '৳1,000' }),
    '৳500 / ৳1,000 paid',
  )
  assert.equal(
    fill('{net} মোট, {paid} জমা', { paid: '৳500', net: '৳1,000' }),
    '৳1,000 মোট, ৳500 জমা',
  )

  // Repeated once, or many times, or not at all.
  assert.equal(fill('{n} of {n}', { n: 3 }), '3 of 3')
  assert.equal(fill('nothing to fill', { n: 3 }), 'nothing to fill')

  // A placeholder with no value stays put. Blanking it would render "more still
  // to tell" and read as clumsy English rather than as a bug.
  assert.equal(fill('{n} still to tell', {}), '{n} still to tell')

  // A brace that is not a placeholder is left alone, and an empty value is
  // substituted rather than treated as missing.
  assert.equal(fill('{ n } and {}', { n: 1 }), '{ n } and {}')
  assert.equal(fill('[{x}]', { x: '' }), '[]')
})

test('every reminder stage has a heading and a reason in both languages', () => {
  // The worklist renders both from a lookup keyed by stage, so a fifth stage added
  // to the schedule without copy would print "undefined" above somebody's fee.
  // The two regex tests above already prove the language of each; this proves
  // there is one per stage and nothing orphaned in either direction.
  for (const locale of LOCALES) {
    const { stages, stageNotes } = dict(locale).reminders
    for (const stage of STAGE_ORDER) {
      assert.ok(stages[stage], `${locale}.reminders.stages.${stage}`)
      assert.ok(stageNotes[stage], `${locale}.reminders.stageNotes.${stage}`)
    }
    assert.equal(Object.keys(stages).length, STAGE_ORDER.length)
    assert.equal(Object.keys(stageNotes).length, STAGE_ORDER.length)
  }

  // 'due' spans the deadline and the six days after it, so its heading must not
  // claim the deadline is today — five families out of six would be reading a lie.
  assert.ok(!bn.reminders.stages.due.includes('আজ'), bn.reminders.stages.due)
  assert.ok(
    !/\btoday\b/i.test(en.reminders.stages.due),
    en.reminders.stages.due,
  )
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

test('a limit message quotes the constant the check actually enforces', () => {
  // The point of messages.ts. Somebody halves MAX_NAME, forgets the sentence,
  // and an owner is refused at forty while being told eighty is fine — with no
  // way to discover the real number except by deleting characters one at a time.
  for (const locale of LOCALES) {
    assert.match(nameTooLong(locale), new RegExp(digits(MAX_NAME, locale)))
    assert.match(passwordTooShort(locale), new RegExp(digits(MIN_PASSWORD, locale)))
  }

  // Bangla numerals in a Bangla sentence, ASCII in an English one. A cap is
  // prose; money and headcounts are the ones that stay ASCII in both.
  assert.match(nameTooLong('bn'), /৮০/)
  assert.match(nameTooLong('en'), /80/)
  assert.match(passwordTooShort('bn'), /৬/)
  assert.match(passwordTooShort('en'), /6/)
})

test('no limit message ships with its placeholder still in it', () => {
  // fill() leaves an unknown placeholder standing rather than throwing, which is
  // right at runtime and useless at review time — "নাম {n} অক্ষরের" reads as a
  // broken build to the owner and as a passing test to everyone else.
  for (const locale of LOCALES) {
    for (const text of [nameTooLong(locale), passwordTooShort(locale)]) {
      assert.doesNotMatch(text, /\{[a-zA-Z]+\}/, text)
    }
  }
})
