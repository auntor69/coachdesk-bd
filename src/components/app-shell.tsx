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
import { Logo } from '@/components/ui'
import type { MemberRole } from '@/lib/supabase/types'
import type { Session } from '@/lib/auth/session'
import { canReadFees } from '@/lib/auth/session'
import { formatBdMobile } from '@/lib/bd/phone'
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

/**
 * What each role sees. Icons are text glyphs rather than an icon font or SVG
 * sprite — one less network request on a 3G connection, and they inherit the
 * Bangla font's baseline so nothing sits half a pixel off.
 *
 * Keyed by MemberRole rather than string: adding a role to the enum then breaks
 * here until someone decides what that role's navigation is, instead of
 * silently handing them an empty bar.
 */
const NAV: Record<MemberRole, NavItem[]> = {
  owner: [
    { href: '/dashboard', label: 'home', icon: '⌂' },
    { href: '/teach', label: 'attendance', icon: '✓' },
    FEES_TAB,
    { href: '/settings', label: 'settings', icon: '⚙' },
  ],
  manager: [
    { href: '/dashboard', label: 'home', icon: '⌂' },
    { href: '/teach', label: 'attendance', icon: '✓' },
    FEES_TAB,
    { href: '/settings', label: 'settings', icon: '⚙' },
  ],
  teacher: [
    { href: '/teach', label: 'attendance', icon: '✓' },
    { href: '/exams', label: 'exams', icon: '✎' },
  ],
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

export async function AppShell({
  session,
  children,
}: {
  session: Session
  children: React.ReactNode
}) {
  const role: MemberRole = session.active?.role ?? 'student'
  const t = dict(session.locale).shell

  // The one entry the table above cannot decide, because it turns on a
  // permission rather than a role. Asked through the same `canReadFees` that
  // /fees guards itself with, so the tab and the screen can never disagree —
  // and it is memoised per request, so the layout and the page it wraps cost
  // one query between them.
  //
  // Appended rather than slotted in beside attendance: the two tabs a teacher
  // already knows keep their positions on the day the permission is granted or
  // taken away.
  const items: NavItem[] =
    role === 'teacher' && (await canReadFees())
      ? [...NAV.teacher, FEES_TAB]
      : NAV[role]

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <Logo className="text-base" />
            <CenterName session={session} t={t} />
          </div>

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
      </header>

      {/* pb-24 clears the fixed bottom bar; without it the last row of any
          list sits permanently under the nav and looks like a rendering bug. */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 pb-24">
        {children}
      </main>

      {items.length > 1 && (
        <nav
          aria-label={t.mainMenu}
          className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white"
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
