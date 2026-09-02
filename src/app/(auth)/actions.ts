'use server'

/**
 * Auth Server Actions.
 *
 * Next 16 is explicit that a Server Action is a public HTTP endpoint: anyone
 * who learns its ID can POST to it directly, with any body they like. So every
 * function here validates its own input and re-derives the caller — nothing is
 * trusted because the form that called it was only rendered to a signed-in user.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import type { Route } from 'next'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  normalizeBdMobile,
  phoneToLoginEmail,
  formatBdMobile,
} from '@/lib/bd/phone'
import { loginEmailFor } from '@/lib/bd/username'
import { getSession, homePathFor } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { OTP_LENGTH } from '@/lib/auth/otp'
import {
  checkPhoneCode,
  phoneGateOn,
  sendPhoneCode,
  type CheckCodeResult,
  type SendCodeResult,
} from '@/lib/auth/otp-gate'
import { MAX_NAME } from '@/lib/limits'
import { digits } from '@/lib/bd/time'
import { DEFAULT_LOCALE } from '@/lib/i18n'
import { nameTooLong, passwordTooShort } from '@/lib/i18n/messages'

export type FormState = {
  error?: string
  /** Which input to highlight, so the message lands next to the problem. */
  field?: 'identifier' | 'phone' | 'password' | 'name' | 'center' | 'email'
} | null

/**
 * Signup's own state, because signup is the one screen here with two steps.
 *
 * Written out rather than widened from `FormState`: sign-in and centre creation have
 * no code step and should not carry the shape of one. Nothing in it is a claim the
 * browser can make — `awaitingCode` decides which fields are drawn, never whether a
 * number was proved, and the account is created in the same call that checks the code.
 */
export type SignupState = {
  error?: string
  field?: 'phone' | 'password' | 'name' | 'code'
  /** A code has been sent and the form is waiting for one. */
  awaitingCode?: boolean
  /** The number the code went to, formatted for reading. Shown, never resubmitted. */
  sentTo?: string
  /** Seconds until the code expires. */
  expiresIn?: number
  /** Seconds until a resend is allowed, when the last answer was a cooldown. */
  wait?: number
} | null

/**
 * Supabase returns English error strings meant for developers. Teachers get
 * Bangla, and we never distinguish "no such account" from "wrong password" —
 * that difference is how you enumerate who has an account.
 */
function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'নম্বর, ইউজারনেম বা পাসওয়ার্ড ঠিক নেই। আবার চেষ্টা করুন।'
  }
  if (/email rate limit|too many requests|rate limit/i.test(message)) {
    return 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।'
  }
  if (/already registered|already been registered/i.test(message)) {
    return 'এই নম্বরে অ্যাকাউন্ট আছে। লগইন করুন।'
  }
  // What a unique-violation on profiles.phone looks like from the auth API.
  // GoTrue reports any trigger failure as this one opaque string, and for us
  // the overwhelmingly likely cause is a number that already has an account.
  if (/database error (creating|saving)/i.test(message)) {
    return 'এই নম্বরে অ্যাকাউন্ট আছে। লগইন করুন।'
  }
  if (/password/i.test(message) && /short|least/i.test(message)) {
    return passwordTooShort(DEFAULT_LOCALE)
  }
  return 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।'
}

/** Why no code was sent, in the voice of the rest of this screen. */
function sendRefusal(result: Extract<SendCodeResult, { ok: false }>): string {
  switch (result.reason) {
    case 'cooldown':
      return `আরও ${digits(result.wait, 'bn')} সেকেন্ড পর নতুন কোড নিতে পারবেন।`
    case 'phone_limit':
      return 'এই নম্বরে এক ঘণ্টায় অনেকবার কোড পাঠানো হয়েছে। পরে আবার চেষ্টা করুন।'
    case 'ip_limit':
      return 'এই সংযোগ থেকে অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।'
    case 'undelivered':
      return 'কোড পাঠানো যায়নি। এক মিনিট পর আবার চেষ্টা করুন।'
    case 'invalid':
      return 'সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।'
    default:
      return 'কোড পাঠানো যায়নি। আবার চেষ্টা করুন।'
  }
}

/**
 * Why a code was refused. Four of the answers are the same sentence on purpose —
 * never asked, already used, already burned and already swept are one state to a
 * visitor, and telling them apart would say which numbers are mid-signup.
 */
function verifyRefusal(result: Extract<CheckCodeResult, { ok: false }>): string {
  switch (result.reason) {
    case 'wrong':
      return result.left > 0
        ? `কোড মিলছে না। আর ${digits(result.left, 'bn')} বার চেষ্টা করতে পারবেন।`
        : 'কোড মিলছে না। নতুন কোড নিন।'
    case 'malformed':
      return `${digits(OTP_LENGTH, 'bn')} সংখ্যার কোড দিন।`
    case 'expired':
      return 'কোডের সময় শেষ। নতুন কোড নিন।'
    case 'burned':
      return 'অনেকবার ভুল হয়েছে। নতুন কোড নিন।'
    case 'none':
      return 'কোডটি আর কাজ করছে না। নতুন কোড নিন।'
    case 'invalid':
      return 'সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।'
    default:
      return 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।'
  }
}

/**
 * The caller's address, for the per-IP hourly ceiling.
 *
 * Null when there is no proxy header, which is local development. The SQL skips the
 * per-IP count on a null rather than filing everyone under one shared 'unknown',
 * where the first twenty signups of an hour would use up everybody's allowance.
 */
async function callerIp(): Promise<string | null> {
  const forwarded = (await headers()).get('x-forwarded-for')
  // A proxy chain: the client is the first entry, the rest are Vercel's.
  return forwarded?.split(',')[0]?.trim() || null
}

/**
 * Whether this number already has an account.
 *
 * Asked before a code is sent rather than after one is proved, because a send costs a
 * taka and rings somebody's phone. On a read error this answers "no" and signup goes
 * on: the number is checked again by `createUser`, which refuses a duplicate, so the
 * cost of guessing wrong is one message — where refusing would be every signup
 * blocked by a transient error. This says nothing signup did not already say; the
 * existing duplicate path returns the same sentence.
 */
async function phoneHasAccount(phone: string): Promise<boolean> {
  // actor-less: nobody is signed in yet, and nothing is written. This reads whether a
  // number is taken, before a code is sent to it.
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('phone', phone)
    .maybeSingle()

  return data !== null
}

/**
 * Sign in with a mobile number *or* a username, in one field.
 *
 * MASTERPLAN.md §5.3 puts a single box on the login screen and makes the server
 * work out which of the two it was handed — "no radio button, no second tab, no
 * 'are you a teacher?' question". That dispatch is `loginEmailFor`, and it is
 * unambiguous because the two sets cannot overlap: a username begins with a
 * letter and no form of a Bangladeshi mobile number does.
 *
 * Both are normalised on the way through, so 01712-345678, +8801712345678 and
 * ০১৭১২৩৪৫৬৭৮ reach one account, and `Rahim` reaches the same account as
 * `rahim`, instead of failing as "wrong password".
 */
export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const rawIdentifier = String(formData.get('identifier') ?? '')
  const password = String(formData.get('password') ?? '')

  const loginEmail = loginEmailFor(rawIdentifier)
  if (!loginEmail) {
    // One message for both halves of the field. Saying *which* form it failed to
    // be would be a hint about which form exists — and it is no help anyway: the
    // teacher was told one identifier and is typing that one.
    return {
      error: 'মোবাইল নম্বর বা ইউজারনেম ঠিক নেই (যেমন ০১৭১২৩৪৫৬৭৮ বা rahim)।',
      field: 'identifier',
    }
  }
  if (!password) {
    return { error: 'পাসওয়ার্ড দিন।', field: 'password' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: loginEmail,
    password,
  })

  if (error) {
    return { error: friendlyAuthError(error.message), field: 'password' }
  }

  const session = await getSession()
  const next = String(formData.get('next') ?? '')

  // Only same-origin paths. An open redirect here would let a phishing page
  // bounce a freshly-authenticated teacher straight off our domain.
  //
  // The cast is unavoidable: `next` arrives from a query string, so no amount
  // of static analysis can prove it names a real route. The check above is what
  // makes it safe; typedRoutes cannot see that, and an unknown path lands on
  // our own 404 rather than anywhere dangerous.
  const safeNext =
    next.startsWith('/') && !next.startsWith('//') ? (next as Route) : null

  // Outside the try/catch above — redirect() works by throwing.
  redirect(safeNext ?? (session ? homePathFor(session) : '/'))
}

/**
 * Create an account. Does not create a center — onboarding does that, because
 * the same signup serves an owner opening a centre and a teacher who was
 * invited to one.
 *
 * Two steps when a gateway is configured, one step when it is not — see `phoneGateOn`.
 * The two-step path never hands the browser anything to carry between them: the code
 * is checked and the account created inside this one call, so there is no verified flag
 * for a second request to forge. `awaitingCode` in the returned state only decides
 * which inputs are drawn.
 */
export async function signUp(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const rawPhone = String(formData.get('phone') ?? '')
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('name') ?? '').trim()
  const typedCode = String(formData.get('code') ?? '').trim()
  // A submit button's own name. It can only ever cause a send, so a browser choosing
  // it is choosing to be rate-limited, not to skip anything.
  const resending = String(formData.get('intent') ?? '') === 'resend'

  const phone = normalizeBdMobile(rawPhone)
  const loginEmail = phone ? phoneToLoginEmail(phone) : null

  if (!phone || !loginEmail) {
    return { error: 'সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।', field: 'phone' }
  }
  if (!fullName) {
    return { error: 'আপনার নাম লিখুন।', field: 'name' }
  }
  if (fullName.length > MAX_NAME) {
    return { error: nameTooLong(DEFAULT_LOCALE), field: 'name' }
  }
  if (password.length < MIN_PASSWORD) {
    return { error: passwordTooShort(DEFAULT_LOCALE), field: 'password' }
  }

  if (!phoneGateOn()) {
    return createAccount({ loginEmail, password, fullName, phone })
  }

  if (await phoneHasAccount(phone)) {
    return { error: 'এই নম্বরে অ্যাকাউন্ট আছে। লগইন করুন।', field: 'phone' }
  }

  if (resending || !typedCode) {
    const sent = await sendPhoneCode({
      phone,
      purpose: 'signup',
      ip: await callerIp(),
    })

    if (sent.ok) {
      return {
        awaitingCode: true,
        sentTo: formatBdMobile(phone),
        expiresIn: sent.expiresIn,
      }
    }

    // A cooldown means a code sent a moment ago is still live, so the code box is
    // where the visitor belongs even though this attempt was refused. A resend that
    // failed for any other reason should not throw away the step they are standing on
    // either — the code they already have may still work.
    const stay = sent.reason === 'cooldown' || resending
    return stay
      ? {
          awaitingCode: true,
          sentTo: formatBdMobile(phone),
          wait: sent.reason === 'cooldown' ? sent.wait : undefined,
          error: sendRefusal(sent),
          field: 'code',
        }
      : { error: sendRefusal(sent), field: 'phone' }
  }

  const checked = await checkPhoneCode({ phone, purpose: 'signup', code: typedCode })
  if (!checked.ok) {
    return {
      awaitingCode: true,
      sentTo: formatBdMobile(phone),
      error: verifyRefusal(checked),
      field: 'code',
    }
  }

  return createAccount({ loginEmail, password, fullName, phone })
}

/**
 * The account itself, once there is nothing left to prove.
 *
 * Reached with a verified number when the gate is on and directly when it is off, so
 * it makes no assumption about which. Either redirects or returns a refusal.
 */
async function createAccount({
  loginEmail,
  password,
  fullName,
  phone,
}: {
  loginEmail: string
  password: string
  fullName: string
  phone: string
}): Promise<SignupState> {
  const supabase = await createClient()

  // Accounts are created through the admin endpoint, never the public signUp
  // endpoint. Public signUp sends a confirmation email, and the free tier's
  // shared SMTP rate-limits it to ~2/hour; signup would start throttling real
  // signups within the first hour. The admin endpoint creates the user with
  // email_confirm already set and sends no mail at all — which is exactly right,
  // because our phone-login address is unroutable and could never receive one.
  // What the endpoint can't do is race prevention: two people signing up with
  // the same number in the same instant can both pass the check below. That is
  // acceptable — the loser is still fully usable, just redirected to login.
  // actor-less: nobody exists to name yet. This call is what creates the account, so
  // its id cannot be in a header sent before it, and nothing audited is written either
  // way — the on_auth_user_created trigger writes `profiles`, which is not one of
  // migration 46's fourteen tables. The first audited row this person causes is their
  // centre, and `bootstrap_center` below writes it through their own JWT.
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.createUser({
    email: loginEmail,
    password,
    email_confirm: true,
    // Read by the on_auth_user_created trigger, so the profile row exists
    // before this function returns.
    //
    // DEFAULT_LOCALE rather than a literal: a new centre has expressed no
    // preference yet, and the one place that decides what a reader gets by
    // default should be the one place that says so.
    user_metadata: { full_name: fullName, phone, locale: DEFAULT_LOCALE },
  })

  if (error) {
    if (/already registered|already been registered|already exists/i.test(error.message)) {
      return { error: 'এই নম্বরে অ্যাকাউন্ট আছে। লগইন করুন।', field: 'phone' }
    }
    return { error: friendlyAuthError(error.message), field: 'phone' }
  }

  // The account exists now. Sign in with it — the trigger has already created
  // the profile row, and signInWithPassword returns a session without any email.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: loginEmail,
    password,
  })

  if (signInError) {
    return {
      error:
        'অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু লগইন হয়নি। লগইন পাতায় গিয়ে চেষ্টা করুন।',
      field: 'phone',
    }
  }

  redirect('/onboarding')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

/**
 * Creates the center and makes the caller its owner, in one database
 * transaction. Teacher Mode additionally makes them a teacher of that center,
 * so the attendance and marks screens see them.
 */
export async function createCenter(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Re-derive the user rather than trusting anything in formData.
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const centerName = String(formData.get('centerName') ?? '').trim()
  const mode = String(formData.get('mode') ?? 'teacher')

  if (!centerName) {
    return { error: 'কোচিং/ব্যাচের নাম লিখুন।', field: 'center' }
  }
  if (centerName.length > MAX_NAME) {
    return { error: nameTooLong(DEFAULT_LOCALE), field: 'center' }
  }

  const supabase = await createClient()

  const { error } = await supabase.rpc('bootstrap_center', {
    center_name: centerName,
    owner_phone: session.phone ? normalizeBdMobile(session.phone) : null,
    owner_name: session.fullName ?? '',
    teacher_mode: mode === 'teacher',
  })

  if (error) {
    if (/already owns/i.test(error.message)) {
      // They double-submitted, or came back to this page. Both are fine.
      redirect('/dashboard')
    }
    return { error: 'তৈরি করা যায়নি। আবার চেষ্টা করুন।', field: 'center' }
  }

  revalidatePath('/', 'layout')
  redirect(mode === 'teacher' ? '/teach' : '/dashboard')
}

/**
 * `resetStaffPassword` was removed here.
 *
 * It was an owner-issued reset written before there was a screen to put one on, and
 * it never got one — no component in the tree referenced it. That did not make it
 * harmless. `signOut` in this module is imported by the app shell, so the module is
 * in the build graph, so every exported action in it has an id and is a live HTTP
 * endpoint whether or not any button posts to it.
 *
 * And it was weaker than the reset that eventually shipped. It took `userId`
 * straight from the form body, and asked only whether that account held a
 * `center_members` row at the caller's centre — which is true of a teacher who also
 * owns a rival centre, of a manager, and of the founder's own account if it happened
 * to hold any membership there. So an owner could have reset the password of an
 * account with authority elsewhere and signed in as it.
 *
 * The real one is `resetTeacherPassword` in (app)/settings/actions.ts: it reads the
 * account off this centre's own teacher row rather than the body, and refuses
 * anything holding a second membership anywhere, itself, or a platform admin. The
 * rule is `lib/auth/reset.ts` and its ten tests. Nothing was lost by deleting this.
 */

/** Used by the login page to echo a normalised number back at the user. */
export async function previewPhone(input: string): Promise<string> {
  return formatBdMobile(normalizeBdMobile(input))
}
