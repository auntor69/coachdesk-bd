import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'

/**
 * The root is a router, not a landing page.
 *
 * A marketing page belongs on its own domain later. Right now every visitor is
 * either a teacher who wants today's batch or someone who needs to sign in, and
 * making them read a hero section first is pure friction.
 */
export default async function Home() {
  const session = await getSession()
  redirect(session ? homePathFor(session) : '/login')
}
