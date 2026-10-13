import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  describeLoginIdentifier,
  identifierOfTyped,
  loginAddressOf,
  loginIdentifierOf,
  type LoginFields,
} from '../src/lib/auth/identifier.ts'
import { loginEmailFor } from '../src/lib/bd/username.ts'
import { dict } from '../src/lib/i18n/index.ts'
import { LOCALES } from '../src/lib/i18n/locale.ts'

/**
 * `/account`, the screen where somebody changes their own name and their own password.
 *
 * WHICH OF THE THREE THINGS AN ACCOUNT SIGNS IN WITH (MASTERPLAN.md §5.3) is the first
 * half. The screen used to answer that question with two branches and there are three
 * answers, so everything below is one of the three shapes, or the guarantee that both
 * callers ask the module instead of testing again. The three, as the session hands them
 * over:
 *   a number    +8801712345678                 — an owner, or a teacher the owner gave one
 *   a username  rahim                          — a teacher who has no number (§5.2)
 *   an email    jamila.akter@gmail.com         — anybody who signed up themselves (§5.4)
 *
 * The second half is the form under it, which left the new password sitting in all three
 * of its boxes after saying the change had gone through.
 */

const USERNAME = 'rahim'
const EMAIL = 'jamila.akter@gmail.com'

const PHONE_LOGIN: LoginFields = { phone: '+8801712345678', username: null, email: null }
const USERNAME_LOGIN: LoginFields = { phone: null, username: USERNAME, email: null }
const EMAIL_LOGIN: LoginFields = { phone: null, username: null, email: EMAIL }

test('a number account signs in with the number, and reads it the way people write it', () => {
  const identifier = loginIdentifierOf(PHONE_LOGIN)
  assert.deepEqual(identifier, { kind: 'phone', value: '+8801712345678' })

  // The address the password form probes, built by the login screen's own dispatch.
  assert.equal(loginAddressOf(PHONE_LOGIN), '8801712345678@phone.coachdesk.invalid')

  const words = describeLoginIdentifier(PHONE_LOGIN, dict('bn').account)
  assert.equal(words?.value, '01712345678')
  assert.equal(words?.numeric, true)
  assert.equal(words?.label, dict('bn').account.phoneLabel)
})

test('a username account signs in with the username', () => {
  assert.deepEqual(loginIdentifierOf(USERNAME_LOGIN), { kind: 'username', value: USERNAME })
  assert.equal(loginAddressOf(USERNAME_LOGIN), `${USERNAME}@user.coachdesk.invalid`)

  const words = describeLoginIdentifier(USERNAME_LOGIN, dict('en').account)
  assert.equal(words?.value, USERNAME)
  assert.equal(words?.numeric, false)
  assert.equal(words?.hint, dict('en').account.usernameHint)
})

test('an email account is the third kind of identifier, not a blank number', () => {
  // THE REGRESSION. This account has no number and no username, and the screen read that
  // as "no username, so it must be a number": `formatBdMobile(null)` is the empty string,
  // so the card printed a heading with nothing under it and a hint beneath that told the
  // owner of the account to ask the owner of the account. Every self-serve signup is this
  // account, which is every owner.
  assert.deepEqual(loginIdentifierOf(EMAIL_LOGIN), { kind: 'email', value: EMAIL })

  const words = describeLoginIdentifier(EMAIL_LOGIN, dict('bn').account)
  assert.equal(words?.value, EMAIL)
  assert.equal(words?.label, dict('bn').account.emailLabel)
  assert.equal(words?.hint, dict('bn').account.emailHint)
  assert.equal(words?.numeric, false)

  // And the password form's side of it, which failed less visibly: the address it verifies
  // the current password against is the address that signs this person in.
  assert.equal(loginAddressOf(EMAIL_LOGIN), EMAIL)
  // Lowercased by the login screen's dispatch, so autocapitalisation on a phone keyboard
  // does not fail either the probe or the login itself.
  assert.equal(
    loginAddressOf({ phone: null, username: null, email: 'Jamila.Akter@Gmail.com' }),
    EMAIL,
  )
})

test('no account shape prints an empty identifier', () => {
  // The failure mode itself, asserted rather than described: whatever a reader's session
  // holds, the card has something in it or is not drawn at all.
  const shapes = [
    ['number', PHONE_LOGIN],
    ['username', USERNAME_LOGIN],
    ['email', EMAIL_LOGIN],
  ] as const

  for (const [shape, login] of shapes) {
    for (const locale of LOCALES) {
      const words = describeLoginIdentifier(login, dict(locale).account)
      assert.ok(words, `${shape}: no words`)
      assert.notEqual(words.value.trim(), '', `${shape}: the card would print blank`)
      assert.notEqual(words.label.trim(), '', `${shape}: unlabelled`)
      assert.notEqual(words.hint.trim(), '', `${shape}: no hint`)
    }
  }
})

test('a session with none of the three names no identifier at all', () => {
  // Unreachable — `email` is null exactly when the login address is one of the two
  // synthetic ones — and the honest answer to it. The screen draws no card rather than an
  // empty one, and the action refuses instead of probing an address it does not have.
  const nobody: LoginFields = { phone: null, username: null, email: null }
  assert.equal(loginIdentifierOf(nobody), null)
  assert.equal(loginAddressOf(nobody), null)
  assert.equal(describeLoginIdentifier(nobody, dict('bn').account), null)
})

test('both the screen and the password action ask this module, and neither tests twice', () => {
  // A source check, in the shape tests/page-header.test.ts uses, and it is the point of the
  // extraction: a page that prints the identifier and an action that signs in with it have
  // to agree, and the way they stopped agreeing was each spelling the question itself.
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

  // The ban is on the two-way question itself, in code or in prose. A comment that quotes
  // the old expression fails too, and deliberately: the sentence belongs in words — which
  // is what the docblocks on both files do — and a rule with an exception carved out for the
  // places people write it is a rule the next edit walks around.
  const page = read('src/app/(app)/account/page.tsx')
  assert.match(page, /describeLoginIdentifier\(session, t\)/)
  assert.doesNotMatch(page, /session\.phone \|\|/)

  const actions = read('src/app/(app)/account/actions.ts')
  assert.match(actions, /loginAddressOf\(session\)/)
  assert.doesNotMatch(actions, /session\.phone \?\?/)
  // `loginEmailFor` is what the action used to build the address from a number or a username
  // only. It is reached through the resolver now, so an import of it here is the old shape
  // coming back by another door.
  assert.doesNotMatch(actions, /loginEmailFor\(/)
})

/* -------------------------------------------------------------------------- */
/* And the same three, typed into the founder's lockout box                    */
/* -------------------------------------------------------------------------- */

/**
 * The founder's half of the question, and the half that cannot ask a session: the person who
 * cannot get in is on the telephone, and all the founder has is what they read out.
 *
 * That form used to take a number and nothing else, so the two populations with no number —
 * everybody who signed up through the app, and every teacher whose login is a username — had
 * no way back into their own account at all.
 */
test('the founder’s box takes any of the three identifiers a person can read out', () => {
  assert.deepEqual(identifierOfTyped('01712345678'), {
    kind: 'phone',
    value: '+8801712345678',
  })
  // Spaces, a `+880` and Bangla digits are all the same number, which is the shape somebody
  // reads off a signboard rather than off a keyboard.
  assert.deepEqual(identifierOfTyped('  +880 1712 345678 '), {
    kind: 'phone',
    value: '+8801712345678',
  })
  assert.deepEqual(identifierOfTyped('rahim'), { kind: 'username', value: 'rahim' })
  assert.deepEqual(identifierOfTyped('Jamila.Akter@Gmail.com'), {
    kind: 'email',
    value: 'jamila.akter@gmail.com',
  })
})

test('and refuses whatever the login screen would refuse, before any query', () => {
  // The same list tests/username.test.ts holds the login dispatch to: a malformed address, a
  // number that does not normalise, a username of the wrong shape. The founder is told there
  // is no such account rather than shown a database error, and nothing is looked up.
  for (const typed of [
    '',
    '   ',
    'ab',
    '0171234567',
    '01012345678',
    'rahim!',
    'রহিম',
    'name@',
    '@gmail.com',
    'a@b@c',
    'a b@gmail.com',
  ]) {
    assert.equal(identifierOfTyped(typed), null, `accepted ${JSON.stringify(typed)}`)
  }
})

test('what the founder types resolves to the value a session reports for that account', () => {
  // The property that keeps the founder's lookup and the profile screen reading the same
  // three columns: the kind it names is the field the session fills, and the address the
  // value signs in with is the address the login screen builds from the same string.
  for (const typed of ['01712345678', 'rahim', 'Jamila.Akter@Gmail.com']) {
    const identifier = identifierOfTyped(typed)
    assert.ok(identifier, `${typed} resolved to nothing`)

    const session: LoginFields =
      identifier.kind === 'phone'
        ? { phone: identifier.value, username: null, email: null }
        : identifier.kind === 'username'
          ? { phone: null, username: identifier.value, email: null }
          : { phone: null, username: null, email: identifier.value }

    assert.deepEqual(loginIdentifierOf(session), identifier)
    assert.equal(loginAddressOf(session), loginEmailFor(typed))
  }
})

test('the password boxes are emptied once the change goes through', () => {
  // The five lines eight other forms in the app already open with, asserted here rather
  // than assumed because this is the only form whose boxes hold secrets. Left as it was,
  // the box marked "current" still held the password that had just been invalidated, so
  // pressing the button again — the ordinary thing to do when a save is not obviously a
  // save — answered "That is not your current password." Three boxes still full on a
  // centre phone is the other half of it.
  const form = readFileSync(
    path.join(process.cwd(), 'src/app/(app)/account/password-form.tsx'),
    'utf8',
  )

  assert.match(form, /if \(state\?\.ok\) formRef\.current\?\.reset\(\)/)
  assert.match(form, /<form ref=\{formRef\}/)
})

/* -------------------------------------------------------------------------- */
/* And the desk this screen is read on                                         */
/* -------------------------------------------------------------------------- */

test('the three cards use the width a laptop has, and a phone still reads them in order', () => {
  const PAGE = readFileSync(
    path.join(process.cwd(), 'src/app/(app)/account/page.tsx'),
    'utf8',
  )

  // THE REPORTED BUG. The shell's `main` is `max-w-3xl` below `lg` and `max-w-7xl` above it,
  // and each of these cards is capped at `max-w-2xl` — so from `lg` the whole screen sat in
  // a 672px column at the left edge of a 1216px workspace with half of it empty. The fix is
  // the grid's shape: two columns of the same cards, and no card made wider than it was.
  assert.match(
    PAGE,
    /<div className="grid gap-5 lg:grid-cols-2 lg:items-start">/,
    'the screen is one column on a desk again, so half of it is empty',
  )
  // And the fix is the grid, not a wider card: a form stretched across 1,216px is the
  // other way to fill a desk and the wrong one.
  assert.match(PAGE, /<Card className="max-w-2xl">/, 'a card lost its own cap')

  // The bar stays OUT of the grid: `PageHeader` is a fragment at the top of the page's own
  // column, and a cell — or a box of its own — gives it a containing block one grid row
  // tall, so it stops sticking (tests/page-header.test.ts is the tripwire for that shape).
  const bar = PAGE.indexOf('<PageHeader')
  const grid = PAGE.indexOf('lg:grid-cols-2')
  assert.ok(bar > 0 && grid > 0, 'the bar or the grid is gone')
  assert.ok(bar < grid, 'the grid wraps the bar, which un-sticks it')

  // And one column below `lg`, where the grid draws its cells in source order: the name, the
  // identifier, then the password. A reader who has just corrected their own spelling is the
  // reader about to try the login they cannot remember, so those two stay together — and
  // either of them moving past the password is the bug this ordering pins.
  const name = PAGE.indexOf('{t.nameTitle}')
  const identifier = PAGE.indexOf('{login.value}')
  const password = PAGE.indexOf('{t.passwordTitle}')
  assert.ok(name < identifier, 'the identifier is no longer under the name')
  assert.ok(identifier < password, 'the password box now comes before the login card')
})
