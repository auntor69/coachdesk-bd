import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'
import { Card, Logo } from '@/components/ui'
import { OnboardingForm } from '../onboarding-form'

export const metadata = { title: 'শুরু করুন — CoachDesk' }

export default async function OnboardingPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  // Already attached to a center — an invited teacher never needs this page.
  if (session.active) redirect(homePathFor(session))

  /*
   * AND NOT ATTACHED TO A CENTRE IS NOT THE SAME AS NOT KNOWN TO BE.
   *
   * The form below creates a coaching centre. `session.active` is null for a brand-new
   * account, which is who it is for, and it was equally null when the `center_members`
   * read failed — so the owner of a working centre could be shown the form that makes
   * their second one, with everything they have in the first and nothing on the screen
   * saying so. requireCenter now keeps that off this page by refusing to redirect here,
   * and this is the same guard for the two ways in that do not go through it: the root
   * router, which sends a session with no active centre straight here, and the address
   * bar.
   *
   * A throw, landing on app/error.tsx — "something went wrong, try again" over a retry
   * button, in both languages. There is nothing for this reader to do and nowhere else
   * to send them, which is exactly what that screen is for.
   */
  if (session.membershipsUnreadable) {
    throw new Error('Centre memberships could not be read; not offering to create one.')
  }

  return (
    <main className="flex min-h-full flex-1 flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <p className="mt-3 text-ink-soft">
            {session.fullName
              ? `স্বাগতম, ${session.fullName}`
              : 'স্বাগতম'}
          </p>
        </div>

        <Card>
          <OnboardingForm />
        </Card>
      </div>
    </main>
  )
}
