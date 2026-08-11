import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'
import { Card, Logo } from '@/components/ui'
import { SignupForm } from '../signup-form'

export const metadata = { title: 'নতুন অ্যাকাউন্ট — CoachDesk' }

export default async function SignupPage() {
  const session = await getSession()
  if (session) redirect(homePathFor(session))

  return (
    <main className="flex min-h-full flex-1 flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <p className="mt-3 text-ink-soft">
            ফ্রি — একটি ব্যাচের জন্য সব সুবিধা
          </p>
        </div>

        <Card>
          <SignupForm />
        </Card>

        <p className="mt-5 text-center text-sm text-ink-faint">
          শিক্ষার্থীদের তথ্য শুধু আপনার কোচিং দেখতে পাবে। অন্য কেউ নয়।
        </p>
      </div>
    </main>
  )
}
