/**
 * Making an account whose login id is a username rather than a phone number (§5.2).
 *
 * ITS OWN MODULE BECAUSE THERE ARE TWO CALLERS NOW. It began inside
 * settings/actions.ts, where the teachers screen mints a login for the part-timer whose
 * number the centre does not have. §6.2's manager appointment needs the same thing for
 * the same reason — an office manager written down as an employee with no phone on the
 * row — and a `"use server"` module may export nothing but Server Actions, so a function
 * shared between two of them cannot live in either.
 *
 * NOT IN lib/bd/username.ts, which is pure string work: every candidate, every domain and
 * every parse in that file is tested against no network at all, and putting a GoTrue call
 * in it would make `tests/username.test.ts` reach for a service-role key to test
 * `transliterateBn`.
 *
 * THE CLIENT IS AN ARGUMENT, like `branchChoicesFor`'s. This module is imported by
 * `node --test`, which has no `next/headers` to build one from, and the caller already
 * holds an admin client carrying the actor header that migration 56 reads.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  USERNAME_ATTEMPTS,
  usernameCandidate,
  usernameToLoginEmail,
} from '../bd/username.ts'
import type { Locale } from '../i18n/locale.ts'
import type { Database } from '../supabase/types.ts'

/**
 * What making a username login came to: the account, or which way it did not.
 *
 * `taken` and `failed` are separated because only one of them is worth retrying and they
 * ask the owner for different things — a different spelling of the name versus the same
 * submit again in a minute.
 */
export type UsernameLogin =
  | { userId: string; username: string }
  | { refused: 'taken' | 'failed' }

/**
 * Whether GoTrue is saying this login address already belongs to somebody.
 *
 * The whole collision loop rests on this answer, so it reads two things rather than one.
 * `email_exists` is the code the current API returns; the message regex is what older
 * builds and the odd proxy send instead, and it is the same test (auth)/actions.ts already
 * applies to a duplicate signup.
 */
export function isEmailTakenError(
  error: { code?: string; message: string } | null,
): boolean {
  if (!error) return false
  if (error.code === 'email_exists') return true
  return /already registered|already been registered|already exists/i.test(error.message)
}

/**
 * An account for somebody whose centre has no phone number for them.
 *
 * WHERE THE UNIQUENESS COMES FROM. Not from a SELECT — this walks candidates and lets
 * `auth.users.email` refuse the ones that are taken, because a SELECT that found nothing
 * is not a reservation: two managers adding a Rahim in the same second would both read
 * "free" and both try `rahim`. One of them gets it, the other is told the address exists
 * and moves on to `rahim01`. The username is the local part of that address, so the
 * constraint doing the work is the same one that decides who can sign in.
 *
 * ONE RESOLVER, AND IT IS THIS LOOP. The trigger in 20260811000038 writes what it is
 * handed and never appends a suffix, so `profiles.username` cannot end up saying `rahim01`
 * while the account signs in as `rahim` — a displayed username that does not work is the
 * only way this feature really fails.
 *
 * ANYTHING THAT IS NOT A COLLISION STOPS IT. A dead network or a bad key would otherwise
 * become a hundred round trips before one error message.
 */
export async function createUsernameLogin(
  admin: SupabaseClient<Database>,
  base: string,
  name: string,
  password: string,
  locale: Locale,
): Promise<UsernameLogin> {
  for (let attempt = 0; attempt < USERNAME_ATTEMPTS; attempt += 1) {
    const username = usernameCandidate(base, attempt)
    const email = usernameToLoginEmail(username)

    // Unreachable, and handled rather than asserted: tests/username.test.ts proves every
    // candidate for every base is a valid username across the whole range, and a throw
    // here would be a stack trace inside a Server Action.
    if (!email) return { refused: 'failed' }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // No `phone` key, which is the point of the whole exercise. `username` is read by
      // app.handle_new_user and written to profiles.username, so a screen can show what
      // this person types without digging it out of an address.
      user_metadata: { full_name: name, username, locale },
    })

    if (!error && data.user) return { userId: data.user.id, username }
    if (!isEmailTakenError(error)) return { refused: 'failed' }
  }

  // A hundred collisions on one base is a hundred people of that name across the whole
  // platform. The honest answer is to ask for a different spelling.
  return { refused: 'taken' }
}
