'use server'

/**
 * Changing the language.
 *
 * Two writes, because there are two readers. `profiles.locale` is the durable
 * answer that every signed-in screen renders from, and the cookie is what the
 * login form and the root layout can see before anyone has signed in. Writing
 * only the profile would leave a reader who signed out staring at a Bangla form;
 * writing only the cookie would lose the choice on their next phone.
 *
 * Lives in lib rather than under src/app with the other actions, because it is the
 * one action both route groups need: the app shell offers it to a signed-in
 * teacher and the login screen offers it to somebody who cannot read the form yet.
 * Importing it out of either group would be the wrong dependency.
 */
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { asLocale, LOCALE_COOKIE, LOCALE_MAX_AGE } from './locale.ts'

export async function setLocale(formData: FormData) {
  // asLocale rather than a check-and-refuse. A Server Action is a public endpoint,
  // so anything can arrive here, and the worst outcome of a junk value is the
  // default language — which is also what the reader would get by clearing their
  // cookies. Nothing to report and nowhere to report it to: the switch is a
  // one-button form with no error surface.
  const locale = asLocale(formData.get('locale'))

  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    // Not in dev: localhost is http, and a Secure cookie there is set by the
    // server, dropped by the browser, and debugged for an hour.
    secure: process.env.NODE_ENV === 'production',
  })

  const session = await getSession()
  if (session) {
    const supabase = await createClient()
    // Through the user's own client, so profiles_self_update decides. The row id
    // comes from the session rather than the form for the same reason.
    await supabase.from('profiles').update({ locale }).eq('id', session.userId)
  }

  // Every string on every screen just changed, including the ones in the client
  // router cache that a Back button would otherwise show in the old language.
  revalidatePath('/', 'layout')
}
