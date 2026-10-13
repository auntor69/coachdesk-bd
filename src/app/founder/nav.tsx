import Link from 'next/link'
import type { Route } from 'next'

import type { Dictionary } from '@/lib/i18n'

/**
 * The panel's five sections, and the way between them.
 *
 * WHY THIS EXISTS NOW. The panel began as one page: a list of customers and the money on it,
 * and a founder who came to answer one question read one screen. Three of the four sections
 * below are *other* questions — what the business is doing over time, what is quietly broken,
 * which logins exist, what we have done — and without a nav each one is a URL somebody has to
 * be told about, which is the state a panel reaches before nobody uses half of it.
 *
 * IT IS A ROW OF LINKS AND NOT TABS. Tabs are a client-side concept and this panel has no
 * client state at all: every screen is a Server Component reading the database, `here` is a
 * prop the page passes, and the current section is marked by `aria-current` and a border
 * rather than by an index held in memory. A founder can open two of them in two tabs and both
 * work, which is exactly the behaviour somebody checking a payment against a log wants.
 *
 * THE LIST IS FIRST AND UNCHANGED, because it is still what the panel is for.
 */
export type FounderSection = 'customers' | 'money' | 'health' | 'accounts' | 'audit'

/** The hrefs, in reading order — one table, so the nav and the pages cannot disagree. */
const SECTIONS: readonly { key: FounderSection; href: Route }[] = [
  { key: 'customers', href: '/founder' },
  { key: 'money', href: '/founder/money' },
  { key: 'health', href: '/founder/health' },
  { key: 'accounts', href: '/founder/accounts' },
  { key: 'audit', href: '/founder/audit' },
]

export function FounderNav({
  here,
  words,
}: {
  /** Which screen is being drawn. Passed rather than derived from the path. */
  here: FounderSection
  /** `d.founder.nav` — five string leaves, so nothing here needs a locale. */
  words: Dictionary['founder']['nav']
}) {
  return (
    <nav
      aria-label={words.label}
      className="flex flex-wrap items-center gap-1 border-b border-line pb-2"
    >
      {SECTIONS.map(({ key, href }) => {
        const current = key === here
        return (
          <Link
            key={key}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={`inline-flex min-h-tap items-center rounded-xl px-3 text-sm font-medium
              ${
                current
                  ? 'bg-brand-50 text-brand-800'
                  : 'text-ink-soft hover:bg-surface-alt hover:text-ink'
              }`}
          >
            {words[key]}
          </Link>
        )
      })}
    </nav>
  )
}
