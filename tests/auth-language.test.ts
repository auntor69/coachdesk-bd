/**
 * The (auth) screens read the reader's language, and the switch that lets them change it.
 *
 * WHAT THIS FILE IS GUARDING, and it is a defect rather than a preference. Three separate
 * notes in the codebase describe the same behaviour in the same words:
 *
 *   - `lib/i18n/server.ts`: "an English reader who signs out does not get handed a Bangla
 *     login form".
 *   - `lib/i18n/actions.ts`, on where `setLocale` lives: "the login screen offers it to
 *     somebody who cannot read the form yet".
 *   - `components/language-switch.tsx`: "It is also the only sensible answer for the login
 *     screen, where the whole point is that somebody who cannot read the form can still
 *     change it."
 *
 * None of it was true. The two screens a signed-out reader reaches were Bangla by hand, they
 * read no locale, and the switch those notes name them for was drawn on neither — so the one
 * reader the switch exists for had a form they could not read and no control to say so. A
 * code comment is a substring like any other, so the check has to be on the drawing: the
 * locale read, the switch rendered, and no copy typed into the forms.
 *
 * The four assertions that carry the weight, in order: the screens ask the cookie (not a
 * session they do not have), they draw the switch, the forms are handed the group they draw
 * and hold no sentences of their own, and the three sentences a browser has to compose are
 * `{...}` templates filled on the side that owns the number. That last one is the failure mode
 * of a client form: a function leaf cannot cross into a client component at all, so a
 * count-dependent sentence written as one would 500 the login screen rather than mis-set a
 * digit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { dict, LOCALES } from '../src/lib/i18n/index.ts'
import { fill } from '../src/lib/i18n/fill.ts'

const ROOT = path.join(import.meta.dirname, '..')

const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

/**
 * A file with its prose taken off.
 *
 * The rule below is "this form types no Bangla of its own", and every one of these files
 * explains itself at length — in English, but quoting the Bangla strings it moved out. A
 * comment is a substring like any other, so a check that did not strip them would pass on a
 * form that had gone back to hardcoding its labels.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const LOGIN_PAGE = read('src', 'app', '(auth)', 'login', 'page.tsx')
const LOGIN_FORM = read('src', 'app', '(auth)', 'login-form.tsx')
const SIGNUP_PAGE = read('src', 'app', '(auth)', 'signup', 'page.tsx')
const SIGNUP_FORM = read('src', 'app', '(auth)', 'signup-form.tsx')
const ONBOARDING_PAGE = read('src', 'app', '(auth)', 'onboarding', 'page.tsx')
const ONBOARDING_FORM = read('src', 'app', '(auth)', 'onboarding-form.tsx')

const BENGALI = /[ঀ-৲৴-৿]/

/* -------------------------------------------------------------------------- */
/* The locale, which no signed-out screen can get from a session             */
/* -------------------------------------------------------------------------- */

test('both screens a signed-out reader reaches ask the cookie for their language', () => {
  for (const [name, page] of [
    ['login', LOGIN_PAGE],
    ['signup', SIGNUP_PAGE],
  ] as const) {
    assert.match(page, /await readerLocale\(\)/, `${name}/page.tsx reads no locale`)
    assert.match(page, /dict\(locale\)\.auth/, `${name} does not use the auth group`)
    // `readerLocale` and not a session read: there is no session on either screen, which is
    // exactly why the cookie is the only record of what this reader can read.
    assert.doesNotMatch(page, /getSession\(\)[\s\S]{0,200}session\.locale/)
  }
})

test('and both draw the switch, which is the control those screens were named for', () => {
  for (const [name, page] of [
    ['login', LOGIN_PAGE],
    ['signup', SIGNUP_PAGE],
  ] as const) {
    assert.match(page, /import \{ LanguageSwitch \} from '@\/components\/language-switch'/)
    assert.match(page, /<LanguageSwitch locale=\{locale\} \/>/, `${name} offers no switch`)
  }
})

test('and their titles follow the reader, like every other page in the product', () => {
  for (const [name, page] of [
    ['login', LOGIN_PAGE],
    ['signup', SIGNUP_PAGE],
    ['onboarding', ONBOARDING_PAGE],
  ] as const) {
    assert.match(page, /export async function generateMetadata\(\): Promise<Metadata>/)
    assert.match(page, /auth\.\w+\.title/, `${name} does not name its page title`)
  }

  // And with that, not one word of Bangla survives outside the dictionaries: the three
  // screens a reader meets before they have a workspace are wholly the reader's own language,
  // body and title alike. A hand-typed string here is a string no switch can reach.
  for (const page of [LOGIN_PAGE, SIGNUP_PAGE, ONBOARDING_PAGE]) {
    assert.doesNotMatch(codeOnly(page), BENGALI)
  }
})

test('the signup screen quotes the password rule the action refuses on', () => {
  // Not a second wording of it. `MIN_PASSWORD` is the number in this sentence and the number
  // `createAccount` checks, and this is one of the two screens `common.passwordTooShort` was
  // written for — a form that refuses at eight while telling the reader six is somebody who
  // cannot sign up and cannot tell why.
  assert.match(SIGNUP_PAGE, /passwordTooShort\(locale\)/)
  assert.doesNotMatch(codeOnly(SIGNUP_PAGE), /MIN_PASSWORD/)
})

/* -------------------------------------------------------------------------- */
/* The forms hold no copy of their own                                       */
/* -------------------------------------------------------------------------- */

test('no sentence on any of the three forms is typed into it', () => {
  for (const [name, form] of [
    ['login-form.tsx', LOGIN_FORM],
    ['signup-form.tsx', SIGNUP_FORM],
    ['onboarding-form.tsx', ONBOARDING_FORM],
  ] as const) {
    const code = codeOnly(form)
    assert.doesNotMatch(
      code,
      BENGALI,
      `${name} still has Bangla copy in it — every word here has to come from \`t\``,
    )
    // And the two English words that were left behind in one of them: "name@gmail.com" is a
    // format, not a sentence, and it is the same in both languages; everything else moved.
    assert.doesNotMatch(code, /'Log in'|'Create account'|'Password'/)
  }
})

test('each form is handed its group, typed, so a removed key fails the build', () => {
  assert.match(LOGIN_FORM, /t: T<'auth'>\['login'\]/)
  assert.match(SIGNUP_FORM, /t: T<'auth'>\['signup'\]/)
  assert.match(ONBOARDING_FORM, /t: T<'auth'>\['onboarding'\]/)

  assert.match(LOGIN_PAGE, /t=\{t\.login\}/)
  assert.match(SIGNUP_PAGE, /t=\{t\.signup\}/)
})

/* -------------------------------------------------------------------------- */
/* Every sentence a browser has to write is a template                       */
/* -------------------------------------------------------------------------- */

test('the sentences the browser composes are templates filled with a number', () => {
  // `state.sentTo` is browser state, so the sentence naming it cannot be written on the
  // server. This one is split rather than filled, because the address inside it is the word
  // the reader checks against the inbox they just opened: it keeps its weight and, more to
  // the point, `break-all` — a thirty-character address with no wrap runs off a 320px phone.
  assert.match(SIGNUP_FORM, /const \[codeSentBefore, codeSentAfter\] = t\.codeSent\.split\('\{email\}'\)/)
  assert.match(SIGNUP_FORM, /<span className="font-semibold text-ink break-all">\{state\?\.sentTo\}<\/span>/)
  assert.match(SIGNUP_FORM, /\{codeSentBefore\}/)
  assert.match(SIGNUP_FORM, /\{codeSentAfter\}/)
  // The resend countdown, in the reader's own numerals rather than Bangla ones for everybody.
  assert.match(SIGNUP_FORM, /fill\(t\.resendWait, \{ n: digits\(wait, locale\) \}\)/)
  // The trial offer, whose length and closing verb both depend on the answer chosen here.
  assert.match(ONBOARDING_FORM, /fill\(t\.trialLine/)
  assert.match(ONBOARDING_FORM, /days: digits\(days, locale\)/)

  // None of the three came across as a function, which React refuses to serialise: `T<'auth'>`
  // poisons function leaves, and a group that grew one would fail `tsc` in the form's own
  // prop type rather than 500 the login screen.
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries({
      'auth.signup.codeSent': dict(locale).auth.signup.codeSent,
      'auth.signup.resendWait': dict(locale).auth.signup.resendWait,
      'auth.onboarding.trialLine': dict(locale).auth.onboarding.trialLine,
    })) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a template`)
    }
  }
})

test('the free line inflects in English, where Bangla does not', () => {
  // The free tier is one batch, so the plural wording would have shipped as "1 batches" on
  // the screen every new centre reads — the class of bug this product's own notes single out
  // ("1 days late is the first thing an English-medium teacher notices"). The page picks
  // between the two templates off the tier itself, so the wording cannot drift from the cap.
  assert.match(SIGNUP_PAGE, /FREE_BATCHES === 1 \? t\.signup\.freeLineOne : t\.signup\.freeLine/)
  assert.match(SIGNUP_PAGE, /FREE\.maxBatches \?\? 1/)

  const one = fill(dict('en').auth.signup.freeLineOne, { batches: 1, students: 30 })
  const many = fill(dict('en').auth.signup.freeLine, { batches: 3, students: 90 })
  assert.doesNotMatch(one, /1 batches/, one)
  assert.match(one, /1 batch\b/, one)
  assert.match(many, /3 batches/, many)

  // Both take the same values, so a translator cannot fill one and leave the other standing.
  for (const locale of LOCALES) {
    for (const text of [
      dict(locale).auth.signup.freeLine,
      dict(locale).auth.signup.freeLineOne,
    ]) {
      assert.match(text, /\{batches\}/)
      assert.match(text, /\{students\}/)
    }
  }
})

/* -------------------------------------------------------------------------- */
/* The onboarding screen, which has a session and uses it                    */
/* -------------------------------------------------------------------------- */

test('onboarding reads the reader it already has, and hands the form its language', () => {
  // This screen is reached with a session, so `session.locale` is the answer — and it was
  // already being read for the refusal card, which is how a Bangla form came to sit under an
  // English sentence about somebody's account.
  assert.match(ONBOARDING_PAGE, /const d = dict\(session\.locale\)\n  const t = d\.noCenter\n  const a = d\.auth\.onboarding/)
  assert.match(ONBOARDING_PAGE, /t=\{a\}/)
  assert.match(ONBOARDING_PAGE, /locale=\{session\.locale\}/)
  // The greeting is the one sentence the page writes itself, and it carries a name.
  assert.match(ONBOARDING_PAGE, /fill\(a\.welcomeNamed, \{ name: session\.fullName \}\)/)

  const code = codeOnly(ONBOARDING_PAGE)
  assert.doesNotMatch(code, /স্বাগতম/, 'the greeting is still typed into the page')
})

/* -------------------------------------------------------------------------- */
/* And the words themselves exist, in both languages                         */
/* -------------------------------------------------------------------------- */

test('the group is a translation and not the same copy pasted twice', () => {
  for (const locale of LOCALES) {
    const t = dict(locale).auth
    for (const [key, value] of Object.entries({
      'login.tagline': t.login.tagline,
      'login.submit': t.login.submit,
      'signup.codeSent': t.signup.codeSent,
      'signup.resendWait': t.signup.resendWait,
      'onboarding.trialLine': t.onboarding.trialLine,
      'onboarding.modes.teacher.title': t.onboarding.modes.teacher.title,
    })) {
      assert.ok(value.trim(), `${locale}.auth.${key} is empty`)
    }

    // Filled here rather than asserted as a template: an unfilled `{n}` on the login screen
    // reads as a broken build to the reader and as a passing test to everyone else.
    for (const text of [
      fill(t.signup.codeSent, { email: 'rafiq@example.com' }),
      fill(t.signup.resendWait, { n: 42 }),
      fill(t.onboarding.trialLine, { days: 14, how: t.onboarding.thenTopUp }),
    ]) {
      assert.doesNotMatch(text, /\{[a-z]+\}/, text)
    }
  }

  for (const key of ['tagline', 'submit', 'forgot'] as const) {
    assert.notEqual(
      dict('bn').auth.login[key],
      dict('en').auth.login[key],
      `auth.login.${key} is identical in both languages`,
    )
  }

  // The one every account kind gets: a fourth kind added to `ACCOUNT_KINDS` without copy
  // fails `tsc` in the form's prop type, and this is the runtime half of the same rule.
  for (const locale of LOCALES) {
    for (const kind of ['teacher', 'center', 'institution'] as const) {
      const mode = dict(locale).auth.onboarding.modes[kind]
      assert.ok(mode.title && mode.body && mode.nameLabel && mode.namePlaceholder, kind)
    }
  }
})
