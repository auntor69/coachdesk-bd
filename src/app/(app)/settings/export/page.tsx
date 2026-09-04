import Link from 'next/link'

import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { pageRole, getSession } from '@/lib/auth/session'
import { has, planName, PLANS } from '@/lib/plans'
import { currentPeriodMonth, addMonths, formatMonth, formatDate, todayInDhaka } from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { REPORT_IDS, NEEDS_MONTH } from '@/lib/export/reports'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.export.title} — CoachDesk` }
}

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/**
 * Where an owner takes their own data out.
 *
 * THIS SCREEN DRAWS NOTHING IT IS ABOUT. It has no preview, no row counts and no
 * table — five descriptions and five links. That is deliberate: every count on it
 * would be a query run to render a number nobody asked for, and a preview of a
 * spreadsheet on a 375px phone is a table nobody can read. The file is the artefact,
 * and the file opens in the app that is good at this.
 *
 * TWO COLUMNS OF CARDS FROM `xl` (§20.8.11), AND THE MONTH IN THE PAGE BAR. Five
 * descriptions down a 1,216px page is a menu that scrolls for no reason, and the control
 * that decides what all five buttons download used to scroll off the top of them. At `xl`
 * the two columns are 472px each and the whole screen is one view; the month now sits in
 * the bar (§20.1), so it is still there at the fifth card. The order is unchanged, so the
 * money sheets still come before the teaching ones on a phone and on a desktop alike.
 *
 * PLAIN `<a>`, NOT `<Link>`. The client router intercepts a `<Link>` and tries to
 * render the destination as a route; there is no route here, there is a response with
 * a Content-Disposition on it. A plain anchor hands the URL to the browser's own
 * download manager, which is also what makes this work with JavaScript off and what
 * makes a failed download retryable by tapping again.
 *
 * THE MONTH IS A GET FORM, for the same reasons as the collection register: the
 * chosen month lands in the URL where it can be bookmarked and shared, and the submit
 * button is not decoration — Android Chrome fires no navigation on a bare `<select>`
 * change, so an onChange handler would need JavaScript to do what a button does for
 * free.
 *
 * STAFF-ADMIN, VIA `pageRole('manager')` rather than a permission. Nothing in this
 * product is scoped down to one teacher's batches on the way out, and a teacher
 * handed `can_manage_students` should not be able to walk out with the centre's
 * whole roster in a file. The route handler checks the same thing again, because a
 * URL is reachable without ever loading this page.
 */
export default async function ExportPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ month?: string }>
}) {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.export

  // Before the month arithmetic and before anything else is drawn. A locked screen
  // does not need a month list, and building one to throw away is work done for a
  // page that cannot use it.
  if (!has(session.plan, 'exportReports')) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t.title} back={{ href: '/settings', label: d.settings.hub.title }} />
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.lockedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(
              planName(session.plan, locale),
              planName(PLANS.teacher_plus, locale),
            )}
          </p>
          <p className="mt-3">
            <Link
              href="/settings/plan"
              className="inline-flex min-h-tap items-center font-medium
                text-brand-700 underline"
            >
              {t.seePlans} →
            </Link>
          </p>
        </Card>
      </div>
    )
  }

  const { month: rawMonth } = await searchParams
  const thisMonth = currentPeriodMonth()
  const month = MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : thisMonth

  // Next month, this one, and the eleven before. Forwards by exactly one because
  // the fee board bills a month ahead — an owner who raised September's invoices in
  // August has a sheet to hand the batch teachers, and a list that stopped at today
  // would tell them it does not exist. No further: there is nothing to export from
  // a month nobody has billed or collected in.
  const months = Array.from({ length: 13 }, (_, i) => {
    const value = addMonths(thisMonth, 1 - i)
    return { value, label: formatMonth(value, locale) }
  })

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/settings', label: d.settings.hub.title }}
        subtitle={t.subtitle}
        /* The month rides in the bar, which is the reason the bar exists on this
           screen: it decides what all five buttons download, and it used to scroll off
           the top of them. Inline and label-less because the bar is one line tall — the
           options read "সেপ্টেম্বর ২০২৬", so the control says what it is, and the
           `aria-label` says it to a screen reader arriving at the select alone. */
        actions={
          <form method="get" className="flex items-center gap-2">
            <select
              name="month"
              aria-label={t.month}
              defaultValue={month}
              className="min-h-tap max-w-44 rounded-xl border-2 border-line bg-white px-3
                font-medium text-ink"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex min-h-tap shrink-0 items-center rounded-xl border-2
                border-brand-500 bg-brand-50 px-4 font-medium text-brand-800"
            >
              {t.show}
            </button>
          </form>
        }
      />

      <ul className="flex flex-col gap-3 xl:grid xl:grid-cols-2 xl:gap-4">
        {REPORT_IDS.map((id) => {
          // The month rides on the link only where the sheet has one. The roster is
          // a snapshot of now — see NEEDS_MONTH — and a `month` on that URL would be
          // a parameter the handler ignores, which is a promise the file then breaks.
          const href = NEEDS_MONTH[id]
            ? `/api/export?kind=${id}&month=${month}`
            : `/api/export?kind=${id}`

          return (
            <li key={id}>
              {/* `h-full` and `mt-auto` are one decision: the five descriptions are
                  two lines long and five, so in a row of two the buttons would sit at
                  two different heights and the shorter card would end in white space.
                  Both are no-ops on a phone, where the card is as tall as it reads. */}
              <Card className="flex h-full flex-col">
                <h2 className="font-semibold text-ink">{t.reports[id].title}</h2>
                <p className="mt-1 text-sm text-ink-soft">{t.reports[id].body}</p>
                {/* Which period the file will actually cover, kept with the button
                    rather than with the description: the month picker is one control
                    above five links, and an owner who scrolled past it needs to read
                    on the thing they are about to tap whether it is August or today. */}
                <div className="mt-auto pt-3">
                  <p className="text-sm font-medium text-ink-faint">
                    {NEEDS_MONTH[id]
                      ? formatMonth(month, locale)
                      : t.asOf(formatDate(todayInDhaka(), locale))}
                  </p>
                  <p className="mt-2">
                    <a
                      href={href}
                      className="inline-flex min-h-tap items-center rounded-xl
                        bg-brand-600 px-5 font-semibold text-white"
                    >
                      {t.download}
                    </a>
                  </p>
                </div>
              </Card>
            </li>
          )
        })}
      </ul>

      <p className="max-w-2xl text-sm text-ink-faint">{t.opensIn}</p>
    </div>
  )
}
