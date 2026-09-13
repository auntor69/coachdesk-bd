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
import { normalizeBdMobile } from '@/lib/bd/phone'
import { loginEmailFor } from '@/lib/bd/username'
import { getSession, homePathFor } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { MAX_NAME } from '@/lib/limits'
import { digits } from '@/lib/bd/time'
import { DEFAULT_LOCALE, dict } from '@/lib/i18n'
import { nameTooLong, passwordTooShort } from '@/lib/i18n/messages'
import { EMAIL_CODE_LENGTH } from '@/lib/auth/email-otp'

export type FormState = {
  error?: string
  /** Which input to highlight, so the message lands next to the problem. */
  field?: 'identifier' | 'password' | 'name' | 'center' | 'email' | 'code'
} | null

/**
 * Signup's own state, because signup is the one screen here with two steps.
 *
 * Written out rather than widened from `FormState`: sign-in and centre creation have
 * no code step and should not carry the shape of one. Nothing in it is a claim the
 * browser can make — `awaitingCode` decides which fields are drawn, never whether an
 * address was proved, and the code is checked against Supabase's own confirmation
 * record inside this same call. There is no verified flag for a second request to
 * forge (§5.4).
 */
export type SignupState = {
  error?: string
  field?: 'email' | 'password' | 'name' | 'code'
  /** A code has been sent and the form is waiting for one. */
  awaitingCode?: boolean
  /** The address the code went to. Shown, never resubmitted. */
  sentTo?: string
} | null

/**
 * Supabase returns English error strings meant for developers. Teachers get
 * Bangla, and we never distinguish "no such account" from "wrong password" —
 * that difference is how you enumerate who has an account.
 */
function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'ইমেইল, নম্বর, ইউজারনেম বা পাসওয়ার্ড ঠিক নেই। আবার চেষ্টা করুন।'
  }
  if (/email not confirmed/i.test(message)) {
    return 'ইমেইলটি এখনও ভেরিফাই হয়নি। ইমেইলে পাঠানো কোড বা লিংকটি দেখুন।'
  }
  if (/rate limit|too many requests/i.test(message)) {
    return 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।'
  }
  if (/already registered|already been registered/i.test(message)) {
    return 'এই ইমেইলে অ্যাকাউন্ট আছে। লগইন করুন।'
  }
  if (/password/i.test(message) && /short|least/i.test(message)) {
    return passwordTooShort(DEFAULT_LOCALE)
  }
  return 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।'
}

/**
 * Why a send was refused, in the voice of the rest of this screen. Supabase's
 * own rate limit is the only expected refusal: the built-in sender allows about
 * two messages an hour and the dedicated SMTP raises it far past anything a
 * signup flow can hit.
 */
function sendRefusal(message: string): string {
  if (/once every|rate limit|too many/i.test(message)) {
    return 'কোড একবারই পাঠানো যায় — এক মিনিট অপেক্ষা করে আবার চেষ্টা করুন।'
  }
  return 'কোড পাঠানো যায়নি। এক মিনিট পর আবার চেষ্টা করুন।'
}

/**
 * Why a code was refused. The same sentence for wrong, stale and unknown on
 * purpose — telling them apart would tell a script which addresses are
 * mid-signup, and the answer to all three is "ask for a new code".
 */
function verifyRefusal(message: string): string {
  if (/invalid|expired|incorrect|not found|no such/i.test(message)) {
    return `কোড মিলছে না। ইমেইলে পাঠানো ${digits(EMAIL_CODE_LENGTH, 'bn')} সংখ্যার কোডটি দিন, বা নতুন কোড নিন।`
  }
  return 'কোডটি কাজ করছে না। নতুন কোড নিন।'
}

/**
 * Where this request came from, for the confirmation email's redirect. The
 * `Origin` header is sent on every same-origin POST — and a Server Action is a
 * POST — with the forwarded host and protocol as the fallbacks a proxy behind
 * a proxy would leave. Never a value from the form body.
 */
async function requestOrigin(): Promise<string> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin

  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return host ? `${proto}://${host}` : ''
}

/**
 * The link inside the confirmation email lands here once it has been clicked,
 * so the email works whether its template carries the code, the link, or both
 * (§5.4). Must be an allowed redirect URL in the dashboard for Supabase to
 * honour it; otherwise it falls back to the Site URL, which is the same trip.
 * Undefined when no origin could be derived, in which case the platform uses
 * its configured Site URL — the link still works, it just defaults.
 */
async function confirmUrl(): Promise<string | undefined> {
  const origin = await requestOrigin()
  return origin ? `${origin}/auth/confirm` : undefined
}

/**
 * Sign in with an email address, a mobile number *or* a username, in one field.
 *
 * MASTERPLAN.md §5.3 puts a single box on the login screen and makes the server
 * work out which of the three it was handed. That dispatch is `loginEmailFor`,
 * and it is unambiguous because the three sets cannot overlap: an email carries
 * an `@`, a username starts with a letter and no form of a Bangladeshi mobile
 * number does.
 *
 * Numbers and usernames are normalised on the way through, so 01712-345678,
 * +8801712345678 and ০১৭১২৩৪৫৬৭৮ reach one account, and `Rahim` reaches the
 * same account as `rahim`, instead of failing as "wrong password". Emails are
 * lowercased, because autocorrect capitalises the first letter of a text field.
 */
export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const rawIdentifier = String(formData.get('identifier') ?? '')
  const password = String(formData.get('password') ?? '')

  const loginEmail = loginEmailFor(rawIdentifier)
  if (!loginEmail) {
    // One message for all thirds of the field. Saying *which* form it failed to
    // be would be a hint about which forms exist — and it is no help anyway: the
    // teacher was told one identifier and is typing that one.
    return {
      error: 'ইমেইল, মোবাইল নম্বর বা ইউজারনেম ঠিক নেই (যেমন name@gmail.com, ০১৭১২৩৪৫৬৭৮ বা rahim)।',
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
 * Two steps, and the second is Supabase's rather than ours (§5.4): `signUp`
 * creates the account unconfirmed and the platform sends the email; `verifyOtp`
 * checks the code and establishes the session inside this same call — so there
 * is no verified flag for a second request to forge, and `awaitingCode` in the
 * returned state only decides which inputs are drawn. If the project ever has
 * confirmation switched off, `signUp` returns the session directly and the code
 * step never appears.
 */
export async function signUp(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const rawEmail = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('name') ?? '').trim()
  const typedCode = String(formData.get('code') ?? '').trim()
  // A submit button's own name. It can only ever cause a resend, so a browser
  // choosing it is choosing to be rate-limited, not to skip anything.
  const resending = String(formData.get('intent') ?? '') === 'resend'

  const email = rawEmail.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { error: 'সঠিক ইমেইল দিন (যেমন name@gmail.com)।', field: 'email' }
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

  const redirectTo = await confirmUrl()

  // Step 1: no code yet — create the (unconfirmed) account and send the email.
  if (!typedCode && !resending) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Read by the on_auth_user_created trigger, so the profile row exists
        // before the email is even confirmed. DEFAULT_LOCALE rather than a
        // literal: a new centre has expressed no preference yet.
        data: { full_name: fullName, locale: DEFAULT_LOCALE },
        emailRedirectTo: redirectTo,
      },
    })

    // Confirmation off in the project: the session came back with the account.
    if (!error && data.session) {
      redirect('/onboarding')
    }

    if (error) {
      // The address already has an account. It may be an abandoned signup —
      // created, never confirmed, and now unable to log in — so before saying
      // "log in" and stranding them, offer the code again: `resend` succeeds
      // only for an unconfirmed user, which is exactly the population it
      // exists for. A confirmed account errors here and gets the sentence.
      if (/already registered|already been registered/i.test(error.message)) {
        const { error: resendError } = await supabase.auth.resend({
          email,
          type: 'signup',
          options: { emailRedirectTo: redirectTo },
        })
        if (!resendError) {
          return { awaitingCode: true, sentTo: email }
        }
        return {
          awaitingCode: /once every|rate limit|too many/i.test(resendError.message),
          sentTo: /once every|rate limit|too many/i.test(resendError.message)
            ? email
            : undefined,
          error: sendRefusal(resendError.message),
          field: 'email',
        }
      }
      return { error: sendRefusal(error.message), field: 'email' }
    }

    return { awaitingCode: true, sentTo: email }
  }

  const supabase = await createClient()

  // A resend: the account exists unconfirmed, and only the email is re-armed.
  if (resending) {
    const { error } = await supabase.auth.resend({
      email,
      type: 'signup',
      options: { emailRedirectTo: redirectTo },
    })

    if (!error) {
      return { awaitingCode: true, sentTo: email }
    }
    return {
      awaitingCode: true,
      sentTo: email,
      error: sendRefusal(error.message),
      field: 'code',
    }
  }

  // Step 2: the code. Checked against the platform's own confirmation record,
  // and the session it returns is the session — nothing else is decided here.
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: typedCode,
    type: 'signup',
  })

  if (verifyError) {
    return {
      awaitingCode: true,
      sentTo: email,
      error: verifyRefusal(verifyError.message),
      field: 'code',
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

  /*
   * The onboarding screen does not draw this form for a centre-issued login, and that
   * is not what stops one getting here: a Server Action is a public endpoint, so the
   * only reason the screen and the action agree is that both ask. `bootstrap_center`
   * asks a third time (20260811000079 widens it to both reserved domains) and is the
   * one that cannot be routed around — the anon key reaches that RPC directly. This
   * is here so the refusal arrives as a sentence under the field rather than as a
   * Postgres error string.
   */
  if (session.username) {
    return { error: dict(session.locale).noCenter.refused, field: 'center' }
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
 * It was an owner-issued reset written before there was a screen to put one on, and it
 * never got one — no component in the tree referenced it. That did not make it
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
