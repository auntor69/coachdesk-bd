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
import type { Route } from 'next'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  normalizeBdMobile,
  phoneToLoginEmail,
  formatBdMobile,
} from '@/lib/bd/phone'
import { getSession, homePathFor } from '@/lib/auth/session'
import { MIN_PASSWORD, PASSWORD_TOO_SHORT_BN } from '@/lib/auth/password'
import { DEFAULT_LOCALE } from '@/lib/i18n'

export type FormState = {
  error?: string
  /** Which input to highlight, so the message lands next to the problem. */
  field?: 'phone' | 'password' | 'name' | 'center' | 'email'
} | null

/**
 * Supabase returns English error strings meant for developers. Teachers get
 * Bangla, and we never distinguish "no such account" from "wrong password" —
 * that difference is how you enumerate who has an account.
 */
function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'নম্বর বা পাসওয়ার্ড ঠিক নেই। আবার চেষ্টা করুন।'
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
    return PASSWORD_TOO_SHORT_BN
  }
  return 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।'
}

/**
 * Sign in with a Bangladeshi mobile number and a password.
 *
 * The number is normalised to E.164 first, so 01712-345678, +8801712345678 and
 * ০১৭১২৩৪৫৬৭৮ all reach the same account instead of failing as "wrong password".
 */
export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const rawPhone = String(formData.get('phone') ?? '')
  const password = String(formData.get('password') ?? '')

  const loginEmail = phoneToLoginEmail(rawPhone)
  if (!loginEmail) {
    return { error: 'সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।', field: 'phone' }
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
 */
export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const rawPhone = String(formData.get('phone') ?? '')
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('name') ?? '').trim()

  const phone = normalizeBdMobile(rawPhone)
  const loginEmail = phone ? phoneToLoginEmail(phone) : null

  if (!phone || !loginEmail) {
    return { error: 'সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।', field: 'phone' }
  }
  if (!fullName) {
    return { error: 'আপনার নাম লিখুন।', field: 'name' }
  }
  if (password.length < MIN_PASSWORD) {
    return {
      error: PASSWORD_TOO_SHORT_BN,
      field: 'password',
    }
  }

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
  if (centerName.length > 80) {
    return { error: 'নাম ৮০ অক্ষরের মধ্যে রাখুন।', field: 'center' }
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
 * Owner-issued password reset for staff.
 *
 * There is no email to send a reset link to and no SMS sender ID yet, so
 * recovery flows through the person who already has authority over the account:
 * the centre owner, who in practice is standing next to the teacher.
 */
export async function resetStaffPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession()
  if (!session?.active) {
    redirect('/login')
  }

  // Only owners and managers, checked here rather than at the page.
  if (session.active.role !== 'owner' && session.active.role !== 'manager') {
    return { error: 'এই কাজটি শুধু মালিক করতে পারেন।' }
  }

  const targetUserId = String(formData.get('userId') ?? '')
  const newPassword = String(formData.get('password') ?? '')

  if (newPassword.length < MIN_PASSWORD) {
    return {
      error: PASSWORD_TOO_SHORT_BN,
      field: 'password',
    }
  }

  const supabase = await createClient()

  // The target must be a member of *this* owner's center. Without this check,
  // an owner could reset the password of any user ID they guessed, anywhere on
  // the platform — the admin client below has no RLS to stop them.
  const { data: membership } = await supabase
    .from('center_members')
    .select('user_id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (!membership) {
    return { error: 'এই ব্যবহারকারী আপনার সেন্টারের নয়।' }
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(targetUserId, {
    password: newPassword,
  })

  if (error) {
    return { error: 'পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করুন।' }
  }

  revalidatePath('/settings/teachers')
  return null
}

/** Used by the login page to echo a normalised number back at the user. */
export async function previewPhone(input: string): Promise<string> {
  return formatBdMobile(normalizeBdMobile(input))
}
