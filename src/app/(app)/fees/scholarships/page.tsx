import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageCapability, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { currentPeriodMonth, formatMonth } from '@/lib/bd/time'
import { formatTaka, sumTaka } from '@/lib/money'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { ScholarshipForm } from './scholarship-form'
import { ScholarshipRow } from './scholarship-row'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const t = dict(session?.locale ?? DEFAULT_LOCALE).scholarships
  return { title: `${t.title} — CoachDesk` }
}

/**
 * The waivers a centre grants by name, and what they cost it this month (§9.3).
 *
 * WHY THIS SCREEN EXISTS RATHER THAN JUST THE BOX ON THE BILL. A waiver typed as a figure
 * with a free-text reason is money the centre cannot account for: eleven spellings of
 * "sibling" total nothing, and "why is our collection rate 82%" has opposite answers
 * depending on whether the missing 18% was given away on purpose or never paid. Naming a
 * waiver once turns it into something `fee_waiver_month` can add up.
 *
 * NOT PAGED, unlike every list on the board it hangs off. A centre names a handful of
 * these — sibling, merit, hardship — and the month's report has one row per name plus one
 * for everything waived by hand. Neither can reach PostgREST's thousand-row ceiling
 * without the centre having invented a thousand awards, which is not a failure this
 * screen should carry code for.
 *
 * STAFF ADMIN AND `fees`, matching the panel it feeds: an award is a standing instruction
 * to reduce what families owe, so a manager narrowed away from money must not be able to
 * write one. The action re-checks, because that is where the security is.
 */
export default async function ScholarshipsPage() {
  const session = await pageCapability('fees')

  const locale = session.locale
  const d = dict(locale)
  const t = d.scholarships

  const supabase = await createClient()

  const month = currentPeriodMonth()

  // Retired awards included, and last: the list is also the record of what the centre
  // has ever granted, and an owner looking for "why is this bill labelled hardship"
  // needs to find hardship even after they stopped offering it. `active desc` puts the
  // ones they can still grant at the top.
  const [{ data: awards }, { data: waived }] = await Promise.all([
    supabase
      .from('fee_scholarships')
      .select('id, name, percent, amount_bdt, active')
      .eq('coaching_center_id', session.active.centerId)
      .order('active', { ascending: false })
      .order('name', { ascending: true }),
    // This month only. A year of history belongs in a report, and the question this
    // screen answers is "what are these costing us", which is a question about now.
    supabase
      .from('fee_waiver_month')
      .select('scholarship_id, scholarship_name, bills, students, waived_bdt')
      .eq('coaching_center_id', session.active.centerId)
      .eq('period_month', month)
      .order('waived_bdt', { ascending: false }),
  ])

  const lines = waived ?? []

  // Added up here because Postgres already did the per-award sums and this is one
  // addition over the rows on the screen — the same allowance the board's outstanding
  // total takes. Through sumTaka, so the figures are added as poisha.
  const total = sumTaka(lines.map((line) => Number(line.waived_bdt ?? 0)))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/fees"
        className="inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        ← {t.backLink}
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.subtitle}</p>
      </div>

      {/* What the screen is for, in one sentence, above the form. An owner who has never
          waived anything by name cannot tell from a list of nothing why they would. */}
      <Card>
        <p className="text-sm text-ink-soft">{t.why}</p>
      </Card>

      <ScholarshipForm t={t} />

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold text-ink">{t.listHeading}</h2>

        {/* Null and empty read the same here on purpose. A failed read leaves the form
            above working and the month's totals below untouched, and "no named waivers
            yet" is the honest state of the centre this screen is written for. */}
        {(awards ?? []).length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">{t.empty}</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {(awards ?? []).map((award) => (
              <ScholarshipRow
                key={award.id}
                id={award.id}
                name={award.name}
                // Both figures through Number(): PostgREST hands numerics over as
                // strings, and "50" would print as a share of fifty taka.
                percent={award.percent === null ? null : Number(award.percent)}
                amountBdt={award.amount_bdt === null ? null : Number(award.amount_bdt)}
                active={award.active}
                t={t}
                common={d.common}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold text-ink">
          {t.monthHeading} — {formatMonth(month, locale)}
        </h2>

        {lines.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">{t.monthEmpty}</p>
          </Card>
        ) : (
          <Card>
            <ul className="flex flex-col divide-y divide-line">
              {lines.map((line) => (
                <li
                  key={line.scholarship_id ?? 'unnamed'}
                  className="flex items-baseline justify-between gap-3 py-2 first:pt-0
                    last:pb-0"
                >
                  <div className="min-w-0">
                    {/* A waiver with no award behind it is a figure somebody typed, and
                        it is on this report rather than left off it: the owner needs to
                        see how much of the month's giving away was unaccounted for. */}
                    <p className="truncate font-medium text-ink">
                      {line.scholarship_name ?? t.unnamed}
                    </p>
                    <p className="num text-sm text-ink-faint">
                      {fill(t.countNote, {
                        bills: Number(line.bills ?? 0),
                        students: Number(line.students ?? 0),
                      })}
                    </p>
                  </div>
                  <p className="num shrink-0 font-medium text-ink">
                    {formatTaka(Number(line.waived_bdt ?? 0))}
                  </p>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-baseline justify-between gap-3 border-t
              border-line pt-3">
              <p className="font-semibold text-ink">{t.monthTotal}</p>
              <p className="num font-semibold text-ink">{formatTaka(total)}</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
