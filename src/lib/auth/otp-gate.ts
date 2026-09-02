import 'server-only'

/**
 * The gate in front of owner signup: send a code, then check one.
 *
 * Both halves run on the server and nothing about either is negotiable from a
 * browser. The code is generated here, hashed here, and handed to the transport
 * here; what crosses back to the caller is a reason, never a code and never a
 * "verified" flag for a form to carry. Verification and account creation happen
 * inside one Server Action call, so there is nothing in between to forge.
 *
 * MASTERPLAN section 5.4. Teachers are not in this file and must not be put in it:
 * their number is optional and their account is issued by an employer.
 */
import { normalizeBdMobile } from '@/lib/bd/phone'
import { smsProviderConfigured } from '@/lib/sms/provider'
import { sendSms } from '@/lib/sms/send'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  OTP_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_PER_IP_PER_HOUR,
  OTP_PER_PHONE_PER_HOUR,
  OTP_TTL_SECONDS,
  generateOtp,
  hashOtp,
  otpSmsBody,
  readIssueOutcome,
  readTypedOtp,
  readVerifyOutcome,
  type IssueOutcome,
  type OtpPurpose,
  type VerifyOutcome,
} from '@/lib/auth/otp'

/**
 * Whether an owner has to prove the number before an account is made.
 *
 * On when there is a way to send a code and off when there is not, read from the
 * same switch the SMS worker consults before claiming a batch. This is a fact about
 * the deployment, never anything a request can carry: `smsProviderConfigured()` reads
 * three server-only environment variables and a browser cannot reach any of them.
 *
 * WHY IT IS A SWITCH AT ALL, since a security control with an off position deserves
 * saying out loud. No BTRC sender ID exists yet, so nothing can text anybody; a gate
 * that were unconditional today would not close the hole, it would close signup — no
 * owner could ever finish, and the code would sit in a Vercel log the visitor cannot
 * read. Off, signup is exactly what it is today and section 5.4's hole is still open
 * and still written down as open. On, it shuts for everybody at once, with no code
 * change: the aggregator's three variables are the deploy that does it.
 */
export function phoneGateOn(): boolean {
  return smsProviderConfigured() || devTransportOn()
}

/**
 * The other way on: `OTP_DEV_TRANSPORT=1`, outside production only.
 *
 * Without this the two-step signup could not be run at all before a sender ID exists,
 * because the condition that turns the gate on is the same condition that turns the
 * logging transport off — so the transport section 5.4 asks for would be unreachable
 * code, and the flow in front of it unreviewable.
 *
 * The NODE_ENV clause is what makes the variable safe rather than merely convenient.
 * Vercel sets NODE_ENV=production for preview and production builds alike, so this
 * cannot be switched on where a code would go to a log no visitor can read — which
 * would be signup broken for real owners. And it only ever *adds* a check: there is no
 * variable anywhere that turns the gate off once a gateway is configured.
 */
function devTransportOn(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.OTP_DEV_TRANSPORT === '1'
}

/** Adds the two refusals the transport and the number itself can produce. */
export type SendCodeResult =
  | IssueOutcome
  | { ok: false; reason: 'invalid' | 'undelivered' }

/** Adds a code that could never have been one, and a number that is not a number. */
export type CheckCodeResult =
  | VerifyOutcome
  | { ok: false; reason: 'invalid' | 'malformed' }

/** Last four digits, for a log line that is useful without being a phone book. */
function tail(phone: string): string {
  return `…${phone.slice(-4)}`
}

/**
 * Sends a code, or says why not.
 *
 * The ceilings are checked before the send and not after, because a send is what
 * costs a taka and rings somebody's phone; see the migration. Delivery is the last
 * step, so a refusal never spends money.
 */
export async function sendPhoneCode({
  phone,
  purpose,
  ip,
}: {
  phone: string
  purpose: OtpPurpose
  ip?: string | null
}): Promise<SendCodeResult> {
  // Section 5.4's normalisation rule, applied here rather than trusted from the
  // caller: 01712…, +88017… and ০১৭১২… have to be one number before anything is
  // sent or stored, or they are three ceilings instead of one.
  const normalized = normalizeBdMobile(phone)
  if (!normalized) return { ok: false, reason: 'invalid' }

  const code = generateOtp()

  // actor-less: the number being proved belongs to nobody yet, so there is no auth.uid()
  // to name. app.phone_verifications is not a table migration 46 watches either.
  const { data, error } = await createAdminClient().rpc('issue_phone_code', {
    p_phone: normalized,
    p_purpose: purpose,
    p_code_hash: hashOtp(normalized, purpose, code),
    p_ip: ip ?? null,
    p_ttl_seconds: OTP_TTL_SECONDS,
    p_cooldown_seconds: OTP_COOLDOWN_SECONDS,
    p_phone_per_hour: OTP_PER_PHONE_PER_HOUR,
    p_ip_per_hour: OTP_PER_IP_PER_HOUR,
  })

  if (error) {
    console.error(`[otp] issue failed for ${tail(normalized)}: ${error.message}`)
    return { ok: false, reason: 'unknown' }
  }

  const issued = readIssueOutcome(data)
  if (!issued.ok) return issued

  if (!(await deliver(normalized, code))) {
    // The row stays. It has to: the aggregator may have taken the message and the
    // money, and an hour's ceiling that forgets a paid send is not a ceiling. So a
    // gateway hiccup costs the visitor the cooldown, which is a minute.
    return { ok: false, reason: 'undelivered' }
  }

  return issued
}

/**
 * The transport, both of them.
 *
 * The development one is what section 5.4 asks for: the code goes to the server log
 * and nowhere else. Never a return value, never a header, never a field on a form
 * state — a code the browser can read is not a code. It runs whenever no gateway is
 * configured, which given `phoneGateOn` means it runs only under `OTP_DEV_TRANSPORT`
 * outside production. In production either a gateway sends the message or the gate is
 * shut and nothing is sent at all; nothing logs a live code either way.
 */
async function deliver(phone: string, code: string): Promise<boolean> {
  if (!smsProviderConfigured()) {
    console.info(`[otp] dev transport: ${code} for ${tail(phone)}`)
    return true
  }

  const result = await sendSms(phone, otpSmsBody(code))
  if (!result.ok) {
    console.error(`[otp] send failed for ${tail(phone)}: ${result.error}`)
    return false
  }

  return true
}

/**
 * Checks a code. The attempt is counted in SQL under a row lock, so ten parallel
 * guesses queue rather than each being the first one.
 */
export async function checkPhoneCode({
  phone,
  purpose,
  code,
}: {
  phone: string
  purpose: OtpPurpose
  code: string
}): Promise<CheckCodeResult> {
  const normalized = normalizeBdMobile(phone)
  if (!normalized) return { ok: false, reason: 'invalid' }

  // A five-digit or empty entry does not spend one of the five tries. It could not
  // have matched a six-digit code anyway, and burning a try for a slip of the thumb
  // would only make somebody ask for a second code.
  const typed = readTypedOtp(code)
  if (!typed) return { ok: false, reason: 'malformed' }

  // actor-less: same as issuing — the account this proves a number for does not exist
  // until the Server Action that calls this creates it.
  const { data, error } = await createAdminClient().rpc('verify_phone_code', {
    p_phone: normalized,
    p_purpose: purpose,
    p_code_hash: hashOtp(normalized, purpose, typed),
    p_max_attempts: OTP_MAX_ATTEMPTS,
  })

  if (error) {
    console.error(`[otp] verify failed for ${tail(normalized)}: ${error.message}`)
    return { ok: false, reason: 'unknown' }
  }

  return readVerifyOutcome(data)
}
