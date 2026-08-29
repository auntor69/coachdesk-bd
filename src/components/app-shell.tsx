/**
 * The frame every signed-in screen sits in.
 *
 * Navigation lives at the *bottom* on phones. That is not an aesthetic choice:
 * teachers hold the phone one-handed while looking at a room full of students,
 * and the top of a 6.5" screen is out of thumb reach. Desktop gets the same
 * bar — owners check the fee board on a laptop, but they are a minority and a
 * second layout is a second thing to keep correct.
 */
import Link from 'next/link'
import type { Route } from 'next'

import { signOut } from '@/app/(auth)/actions'
import { switchCenter } from '@/app/(app)/actions'
import { LanguageSwitch } from '@/components/language-switch'
import { Logo } from '@/components/ui'
import type { MemberRole, CenterStatus } from '@/lib/supabase/types'
import type { Session } from '@/lib/auth/session'
import {
  atLeast,
  canReadFees,
  canManageStudents,
  canManageBatches,
} from '@/lib/auth/session'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { dict, type Dictionary } from '@/lib/i18n'

/**
 * `href` is `Route`, not string, so a nav entry pointing at a route that does
 * not exist fails the build. The bottom bar is the only navigation most users
 * ever touch; a dead tab here is worse than a dead link anywhere else.
 *
 * `label` is a key into the nav group rather than a string, so the table below
 * stays one table instead of one per language — and a key that does not exist in
 * the dictionary fails the build alongside a route that does not exist.
 */
type NavItem = { href: Route; label: keyof Dictionary['shell']['nav']; icon: string }

/**
 * The fee tab, named once because two roles reach it by different routes — the
 * table below for a staff-admin, `canReadFees` for a teacher whose owner has
 * ticked the permission. Two literals would eventually be two different icons.
 */
const FEES_TAB: NavItem = { href: '/fees', label: 'fees', icon: '৳' }

/** Named for the same reason, now that three roles reach it. */
const EXAMS_TAB: NavItem = { href: '/exams', label: 'exams', icon: '✎' }

/**
 * Settings, named for the same reason the fee tab is.
 *
 * A teacher reaches it when the owner has ticked `can_manage_students` or
 * `can_manage_batches` — the hub then shows them the one or two rows those boxes
 * open and nothing else. Until 20260811000019 there was no route in for them at
 * all, which is half of why the two checkboxes did nothing: the screens were behind
 * a rank they could not clear, and behind a tab they were never given.
 */
const SETTINGS_TAB: NavItem = { href: '/settings', label: 'settings', icon: '⚙' }

/**
 * Owners and managers, who see the same five tabs.
 *
 * One array rather than two identical ones, because the two roles had drifted:
 * both were missing /exams while a teacher had it, and a fix applied to `owner`
 * alone would have left every manager in the country unable to reach a third of
 * the product. Written as a shared const rather than merged into one Record key
 * so that the day an owner-only tab exists it is `[...STAFF_ADMIN_NAV, BILLING]`
 * and not a re-split of four entries.
 *
 * Exams sits after attendance, matching the teacher's bar, so somebody promoted
 * from teaching finds it where they left it. Settings stays last, where every
 * app on the phone keeps it.
 */
const STAFF_ADMIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'home', icon: '⌂' },
  { href: '/teach', label: 'attendance', icon: '✓' },
  EXAMS_TAB,
  FEES_TAB,
  SETTINGS_TAB,
]

/**
 * What each role sees. Icons are text glyphs rather than an icon font or SVG
 * sprite — one less network request on a 3G connection, and they inherit the
 * Bangla font's baseline so nothing sits half a pixel off.
 *
 * Keyed by MemberRole rather than string: adding a role to the enum then breaks
 * here until someone decides what that role's navigation is, instead of
 * silently handing them an empty bar.
 *
 * Note what this table is not: a plan gate. Every screen here is guarded by role
 * and permission alone, so a solo teacher on teacher_free — who is the `owner` of
 * their own centre — gets all five tabs. Exams especially: on the free plan the
 * owner *is* the teacher, and marks are a third of what they signed up for.
 */
const NAV: Record<MemberRole, NavItem[]> = {
  owner: STAFF_ADMIN_NAV,
  manager: STAFF_ADMIN_NAV,
  teacher: [{ href: '/teach', label: 'attendance', icon: '✓' }, EXAMS_TAB],
  student: [{ href: '/me', label: 'mine', icon: '⌂' }],
  guardian: [{ href: '/me', label: 'myChild', icon: '⌂' }],
}

/**
 * The centre's name, and a way out of it for people who have more than one.
 *
 * A `<details>` and one form per centre, rather than a `<select>` with an
 * onChange: this is a Server Component and a dropdown that switches on change
 * needs client JavaScript to submit. A disclosure works before the bundle
 * arrives, which on a 3G connection in Mymensingh is most of the first ten
 * seconds. It also degrades honestly — with JS off it is still a list of
 * buttons that each post a form.
 */
function CenterName({ session, t }: { session: Session; t: Dictionary['shell'] }) {
  if (!session.active) return null

  if (session.memberships.length < 2) {
    return (
      <p className="mt-0.5 truncate text-sm text-ink-soft">
        {session.active.centerName}
      </p>
    )
  }

  return (
    <details className="relative">
      <summary
        className="flex min-h-tap cursor-pointer list-none items-center gap-1
          text-sm text-ink-soft marker:hidden hover:text-ink
          [&::-webkit-details-marker]:hidden"
      >
        <span className="truncate">{session.active.centerName}</span>
        <span aria-hidden className="text-xs">
          ▾
        </span>
      </summary>

      {/* min-w rather than w: a centre's name is as long as its owner typed it,
          and the panel should fit the names it holds, not a guess at them. */}
      <div
        className="absolute left-0 top-full z-20 mt-1 flex min-w-56 max-w-xs
          flex-col rounded-xl border border-line bg-white p-1 shadow-lg"
      >
        <p className="px-3 py-1.5 text-xs font-medium text-ink-faint">
          {t.otherCenter}
        </p>
        {session.memberships.map((m) => {
          const here = m.centerId === session.active?.centerId
          return (
            <form key={m.centerId} action={switchCenter}>
              <input type="hidden" name="centerId" value={m.centerId} />
              <button
                type="submit"
                className="flex min-h-tap w-full items-center justify-between gap-2
                  rounded-lg px-3 py-2 text-left text-sm text-ink
                  hover:bg-surface-alt"
              >
                <span className="truncate font-medium">{m.centerName}</span>
                {here && (
                  <span className="shrink-0 text-xs text-ink-faint">
                    {t.thisCenter}
                  </span>
                )}
              </button>
            </form>
          )
        })}
      </div>
    </details>
  )
}

/**
 * A teacher's bar, plus whatever their owner has granted them.
 *
 * The three permission checks run together rather than in sequence: they share one
 * memoised query behind `myTeacherRows`, so the cost is a single round trip either
 * way, but awaiting them one at a time would make that look like three.
 *
 * Settings appears for either roster permission, because the hub itself now decides
 * which rows to draw — a teacher with only `can_manage_batches` gets the tab and one
 * row behind it, and that is the honest thing to show rather than a tab that leads
 * to a page of things they cannot open.
 */
async function teacherNav(role: MemberRole): Promise<NavItem[]> {
  if (role !== 'teacher') return NAV[role]

  const [fees, students, batches] = await Promise.all([
    canReadFees(),
    canManageStudents(),
    canManageBatches(),
  ])

  return [
    ...NAV.teacher,
    ...(fees ? [FEES_TAB] : []),
    ...(students || batches ? [SETTINGS_TAB] : []),
  ]
}

/**
 * What a centre in read-only sees, on every screen, until the bill is settled.
 *
 * MASTERPLAN.md §4.4 asks for exactly this: writing stops, everything stays readable,
 * "plus a banner that says plainly what happened and how to fix it, with the founder's
 * number on it". Without it the product simply breaks — a teacher's register refuses to
 * save with a one-line form error and no screen anywhere says why.
 *
 * IN THE SHELL RATHER THAN ON THE SCREENS, because there are thirty-odd screens and the
 * ones a suspended centre reaches most are the ones nobody would remember to annotate.
 * The refusal a form prints points back up here, so this is the one place the whole
 * explanation lives.
 *
 * `print:hidden`, like the header and the nav. A receipt is handed across a desk to a
 * parent and a register is filed; neither is a place to tell them the centre owes us
 * money.
 *
 * AMBER, NOT RED. Red is for something that went wrong, and nothing has: the data is
 * intact, the app is working, and a bill is unpaid. Red here would also be permanent —
 * on every screen, all day — which is how people learn to stop reading a colour.
 */
function ReadOnlyBanner({
  status,
  t,
  canSeePlan,
}: {
  status: CenterStatus
  t: Dictionary['readOnly']
  canSeePlan: boolean
}) {
  // Only `cancelled` and `suspended` reach read-only, and a status outside the enum
  // reads as suspended: it is the sentence with a fix in it, and "ring us" is the right
  // answer to a row that has gone wrong as well as to a bill that has lapsed.
  const cancelled = status === 'cancelled'

  // Empty in every deployment until the founder puts their own number in, exactly as
  // on the plan screen — and the banner is not gated on it, for the reason the note
  // there gives. What is gated is the chip: a `tel:` link to nobody is worse than none.
  const salesPhone = normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')

  return (
    <div
      // `status`, not `alert`. This is the state of the screen the reader just opened,
      // not something that happened while they were on it, and `alert` would interrupt
      // a screen reader on every single navigation.
      role="status"
      className="mb-5 rounded-xl border-2 border-late/40 bg-late/5 px-4 py-3 print:hidden"
    >
      <p className="font-semibold text-late">
        {cancelled ? t.cancelledTitle : t.suspendedTitle}
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        {cancelled ? t.cancelledBody : t.suspendedBody}
      </p>

      {(canSeePlan || salesPhone) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Owners and managers only, because /settings/plan is pageRole('manager') —
              offering a teacher a tab that answers with a 403 is worse than offering
              them nothing, and there is nothing for them to do here anyway. */}
          {canSeePlan && (
            <Link
              href="/settings/plan"
              className="inline-flex min-h-tap items-center rounded-xl border-2
                border-brand-500 bg-brand-50 px-4 font-medium text-brand-800"
            >
              {t.seePlan}
            </Link>
          )}
          {salesPhone && (
            <a
              // The digits are printed rather than hidden behind the word, for the
              // reason the plan screen's own call chip gives: `tel:` opens nothing on a
              // laptop, and a number that can be read off the screen and dialled by
              // hand works on anything.
              href={`tel:${salesPhone}`}
              className="inline-flex min-h-tap items-center rounded-xl border-2
                border-line px-4 font-medium text-ink-soft"
            >
              {t.callUs}
              <span className="num ml-1">{formatBdMobile(salesPhone)}</span>
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export async function AppShell({
  session,
  children,
}: {
  session: Session
  children: React.ReactNode
}) {
  const role: MemberRole = session.active?.role ?? 'student'
  const d = dict(session.locale)
  const t = d.shell

  // The two entries the table above cannot decide, because they turn on a
  // permission rather than a role. Asked through the same helpers the screens guard
  // themselves with, so a tab and its screen can never disagree — and each is
  // memoised per request, so the layout and the page it wraps cost one query
  // between them rather than one each.
  //
  // Appended rather than slotted in: the two tabs a teacher already knows keep
  // their positions on the day a permission is granted or taken away, and settings
  // ends up last, where every app on the phone keeps it.
  //
  // Only for `teacher`. The other three roles' bars are complete — a staff-admin
  // has both tabs already, and a student or guardian holds no teacher row for a
  // permission to hang off.
  const items: NavItem[] = await teacherNav(role)

  /*
   * A lapsed or cancelled subscription, which the banner below explains and
   * `requireWritable` is what actually refuses. See MASTERPLAN.md §4.4.
   *
   * `session.active` IS CHECKED FIRST AND IS NOT BELT-AND-BRACES. `access` is
   * `read_only` for a reader with no centre as well, because entitlement has nothing to
   * judge and fails closed — so without this an account midway through onboarding would
   * be told its centre's plan had run out, about a centre it has not made yet. The
   * layout redirects that reader to /onboarding, but Next's own docs are explicit that
   * a layout does not re-run on every navigation, and the shell is not the place to
   * rely on it having.
   */
  const readOnly =
    session.active && session.access === 'read_only' ? session.active.status : null

  return (
    <div className="flex min-h-full flex-col">
      {/* print:hidden on both the header and the nav below. A receipt is handed
          across a desk and a register is filed, and neither wants a logout button
          or four tab icons on it — the sticky header would also reprint at the top
          of every sheet. What the paper needs instead is the centre's name, which
          each of those pages prints for itself as a letterhead. */}
      <header
        className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur
          print:hidden"
      >
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <Logo className="text-base" />
            <CenterName session={session} t={t} />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/*
              One letter in a circle, not a third labelled button. The right-hand
              cluster already holds two words, and a 320px screen has no room for a
              third before the centre's name starts losing characters — so the entry
              point to /account is the smallest control that can still be tapped,
              with its name given to the screen reader instead of to the layout.

              It also answers a question the header never used to: whose account is
              signed in on this shared phone. The letter is the first character of
              the greeting, which is the name if there is one and the number if
              there is not.
            */}
            <Link
              href="/account"
              aria-label={t.account}
              title={t.account}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full
                bg-brand-50 text-sm font-semibold text-brand-700
                hover:bg-brand-100"
            >
              <span aria-hidden>{initialFor(session)}</span>
            </Link>

            <LanguageSwitch locale={session.locale} />

            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft
                  hover:bg-surface-alt hover:text-ink"
              >
                {t.logout}
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* pb-24 clears the fixed bottom bar; without it the last row of any
          list sits permanently under the nav and looks like a rendering bug.
          On paper there is no bar and no phone-width column to centre in, so all
          of it comes off: @page owns the margins, and max-w-3xl left standing
          would waste a third of an A4 sheet the register wants for its columns. */}
      <main
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 pb-24
          print:max-w-none print:px-0 print:py-0 print:pb-0"
      >
        {readOnly && (
          <ReadOnlyBanner
            status={readOnly}
            t={d.readOnly}
            canSeePlan={atLeast(role, 'manager')}
          />
        )}
        {children}
      </main>

      {items.length > 1 && (
        <nav
          aria-label={t.mainMenu}
          className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white
            print:hidden"
        >
          <ul className="mx-auto flex w-full max-w-3xl">
            {items.map((item) => (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className="flex min-h-tap flex-col items-center justify-center
                    gap-0.5 py-2 text-ink-soft hover:text-brand-700"
                >
                  <span aria-hidden className="text-xl leading-none">
                    {item.icon}
                  </span>
                  {/* truncate, not wrap: "Attendance" is ten characters where
                      হাজিরা is six, and a wrapped label makes one tab taller
                      than the other three. */}
                  <span className="w-full truncate px-1 text-center text-xs font-medium">
                    {t.nav[item.label]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}

/** Greets by name, falling back to the number, because one of them always exists. */
export function greetingFor(session: Session): string {
  return (
    session.fullName ||
    formatBdMobile(session.phone) ||
    dict(session.locale).shell.welcome
  )
}

/**
 * The single letter in the header's account link.
 *
 * Taken off the greeting rather than the name alone, so an account with no name on it
 * still gets a letter — the first digit of its number — instead of an empty circle.
 * `Array.from` rather than `[0]`: a Bangla name is inside the BMP and would index
 * fine, but an emoji in a name would come apart into half a surrogate pair, and a
 * broken glyph in the header on every screen is a poor trade for one character.
 */
function initialFor(session: Session): string {
  return Array.from(greetingFor(session))[0] ?? '•'
}
