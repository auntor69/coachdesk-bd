import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'
import { Card, Logo } from '@/components/ui'
import { LanguageSwitch } from '@/components/language-switch'
import { dict } from '@/lib/i18n'
import { readerLocale } from '@/lib/i18n/server'
import { LoginForm } from '../login-form'

/**
 * The tab, the app switcher and the installed app's title, in the reader's own language.
 *
 * Every other page in the product reads its title out of the dictionary — see the note on
 * `notices/page.tsx`'s own — and these three were Bangla because the screens around them
 * were. `readerLocale` rather than a session, for the reason the body gives: there is none.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await readerLocale()
  return { title: `${dict(locale).auth.login.title} — CoachDesk` }
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Already signed in: send them where they were going, not back to a form.
  const session = await getSession()
  if (session) redirect(homePathFor(session))

  // searchParams is a Promise in Next 16.
  const params = await searchParams
  const next = typeof params.next === 'string' ? params.next : undefined

  /*
   * THE LANGUAGE COMES FROM THE COOKIE, AND THIS SCREEN IS WHY THE COOKIE EXISTS.
   *
   * `readerLocale` reads `profiles.locale` when there is a session and the cookie when
   * there is not, and this is the one screen every reader reaches with no session at all.
   * Both notes on the other side of that call say what it is for in the same words — an
   * English reader who signs out must not be handed a Bangla form they cannot read — and
   * until now nothing here asked, so the copy was Bangla by hand and the switch below was
   * drawn on no screen the reader could reach while signed out. That is the whole defect:
   * the control `components/language-switch.tsx` names this screen as the reason for was
   * the one control this screen did not have.
   */
  const locale = await readerLocale()
  const t = dict(locale).auth

  return (
    <main className="flex min-h-full flex-1 flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        {/* Above the wordmark, in the corner every phone app keeps it: a reader who cannot
            read the form has to find this before they read anything else. */}
        <div className="mb-3 flex justify-end">
          <LanguageSwitch locale={locale} />
        </div>

        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <p className="mt-3 text-ink-soft">{t.login.tagline}</p>
        </div>

        <Card>
          <LoginForm next={next} t={t.login} />
        </Card>
      </div>
    </main>
  )
}
