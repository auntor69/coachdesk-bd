/**
 * Bangladeshi mobile number handling.
 *
 * Every SMS costs real money and every wrong digit means a parent never hears
 * about their child's exam. So numbers are normalised once, on the way in, and
 * stored in exactly one canonical shape: E.164 (+8801XXXXXXXXX).
 *
 * People will type all of these, and all of them are the same number:
 *   01712345678      017 1234 5678      +8801712345678
 *   8801712345678    ০১৭১২৩৪৫৬৭৮ (Bangla digits, from a Bangla keyboard)
 */

/**
 * Live BD mobile series, keyed by the digit after the leading 0 (BTRC national
 * numbering plan). 010 and 012 are unallocated; 011 was Citycell, shut in 2016.
 *
 * Since number portability arrived in 2018 a prefix no longer tells you the
 * current operator, so this is used for validation only — never for routing or
 * per-operator SMS pricing. That needs an MNP/HLR lookup.
 */
const OPERATOR_DIGITS = new Set([
  '3', // 013 Grameenphone
  '4', // 014 Banglalink
  '5', // 015 Teletalk
  '6', // 016 Airtel (Robi Axiata)
  '7', // 017 Grameenphone
  '8', // 018 Robi
  '9', // 019 Banglalink
])

const BANGLA_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

/** Converts Bangla numerals to ASCII so both keyboards behave identically. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => BANGLA_DIGITS[d] ?? d)
}

/**
 * Returns the number as +8801XXXXXXXXX, or null if it is not a valid BD mobile.
 * Landlines are rejected on purpose: we only ever send SMS.
 */
export function normalizeBdMobile(input: string | null | undefined): string | null {
  if (!input) return null

  // Strip everything a human might add: spaces, dashes, brackets, dots.
  let digits = toAsciiDigits(input).replace(/[^\d+]/g, '')

  if (digits.startsWith('+')) digits = digits.slice(1)

  // 8801XXXXXXXXX -> 01XXXXXXXXX
  if (digits.startsWith('880')) digits = digits.slice(3)

  // Some people write 1712345678 without the leading zero.
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`

  if (digits.length !== 11) return null
  if (!digits.startsWith('01')) return null
  if (!OPERATOR_DIGITS.has(digits[2])) return null

  return `+880${digits.slice(1)}`
}

export function isValidBdMobile(input: string | null | undefined): boolean {
  return normalizeBdMobile(input) !== null
}

/** Local display form, which is how Bangladeshis actually read a number. */
export function formatBdMobile(e164: string | null | undefined): string {
  if (!e164) return ''
  const normalized = normalizeBdMobile(e164)
  if (!normalized) return e164
  return `0${normalized.slice(4)}`
}

/**
 * Supabase requires an email or a phone to create a user, and real phone auth
 * needs a registered SMS sender ID we will not have until Month 2. Teachers and
 * students therefore sign in with phone + password, which we map onto a stable
 * synthetic address. The real number also lives in profiles.phone, so switching
 * to genuine phone auth later is a data migration, not a re-signup.
 *
 * The domain is an RFC 2606 reserved TLD, so DNS can never resolve it and no
 * mail addressed to a subscriber's phone number can leak to a real inbox. A
 * domain we merely happen not to own would not give that guarantee.
 *
 * CONSTRAINT THIS IMPOSES, verified against the live project: GoTrue's *public*
 * signUp endpoint rejects reserved TLDs outright ("Email address ... is
 * invalid"), while auth.admin.createUser accepts them. Accounts must therefore
 * be created through the admin endpoint — which is what we want anyway, since
 * public signUp sends a confirmation email that the free tier's shared SMTP
 * rate-limits to roughly two per hour.
 */
export const PHONE_LOGIN_DOMAIN = 'phone.coachdesk.invalid'

export function phoneToLoginEmail(input: string): string | null {
  const normalized = normalizeBdMobile(input)
  if (!normalized) return null
  // +8801712345678 -> 8801712345678@phone.coachdesk.invalid
  return `${normalized.slice(1)}@${PHONE_LOGIN_DOMAIN}`
}

export function isPhoneLoginEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(`@${PHONE_LOGIN_DOMAIN}`))
}

/** Recovers the display number from a synthetic login address. */
export function loginEmailToPhone(email: string): string | null {
  if (!isPhoneLoginEmail(email)) return null
  return normalizeBdMobile(`+${email.split('@')[0]}`)
}
