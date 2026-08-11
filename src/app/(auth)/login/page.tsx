import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'
import { Card, Logo } from '@/components/ui'
import { LoginForm } from '../login-form'

export const metadata = { title: 'লগইন — CoachDesk' }

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Already signed in: send them where they were going, not back to a form.
  const session = await getSession()
  if (session) redirect(homePathFor(session))

  // searchParams is a Promise in Next 16.
  const params = await searchParams
  const next = typeof params.next === 'string' ? params.next : undefined

  return (
    <main className="flex min-h-full flex-1 flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <p className="mt-3 text-ink-soft">
            হাজিরা, ফলাফল আর ফি — এক জায়গায়
          </p>
        </div>

        <Card>
          <LoginForm next={next} />
        </Card>
      </div>
    </main>
  )
}
