import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'
import { PLANS } from '@/lib/plans'
import { digits } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { passwordTooShort } from '@/lib/i18n/messages'
import { readerLocale } from '@/lib/i18n/server'
import { copyFor, policyFor, policyHref } from '@/lib/legal/policies'
import { Card, Logo } from '@/components/ui'
import { AuthBrandPanel } from '@/components/auth-brand'
import { LanguageSwitch } from '@/components/language-switch'
import { SignupForm } from '../signup-form'

/** The tab and the app switcher, in the reader's language — see login/page.tsx's own note. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await readerLocale()
  return { title: `${dict(locale).auth.signup.title} — CoachDesk` }
}

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

/** The free tier's two caps, read once so the sentence and the tier cannot disagree. */
const FREE_BATCHES = FREE.maxBatches ?? 1
const FREE_STUDENTS = FREE.maxStudents ?? 0

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
   * the reason §5.4's signup has two steps, and the reader is whoever is at the door. It is
   * also what makes the switch above the wordmark work: without a session the cookie is the
   * only record of the reader's language, and this screen is one of the two places it has to
   * be read — see lib/i18n/server.ts. The document titles below already followed it, which
   * is how a Bangla form came to carry English legal links.
   */
  const locale = await readerLocale()
  const t = dict(locale).auth
  const terms = policyFor('terms')
  const privacy = policyFor('privacy')

  return (
    /* Same two frames as /login — the panel's own note is on components/auth-brand.tsx. */
    <main className="flex min-h-full flex-1 flex-col lg:grid lg:grid-cols-[1.15fr_1fr]">
      <AuthBrandPanel t={t.brand} />

      <div className="flex flex-1 flex-col justify-center px-5 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-sm">
          {/* The corner every phone app keeps it in, and the control a reader who cannot
              read this form is looking for. */}
          <div className="mb-3 flex justify-end">
            <LanguageSwitch locale={locale} />
          </div>

          <div className="mb-8 text-center">
            <Logo className="text-2xl" />
            <p className="mt-3 text-ink-soft">
              {/*
                * Two templates, one ternary, because English inflects on a count Bangla
                * ignores — and the free tier is one batch, so the plural wording would have
                * read "1 batches" on the screen every new centre sees. `daysLate`/`lateLabel`
                * are the same shape for the same reason.
                */}
              {fill(FREE_BATCHES === 1 ? t.signup.freeLineOne : t.signup.freeLine, {
                batches: digits(FREE_BATCHES, locale),
                students: digits(FREE_STUDENTS, locale),
              })}
            </p>
          </div>

          <Card>
            <SignupForm
              // The rule the action refuses on, not a second wording of it: `MIN_PASSWORD`
              // is the number in this sentence and the number the check reads, and this is
              // one of the two screens `common.passwordTooShort` was written for.
              passwordHint={passwordTooShort(locale)}
              terms={{ href: policyHref(terms.slug), label: copyFor(terms, locale).title }}
              privacy={{
                href: policyHref(privacy.slug),
                label: copyFor(privacy, locale).title,
              }}
              t={t.signup}
              locale={locale}
            />
          </Card>

          <p className="mt-5 text-center text-sm text-ink-faint">
            {t.signup.privacyNote}
          </p>
        </div>
      </div>
    </main>
  )
}
