import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { pageCenter, getSession, homePathFor } from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { describeLoginIdentifier } from '@/lib/auth/identifier'
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
 * It is shown at all because it is the login id and people forget which of the three
 * things they type — a number, a username, or the address they signed up with — and it
 * is read-only because changing it is not a form: for a staff login the same number sits
 * on the profile, inside the auth account and on a teacher row, so moving it is a
 * migration.
 */
export default async function AccountPage() {
  const session = await pageCenter()
  const locale = session.locale
  const d = dict(locale)
  const t = d.account
  // One call for the identifier card, so the three shapes are decided in one place and
  // not re-tested in the markup — see lib/auth/identifier.ts for what that cost.
  const login = describeLoginIdentifier(session, t)

  return (
    <div className="flex flex-col gap-5">
      {/* The crumb is where the bottom bar would be for everybody else. A student or
          guardian has a single tab, which the shell does not draw as a bar at all, so
          without it the only way off this screen is the browser's back arrow. */}
      <PageHeader title={t.title} back={{ href: homePathFor(session), label: t.back }} />

      {/*
       * TWO COLUMNS FROM `lg`, WHICH IS EXACTLY WHERE THE WORKSPACE STOPS BEING A PHONE.
       * Below that breakpoint the shell's `main` is a 672px column and these cards fill it.
       * Above it `main` goes to 1216px, and the cards — each capped at `max-w-2xl`, because
       * a box for a name should be the width of a name — went on sitting in the left 672px
       * of it with the other 544 empty. That is the reported bug: the desk was there and
       * the screen was not using it.
       *
       * The fix is the grid's shape rather than a wider card. Two columns of the same
       * cards, the cap left on each of them, and nothing stretched to a width no form
       * wants — see tests/account.test.ts, which pins the shape and the phone's order.
       *
       * The forms go in the left column and the password in the right, which keeps the
       * identifier directly under the name on every screen: a reader who has just fixed
       * their own spelling is the reader about to try the login they cannot remember, and
       * saying it cannot be moved there saves the attempt (see the note on the identifier
       * card). One column below `lg` — same order, top to bottom, which is the order a
       * phone reads.
       *
       * The cap stays on the CARDS and never on the column that holds `PageHeader`: the
       * bar bleeds to the workspace edges with `lg:-mx-8`, and a `max-w-*` above it stops
       * that background at the column's edge. tests/page-header.test.ts is the tripwire,
       * and this file is where that was got wrong once already.
       */}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-5">
          <Card className="max-w-2xl">
            <h2 className="font-semibold text-ink">{t.nameTitle}</h2>
            <p className="mb-3 mt-1 text-sm text-ink-soft">{t.nameBody}</p>
            {/* `?? ''` and not the old "No name set" line: the box itself is where the
                name is read now, and an empty box under the label "Name" says the same
                thing without a second sentence to translate. */}
            <NameForm fullName={session.fullName ?? ''} t={t} common={d.common} />
          </Card>

          {/* Whichever of the three this account signs in with, drawn only when it has
              one. The card is here because this is the only screen that can say it: a
              staff login is a number or a username somebody was told out loud once, and a
              self-serve account is one of however many addresses its owner holds.
              `homePathFor` above and this card are the two things a reader comes to this
              screen for. */}
          {login && (
            <Card className="max-w-2xl">
              <p className="text-sm text-ink-faint">{login.label}</p>
              {/* `break-all` on the two that can be long: an address or a username runs
                  off the side of a 320px phone, where eleven digits never do. */}
              <p
                className={
                  login.numeric ? 'num font-medium text-ink' : 'break-all font-medium text-ink'
                }
              >
                {login.value}
              </p>
              <p className="mt-1 text-sm text-ink-soft">{login.hint}</p>
            </Card>
          )}
        </div>

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
    </div>
  )
}
