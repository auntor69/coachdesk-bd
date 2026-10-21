import { redirect } from 'next/navigation'

import { getSession, homePathFor } from '@/lib/auth/session'
import { dict } from '@/lib/i18n'
import { Card, Logo } from '@/components/ui'
import { OnboardingForm } from '../onboarding-form'
import { signOut } from '../actions'

export const metadata = { title: 'শুরু করুন — CoachDesk' }

/**
 * The way out, and the reason it is on both branches below.
 *
 * /login redirects a live session to `homePathFor`, which for an account with no
 * membership is this page — so before this button existed, a signed-in reader who
 * did not want to found a coaching centre had no route anywhere in the product. Not
 * a dead end in a corner either: it is where every switched-off teacher lands.
 */
function SignOut({ label, className = 'mt-6' }: { label: string; className?: string }) {
  return (
    <form action={signOut} className={`${className} text-center`}>
      <button
        type="submit"
        className="min-h-tap rounded-lg px-3 text-sm font-medium text-ink-soft
          hover:bg-surface-alt hover:text-ink"
      >
        {label}
      </button>
    </form>
  )
}

export default async function OnboardingPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  // Already attached to a center — an invited teacher never needs this page.
  if (session.active) redirect(homePathFor(session))

  /*
   * AND NOT ATTACHED TO A CENTRE IS NOT THE SAME AS NOT KNOWN TO BE.
   *
   * The form below creates a coaching centre. `session.active` is null for a brand-new
   * account, which is who it is for, and it was equally null when the `center_members`
   * read failed — so the owner of a working centre could be shown the form that makes
   * their second one, with everything they have in the first and nothing on the screen
   * saying so. requireCenter now keeps that off this page by refusing to redirect here,
   * and this is the same guard for the two ways in that do not go through it: the root
   * router, which sends a session with no active centre straight here, and the address
   * bar.
   *
   * A throw, landing on app/error.tsx — "something went wrong, try again" over a retry
   * button, in both languages. There is nothing for this reader to do and nowhere else
   * to send them, which is exactly what that screen is for.
   */
  if (session.membershipsUnreadable) {
    throw new Error('Centre memberships could not be read; not offering to create one.')
  }

  /*
   * THE FOUNDER NEVER SEES THIS FORM, and this redirect is the reason the platform
   * account cannot own a coaching centre by accident. `is_platform_admin` is not a
   * membership and not a role in any centre, so without this branch the founder
   * account — which holds no centre — was greeted by the form that makes one, and a
   * centre created from it would put a customer's data on the one login that can
   * already see every centre. `/founder` is that account's home (homePathFor agrees),
   * and a platform admin who also holds a membership never reaches here: the
   * `session.active` branch above already sent them to their centre.
   *
   * Below the unreadable guard on purpose: a failed memberships read must not be
   * read as "the founder signed in" any more than as "no centre".
   */
  if (session.isPlatformAdmin) redirect('/founder')

  /*
   * THIS SCREEN HAS TWO READERS AND THEY WANT OPPOSITE THINGS.
   *
   * `session.username` is non-null exactly when the login address sits on the username
   * domain (see lib/bd/username.ts), which is to say the centre minted this credential
   * from a teacher's name — a password the manager chose and can still read off the
   * roster. `toggleTeacherActive` deletes the `center_members` row when that teacher is
   * switched off, so the ordinary end of a term leaves them here: greeted by name, over
   * a form inviting them to found an institution, on a login that is not theirs.
   *
   * They get the plain fact instead. Their own centre is still open to them — with their
   * own number, as a signup, which is §1's Teacher Free tier and refuses nobody. What is
   * refused is founding one on a borrowed key, and the refusal that counts is in
   * `bootstrap_center` (20260811000077); this is only the screen agreeing with it.
   *
   * A teacher whose login IS their own number falls through to the form, because that
   * account is genuinely theirs. `expected` below is the sentence they need.
   *
   * Read in the reader's own language, unlike the rest of (auth): a signup has expressed
   * no preference yet and gets Bangla, but this person has a profile and a locale in it.
   */
  const d = dict(session.locale)
  const t = d.noCenter

  if (session.username || !session.email) {
    return (
      <main className="flex min-h-full flex-1 flex-col justify-center px-5 py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 text-center">
            <Logo className="text-2xl" />
          </div>

          <Card>
            <h1 className="text-lg font-bold text-ink">{t.title}</h1>
            <p className="mt-3 text-ink-soft">{t.body}</p>
            <p className="mt-4 text-sm text-ink-faint">
              {t.refused} {t.signUpOwn}
            </p>
          </Card>

          <SignOut label={d.shell.logout} />
        </div>
      </main>
    )
  }

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

        {/* For the teacher who signs in with their own number and was switched off:
            same empty membership list, but their account is their own, so the form
            stays. This is the only thing on the screen that explains the mismatch. */}
        <p className="mt-6 text-center text-sm text-ink-faint">{t.expected}</p>
        <SignOut label={d.shell.logout} className="mt-2" />
      </div>
    </main>
  )
}
