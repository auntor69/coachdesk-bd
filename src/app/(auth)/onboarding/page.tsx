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
