import Link from 'next/link'
import type { Route } from 'next'

import { Card } from '@/components/ui'
import { pagePlatformAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dhakaMoment, digits, formatDate } from '@/lib/bd/time'
import { formatBdMobile } from '@/lib/bd/phone'
import { dict, type Dictionary, type Locale } from '@/lib/i18n'
import type { MemberRole } from '@/lib/supabase/types'
import { FounderNav } from '../nav'

/*
 * NO generateMetadata, like the rest of the panel — see the note at the top of ../page.tsx.
 */

/** The roles `center_members` can hold, in the order the filter offers them. */
const ROLES = ['owner', 'manager', 'teacher'] as const

/**
 * How many logins are read.
 *
 * Every staff account on every centre, in one page: twenty centres of ten staff is two hundred
 * rows, which is a list somebody scrolls. The cap exists so the first customer with forty
 * branches cannot make this screen a table scan, and it is high enough that no customer we
 * have comes near it.
 */
const LIMIT = 500

/**
 * Accounts and staff — §16.1's fifth question, and the one the panel could only answer one
 * customer at a time.
 *
 * WHY IT IS A SCREEN. Every lockout call ends in the same two questions: does this person
 * actually have a login, and are they on the centre I think they are. The list answers both
 * for one customer, one card at a time — which is useless when the founder has a number and no
 * name, or a name and no idea which of the eleven centres it belongs to. This page is the same
 * rows, flat, searchable, with the role and the customer beside every one.
 *
 * THE OTHER HALF IS OURS. `profiles.is_platform_admin` is the most powerful column in the
 * schema — it is the whole of the panel's door — and until this screen existed the only way to
 * see who holds it was a SQL console. It is a short list by design and it is drawn first, with
 * the count, because the answer to "how many people can read every customer's record" should
 * be one line on a page rather than a query somebody remembers to run.
 *
 * IT WILL NOT RESET A PASSWORD FROM HERE, and that is the deliberate omission. The reset form
 * needs the centre the founder is looking at — it checks that the number typed belongs to that
 * centre's staff before it touches anything (lib/auth/founder-reset.ts) — and a page of two
 * hundred rows with two hundred password boxes is a page where the wrong one gets filled in.
 * Every row links to its customer's record, where the form is beside the other things that
 * customer's call is about and the check is a check.
 *
 * NOTHING HERE NAMES A STUDENT. A guardian does not have a login, a student's account is a
 * row in a table this screen does not read, and the fence in lib/platform/audit.ts is the same
 * one: the panel's subject is a customer, never a family.
 */
export default async function FounderAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await pagePlatformAdmin()
  const locale = session.locale
  const d = dict(locale)
  const t = d.founder

  const params = await searchParams
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? ''

  const query = one(params.q).trim().slice(0, 60).toLowerCase()
  const askedCenter = one(params.center)
  const askedRole = one(params.role)
  const role = (ROLES as readonly string[]).includes(askedRole)
    ? (askedRole as (typeof ROLES)[number])
    : null

  const supabase = await createClient()

  const [members, centers, people] = await Promise.all([
    // Every centre's logins at once, which is the point of this screen.
    // scoped-by: every centre is the point — `members_read` answers app.is_platform_admin()
    // in 20260811000002_rls_policies.sql, and the centre filter below is the query plan rather
    // than the guarantee.
    supabase
      .from('center_members')
      .select('id, coaching_center_id, user_id, role, active, created_at')
      .order('created_at')
      .limit(LIMIT),
    // The customer names, for the filter and for every row.
    // scoped-by: every centre is the point of this panel; centers_member_read in
    // 20260811000002_rls_policies.sql is what authorises it.
    supabase.from('coaching_centers').select('id, name').order('name'),
    // The people behind the logins, and the platform admins with them: `profiles_self_read`
    // answers a platform admin for every row, so this one read names every actor on the page
    // and finds our own team in the same pass.
    supabase
      .from('profiles')
      .select('id, full_name, phone, username, is_platform_admin')
      .order('full_name'),
  ])

  const centerNames = new Map((centers.data ?? []).map((row) => [row.id, row.name]))
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]))

  const admins = (people.data ?? []).filter((p) => p.is_platform_admin)

  // The centre filter is applied here rather than in the query, because the same read serves
  // the name map: a `.eq` on a query that has already been built would need a second read of
  // `coaching_centers` for the `<select>`.
  const centerId = centerNames.has(askedCenter) ? askedCenter : null

  const matched = (members.data ?? []).filter((member) => {
    if (centerId !== null && member.coaching_center_id !== centerId) return false
    if (role !== null && member.role !== role) return false
    if (!query) return true
    const person = byId.get(member.user_id)
    // What the founder has in front of them: a name, a number, or the handle somebody typed at
    // a login screen. A member with no profile row matches nothing and stays visible.
    const haystack = [
      person?.full_name ?? '',
      person?.phone ?? '',
      person?.username ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })

  const filtered = query !== '' || centerId !== null || role !== null
  const unreadable = members.error || centers.error || people.error

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
      <div>
        <Link
          href="/founder"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.accounts.title}</h1>
        <p className="mt-1 text-ink-soft">{t.accounts.lead}</p>
      </div>

      <FounderNav here="accounts" words={t.nav} />

      {/* Ours, first and short. The count is the figure that matters: it is how many people can
          read every customer's record. */}
      <Card>
        <h2 className="font-semibold text-ink">
          {t.accounts.adminsTitle} · {digits(admins.length, locale)}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">{t.accounts.adminsHint}</p>
        {admins.length === 0 ? (
          // Impossible while somebody is reading the page — they are a platform admin — and
          // said rather than left blank, because a screen that cannot be empty and is, is a
          // read that did not answer.
          <p className="mt-2 text-sm text-ink-soft">{t.accounts.adminsEmpty}</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {admins.map((admin) => (
              <li key={admin.id} className="text-ink">
                <span className="font-medium">{admin.full_name ?? t.accounts.noName}</span>
                {admin.phone && (
                  <>
                    {' · '}
                    <span className="num text-ink-soft">{formatBdMobile(admin.phone)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form
        method="get"
        className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-xs text-ink-soft">{t.accounts.search}</span>
            <input
              type="search"
              name="q"
              defaultValue={one(params.q)}
              placeholder={t.accounts.searchHint}
              maxLength={60}
              className="min-h-tap rounded-xl border border-line px-3 text-ink"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">{t.accounts.customer}</span>
            <select
              name="center"
              defaultValue={centerId ?? ''}
              className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
            >
              <option value="">{t.accounts.allCustomers}</option>
              {(centers.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">{t.accounts.role}</span>
            <select
              name="role"
              defaultValue={role ?? ''}
              className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
            >
              <option value="">{t.accounts.allRoles}</option>
              {ROLES.map((key) => (
                <option key={key} value={key}>
                  {d.audit.roles[key]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="min-h-tap rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.accounts.apply}
          </button>

          {filtered && (
            <Link
              href={'/founder/accounts' as Route}
              className="inline-flex min-h-tap items-center px-3 text-sm font-medium text-ink-soft hover:text-ink"
            >
              {t.accounts.clear}
            </Link>
          )}
        </div>

        {/* Same rule as the customer list: a filtered list says how much of the book it is
            showing, because four rows out of two hundred reads as "that is everybody". */}
        <p className="text-xs text-ink-faint">
          {t.accounts.showing(
            digits(matched.length, locale),
            digits((members.data ?? []).length, locale),
          )}
        </p>
      </form>

      {unreadable ? (
        <Card>
          <p className="font-medium text-ink">{t.accounts.unreadable}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.accounts.unreadableHint}</p>
        </Card>
      ) : matched.length === 0 ? (
        <Card>
          <p className="font-medium text-ink">{t.accounts.none}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.accounts.noneHint}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {matched.map((member) => (
            <Member
              key={member.id}
              member={member}
              person={byId.get(member.user_id) ?? null}
              center={centerNames.get(member.coaching_center_id) ?? null}
              locale={locale}
              d={d}
            />
          ))}
        </ul>
      )}
    </main>
  )
}

/**
 * One login: who, what they may do, on which customer, and since when.
 *
 * THE CUSTOMER'S NAME IS A LINK and it is the only action on the row. Every call about a
 * login ends with the founder needing to do something to that customer's account — reset a
 * password, move the line, check what they paid — and all of it lives on their record. A
 * button here that did any of it would be a second implementation of a form that already
 * exists, with the centre check that makes it safe left behind.
 */
function Member({
  member,
  person,
  center,
  locale,
  d,
}: {
  member: {
    id: string
    coaching_center_id: string
    /** `MemberRole`, and not the three the filter offers: a login filed as a student is a row
     * this list must still draw rather than one it may assume away. */
    role: MemberRole
    active: boolean
    created_at: string
  }
  person: { full_name: string | null; phone: string | null; username: string | null } | null
  center: string | null
  locale: Locale
  d: Dictionary
}) {
  const t = d.founder.accounts

  return (
    <li className="flex flex-col gap-1 rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold text-ink">{person?.full_name ?? t.noName}</span>
        <span className="text-sm text-ink-soft">{d.audit.roles[member.role]}</span>
        {!member.active && (
          <span className="rounded-lg border border-line bg-surface-alt px-2 py-0.5 text-xs text-ink-soft">
            {t.stopped}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-soft">
        {center !== null ? (
          <Link
            href={`/founder/${member.coaching_center_id}` as Route}
            className="font-medium text-brand-700"
          >
            {center}
          </Link>
        ) : (
          <span>{t.unknownCustomer}</span>
        )}
        {person?.phone && (
          <span className="num">· {formatBdMobile(person.phone)}</span>
        )}
        {person?.username && <span>· {person.username}</span>}
        <span className="num">
          · {t.since(formatDate(dhakaMoment(member.created_at).date, locale))}
        </span>
      </div>
    </li>
  )
}
