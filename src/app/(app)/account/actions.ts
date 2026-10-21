'use server'

/**
 * The two things a person may change about themselves: their password and their name.
 *
 * The password came first, as the last piece of a recovery story with no email in it.
 * An owner can hand a teacher a new password (settings/actions.ts,
 * resetTeacherPassword) and can give a login to a teacher who never had one — but
 * until that action, nobody could change their own, and two sentences already shipped
 * promising otherwise: teacherForm.passwordHint tells the teacher they can change it
 * later, and the staff list refuses an owner their own row with "you cannot change
 * your own password here", which is only fair if somewhere else can.
 *
 * The name is the same shape of hole, found the same way. `profiles.full_name` was
 * written at signup and when an owner issues a teacher their first login, and read on
 * this screen, on the onboarding greeting, and in the app header on every single
 * screen — and no code path anywhere ever updated it. A founder who mistyped their own
 * name into the signup form was greeted by the mistake for ever.
 *
 * Every signed-in role reaches both — owner, manager, teacher, student, guardian.
 * There is no plan gate and there never should be: an account nobody can re-secure is
 * not a feature to sell in tiers, and neither is one's own name.
 */
import { revalidatePath } from 'next/cache'
import { createClient as createStatelessClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { requireCenter, getSession, AuthError } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { loginAddressOf } from '@/lib/auth/identifier'
import { MAX_NAME } from '@/lib/limits'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { nameTooLong, passwordTooShort } from '@/lib/i18n/messages'
import type { CenterSession } from '@/lib/auth/session'
import type { Database } from '@/lib/supabase/types'

export type AccountState = { error?: string; ok?: string } | null

/**
 * The caller, or the sentence to show somebody who has stopped being one.
 *
 * The same conversion (app)/settings/actions.ts does at its own `guard`: the require*
 * helpers throw, and a form wants a sentence. There is only one way to fail it here —
 * nobody is signed in — because every role that reaches this screen is allowed to
 * change their own password and their own name, so there is one message and no table
 * of them. A caller with no session has no language either, hence the default.
 *
 * NO `requireWritable` HERE, AND THAT IS THE POINT OF THIS COMMENT rather than an
 * oversight to be tidied up later. A read-only centre is a centre whose bill is unpaid;
 * these two writes are not the centre's at all. Locking somebody out of changing their
 * own password because the coaching centre they teach at owes us money would be a
 * security failure with a billing excuse attached — the whole reason /account has no
 * guard narrower than the layout's is that an account nobody can re-secure is not a
 * thing to gate. `profiles` is also outside every centre, so there is no centre row
 * being written to freeze.
 */
async function caller(): Promise<CenterSession | AccountState> {
  try {
    return await requireCenter()
  } catch (err) {
    if (err instanceof AuthError) {
      const who = await getSession()
      return { error: dict(who?.locale ?? DEFAULT_LOCALE).denied.title }
    }
    throw err
  }
}

function isSession(value: CenterSession | AccountState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Proof that the person holding this session is the person who owns it.
 *
 * A coaching centre has one phone on the desk and it is passed around. An open
 * session says somebody signed in; it does not say who is holding the phone now. So
 * the current password is asked for, and asked of GoTrue rather than compared here —
 * there is no hash on our side to compare against, and there should not be.
 *
 * Takes the login address rather than a number, because as of §5.2 an account's
 * identifier is a number *or* a username *or* the address a self-serve signup owns, and
 * only the address covers all three. The caller builds it with the same dispatch the login
 * screen uses, so this check cannot drift away from what actually signs somebody in.
 *
 * On a client of its own, built from the anon key with `persistSession` off, because
 * `signInWithPassword` on the request-scoped client would mint a second session and
 * write its tokens straight over the caller's cookies. That is invisible when the
 * password is right and quietly signs you out of your own session when it is wrong.
 */
async function passwordIsCurrent(loginEmail: string, password: string): Promise<boolean> {
  const probe = createStatelessClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { error } = await probe.auth.signInWithPassword({ email: loginEmail, password })
  return !error
}

export async function changeOwnPassword(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await caller()
  if (!isSession(session)) return session

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
   * The address this account signs in with, from whichever of the three identifiers it
   * holds: a number for an owner, §5.2's username for a teacher who never gave one, or
   * §5.4's real email for anybody who signed up through the app. Built with
   * `loginAddressOf` — the login screen's own dispatch, applied to the identifier the
   * session holds — so that the password verified here is the password that screen accepts.
   *
   * THIS IS WHERE THE SCREEN USED TO BREAK, and the reason the resolution lives in one
   * module now. It asked for a number and then for a username, and an email account has
   * neither, so everybody who signed up through the app was told their password could not
   * be changed and to try again. Null now means a session with none of the three, which the
   * session cannot produce; it is refused rather than reported as a wrong password.
   */
  const loginEmail = loginAddressOf(session)
  if (!loginEmail) return { error: t.errors.failed }

  if (!(await passwordIsCurrent(loginEmail, current))) {
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

/**
 * Fixing your own name.
 *
 * No current password asked for, unlike the form directly below it on the same screen,
 * and a reader will notice the difference. The password box asks because a password
 * change can lock the real owner of the account out of it; a name cannot. Nothing here
 * grants access to anything, so the cost of the extra box would be a founder who gives
 * up on fixing "Jamsehd" rather than go and remember their password.
 *
 * Only `profiles.full_name`. The same name also sits in the auth account's
 * `user_metadata`, put there at signup — but the only thing that has ever read it is
 * the database trigger that creates the profile row in the first place, so writing it
 * again would be a second copy to keep in step with no reader to serve.
 *
 * And only this person's own row. The centre's spelling of a teacher lives on
 * `teachers.name`, which the owner fixes on /settings/teachers, and the two are
 * deliberately separate: a teacher may work at two centres, and neither owner gets to
 * rewrite what the other's app — or the person's own — calls them.
 */
export async function changeOwnName(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).account

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: t.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  // Through the caller's own client and keyed on the session's own id, so
  // `profiles_self_update` is what decides — the same shape as setLocale, and for the
  // same reason: an id off a form is a suggestion, an id off a verified session is not.
  //
  // No unchanged-value early return, unlike the subject and exam-kind toggles. Those
  // needed one because a replayed write would have flipped a switch back; setting a
  // name to what it already is has no second meaning, so the replay `useOffline` may
  // queue is harmless on its own.
  const supabase = await createClient()
  const { data: saved, error } = await supabase
    .from('profiles')
    .update({ full_name: name })
    .eq('id', session.userId)
    .select('id')

  // Zero rows and no error is what a policy refusal looks like from here, which is why
  // the row count is checked rather than just `error`.
  if (error || !saved || saved.length === 0) return { error: t.errors.nameFailed }

  // The whole layout, not one page: the header greets by this name and draws its first
  // letter in the account button, on every screen in the app.
  revalidatePath('/', 'layout')

  return { ok: t.nameDone }
}
