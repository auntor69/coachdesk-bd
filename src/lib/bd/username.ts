/**
 * A teacher's username — the identifier for somebody who has no phone number.
 *
 * MASTERPLAN.md §5.1 keeps a *teacher record* and a *login account* apart: a
 * part-timer who takes two batches a week has to exist in the register whether or
 * not they ever open the app, and `teachers.user_id` has been nullable since the
 * first migration for exactly that reason. §5.2 is the other half — how you give
 * that person an account *afterwards*, when the only thing the centre knows about
 * them is their name.
 *
 * WHY NOT THEIR PHONE NUMBER. Because a teacher's number is optional and always
 * will be. Plenty of part-timers will not give one, plenty of owners do not have
 * it to hand, and requiring it turns "give Karim a login" into a phone call.
 * Requiring OTP on it would be worse: there is no BTRC sender ID to send one
 * through, so a teacher OTP would block staff logins on an external approval with
 * no date on it.
 *
 * WHY NOT A RANDOM STRING. Because of the moment this identifier is used. An
 * owner reads it out across a staffroom and the teacher types it into a phone
 * they are holding at arm's length, once, months later. `usr_8f92a1c` fails at
 * exactly that moment; `rahim` does not. So the name is transliterated, and the
 * only thing added to it is a two-digit number when somebody else got there
 * first.
 *
 * GENERATED HERE, NEVER PROPOSED BY THE BROWSER. This module is pure and runs on
 * the server; the form posts a *name*, and the username is derived from it. A
 * username the browser chose is a username an attacker chose — `admin`, or the
 * one belonging to a teacher at a centre down the road.
 *
 * WHAT MAKES IT UNIQUE IS NOT THIS FILE. These functions produce candidates in
 * order; the database refuses the ones that are taken. `auth.users.email` is
 * unique and the username is its local part, so two managers creating `rahim` in
 * the same second get `rahim` and `rahim01` — a SELECT that found nothing is not
 * a reservation. See settings/actions.ts for the loop that walks the candidates.
 */

import { phoneToLoginEmail, toAsciiDigits } from './phone.ts'

/**
 * Bengali is an abugida: a bare consonant already carries a vowel, so the map
 * below is only half the job and the rules further down are the other half.
 *
 * The romanisations are the ones Bangladeshis write their own names with rather
 * than a scholarly scheme — ফ is `f` because রফিক signs himself Rafik, ভ is `v`
 * because তানভীর signs himself Tanvir, and the inherent vowel is `a` because
 * রহমান is Rahman on every certificate he owns. A transliteration nobody
 * recognises as their own name would be a random string with extra steps.
 */
const CONSONANTS: Record<string, string> = {
  ক: 'k', খ: 'kh', গ: 'g', ঘ: 'gh', ঙ: 'ng',
  চ: 'ch', ছ: 'chh', জ: 'j', ঝ: 'jh', ঞ: 'n',
  ট: 't', ঠ: 'th', ড: 'd', ঢ: 'dh', ণ: 'n',
  ত: 't', থ: 'th', দ: 'd', ধ: 'dh', ন: 'n',
  প: 'p', ফ: 'f', ব: 'b', ভ: 'v', ম: 'm',
  য: 'j', র: 'r', ল: 'l',
  শ: 'sh', ষ: 'sh', স: 's', হ: 'h',
  // Nukta forms, and the only keys here that cannot be checked by eye. These
  // three exist twice in Unicode — as one precomposed character and as a base
  // plus U+09BC — and the two forms render identically, so an editor that
  // normalises on save could swap them without a visible diff. The keys below
  // are the *decomposed* pair, matching bn.ts, and the scanner decomposes its
  // input before looking anything up (see PRECOMPOSED). tests/username.test.ts
  // asserts both halves of that by code point, which is the only way it stays
  // true.
  ['ড়']: 'r', // ড় = ড + U+09BC
  ['ঢ়']: 'rh', // ঢ় = ঢ + U+09BC
  ['য়']: 'y', // য় = য + U+09BC
}

/**
 * The vowel *signs* — the marks that hang off a consonant and replace the vowel
 * it already carried. Distinct from the independent vowels below, which are
 * letters in their own right, because only these two forms of the same sound
 * decide whether a preceding consonant keeps its inherent `a`.
 */
// Quoted keys, unlike the consonants above: a vowel sign is a combining mark, and
// a combining mark cannot start a JavaScript identifier, so a bare key here is a
// syntax error rather than a bad idea.
const VOWEL_SIGNS: Record<string, string> = {
  'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri',
  'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou',
}

/** The same sounds as letters, used at the start of a word or after a vowel. */
const VOWELS: Record<string, string> = {
  অ: 'o', আ: 'a', ই: 'i', ঈ: 'i', উ: 'u', ঊ: 'u',
  ঋ: 'ri', এ: 'e', ঐ: 'oi', ও: 'o', ঔ: 'ou',
}

const NUKTA = '়'
/** Hasant/virama — "this consonant has no vowel", which is how ক্ত is one cluster. */
const HASANT = '্'
/** Anusvara ং, as in বাংলা. A nasal with no vowel of its own, ever. */
const ANUSVARA = 'ং'
/** Khanda ta ৎ, as in উৎসব. A bare `t`, never with a vowel. */
const KHANDA_TA = 'ৎ'

/**
 * Marks that carry no sound worth romanising: candrabindu ঁ and visarga ঃ.
 * Dropped rather than mapped, because `mo` is what somebody types for মোঃ and
 * `moh` is not.
 */
const SILENT = new Set(['ঁ', 'ঃ', 'ঽ'])

/**
 * The three precomposed nukta characters, mapped to the base-plus-nukta pairs the
 * scanner understands. A name arrives as whatever the phone's keyboard produced,
 * and both forms are in the wild — Android's Bangla keyboard emits one, a paste
 * from a spreadsheet often the other. Without this, রায় transliterates as `raj`
 * on one phone and `ray` on another, which is two different usernames for one
 * teacher.
 */
const PRECOMPOSED: Array<[RegExp, string]> = [
  [/ড়/g, 'ড়'],
  [/ঢ়/g, 'ঢ়'],
  [/য়/g, 'য়'],
]

/**
 * One unit of a Bengali word, after the vowel question has been settled for it:
 * a consonant with whatever vowel turned out to follow it, or a sound that
 * stands on its own.
 *
 * The scan is two passes rather than one because the inherent vowel cannot be
 * decided while reading left to right — whether রহমান's হ keeps its `a` depends
 * on what the *next* consonant carries, which the scanner has not reached yet.
 */
type Token =
  | { kind: 'consonant'; letters: string; vowel: string | null; bare: boolean }
  | { kind: 'sound'; letters: string }

/** Precomposed nukta characters to base + U+09BC, so the maps need one key each. */
function decompose(word: string): string {
  let out = word
  for (const [precomposed, pair] of PRECOMPOSED) out = out.replace(precomposed, pair)
  return out
}

function tokenize(word: string): Token[] {
  const s = decompose(word)
  const tokens: Token[] = []
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (SILENT.has(ch)) {
      i += 1
      continue
    }

    if (ch === ANUSVARA || ch === KHANDA_TA) {
      tokens.push({ kind: 'sound', letters: ch === ANUSVARA ? 'ng' : 't' })
      i += 1
      continue
    }

    const vowel = VOWELS[ch]
    if (vowel) {
      tokens.push({ kind: 'sound', letters: vowel })
      i += 1
      continue
    }

    // A consonant, plus its nukta if it has one — two characters that are one
    // letter, which is why this is not a plain per-character lookup.
    const key = s[i + 1] === NUKTA ? ch + NUKTA : ch
    const letters = CONSONANTS[key]
    if (letters) {
      i += key.length

      const sign = VOWEL_SIGNS[s[i]]
      if (sign) {
        tokens.push({ kind: 'consonant', letters, vowel: sign, bare: false })
        i += 1
      } else if (s[i] === HASANT) {
        // Hasant is the script saying "no vowel here" out loud, which is the one
        // case that needs no inference: ক্ত is `kt`.
        tokens.push({ kind: 'consonant', letters, vowel: null, bare: true })
        i += 1
      } else {
        tokens.push({ kind: 'consonant', letters, vowel: null, bare: false })
      }
      continue
    }

    // Not Bengali: a Latin letter, a digit, a full stop after an initial. Kept
    // verbatim and cleaned up by usernameBase, so that a name typed in English
    // transliterates to itself rather than to nothing.
    tokens.push({ kind: 'sound', letters: ch })
    i += 1
  }

  return tokens
}

/** The next consonant after `from`, which is what decides the inherent vowel. */
function nextConsonant(tokens: Token[], from: number) {
  for (let k = from + 1; k < tokens.length; k += 1) {
    const token = tokens[k]
    if (token.kind === 'consonant') return token
  }
  return null
}

/**
 * One Bengali word in ASCII letters.
 *
 * THE INHERENT VOWEL IS THE WHOLE DIFFICULTY. A bare consonant carries an `a`
 * that is not written anywhere, and Bengali drops it in places a map cannot
 * express. Four rules, in this order:
 *
 *   1. An explicit vowel sign wins.               রহিম -> ra-hi-m
 *   2. A hasant says there is no vowel.           উদ্দিন -> u-d-di-n
 *   3. The last consonant of a word drops it.     রহিম -> rahim, not rahima
 *   4. So does a middle consonant whose next      ইমরান -> imran, not imaran
 *      consonant carries a vowel of its own —
 *      unless it is the first letter, which       করিম -> karim, not krim
 *      always keeps it.
 *
 * Rule 4 is the one worth arguing with, and it is why রহমান comes out `rahman`
 * (first letter keeps it, হ drops it) while মাহমুদ comes out `mahmud`. Both are
 * how those two men spell their own names in English, which is the only test
 * this function has to pass — it romanises names, and a scholarly scheme that
 * produced `rohomana` would be correct and useless.
 */
export function transliterateBn(word: string): string {
  const tokens = tokenize(word)
  let out = ''

  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k]

    out += token.letters
    if (token.kind === 'sound' || token.bare) continue

    if (token.vowel) {
      out += token.vowel
      continue
    }

    const next = nextConsonant(tokens, k)
    if (!next) continue
    if (k > 0 && next.vowel) continue

    out += 'a'
  }

  return out
}

/**
 * THE SHAPE, and why it is this narrow. §5.3 puts one field on the login screen
 * labelled "Phone number or username" and lets the server work out which it got.
 * That dispatch is only unambiguous if the two sets cannot overlap — so a
 * username must begin with a letter, because `normalizeBdMobile` accepts nothing
 * that does. Everything after that is a letter or a digit: no dots, no
 * underscores, no hyphens, because this identifier gets read aloud across a
 * staffroom and "rahim underscore two" is a support call.
 */
const USERNAME_RE = /^[a-z][a-z0-9]{2,29}$/

/** Three, so `ali` is a username and a stray `k` cannot become somebody's login. */
export const MIN_USERNAME = 3

/**
 * Twenty, which leaves room for the suffix inside the thirty the column allows. A
 * truncated base is still recognisable; a rejected one is a manager retyping a
 * name that was correct.
 */
const MAX_BASE = 20

/**
 * Bases that are never handed out, because of what somebody would assume on
 * hearing them. `admin` and `support` read as the platform speaking rather than
 * a colleague, which is the first half of a phishing call — and suffixing them
 * does not help, since `support01` reads exactly the same way.
 *
 * A word on this list is skipped rather than fixed up, so the next word of the
 * name is tried. Nobody in Bangladesh is first-named any of these.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'owner', 'founder', 'support', 'help',
  'staff', 'system', 'security', 'billing', 'payment', 'coachdesk', 'coachdeskbd',
  'test', 'demo', 'user', 'teacher', 'api', 'app', 'www', 'mail', 'info', 'null',
])

/** One word of a name as a base, or null if it yields nothing worth using. */
function baseFromWord(word: string): string | null {
  const ascii = transliterateBn(word).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (ascii.length < MIN_USERNAME) return null
  // A leading digit would be a shape the login dispatch has to think about.
  if (!/^[a-z]/.test(ascii)) return null

  const base = ascii.slice(0, MAX_BASE)
  return RESERVED.has(base) ? null : base
}

/**
 * The base for a person's name, or null if the name yields nothing usable.
 *
 * WORD BY WORD, FIRST ONE THAT WORKS — and that is not a fallback, it is how
 * names are actually entered here. "মোঃ রহিম উদ্দিন" is the commonest shape of a
 * man's name in Bangladesh and its first word is an honorific: মোঃ transliterates
 * to `mo`, which is under the minimum, so the base is `rahim`. "A. K. M. Rahim"
 * lands in the same place for the same reason. Taking word one unconditionally
 * would have given a staffroom full of teachers called `mo01`, `mo02`, `mo03`.
 */
export function usernameBase(name: string): string | null {
  for (const word of name.trim().split(/\s+/)) {
    const base = baseFromWord(word)
    if (base) return base
  }

  return null
}

/**
 * The last resort, for a name that transliterates to nothing usable — a single
 * initial, punctuation, an emoji. §5.2 is explicit that this is "the centre's own
 * short code plus a number, never a random hex string", so the centre's name is
 * transliterated the same way and used as the base: a teacher at উদ্ভাস gets
 * `udvas01` rather than `usr_8f92a1c`, and the owner reading it out knows where
 * it came from.
 *
 * `coach` is the floor under that, for when the centre's name is unusable too. A
 * plain word, still sayable down a phone line, and never a random string.
 */
export const FALLBACK_BASE = 'coach'

export function usernameBaseFor(teacherName: string, centerName: string): string {
  return usernameBase(teacherName) ?? usernameBase(centerName) ?? FALLBACK_BASE
}

/**
 * How many candidates a caller may walk before giving up. A hundred, which is
 * also why the suffix is exactly two digits.
 */
export const USERNAME_ATTEMPTS = 100

/**
 * Candidate number `attempt` for a base: the bare base first, then `01`, `02`.
 *
 * FIXED WIDTH, SO THE DIGITS NEVER GROW. §5.2 asks for "only as many digits as
 * needed" and shows `rahim01`; an incrementing counter would eventually produce
 * `rahim1`, `rahim10`, `rahim100` — three shapes for one thing, and the third is
 * past the point where anybody reads it out correctly. The modulo is what keeps
 * that true no matter what a caller passes, rather than a comment asking it not
 * to.
 *
 * A hundred collisions on one base means a hundred teachers named Rahim across
 * the whole platform, at which point the honest answer is the one the action
 * gives: ask for a spelling of the name that differs.
 */
export function usernameCandidate(base: string, attempt: number): string {
  if (attempt <= 0) return base
  return `${base}${String(attempt % USERNAME_ATTEMPTS).padStart(2, '0')}`
}

/**
 * The second reserved domain, and the reason there are two.
 *
 * §5.3: usernames "extend the reserved-domain trick with a second reserved domain
 * rather than replacing it, so every existing password keeps working and nobody
 * is re-signed-up". A teacher who signs in with a number today keeps the address
 * derived from that number; a teacher with no number gets one derived from their
 * username. One account still has exactly one login address.
 *
 * SEPARATE DOMAINS, NOT ONE SHARED ONE, because the local parts would otherwise
 * share a namespace: `8801712345678@…` is a phone and `rahim@…` is a username,
 * and nothing but a regex would tell them apart if a future migration ever had to
 * work out which is which. `.invalid` is the RFC 2606 reserved TLD phone.ts
 * already relies on — DNS can never resolve it, so nothing addressed to a
 * teacher's synthetic account can reach a real inbox.
 */
export const USERNAME_LOGIN_DOMAIN = 'user.coachdesk.invalid'

/**
 * A typed identifier as a username, or null if it is not one.
 *
 * LOWERCASED, AND BANGLA DIGITS FOLDED, because of the keyboard this gets typed
 * on. A phone capitalises the first letter of a text field by default, and a
 * Bangla keyboard produces ০১ where the teacher sees 01 printed on the slip they
 * were handed. `Rahim01` and `rahim০১` are both `rahim01`.
 *
 * NOTHING ELSE IS REPAIRED. A stray character fails the shape test instead of
 * being stripped out, because stripping is how a typo turns into a *different*
 * account that happens to exist.
 */
export function normalizeUsername(input: string | null | undefined): string | null {
  if (!input) return null

  const cleaned = toAsciiDigits(input).trim().toLowerCase()
  return USERNAME_RE.test(cleaned) ? cleaned : null
}

export function usernameToLoginEmail(input: string): string | null {
  const username = normalizeUsername(input)
  if (!username) return null
  // rahim -> rahim@user.coachdesk.invalid
  return `${username}@${USERNAME_LOGIN_DOMAIN}`
}

export function isUsernameLoginEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(`@${USERNAME_LOGIN_DOMAIN}`))
}

/** Recovers the username from a synthetic login address. */
export function loginEmailToUsername(email: string): string | null {
  if (!isUsernameLoginEmail(email)) return null
  return normalizeUsername(email.split('@')[0])
}

/**
 * §5.3's dispatch, which is the entire login screen: "if it normalises as a BD
 * mobile it is a phone, otherwise it is a username. No radio button, no second
 * tab, no 'are you a teacher?' question."
 *
 * The order reads like a preference and is not one. The two sets cannot overlap —
 * a username starts with a letter and every form of a mobile number starts with a
 * digit — so whichever branch answers is the only branch that could have. Null
 * means neither, which the caller turns into one deliberately unhelpful message:
 * telling somebody *which* half of the field they got wrong is how an attacker
 * learns which identifiers exist.
 */
export function loginEmailFor(identifier: string): string | null {
  return phoneToLoginEmail(identifier) ?? usernameToLoginEmail(identifier)
}

