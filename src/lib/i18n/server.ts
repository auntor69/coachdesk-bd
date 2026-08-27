/**
 * Which language *this request* is in, for the two places that cannot ask a
 * session for it.
 *
 * Every signed-in screen already has `session.locale`, which is
 * `profiles.locale`, and should keep using it — one memoised query answers the
 * whole render. This file exists for the root layout, which sets `<html lang>` for
 * signed-out pages too, and for the login and signup screens, where there is no
 * profile to read yet.
 *
 * Session first, cookie second. That order matters: a preference on the account
 * travels to whatever phone or laptop the reader signs in on, which is what
 * somebody who set the app to English on a borrowed computer expects. The cookie is
 * the anonymous half. Nothing signed out can set it — the only switch in the product
 * is in the app shell, which needs a session — so what it actually carries is a
 * choice made inside the app, forward onto the screens that come after signing out.
 * Which is the whole point of writing it on every switch: an English reader who signs
 * out does not get handed a Bangla login form.
 *
 * Because the session wins, this can never disagree with `dict(session.locale)`
 * on a signed-in screen. A page rendering English under `<html lang="bn">` is not
 * a cosmetic bug: it is what a screen reader believes, and it decides which
 * hyphenation and which font fallback the browser picks.
 *
 * Separate from ./actions.ts because that file is `'use server'`, and every export
 * of a `'use server'` file is a callable HTTP endpoint. A locale getter is not one.
 */
import { cookies } from 'next/headers'
import { cache } from 'react'

import { getSession } from '@/lib/auth/session'
import { asLocale, LOCALE_COOKIE, type Locale } from './locale.ts'

export const readerLocale = cache(async (): Promise<Locale> => {
  const session = await getSession()
  if (session) return session.locale

  const store = await cookies()
  // asLocale, not a cast: this is a client-writable cookie, and a value that is
  // neither 'bn' nor 'en' has to land on the default rather than index a
  // dictionary with a key it does not have.
  return asLocale(store.get(LOCALE_COOKIE)?.value)
})
