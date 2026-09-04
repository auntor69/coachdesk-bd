import { PageHeader } from '@/components/page-header'
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
 *
 * TWO COLUMNS FROM `lg`: the list of awards in seven, and beside it the form that names a
 * new one and what the named ones cost this month. The rule and the cost of the same award
 * end up level with each other, which is the pairing the single column made impossible —
 * "sibling, 50% of the fee" was three screens above "sibling, 12 bills, ৳9,000".
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
  const [{ data: awards, error: awardsError }, { data: waived, error: waivedError }] =
    await Promise.all([
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
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/fees', label: t.backLink }}
        subtitle={t.subtitle}
      />

      {/*
       * The `contents` + `order-N` arrangement the rest of §20.8 uses: each block carries the
       * number of the place a phone draws it in, and below `lg` the rail generates no box at
       * all, so its two blocks fall back into the one column around the list.
       *
       * The rail is written FIRST and drawn second. `order` moves nothing for a keyboard or a
       * screen reader, so written last, naming a waiver would be reached only after tabbing
       * through the edit button of every award the centre has ever granted.
       *
       * Nested under the bar rather than holding it as a twelfth-column cell: a sticky box
       * only travels inside its containing block, and a grid cell's block is one grid row.
       */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="contents lg:order-3 lg:col-span-5 lg:flex lg:flex-col lg:gap-5">
          {/* `t.why` lives inside this form now rather than in a card above it — see the
              note there. Not sticky: the form and the month's figures together are taller
              than a laptop screen, and a rail that cannot be scrolled past is worse than
              one that scrolls. */}
          <ScholarshipForm t={t} className="order-2" />

          <div className="order-4 flex flex-col gap-2">
            <h2 className="font-semibold text-ink">
              {t.monthHeading} — {formatMonth(month, locale)}
            </h2>

            {waivedError ? (
              <Card>
                <p className="text-sm text-ink-soft">{t.monthUnreadable}</p>
              </Card>
            ) : lines.length === 0 ? (
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

                <div
                  className="mt-3 flex items-baseline justify-between gap-3 border-t
                    border-line pt-3"
                >
                  <p className="font-semibold text-ink">{t.monthTotal}</p>
                  <p className="num font-semibold text-ink">{formatTaka(total)}</p>
                </div>
              </Card>
            )}
          </div>
        </div>
        {/* Seven columns, because a row opens into a form: a name, a tick and a save
            button. Written after the rail and drawn before it. */}
        <div className="order-3 flex flex-col gap-2 lg:order-2 lg:col-span-7">
          <h2 className="font-semibold text-ink">{t.listHeading}</h2>

          {/* A read that failed is not an empty list, and saying it was invites the one
              mistake this screen cannot absorb: `fee_scholarships_center_name_key` folds
              case, so an owner told "no named waivers yet" who adds hardship again is
              refused by an index rather than by the screen. */}
          {awardsError ? (
            <Card>
              <p className="text-sm text-ink-soft">{t.unreadable}</p>
            </Card>
          ) : (awards ?? []).length === 0 ? (
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
      </div>
    </div>
  )
}
