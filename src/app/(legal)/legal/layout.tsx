import Link from 'next/link'

import { LanguageSwitch } from '@/components/language-switch'
import { Logo } from '@/components/ui'
import { readerLocale } from '@/lib/i18n/server'
import { copyFor, POLICIES, policyHref, SUPPORT_PHONE } from '@/lib/legal/policies'
import { legalShell } from '@/lib/legal/shell'

/**
 * The frame around the seven documents — MASTERPLAN.md §14.1, build-order step 25a.
 *
 * THE ONLY PUBLIC PAGES WITH A SHELL OF THEIR OWN, and they need one because they are the
 * only public pages a stranger arrives at from outside: somebody who has been sent
 * coachdesk.../legal/prepaid-billing by a founder, or who tapped the non-refundable line on
 * the recharge screen. The login and signup screens are a single centred card, which is right
 * for a form and wrong for seven documents somebody may want to read one after another.
 *
 * `readerLocale` RATHER THAN A SESSION, the same call the root layout makes and for the same
 * reason: a signed-in owner reading the terms from inside the app gets their own language,
 * and somebody who has never signed in gets the cookie or Bangla. It is also why the language
 * switch is in the header — §14.1's reader is a coaching-centre owner in Mymensingh, and a
 * legal page they cannot read is a legal page that does not exist.
 *
 * NO SIGN-IN WALL AND NO INTERSTITIAL. These pages are linked from the signup checkbox and
 * from the recharge screen, so they are read by people who are not signed in yet, and
 * `src/proxy.ts` lists `/legal` among the routes that never ask for a session. The two links
 * in the header go the other way: back to the product, or to the login form.
 *
 * A `Link` TO `/` AND NOT A HEADER WITH A NAV: a signed-in reader clicking the mark lands on
 * the product's own router, which sends them to their dashboard or to the login form, and
 * neither of those is this group's business. The footer lists every policy, so the pages are
 * reachable from each other without going back to the index.
 */
export default async function LegalLayout({ children }: LayoutProps<'/legal'>) {
  const locale = await readerLocale()
  const words = legalShell(locale)

  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface-alt">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="rounded-lg" aria-label="CoachDesk">
            <Logo className="text-lg" />
          </Link>

          <div className="flex items-center gap-1">
            <LanguageSwitch locale={locale} />
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              {words.backToSignIn}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">{children}</main>

      <footer className="mt-8 border-t border-line bg-white">
        <div className="mx-auto w-full max-w-3xl px-5 py-6">
          <p className="text-sm font-semibold text-ink">{words.allPolicies}</p>

          <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {POLICIES.map((doc) => (
              <Link
                key={doc.kind}
                href={policyHref(doc.slug)}
                className="text-sm text-ink-soft underline decoration-line underline-offset-4
                  hover:text-brand-700"
              >
                {copyFor(doc, locale).title}
              </Link>
            ))}
          </nav>

          {/* The one phone number, from the constant and not typed into a sentence. It is
              the number a customer already chases a recharge on (§14.1), so a page that
              gives a different one would be the second number nobody answers. */}
          <p className="mt-4 text-sm text-ink-faint">
            {words.contact(SUPPORT_PHONE)}
          </p>
        </div>
      </footer>
    </div>
  )
}
