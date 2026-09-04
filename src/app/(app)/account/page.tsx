import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { pageCenter, getSession, homePathFor } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { formatBdMobile } from '@/lib/bd/phone'
import { digits } from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { NameForm } from './name-form'
import { PasswordForm } from './password-form'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).account.title} — CoachDesk` }
}

/**
 * The reader's own account: who the app thinks they are, and the only screen where
 * anybody changes their own name or their own password.
 *
 * `pageCenter`, so all five roles reach it — a student and a guardian included. It is
 * the only screen in `(app)` with no narrower guard than the layout's own, and that is
 * the point: an account nobody can re-secure is not a feature to gate by role or by
 * plan. Nothing here reads a centre's data, so there is nothing to scope.
 *
 * Two forms and a fact, in that order, and the fact is deliberately stranded between
 * them: a reader who has just corrected their own name is exactly the reader about to
 * try the identifier below it. Saying it cannot be moved right there saves the attempt.
 * It is shown at all because it is the login id and people forget that — login is a
 * number *or* a username, plus a password, with no email anywhere — and it is
 * read-only because changing it is not a form: the same number sits on the profile,
 * inside the auth account, and on a teacher row, so moving it is a migration.
 */
export default async function AccountPage() {
  const session = await pageCenter()
  const locale = session.locale
  const d = dict(locale)
  const t = d.account

  return (
    <div className="flex flex-col gap-5">
      {/* The crumb is where the bottom bar would be for everybody else. A student or
          guardian has a single tab, which the shell does not draw as a bar at all, so
          without it the only way off this screen is the browser's back arrow. */}
      <PageHeader title={t.title} back={{ href: homePathFor(session), label: t.back }} />

      {/* Capped on the cards and not on the column, so the bar reaches the workspace
          edges while a name box stays the width of a name. */}
      <Card className="max-w-2xl">
        <h2 className="font-semibold text-ink">{t.nameTitle}</h2>
        <p className="mb-3 mt-1 text-sm text-ink-soft">{t.nameBody}</p>
        {/* `?? ''` and not the old "No name set" line: the box itself is where the
            name is read now, and an empty box under the label "Name" says the same
            thing without a second sentence to translate. */}
        <NameForm fullName={session.fullName ?? ''} t={t} common={d.common} />
      </Card>

      <Card className="max-w-2xl">
        {/* Whichever of the two this account signs in with. A username teacher has no
            number to show, and the number card standing empty under the heading
            "Login number" would read as something they still have to supply — when in
            fact they have an identifier and it is the one they cannot see anywhere
            else. `session.username` comes off the login address itself, so this card
            cannot show one thing while another signs them in. */}
        {session.phone || !session.username ? (
          <>
            <p className="text-sm text-ink-faint">{t.phoneLabel}</p>
            <p className="num font-medium text-ink">{formatBdMobile(session.phone)}</p>
            <p className="mt-1 text-sm text-ink-soft">{t.phoneHint}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-faint">{t.usernameLabel}</p>
            <p className="font-medium text-ink">{session.username}</p>
            <p className="mt-1 text-sm text-ink-soft">{t.usernameHint}</p>
          </>
        )}
      </Card>

      <Card className="max-w-2xl">
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
