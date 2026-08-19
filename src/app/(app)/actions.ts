'use server'

/**
 * Actions that belong to the app frame rather than to one screen.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { requireUser, homePathFor, homePathForRole } from '@/lib/auth/session'
import {
  ACTIVE_CENTER_COOKIE,
  ACTIVE_CENTER_MAX_AGE,
} from '@/lib/auth/active-center'

/**
 * Move the reader to another of their centres.
 *
 * The list of centres they may choose from is read from the database on this
 * request, not taken from the form that offered them. A Server Action is a public
 * HTTP endpoint — the markup that rendered these buttons proves nothing about the
 * request that arrives here, and this is the one input in the app that decides
 * which centre every subsequent query reads.
 *
 * An id that is not theirs is not an error worth a message: it means a stale tab,
 * a revoked membership, or somebody poking at the endpoint. All three want the
 * same answer — put them back on their own home screen.
 */
export async function switchCenter(formData: FormData) {
  const session = await requireUser()
  const wanted = String(formData.get('centerId') ?? '')

  const chosen = session.memberships.find((m) => m.centerId === wanted)
  if (!chosen) redirect(homePathFor(session))

  const store = await cookies()
  store.set(ACTIVE_CENTER_COOKIE, chosen.centerId, {
    path: '/',
    maxAge: ACTIVE_CENTER_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    // Not in dev: localhost is http, and a Secure cookie there is set by the
    // server, dropped by the browser, and debugged for an hour.
    secure: process.env.NODE_ENV === 'production',
  })

  // The whole tree, because every screen under it was rendered for the other
  // centre — including the ones sitting in the client router cache that a Back
  // button would otherwise show unchanged, under the new centre's name.
  revalidatePath('/', 'layout')

  // Their home screen in the new centre, not the page they were on. An owner of
  // one centre can be a teacher at another, and /settings would answer that with
  // a permission error one tap after a successful switch. Recomputed from the
  // membership rather than from a fresh session, which is memoised per request
  // and would still name the centre they just left.
  redirect(homePathForRole(chosen.role))
}
