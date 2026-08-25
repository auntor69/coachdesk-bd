import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'
import { fill } from '../src/lib/i18n/fill.ts'
import { nameTooLong, passwordTooShort } from '../src/lib/i18n/messages.ts'
import { MAX_NAME } from '../src/lib/limits.ts'
import { MIN_PASSWORD } from '../src/lib/auth/password.ts'
import { digits } from '../src/lib/bd/time.ts'
import { CHASE_EMPTY_REASONS, STAGE_ORDER } from '../src/lib/fees/reminder-schedule.ts'
import { PROGRESS_EMPTY_REASONS } from '../src/lib/students/progress.ts'
import { PERMISSION_KEYS, PERMISSION_DEFAULTS } from '../src/lib/permissions.ts'
import { WALLET_LABEL_BN } from '../src/lib/sms/templates.ts'
import { UCS2_SEGMENT } from '../src/lib/sms/encoding.ts'
import {
  dict,
  LOCALES,
  asLocale,
  otherLocale,
  DEFAULT_LOCALE,
  LOCALE_NAME,
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

/**
 * Bangla script, minus the taka sign.
 *
 * U+09F3 sits in the Bengali block but is the currency symbol both languages
 * use: `formatTaka` prints ৳1,250 for an English reader on purpose, because
 * an owner checks a fee board against a bKash statement in ASCII digits. Leaving
 * it in this class would make "Monthly fee (৳)" read as untranslated English,
 * and the only way to satisfy the test would be to write the wrong label.
 *
 * It is excluded from the mirror test too, which is right: a Bangla string whose
 * only non-ASCII character is ৳ has not been translated either.
 */
const BENGALI = /[ঀ-৲৴-৿]/

/**
 * Bangla strings that legitimately contain no Bangla letters.
 *
 * A Dhaka coaching centre says "SMS", in Latin letters, out loud and in writing
 * — ক্ষুদ্র বার্তা পরিসেবা is what a textbook calls it and nobody else. So
 * the honest translation of the label is the acronym, and the test below has to
 * be told rather than the dictionary bent to satisfy it.
 *
 * "WhatsApp" is the same decision for a stronger reason: it is a trademark and the
 * button it labels is the one thing on the plan screen a reader identifies by its
 * shape rather than by reading it. হোয়াটসঅ্যাপ is a transliteration nobody types.
 *
 * Listed by exact path, never by pattern, so this stays a list of decisions
 * somebody made and not a hole a whole group can fall through.
 */
const LATIN_IN_BANGLA = new Set([
  'settings.hub.sms',
  'settings.sms.title',
  'settings.plan.contactWhatsapp',
])

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

test('an empty worklist has a sentence for every reason it can be empty', () => {
  // /fees/reminders renders this from a lookup keyed by ChaseEmptyReason, so a
  // fifth reason added to the schedule without copy would put "undefined" under a
  // heading that says there is nothing to do — on the screen an owner opens
  // specifically to be told what to do.
  //
  // The reason this is keyed at all, rather than three flat strings and a ternary
  // in the page: the ternary had a case the card did not, and the screen told an
  // owner "no deadline is close yet" directly above a card naming families weeks
  // overdue. See chaseEmptyReason.
  for (const locale of LOCALES) {
    const { noneBecause } = dict(locale).reminders
    for (const reason of CHASE_EMPTY_REASONS) {
      assert.ok(noneBecause[reason], `${locale}.reminders.noneBecause.${reason}`)
    }
    assert.equal(Object.keys(noneBecause).length, CHASE_EMPTY_REASONS.length)
  }

  // 'allUnreachable' is the one of the four that is not "relax", and its whole job
  // is to point at the fix. A copy edit that softened it into another reassurance
  // would restore the original bug with the branching intact.
  for (const locale of LOCALES) {
    const { noneBecause } = dict(locale).reminders
    const reassuring = [noneBecause.nothingOwed, noneBecause.allRecent, noneBecause.notDueYet]
    assert.ok(!reassuring.includes(noneBecause.allUnreachable), noneBecause.allUnreachable)
  }
  assert.match(en.reminders.noneBecause.allUnreachable, /number/i)
  assert.match(bn.reminders.noneBecause.allUnreachable, /নম্বর/)
})

test('an empty weekly list has a sentence for every reason it can be empty', () => {
  // The progress screen's own version of the above, keyed by ProgressEmptyReason.
  for (const locale of LOCALES) {
    const { noneBecause } = dict(locale).progress
    for (const reason of PROGRESS_EMPTY_REASONS) {
      assert.ok(noneBecause[reason], `${locale}.progress.noneBecause.${reason}`)
    }
    assert.equal(Object.keys(noneBecause).length, PROGRESS_EMPTY_REASONS.length)
  }

  // Two of the four are only true because they say "still to tell" — they describe
  // the students who are neither finished nor blank, not the whole week. A copy edit
  // that widened either one back into a universal claim would put a false sentence
  // above the card that names the exceptions, which is the bug they were narrowed
  // to fix. See progressEmptyReason.
  assert.match(en.progress.noneBecause.nothingRecorded, /still to tell/)
  assert.match(en.progress.noneBecause.noNumbers, /still to tell/)
  assert.match(bn.progress.noneBecause.nothingRecorded, /এখনো জানানো বাকি/)
  assert.match(bn.progress.noneBecause.noNumbers, /এখনো জানানো বাকি/)
})

test('the desktop chips read as a different action, not as the dead one', () => {
  // On a laptop `sms:` and `tel:` open nothing, so both chips become a copy — see
  // src/lib/pointer.ts. What the copy is *called* is load-bearing: a button still
  // labelled "SMS" that only reaches the clipboard is the same lie the dead link
  // told, one step earlier.
  for (const locale of LOCALES) {
    const { chase, channels } = dict(locale)
    assert.notEqual(chase.copySms, channels.sms, `${locale}.chase.copySms`)
    assert.notEqual(chase.copyNumber, channels.call, `${locale}.chase.copyNumber`)
    assert.notEqual(chase.copySms, chase.copyNumber, `${locale}.chase.copySms`)
  }

  // Both hints exist to say the one thing the label cannot: the message still goes
  // from the owner's own handset, at their own operator's rate. They are `title`
  // tooltips, so they are only ever read on the device that has these chips.
  assert.match(en.chase.copySmsHint, /phone/i)
  assert.match(en.chase.copyNumberHint, /phone/i)
  assert.match(bn.chase.copySmsHint, /ফোন/)
  assert.match(bn.chase.copyNumberHint, /ফোন/)

  // The confirmation and the failure land in the same slot on the same chip, and
  // only one of them means a row was written to fee_reminders. Two strings that
  // read alike would put the false record back — the owner sees the chip change,
  // assumes the family was told, and moves down the list.
  for (const locale of LOCALES) {
    const { copied, copyFailed } = dict(locale).chase
    assert.notEqual(copied, copyFailed, `${locale}.chase.copyFailed`)
    assert.ok(copied.includes('✓'), `${locale}.chase.copied is missing its tick`)
    assert.ok(!copyFailed.includes('✓'), `${locale}.chase.copyFailed has a tick`)
  }
})

test('every teacher permission has a label and a hint in both languages', () => {
  // Both screens render this table from PERMISSION_KEYS, so a sixth switch added
  // to the migration and the key list without copy for it would put a nameless
  // checkbox in front of an owner deciding who may see other people's fees. tsc
  // catches it too — the labels are keyed by PermissionKey — but `npm test` runs
  // without a type check in front of it.
  for (const locale of LOCALES) {
    const labels = dict(locale).teacherPermissions
    for (const key of PERMISSION_KEYS) {
      assert.ok(labels[key]?.label, `${locale}.teacherPermissions.${key}.label`)
      assert.ok(labels[key]?.hint, `${locale}.teacherPermissions.${key}.hint`)
    }
    assert.equal(Object.keys(labels).length, PERMISSION_KEYS.length)
  }

  // And the defaults the add form ticks cover exactly those five: a key missing
  // here renders an unchecked box, which the action then writes as a revoked
  // permission nobody chose to revoke.
  assert.deepEqual(Object.keys(PERMISSION_DEFAULTS).sort(), [...PERMISSION_KEYS].sort())
})

test('every wallet has a word in both languages, and Bangla matches the SMS', () => {
  // Keyed by coaching_centers.payment_wallet in both dictionaries, so tsc catches
  // a fourth wallet added to the enum without a word for it. This is the runtime
  // half, plus the part tsc cannot see.
  for (const locale of LOCALES) {
    assert.deepEqual(
      Object.keys(dict(locale).wallets).sort(),
      Object.keys(WALLET_LABEL_BN).sort(),
    )
  }

  // The Bangla labels must be the exact words the guardian reads in the SMS. The
  // settings form shows the owner a live preview of that message beside these
  // radio buttons, so two spellings of বিকাশ on one screen would be the app
  // describing a message it does not send.
  assert.deepEqual(bn.wallets, { ...WALLET_LABEL_BN })

  // And English deliberately does not match: an English-medium owner reads the
  // Latin styling, while their parents still receive Bangla. Asserted rather than
  // left implicit, because "translate this too" is the obvious wrong fix if the
  // line above ever fails.
  assert.notEqual(en.wallets.bkash, WALLET_LABEL_BN.bkash)
})

test('every kind of dispatch has a word in both languages', () => {
  // sms_dispatches.kind, rendered straight out of this lookup on the SMS ledger.
  // A sixth kind added to the enum without a word here would print a raw
  // 'attendance_alert' on an owner's receipt.
  const KINDS = ['exam_result', 'attendance_alert', 'fee_reminder', 'notice', 'custom']
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(dict(locale).smsKinds).sort(), [...KINDS].sort())
  }
})

test('the SMS credit note quotes the capacity the biller actually counts', () => {
  // Same bargain as messages.ts: the sentence teaching an owner that a Bangla SMS
  // holds 70 characters takes the number from the module that segments the
  // message, so the two cannot drift. An owner planning around 160 concludes we
  // are overcharging them.
  assert.equal(UCS2_SEGMENT, 70)
  assert.match(
    bn.settings.sms.segmentNote(UCS2_SEGMENT),
    new RegExp(digits(UCS2_SEGMENT, 'bn')),
  )
  assert.match(
    en.settings.sms.segmentNote(UCS2_SEGMENT),
    new RegExp(digits(UCS2_SEGMENT, 'en')),
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
    if (LATIN_IN_BANGLA.has(key)) continue
    for (const text of renderings(value)) {
      assert.ok(BENGALI.test(text), `bn.${key} has no Bangla in it: ${text}`)
    }
  }
  // The allowlist is a list of decisions, so a stale entry has to fail too:
  // otherwise a key renamed years from now leaves a permanent exemption behind
  // for whatever inherits its path.
  const paths = new Set(leaves(bn).map(([key]) => key))
  for (const allowed of LATIN_IN_BANGLA) {
    assert.ok(paths.has(allowed), `${allowed} is allowlisted but no longer exists`)
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

test('the switch offers the other language, named in its own script', () => {
  // The button is labelled with the language it moves you *to*, which is the only
  // convention that works when the reader cannot read the language currently on
  // screen. `otherLocale` therefore has to be total and its own inverse — two
  // locales make a toggle complete, and a third would turn "the other one" into a
  // lie. This is where that gets caught rather than in a menu that shows one entry.
  for (const locale of LOCALES) {
    assert.notEqual(otherLocale(locale), locale)
    assert.ok(LOCALES.includes(otherLocale(locale)))
    assert.equal(otherLocale(otherLocale(locale)), locale)
  }

  // Endonyms, and the reason they are not in either dictionary: both files would
  // have to hold the same two strings, and "Bengali" on the button is useless to
  // exactly the person who needs to press it.
  assert.equal(LOCALE_NAME.bn, 'বাংলা')
  assert.equal(LOCALE_NAME.en, 'English')
  assert.ok(BENGALI.test(LOCALE_NAME.bn))
  assert.ok(!BENGALI.test(LOCALE_NAME.en))
  for (const locale of LOCALES) {
    assert.ok(LOCALE_NAME[locale].trim(), `LOCALE_NAME.${locale} is empty`)
  }

  // What the button's accessible name actually comes out as. `fill` leaves an
  // unfilled placeholder on the screen on purpose, so asserting no brace survives
  // is what catches `{lang}` renamed on one side of the dictionary only.
  for (const locale of LOCALES) {
    const name = LOCALE_NAME[otherLocale(locale)]
    const label = fill(dict(locale).shell.switchTo, { lang: name })
    assert.ok(label.includes(name), label)
    assert.ok(!label.includes('{'), label)
  }
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
