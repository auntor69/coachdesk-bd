import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageCenter, getSession, homePathFor } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { formatBdMobile } from '@/lib/bd/phone'
import { digits } from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { PasswordForm } from './password-form'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).account.title} — CoachDesk` }
}

/**
 * The reader's own account: who the app thinks they are, and the only screen where
 * anybody changes their own password.
 *
 * `pageCenter`, so all five roles reach it — a student and a guardian included. It is
 * the only screen in `(app)` with no narrower guard than the layout's own, and that is
 * the point: an account nobody can re-secure is not a feature to gate by role or by
 * plan. Nothing here reads a centre's data, so there is nothing to scope.
 *
 * Two facts and a form. The number is shown because it is the login id and people
 * forget that — login is a phone and a password, with no email anywhere — and it is
 * shown read-only because changing it is not a form: the same number sits on the
 * profile, inside the auth account, and on a teacher row, so moving it is a migration.
 */
export default async function AccountPage() {
  const session = await pageCenter()
  const locale = session.locale
  const d = dict(locale)
  const t = d.account

  return (
    <div className="flex flex-col gap-5">
      <div>
        {/* Where the bottom bar would be for everybody else. A student or guardian
            has a single tab, which the shell does not draw as a bar at all, so
            without this the only way off this screen is the browser's back arrow. */}
        <Link
          href={homePathFor(session)}
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.back}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
      </div>

      <Card>
        <p className="text-sm text-ink-faint">{t.nameLabel}</p>
        <p className="font-medium text-ink">{session.fullName || t.noName}</p>

        <p className="mt-3 text-sm text-ink-faint">{t.phoneLabel}</p>
        <p className="num font-medium text-ink">{formatBdMobile(session.phone)}</p>
        <p className="mt-1 text-sm text-ink-soft">{t.phoneHint}</p>
      </Card>

      <Card>
        <h2 className="font-semibold text-ink">{t.passwordTitle}</h2>
        <p className="mb-3 mt-1 text-sm text-ink-soft">{t.passwordBody}</p>
        <PasswordForm
          t={t}
          common={d.common}
          nextHint={fill(t.nextHint, { n: digits(MIN_PASSWORD, locale) })}
        />
      </Card>
    </div>
  )
}
