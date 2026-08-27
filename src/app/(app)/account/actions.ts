'use server'

/**
 * Changing your own password.
 *
 * The last piece of a recovery story with no email in it. An owner can hand a teacher
 * a new password (settings/actions.ts, resetTeacherPassword) and can give a login to a
 * teacher who never had one — but until this action, nobody could change their own,
 * and two sentences already shipped promising otherwise: teacherForm.passwordHint
 * tells the teacher they can change it later, and the staff list refuses an owner
 * their own row with "you cannot change your own password here", which is only fair if
 * somewhere else can.
 *
 * Every signed-in role reaches it — owner, manager, teacher, student, guardian. There
 * is no plan gate and there never should be: an account nobody can re-secure is not a
 * feature to sell in tiers.
 */
import { createClient as createStatelessClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { requireCenter, getSession, AuthError } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { phoneToLoginEmail } from '@/lib/bd/phone'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { passwordTooShort } from '@/lib/i18n/messages'
import type { CenterSession } from '@/lib/auth/session'
import type { Database } from '@/lib/supabase/types'

export type AccountState = { error?: string; ok?: string } | null

/**
 * Proof that the person holding this session is the person who owns it.
 *
 * A coaching centre has one phone on the desk and it is passed around. An open
 * session says somebody signed in; it does not say who is holding the phone now. So
 * the current password is asked for, and asked of GoTrue rather than compared here —
 * there is no hash on our side to compare against, and there should not be.
 *
 * On a client of its own, built from the anon key with `persistSession` off, because
 * `signInWithPassword` on the request-scoped client would mint a second session and
 * write its tokens straight over the caller's cookies. That is invisible when the
 * password is right and quietly signs you out of your own session when it is wrong.
 */
async function passwordIsCurrent(phone: string, password: string): Promise<boolean> {
  const email = phoneToLoginEmail(phone)
  if (!email) return false

  const probe = createStatelessClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { error } = await probe.auth.signInWithPassword({ email, password })
  return !error
}

export async function changeOwnPassword(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  /*
   * The same conversion (app)/settings/actions.ts does at its own `guard`: the
   * require* helpers throw, and a form wants a sentence. There is only one way to
   * fail it here — nobody is signed in — because every role that reaches this screen
   * is allowed to change their own password, so there is one message and no table of
   * them. A caller with no session has no language either, hence the default.
   */
  let session: CenterSession
  try {
    session = await requireCenter()
  } catch (err) {
    if (err instanceof AuthError) {
      const caller = await getSession()
      return { error: dict(caller?.locale ?? DEFAULT_LOCALE).denied.title }
    }
    throw err
  }

  const t = dict(session.locale).account

  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('next') ?? '')
  const again = String(formData.get('again') ?? '')

  if (next.length < MIN_PASSWORD) {
    return { error: passwordTooShort(session.locale) }
  }

  // Checked before the current one is verified, so a typo in the confirmation box
  // does not cost a round trip to the auth server and does not count against the
  // sign-in rate limit.
  if (next !== again) return { error: t.errors.mismatch }

  // Refused rather than accepted as a no-op. Somebody who sets their password to what
  // it already was believes they have changed it, and will not think of it again.
  if (next === current) return { error: t.errors.same }

  /*
   * Read into a local before the await below, because `session` is a mutable binding
   * and the narrowing has to survive being passed through a promise.
   *
   * A session without a number is a type-level possibility rather than a reachable
   * state: login is a phone and a password, and the phone is what the login address is
   * derived from, so nobody without one has ever signed in. Reported as a failure and
   * not as a wrong password — it would not be the reader's mistake.
   */
  const phone = session.phone
  if (!phone) return { error: t.errors.failed }

  if (!(await passwordIsCurrent(phone, current))) {
    return { error: t.errors.wrongCurrent }
  }

  // The caller's own session, not the admin client. This is a user changing their own
  // password, so it runs as them — and the SSR client rotates the cookies it just
  // invalidated, which is why they are not signed out by their own success.
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: next })

  if (error) return { error: t.errors.failed }

  return { ok: t.done }
}
