import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  normalizeBdMobile,
  phoneToLoginEmail,
  isPhoneLoginEmail,
  PHONE_LOGIN_DOMAIN,
} from '../src/lib/bd/phone.ts'
import {
  FALLBACK_BASE,
  isUsernameLoginEmail,
  loginEmailFor,
  loginEmailToUsername,
  normalizeUsername,
  transliterateBn,
  usernameBase,
  usernameBaseFor,
  usernameCandidate,
  USERNAME_ATTEMPTS,
  USERNAME_LOGIN_DOMAIN,
  usernameToLoginEmail,
} from '../src/lib/bd/username.ts'
import {
  createUsernameLogin,
  isEmailTakenError,
} from '../src/lib/auth/username-login.ts'

/**
 * The identifier a teacher with no phone number signs in with (MASTERPLAN.md §5.2).
 *
 * Two things are being tested here and they fail in different directions. The
 * transliteration is a *usability* claim — that a teacher recognises the output as
 * their own name — and it fails softly: `rohomana` still works as a login, it just
 * embarrasses everybody. The shape rules are a *correctness* claim: a username that
 * could be mistaken for a phone number breaks the single login field §5.3 insists
 * on, and one that grows a third digit breaks reading it aloud.
 *
 * The name table is therefore the long part. Every expectation in it is how that
 * name is actually spelled in English by Bangladeshis, not what a transliteration
 * standard would produce.
 */

/* -------------------------------------------------------------------------- */
/* The names                                                                  */
/* -------------------------------------------------------------------------- */

/** Bengali name -> how its owner spells it in English. */
const NAMES: Array<[string, string]> = [
  ['রহিম', 'rahim'],
  ['করিম', 'karim'],
  ['রফিক', 'rafik'],
  ['উদ্দিন', 'uddin'],
  ['রহমান', 'rahman'],
  ['মাহমুদ', 'mahmud'],
  ['জামশেদ', 'jamshed'],
  ['নাজমুল', 'najmul'],
  ['তানভীর', 'tanvir'],
  ['মোহাম্মদ', 'mohammad'],
  ['হাসান', 'hasan'],
  ['শাহাদাত', 'shahadat'],
  ['ইমরান', 'imran'],
  ['মুস্তাফিজ', 'mustafij'],
  ['তাসনিম', 'tasnim'],
  ['সালমা', 'salma'],
  ['নাসরিন', 'nasrin'],
  ['ফাতেমা', 'fatema'],
  ['জান্নাত', 'jannat'],
  ['আয়েশা', 'ayesha'],
  ['সাদিয়া', 'sadiya'],
  ['সুমাইয়া', 'sumaiya'],
  ['আব্দুল', 'abdul'],
  ['আমিনুল', 'aminul'],
]

test('a Bengali name comes out as the name its owner writes in English', () => {
  for (const [bengali, english] of NAMES) {
    assert.equal(transliterateBn(bengali), english, `failed on: ${bengali}`)
    assert.equal(usernameBase(bengali), english, `failed on: ${bengali}`)
  }
})

test('a name spelled with a precomposed nukta reads the same as a decomposed one', () => {
  // ড়, ঢ় and য় exist twice in Unicode and both forms are in the wild — one
  // Android keyboard emits the single character, a paste from a spreadsheet the
  // base plus U+09BC. Written as code points here rather than as characters,
  // because the entire hazard is that the two look identical in an editor.
  const NUKTA = String.fromCodePoint(0x09bc)
  const RA = String.fromCodePoint(0x09b0, 0x09be)
  const PAIRS = [
    [0x09dc, 0x09a1],
    [0x09dd, 0x09a2],
    [0x09df, 0x09af],
  ] as const

  for (const [precomposed, base] of PAIRS) {
    const where = `U+${precomposed.toString(16).toUpperCase()}`
    const collapsed = RA + String.fromCodePoint(precomposed)
    const spelled = RA + String.fromCodePoint(base) + NUKTA

    assert.equal(transliterateBn(collapsed), transliterateBn(spelled), where)

    // Pure ASCII out. A map keyed on the wrong form would still look right in the
    // line above — both spellings would miss it — and would leak the mark itself
    // into the username.
    assert.match(transliterateBn(spelled), /^[a-z]+$/, where)

    // And the mark is not decoration: য় is `y` where য is `j`.
    assert.notEqual(
      transliterateBn(spelled),
      transliterateBn(RA + String.fromCodePoint(base)),
      where,
    )
  }
})

test('an honorific is skipped, and so is an initial', () => {
  // The commonest shape of a man's name in Bangladesh, and the reason the base is
  // taken word by word instead of from word one.
  assert.equal(usernameBase('মোঃ রহিম উদ্দিন'), 'rahim')
  assert.equal(usernameBase('Md. Rahim'), 'rahim')
  assert.equal(usernameBase('A. K. M. Rahim'), 'rahim')
  assert.equal(usernameBase('মোঃ'), null)
})

test('a name typed in English transliterates to itself', () => {
  // Half the centres will type the name in English, and that must not be a second
  // code path — the scanner passes anything it does not recognise through, and the
  // ASCII filter does the rest.
  assert.equal(usernameBase('Rahim'), 'rahim')
  assert.equal(usernameBase('Tanvir Ahmed'), 'tanvir')
  assert.equal(usernameBase("O'Brien"), 'obrien')
})

test('a name that yields nothing usable yields nothing', () => {
  // Null here is not a failure, it is the signal that the centre's own name is the
  // base instead. What matters is that none of these becomes a one-letter login.
  for (const name of ['', '   ', '.', '- -', 'K.', '৭১', '০০৭', '???']) {
    assert.equal(usernameBase(name), null, `failed on: ${name}`)
  }
})

test('a reserved word is never the base', () => {
  // `support01` reads as the platform speaking, which is the opening line of a
  // phishing call. The word is skipped rather than suffixed.
  assert.equal(usernameBase('admin'), null)
  assert.equal(usernameBase('Support'), null)
  assert.equal(usernameBase('Admin Rahim'), 'rahim')
})

test('the fallback is the centre, then a word, never a random string', () => {
  // §5.2: "the centre's own short code plus a number, never a random hex string".
  assert.equal(usernameBaseFor('৭১', 'উদ্ভাস'), 'udvas')
  assert.equal(usernameBaseFor('.', '.'), FALLBACK_BASE)
  assert.match(FALLBACK_BASE, /^[a-z]+$/)

  // The teacher's own name still wins when there is one.
  assert.equal(usernameBaseFor('রহিম', 'উদ্ভাস'), 'rahim')
})

test('a long name is truncated, not refused', () => {
  const base = usernameBaseFor('Mohammadullahsiddiquee Chowdhury', 'X')

  assert.equal(base, 'mohammadullahsiddiqu')
  // And it is still a username after the suffix goes on, which is what the cap in
  // MAX_BASE is actually protecting.
  assert.equal(
    normalizeUsername(usernameCandidate(base, USERNAME_ATTEMPTS - 1)),
    usernameCandidate(base, USERNAME_ATTEMPTS - 1),
  )
})

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('every candidate for every base is itself a valid username', () => {
  // The invariant the login field rests on, asserted over the whole range rather
  // than at the ends: what a manager is handed must be what the sign-in screen
  // accepts back, or the username is unusable and nobody finds out until a teacher
  // tries it.
  for (const base of ['ali', 'rahim', 'mohammadullahsiddiqu', FALLBACK_BASE]) {
    for (let attempt = 0; attempt < USERNAME_ATTEMPTS; attempt += 1) {
      const candidate = usernameCandidate(base, attempt)
      assert.equal(normalizeUsername(candidate), candidate, `failed on: ${candidate}`)
    }
  }
})

test('the first candidate is the bare name and the rest are two digits', () => {
  assert.equal(usernameCandidate('rahim', 0), 'rahim')
  assert.equal(usernameCandidate('rahim', 1), 'rahim01')
  assert.equal(usernameCandidate('rahim', 9), 'rahim09')
  assert.equal(usernameCandidate('rahim', 99), 'rahim99')

  // §5.2 asks for "only as many digits as needed" and shows rahim01. A counter
  // that ran past its bound would otherwise produce rahim100 — a third shape for
  // one thing, and past the point where anybody reads it out correctly.
  assert.equal(usernameCandidate('rahim', USERNAME_ATTEMPTS), 'rahim00')
  assert.equal(usernameCandidate('rahim', -1), 'rahim')
})

test('a username and a phone number can never be mistaken for each other', () => {
  // What lets §5.3 have one field with no radio button. If these two sets ever
  // overlapped, the login screen would need to ask, and the answer it got would be
  // wrong for whoever misread the question.
  for (const username of ['rahim', 'rahim01', 'ali', 'udvas99', 'coach00']) {
    assert.equal(normalizeBdMobile(username), null, `failed on: ${username}`)
  }

  for (const phone of [
    '01712345678', '+8801712345678', '8801712345678', '1712345678',
    '017 1234 5678', '০১৭১২৩৪৫৬৭৮',
  ]) {
    assert.equal(normalizeUsername(phone), null, `failed on: ${phone}`)
  }
})

test('a username is normalised the way a phone actually types it', () => {
  assert.equal(normalizeUsername('Rahim'), 'rahim')
  assert.equal(normalizeUsername('RAHIM01'), 'rahim01')
  assert.equal(normalizeUsername('  rahim  '), 'rahim')
  // A Bangla keyboard for the digits the teacher sees printed as 01.
  assert.equal(normalizeUsername('rahim০১'), 'rahim01')
})

test('a mistyped username fails instead of becoming somebody else', () => {
  // Stripping the stray character would be friendlier and is the bug: `rahim.01`
  // repaired into `rahim01` is a sign-in attempt against an account that exists and
  // belongs to another teacher.
  const bad: Array<string | null | undefined> = [
    '', ' ', 'a', 'ab', 'rahim!', 'ra him', 'rahim.uddin', 'rahim_01', 'rahim-01',
    '1rahim', '_rahim', 'rahim@user.coachdesk.invalid', 'রহিম', 'a'.repeat(31),
    null, undefined,
  ]

  for (const input of bad) {
    assert.equal(normalizeUsername(input), null, `failed on: ${input}`)
  }

  assert.equal(normalizeUsername('a'.repeat(30)), 'a'.repeat(30))
})

/* -------------------------------------------------------------------------- */
/* The login address                                                          */
/* -------------------------------------------------------------------------- */

test('the two synthetic domains are separate and both unresolvable', () => {
  // §5.3: the username domain *extends* the phone one rather than replacing it, so
  // every password already in use keeps working. Both are RFC 2606 reserved, so no
  // mail addressed to a teacher's synthetic account can reach a real inbox.
  assert.match(USERNAME_LOGIN_DOMAIN, /\.invalid$/)
  assert.notEqual(USERNAME_LOGIN_DOMAIN, PHONE_LOGIN_DOMAIN)

  const username = usernameToLoginEmail('rahim')
  const phone = phoneToLoginEmail('01712345678')
  assert.ok(username)
  assert.ok(phone)

  assert.equal(username, `rahim@${USERNAME_LOGIN_DOMAIN}`)
  assert.ok(isUsernameLoginEmail(username) && !isPhoneLoginEmail(username))
  assert.ok(isPhoneLoginEmail(phone) && !isUsernameLoginEmail(phone))

  // Round trip, because a screen has to be able to show what somebody signs in
  // with — and must not show a phone number as though it were a username.
  assert.equal(loginEmailToUsername(username), 'rahim')
  assert.equal(loginEmailToUsername(phone), null)
})

test('one login field, and the server works out which it got', () => {
  assert.equal(loginEmailFor('01712345678'), phoneToLoginEmail('01712345678'))
  assert.equal(loginEmailFor('০১৭১২৩৪৫৬৭৮'), phoneToLoginEmail('01712345678'))
  assert.equal(loginEmailFor('rahim'), usernameToLoginEmail('rahim'))
  assert.equal(loginEmailFor('Rahim01'), usernameToLoginEmail('rahim01'))

  // Neither. The caller answers this with one message that does not say which half
  // of the field was wrong, because that difference is how somebody enumerates
  // which identifiers exist.
  for (const input of ['', 'ab', '0171234567', '01012345678', 'rahim!', 'রহিম']) {
    assert.equal(loginEmailFor(input), null, `failed on: ${input}`)
  }
})

test('username.ts stays importable from a client component', () => {
  // The login form is a client component and validates the field it owns, so this
  // module gets bundled for the browser. phone.ts has no imports at all; anything
  // pulled in behind it here — a Supabase client, the dictionary — would ship to a
  // phone on 3G for the sake of a regex.
  const source = readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'lib', 'bd', 'username.ts'),
    'utf8',
  )

  const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])

  assert.deepEqual([...new Set(specifiers)].sort(), ['./phone.ts'])
})

/* -------------------------------------------------------------------------- */
/* Minting the account                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A GoTrue that hands out one address and refuses the rest.
 *
 * `taken` is the set of local parts already spoken for. Every call is recorded, because
 * what is being tested is which candidates were tried and in what order — the loop's
 * whole job is to walk them, and a loop that asked for the same one twice or gave up
 * after the first refusal would still return a plausible answer.
 */
function fakeGoTrue(taken: string[], failOn?: string) {
  const asked: string[] = []

  const admin = {
    auth: {
      admin: {
        createUser({ email }: { email: string }) {
          const username = email.slice(0, email.indexOf('@'))
          asked.push(username)

          if (username === failOn) {
            return Promise.resolve({
              data: { user: null },
              error: { code: 'unexpected_failure', message: 'database is down' },
            })
          }

          if (taken.includes(username)) {
            return Promise.resolve({
              data: { user: null },
              error: { code: 'email_exists', message: 'Email address already registered' },
            })
          }

          return Promise.resolve({ data: { user: { id: `id-${username}` } }, error: null })
        },
      },
    },
  }

  return { admin: admin as unknown as Parameters<typeof createUsernameLogin>[0], asked }
}

test('a taken address is read from the code and from the older message', () => {
  // The whole collision loop rests on this one answer, and it is the difference between
  // trying `rahim01` and telling the owner their centre's login is broken.
  assert.equal(isEmailTakenError({ code: 'email_exists', message: '' }), true)
  assert.equal(isEmailTakenError({ message: 'Email address already registered' }), true)
  assert.equal(isEmailTakenError({ message: 'A user with this email already exists' }), true)
  assert.equal(isEmailTakenError({ message: 'user has already been registered' }), true)

  // Anything else is not a collision. A dead network read as one would be a hundred
  // round trips before the owner saw a message.
  assert.equal(isEmailTakenError(null), false)
  assert.equal(isEmailTakenError({ code: 'weak_password', message: 'Password too short' }), false)
  assert.equal(isEmailTakenError({ message: 'fetch failed' }), false)
})

test('the first free name is the username, and it is the one that is returned', async () => {
  // The claim §5.2 actually makes: what the owner reads out is what signs in. The
  // trigger writes `username` from the metadata and never appends a suffix, so a
  // returned name that differed from the address would be a login nobody can use.
  const { admin, asked } = fakeGoTrue(['rahim', 'rahim01'])

  const login = await createUsernameLogin(admin, 'rahim', 'Rahim', 'password123', 'bn')

  assert.deepEqual(login, { userId: 'id-rahim02', username: 'rahim02' })
  assert.deepEqual(asked, ['rahim', 'rahim01', 'rahim02'])
})

test('anything that is not a collision stops the walk', async () => {
  const { admin, asked } = fakeGoTrue([], 'rahim')

  assert.deepEqual(await createUsernameLogin(admin, 'rahim', 'Rahim', 'password123', 'bn'), {
    refused: 'failed',
  })
  assert.deepEqual(asked, ['rahim'])
})

test('a hundred namesakes is a different answer from a broken signup', async () => {
  /*
   * Bounded, and the bound is the reason the two refusals are separate values. `taken`
   * asks the owner for a different spelling of the name; `failed` asks them to submit
   * again in a minute. One of those is useless advice for the other's cause.
   */
  const all = Array.from({ length: USERNAME_ATTEMPTS }, (_, i) => usernameCandidate('ali', i))
  const { admin, asked } = fakeGoTrue(all)

  assert.deepEqual(await createUsernameLogin(admin, 'ali', 'Ali', 'password123', 'bn'), {
    refused: 'taken',
  })
  assert.equal(asked.length, USERNAME_ATTEMPTS)
})

test('the account carries the name and the locale, and no phone', async () => {
  // No `phone` key is the point of the whole exercise — this person has no number, which
  // is why they are getting a username. One written here would be a lie in auth.users.
  const sent: Array<Record<string, unknown>> = []
  const admin = {
    auth: {
      admin: {
        createUser(args: Record<string, unknown>) {
          sent.push(args)
          return Promise.resolve({ data: { user: { id: 'id-1' } }, error: null })
        },
      },
    },
  } as unknown as Parameters<typeof createUsernameLogin>[0]

  await createUsernameLogin(admin, 'rahim', 'Md. Rahim Uddin', 'password123', 'en')

  assert.equal(sent.length, 1)
  assert.equal(sent[0].email, usernameToLoginEmail('rahim'))
  assert.equal(sent[0].email_confirm, true)
  assert.deepEqual(sent[0].user_metadata, {
    full_name: 'Md. Rahim Uddin',
    username: 'rahim',
    locale: 'en',
  })
})
