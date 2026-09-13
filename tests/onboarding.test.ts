import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { USERNAME_LOGIN_DOMAIN } from '../src/lib/bd/username.ts'
import { PHONE_LOGIN_DOMAIN } from '../src/lib/bd/phone.ts'
import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * /onboarding, which has two readers who want opposite things.
 *
 * One is a brand-new signup: the form that creates a coaching centre is the whole
 * reason the page exists. The other is a teacher whose centre minted their login and
 * then switched them off — `toggleTeacherActive` deletes the `center_members` row, so
 * their session has no membership, and `homePathForRole(null)` sends exactly that
 * session here. They were being greeted by name over a form inviting them to found an
 * institution, on a credential whose password their manager still holds, with no way
 * to sign out because /login redirects a live session back to `homePathFor`.
 *
 * Structural, because there is no render harness and no dev password: what can be
 * checked is that the screen asks, that the action asks again, and that the RPC — the
 * only one of the three a browser cannot route around — asks a third time.
 */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const PAGE = read('src', 'app', '(auth)', 'onboarding', 'page.tsx')
const ACTIONS = read('src', 'app', '(auth)', 'actions.ts')
/** The live shape of `bootstrap_center` — re-emitted whole by 20260811000079. */
const MIGRATION = read('supabase', 'migrations', '20260811000079_email_signup.sql')
/** The same file with its prose taken off: a comment naming a rule is not the rule. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '')

test('the screen refuses the form to a login the centre minted', () => {
  assert.match(PAGE, /if \(session\.username\) \{/)

  // The form is below the refusal, and the refusal returns before reaching it.
  const branch = PAGE.indexOf('if (session.username) {')
  const form = PAGE.indexOf('<OnboardingForm />')
  assert.ok(branch > 0 && form > branch, 'the form is not behind the username check')
  assert.match(PAGE.slice(branch, form), /return \(/, 'the username branch renders nothing')
  assert.doesNotMatch(
    PAGE.slice(branch, form),
    /<OnboardingForm/,
    'the refusal screen draws the form it is refusing',
  )

  // And the guards that were already here still run first: an unreadable membership
  // list must not be read as "no centre" by this new branch either.
  for (const earlier of ['if (!session) redirect', 'session.membershipsUnreadable']) {
    const at = PAGE.indexOf(earlier)
    assert.ok(at > 0, `${earlier} is gone from this page`)
    assert.ok(at < branch, `${earlier} moved below the username check`)
  }
})

test('the founder is redirected rather than offered a centre', () => {
  // The platform account holds no membership and no role, so without this branch it
  // was greeted by the form that creates a coaching centre — and a centre founded
  // from the founder login would put a customer's data on the one account that can
  // already see every centre.
  const redirectAt = PAGE.indexOf("if (session.isPlatformAdmin) redirect('/founder')")
  assert.ok(redirectAt > 0, 'the platform-admin redirect is gone from this page')

  // After the unreadable guard — a failed memberships read must not be read as "the
  // founder signed in" — and before the form, so the founder never sees it.
  const unreadable = PAGE.indexOf('session.membershipsUnreadable')
  const form = PAGE.indexOf('<OnboardingForm />')
  assert.ok(unreadable > 0 && redirectAt > unreadable, 'the redirect precedes the unreadable guard')
  assert.ok(redirectAt < form, 'the founder can still be handed the create-a-centre form')

  // And the two readers the page is *for* keep their arms: a minted login still
  // gets the refusal and a real signup still gets the form.
  assert.match(PAGE, /if \(session\.username\) \{/)
  assert.match(PAGE, /<OnboardingForm \/>/)
})

test('both readers can leave, which is the part nothing else in the product offers', () => {
  assert.match(PAGE, /import \{ signOut \} from '\.\.\/actions'/)
  assert.match(PAGE, /<form action=\{signOut\}/)

  // Twice: once per branch. One sign-out on the refusal screen would leave the new
  // signup with no way out, and one under the form would leave the teacher stuck.
  assert.equal(PAGE.split('<SignOut ').length - 1, 2, 'a branch has no way out')
  const branch = PAGE.indexOf('if (session.username) {')
  const form = PAGE.indexOf('<OnboardingForm />')
  assert.match(PAGE.slice(branch, form), /<SignOut /, 'the refusal screen has no way out')
  assert.match(PAGE.slice(form), /<SignOut /, 'the form has no way out')

  // The same word the shell uses. A second dictionary key for one action is the one
  // that ends up saying something different from the button next to it.
  assert.match(PAGE, /label=\{d\.shell\.logout\}/)
  assert.equal(PAGE.split('label={d.shell.logout}').length - 1, 2)
})

test('the words are the reader’s own, unlike the rest of (auth)', () => {
  assert.match(PAGE, /const d = dict\(session\.locale\)/)
  assert.match(PAGE, /const t = d\.noCenter/)

  for (const [name, d] of [['en', en], ['bn', bn]] as const) {
    const t = d.noCenter
    for (const key of ['title', 'body', 'refused', 'signUpOwn', 'expected'] as const) {
      assert.ok(t[key].length > 20, `${name}.noCenter.${key} says nothing`)
    }

    // Nothing here may repeat the sentence the teachers screen stopped telling: the
    // login does not go anywhere else, and saying so is what made removal frightening.
    for (const key of ['body', 'refused', 'expected'] as const) {
      assert.doesNotMatch(t[key], /another cent|অন্য.{0,12}সেন্টার/, `${name}.${key} redirects them`)
    }

    // The fact this reader is actually missing, in the sentence they are shown.
    assert.match(t.body, /switched|চালু/, `${name}.noCenter.body never says what happened`)
    assert.match(t.refused, /cannot|যায় না/, `${name}.noCenter.refused does not refuse`)
    assert.match(t.signUpOwn, /own|নিজের/, `${name}.noCenter.signUpOwn offers nothing`)
  }
})

test('the action asks again, because it is a public endpoint', () => {
  const start = ACTIONS.indexOf('export async function createCenter')
  assert.ok(start > 0, 'createCenter is not where this test looks')
  const body = ACTIONS.slice(start, ACTIONS.indexOf('\nexport ', start + 10))

  const check = body.indexOf('session.username')
  const rpc = body.indexOf("rpc('bootstrap_center'")
  assert.ok(check > 0, 'createCenter does not re-check the login it was called with')
  assert.ok(rpc > check, 'createCenter creates the centre before checking who asked')

  // Within the check's own lines, because createCenter refuses three other things and
  // any of those returns would otherwise stand in for this one.
  assert.match(
    body.slice(check, check + 200),
    /return \{ error: dict\(session\.locale\)\.noCenter\.refused/,
    'the check does not stop the call',
  )
})

test('the refusal that counts is in the database, where the anon key lands', () => {
  // A browser holding the anon key can POST /rest/v1/rpc/bootstrap_center with its own
  // JWT, so neither of the two checks above is a fence. This one is.
  assert.match(SQL, /create or replace function public\.bootstrap_center/)
  assert.match(SQL, /A center-issued login cannot create a center/)
  assert.match(SQL, /errcode = '42501'/)

  const guard = SQL.indexOf('A center-issued login cannot create a center')
  const insert = SQL.indexOf('insert into public.coaching_centers')
  assert.ok(guard > 0 && insert > guard, 'the centre is created before the login is judged')

  // Both signals, either one enough — the address that signs them in, and the copy of
  // it that 20260811000038's trigger writes and the identity guard protects.
  assert.match(SQL.slice(0, guard), /from auth\.users u/)
  assert.match(SQL.slice(0, guard), /p\.username is not null/)
  assert.match(SQL.slice(0, guard), /\bor exists\b/, 'one signal only, so a disagreement admits')

  // Everything the migration was already doing survives being re-emitted.
  assert.match(SQL, /This account already owns a center/)
  assert.match(SQL, /'teacher_free',\s*'teacher_plus',\s*pg_catalog\.now\(\) \+ interval '14 days'/)
  assert.match(SQL, /set search_path = ''/)
  assert.match(SQL, /grant execute on function public\.bootstrap_center/)
})

test('the domain in the SQL is the one TypeScript mints, and not the other one', () => {
  // Postgres has nowhere to import a constant from, so the literal is duplicated and
  // this is the only thing keeping the copies together. Renaming the domain in
  // username.ts without touching the migration would silently open the hole again.
  //
  // Since 2026-09-13 the guard refuses the shared suffix rather than one domain:
  // self-serve signup creates real email addresses (§5.4), so every login on
  // either reserved domain is one a centre minted — exactly the population this
  // fence exists for. The suffix is derived from the TypeScript constant, and the
  // phone domain is asserted to share it, so renaming either without the other
  // fails here rather than quietly re-opening a door.
  const suffix = USERNAME_LOGIN_DOMAIN.split('.').slice(1).join('.')
  assert.ok(
    suffix === 'coachdesk.invalid',
    'the shared suffix is no longer coachdesk.invalid — update this test knowingly',
  )
  assert.ok(
    PHONE_LOGIN_DOMAIN.endsWith(`.${suffix}`),
    'the phone domain no longer shares the suffix the SQL refuses',
  )
  assert.match(SQL, new RegExp(`like '%\\.${suffix.replace(/\./g, '\\.')}'`))
})
