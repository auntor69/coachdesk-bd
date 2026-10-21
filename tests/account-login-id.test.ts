/**
 * /account and changeOwnPassword across all three login realms: email, username, and phone.
 *
 * WHAT THIS FILE IS GUARDING. Self-serve signup (20260811000079) moved owners onto real,
 * verified email addresses (`session.email !== null, session.phone === null,
 * session.username === null`). `changeOwnPassword` previously resolved the login address
 * solely from `session.phone ?? session.username`, which evaluated to `null` for every
 * email-registered owner and returned `t.errors.failed` before checking their password.
 * Meanwhile `AccountPage` branched on `session.phone || !session.username` (true when both
 * are null) and rendered an empty "Login number" card (`formatBdMobile(null)` -> `""`).
 *
 * The order (`session.email ?? session.username ?? session.phone`) also matters when an
 * email-registered account has a contact number stored in `profiles.phone`: `session.email`
 * is only non-null when the auth credential is a real email (not `@phone.coachdesk.invalid`
 * or `@user.coachdesk.invalid`), so checking `session.email` first ensures the password is
 * verified against their real GoTrue login address rather than a synthetic phone address.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { loginEmailFor } from '../src/lib/bd/username.ts'
import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const ACTIONS = read('src', 'app', '(app)', 'account', 'actions.ts')
const PAGE = read('src', 'app', '(app)', 'account', 'page.tsx')

test('changeOwnPassword resolves the login email across email, username, and phone sessions', () => {
  const start = ACTIONS.indexOf('export async function changeOwnPassword(')
  assert.ok(start >= 0, 'changeOwnPassword not found')
  const next = ACTIONS.indexOf('\nexport ', start + 10)
  const body = ACTIONS.slice(start, next === -1 ? undefined : next)

  // Email first so a real-email account with a contact phone still verifies against its
  // real GoTrue email, then username, then phone.
  assert.ok(
    body.includes('const identifier = session.email ?? session.username ?? session.phone'),
    'changeOwnPassword must check session.email before username and phone',
  )
  assert.ok(body.includes('const loginEmail = identifier ? loginEmailFor(identifier) : null'))

  // And loginEmailFor produces the exact GoTrue address for each of the three realms.
  assert.equal(loginEmailFor('owner@example.com'), 'owner@example.com')
  assert.equal(loginEmailFor('rahim01'), 'rahim01@user.coachdesk.invalid')
  assert.equal(loginEmailFor('+8801712345678'), '8801712345678@phone.coachdesk.invalid')
})

test('AccountPage draws the matching login identifier card for each of the three realms', () => {
  const emailBranch = PAGE.indexOf('session.email ? (')
  const usernameBranch = PAGE.indexOf(') : session.username ? (')
  const phoneBranch = PAGE.indexOf('formatBdMobile(session.phone)')

  assert.ok(emailBranch > 0, 'missing session.email branch on /account')
  assert.ok(usernameBranch > emailBranch, 'username branch must follow email branch')
  assert.ok(phoneBranch > usernameBranch, 'phone branch must be the final arm')

  // Each arm renders its own label, value, and hint.
  const emailArm = PAGE.slice(emailBranch, usernameBranch)
  assert.ok(emailArm.includes('{t.emailLabel}'))
  assert.ok(emailArm.includes('{session.email}'))
  assert.ok(emailArm.includes('{t.emailHint}'))

  const usernameArm = PAGE.slice(usernameBranch, phoneBranch)
  assert.ok(usernameArm.includes('{t.usernameLabel}'))
  assert.ok(usernameArm.includes('{session.username}'))
  assert.ok(usernameArm.includes('{t.usernameHint}'))

  // Both dictionaries carry non-empty copy for the email card.
  for (const [locale, d] of [['bn', bn], ['en', en]] as const) {
    assert.ok(d.account.emailLabel.length > 0, `${locale}.account.emailLabel is empty`)
    assert.ok(d.account.emailHint.length > 0, `${locale}.account.emailHint is empty`)
  }
})
