import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { PLANS } from '@/lib/plans'
import { digits } from '@/lib/bd/time'
import { readerLocale } from '@/lib/i18n/server'
import { copyFor, policyFor, policyHref } from '@/lib/legal/policies'
import { Card, Logo } from '@/components/ui'
import { SignupForm } from '../signup-form'

export const metadata = { title: 'নতুন অ্যাকাউন্ট — CoachDesk' }

/**
 * The free tier, described by the free tier.
 *
 * This line used to read 'all the features, for one batch', which was not true and
 * was the expensive kind of untrue: printed receipts, export and the parent summary
 * are all Pro, so the sentence promised things the product refuses — and it refuses
 * them after a teacher has typed in thirty students, which is the worst moment to
 * learn it. Two caps read off `PLANS` promise only what the tier actually gives, and
 * they move on their own if the tier ever changes.
 */
const FREE = PLANS.teacher_free

export default async function SignupPage() {
  const session = await getSession()
  if (session) redirect(homePathFor(session))

  /*
   * The two documents the checkbox links to, composed here and handed down as finished
   * strings (MASTERPLAN.md §14.1). The form is a client component and must not import
   * `lib/legal/policies.ts` — seven documents in two languages is most of a megabyte, and
   * what the form needs is two titles and two addresses. Same rule as the dictionaries: a
   * client component is handed the words it draws and nothing else.
   *
   * `readerLocale` rather than a session, because there is no profile yet — this page is
   * the reason §5.4's signup has two steps, and the reader is whoever is at the door.
   */
  const locale = await readerLocale()
  const terms = policyFor('terms')
  const privacy = policyFor('privacy')

  return (
    <main className="flex min-h-full flex-1 flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <p className="mt-3 text-ink-soft">
            ফ্রি — {digits(FREE.maxBatches ?? 1, 'bn')} ব্যাচ,{' '}
            {digits(FREE.maxStudents ?? 0, 'bn')} জন শিক্ষার্থী পর্যন্ত
          </p>
        </div>

        <Card>
          <SignupForm
            passwordHint={`কমপক্ষে ${digits(MIN_PASSWORD, 'bn')} অক্ষর`}
            terms={{ href: policyHref(terms.slug), label: copyFor(terms, locale).title }}
            privacy={{
              href: policyHref(privacy.slug),
              label: copyFor(privacy, locale).title,
            }}
          />
        </Card>

        <p className="mt-5 text-center text-sm text-ink-faint">
          শিক্ষার্থীদের তথ্য শুধু আপনার কোচিং দেখতে পাবে। অন্য কেউ নয়।
        </p>
      </div>
    </main>
  )
}
