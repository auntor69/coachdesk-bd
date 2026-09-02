/**
 * One-time codes for phone ownership: the half that is only arithmetic.
 *
 * Generate a code, hash one, write the text message, and read the two RPCs' answers
 * back into something a Server Action can switch on. The half that talks to Postgres
 * and to the gateway is `otp-gate.ts`.
 *
 * Split because `node --test` cannot load a module that imports 'server-only', and
 * the interesting rules — the ceilings, the vocabulary of refusals, the insistence
 * that only a literal `true` counts as verified — are all on this side of the line.
 *
 * `node:crypto` is imported below, so a client component that pulled this file in
 * would fail to build. That is the intended outcome.
 */
import { createHash, randomInt } from 'node:crypto'

import { toAsciiDigits } from '../bd/phone.ts'

/**
 * MASTERPLAN section 5.4's table, in the one place both halves and the SQL read it
 * from. `issue_phone_code` deliberately has no defaults of its own, so these travel
 * with every call rather than being written down twice.
 */
export const OTP_LENGTH = 6
export const OTP_TTL_SECONDS = 300
export const OTP_COOLDOWN_SECONDS = 60
export const OTP_MAX_ATTEMPTS = 5

/**
 * Codes per number and per IP per hour. A mistyped number is a different number and
 * so gets its own bucket, which is why the per-IP figure is the looser of the two:
 * it is the one that catches somebody working through a list.
 */
export const OTP_PER_PHONE_PER_HOUR = 5
export const OTP_PER_IP_PER_HOUR = 20

/** Only one today. Kept as a type so a future 'change my number' shares no ceiling. */
export type OtpPurpose = 'signup'

/**
 * A fresh code.
 *
 * `randomInt` and not `Math.random`: this is the only thing between a stranger and
 * somebody else's phone number, and Math.random's state can be recovered from a
 * handful of outputs. Padded rather than drawn from 100000-999999, because dropping
 * the codes that start with a zero would throw away a tenth of a space that is
 * already only a million wide.
 */
export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

/**
 * What is stored. The plaintext never reaches Postgres — not the table, not a
 * parameter in the statement log.
 *
 * Unsalted, and migration 20260811000065 argues that out at length: six digits is a
 * million preimages, so a hash somebody can read is a hash they have already solved,
 * and reading it needs the key that reads everything anyway. Binding the number and
 * the purpose in is free, and means a row lifted from one signup cannot be replayed
 * as another number's code.
 */
export function hashOtp(phone: string, purpose: OtpPurpose, code: string): string {
  return createHash('sha256').update(`${phone}:${purpose}:${code}`).digest('hex')
}

/**
 * What the visitor typed, as digits, or null if it cannot be a code at all.
 *
 * Bangla numerals fold to ASCII exactly as they do everywhere else in the product:
 * somebody on a Bangla keyboard reads ৩৪৫৬৭৮ off their screen and types it back.
 */
export function readTypedOtp(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = toAsciiDigits(input).replace(/\D/g, '')
  return digits.length === OTP_LENGTH ? digits : null
}

/**
 * The message itself. English, which is not laziness: Bangla forces UCS-2 and a
 * 70-character segment, so this sentence would cost two SMS instead of one — and
 * every code a Bangladeshi has ever been sent, by bKash, Nagad or a bank, is in
 * English. A Bangla one would read as the phishing attempt.
 */
export function otpSmsBody(code: string): string {
  return (
    `CoachDesk verification code: ${code}. `
    + `Expires in ${OTP_TTL_SECONDS / 60} minutes. Do not share it.`
  )
}

/**
 * What issuing a code came back as. `expiresIn` is seconds, for the countdown.
 *
 * 'unknown' is every answer that was not one of the others — a shape nobody wrote, a
 * null, an object with an `ok` that is a string. Refusing what cannot be read is the
 * whole reason these two functions exist rather than a cast.
 */
export type IssueOutcome =
  | { ok: true; expiresIn: number }
  | { ok: false; reason: 'cooldown'; wait: number }
  | { ok: false; reason: 'phone_limit' | 'ip_limit' | 'unknown' }

function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null
}

export function readIssueOutcome(payload: unknown): IssueOutcome {
  const row = asRecord(payload)
  if (!row) return { ok: false, reason: 'unknown' }

  if (row.ok === true) {
    const seconds = typeof row.expiresIn === 'number' ? row.expiresIn : OTP_TTL_SECONDS
    return { ok: true, expiresIn: seconds }
  }

  if (row.reason === 'cooldown') {
    // At least a second, so a countdown never starts at zero and invites the tap that
    // is about to be refused. A missing number falls back to the whole cooldown.
    const wait = typeof row.wait === 'number' ? row.wait : OTP_COOLDOWN_SECONDS
    return { ok: false, reason: 'cooldown', wait: Math.max(1, Math.ceil(wait)) }
  }

  if (row.reason === 'phone_limit' || row.reason === 'ip_limit') {
    return { ok: false, reason: row.reason }
  }

  return { ok: false, reason: 'unknown' }
}

/**
 * What checking a code came back as.
 *
 * 'none' covers never asked, already used, already burned and already swept — one
 * answer for four states on purpose, since telling them apart would tell a script
 * which numbers are mid-signup and the sentence is 'ask for a new code' either way.
 */
export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'wrong'; left: number }
  | { ok: false; reason: 'none' | 'expired' | 'burned' | 'unknown' }

export function readVerifyOutcome(payload: unknown): VerifyOutcome {
  const row = asRecord(payload)
  if (!row) return { ok: false, reason: 'unknown' }

  // `=== true` and nothing looser. This is the one boolean in the product where a
  // truthy string would hand a stranger somebody else's phone number.
  if (row.ok === true) return { ok: true }

  if (row.reason === 'wrong') {
    const left = typeof row.left === 'number' ? row.left : 0
    return { ok: false, reason: 'wrong', left: Math.max(0, Math.floor(left)) }
  }

  if (row.reason === 'none' || row.reason === 'expired' || row.reason === 'burned') {
    return { ok: false, reason: row.reason }
  }

  return { ok: false, reason: 'unknown' }
}

