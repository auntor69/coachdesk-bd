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
import { Logo } from '@/components/ui'
import type { MemberRole } from '@/lib/supabase/types'
import type { Session } from '@/lib/auth/session'
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
    { href: '/fees', label: 'fees', icon: '৳' },
    { href: '/settings', label: 'settings', icon: '⚙' },
  ],
  manager: [
    { href: '/dashboard', label: 'home', icon: '⌂' },
    { href: '/teach', label: 'attendance', icon: '✓' },
    { href: '/fees', label: 'fees', icon: '৳' },
    { href: '/settings', label: 'settings', icon: '⚙' },
  ],
  teacher: [
    { href: '/teach', label: 'attendance', icon: '✓' },
    { href: '/exams', label: 'exams', icon: '✎' },
  ],
  student: [{ href: '/me', label: 'mine', icon: '⌂' }],
  guardian: [{ href: '/me', label: 'myChild', icon: '⌂' }],
}

export function AppShell({
  session,
  children,
}: {
  session: Session
  children: React.ReactNode
}) {
  const role: MemberRole = session.active?.role ?? 'student'
  const items = NAV[role]
  const t = dict(session.locale).shell

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <Logo className="text-base" />
            {session.active && (
              <p className="mt-0.5 truncate text-sm text-ink-soft">
                {session.active.centerName}
              </p>
            )}
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
