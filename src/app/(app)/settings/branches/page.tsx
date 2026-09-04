import Link from 'next/link'

import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { pageRole, getSession } from '@/lib/auth/session'
import { isHqMember } from '@/lib/branches'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import {
  has,
  planName,
  nextBranchCostBdt,
  INSTITUTION_INCLUDED_BRANCHES,
  PLANS,
} from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import { AddBranch } from './add-branch'
import { BranchRow, type BranchListItem } from './branch-row'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.branches.title} — CoachDesk` }
}

/**
 * The buildings an organisation runs.
 *
 * THE FIRST SCREEN THAT READS `branches`, and the table has existed since
 * 20260811000001. Everything up to here filed rows against a null branch, which was the
 * honest thing to do while nothing could name one: §8.2 wanted the column from birth so
 * an organisation that grows into buildings does not have to guess its own history.
 * 20260811000053 then gave the null its meaning — `app.branch_ok` reads it as the whole
 * organisation — and this screen is what finally lets somebody type a building's name.
 *
 * ADDRESSED TO THE HEAD OFFICE. A branch is a line on the monthly bill, so opening,
 * renaming and closing one belong to whoever pays it (§3.7). A manager pinned to Mirpur
 * gets the same list — one row, because `branches_branch_scope` hands them exactly their
 * own — with no forms on it and a card saying whose decision this is. That is a choice
 * about which controls to draw and not a boundary: the boundary is the policy, and
 * ./actions.ts asks the question again because a Server Action is a public endpoint.
 *
 * NO CAP AND NO PLAN COUNTER, unlike subjects. A fourth branch is not refused, it is
 * ৳750 a month, so the add form carries the price instead of a quota line. See
 * `nextBranchCostBdt` for why the figure is a difference rather than the constant.
 *
 * THE SAME COUNT REACHES THE FOUNDER, since 20260811000066: `platform_centers` returns
 * active branch rows aggregated, so the panel's bill and this screen's price come from
 * one number. They disagreed for six migrations, and the one that under-charged was ours.
 *
 * A LIST AND A RAIL FROM `xl` (§20.8.8). Before this the screen was one column at every
 * width: a row 1,216px wide carrying a building's name and a head count, with the form for
 * the next building below all six of them. The form is now the rail — 384px of it, which
 * is what two fields and a price want — and the width the list keeps goes inside a row, on
 * a panel that pairs the name and the address instead of stacking them.
 *
 * `xl` and not `lg`, from the same arithmetic as everywhere else: five columns of twelve at
 * `lg` is 279px, and a form in it would be narrower than the same form on a phone.
 *
 * THE PINNED MANAGER'S CARD TAKES THE RAIL'S PLACE rather than sitting above their one
 * row, so the reader who has no controls is not reading a page of white space either. It
 * stays first in source order — on a phone, whose decision this is comes before the row.
 */
export default async function BranchesPage() {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.branches

  /*
   * Reachable and refused, in the staff screen's style and for its reasons: a plan can
   * change under a bookmark, and a dead end teaches an owner the app is broken rather
   * than that the tier is bought. Before the query, so nothing on a plan without
   * branches costs a read of a table it may not use.
   */
  if (!has(session.plan, 'multipleBranches')) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t.title} back={{ href: '/settings', label: d.settings.hub.title }} />
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.lockedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(
              planName(session.plan, locale),
              planName(PLANS.institution, locale),
            )}
          </p>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()

  const { data: branches } = await supabase
    .from('branches')
    .select('id, name, address, active')
    .eq('coaching_center_id', session.active.centerId)
    // Closed buildings sink to the bottom, like the staff who have left: an
    // organisation that has shut two of eight should not have them mixed in by name
    // among the six that are open this morning.
    .order('active', { ascending: false })
    .order('name', { ascending: true })

  /*
   * FAILING CLOSED, and the add form is why. A dropped read hands back `null`, and `null`
   * drawn as a list is "No branches written down yet" on the screen of an organisation
   * with six of them — over a form, so the owner's next move is to type in a building
   * that is already there. The second one cannot be deleted afterwards, and every row
   * filed under it would be filed under a duplicate.
   */
  if (branches === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t.title} back={{ href: '/settings', label: d.settings.hub.title }} />
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{d.settings.listUnreadable}</p>
        </Card>
      </div>
    )
  }

  /*
   * How big each building is, counted one head query per branch in a single round.
   *
   * NOT A BOUNDARY, which is worth saying because §8.2 forbids exactly this filter as
   * one: "a branch-scoped `.eq('branch_id', …)` in application code is one forgotten
   * call site away from a cross-branch leak". Nothing here is being kept from anybody —
   * the reader has already been handed the branch rows by the policies, and the policies
   * decide which students they can count. This is a group-by for somebody who may read
   * all of it, and the figure it produces goes next to a close button so the decision is
   * made with the number in view.
   *
   * Bounded by the number of buildings rather than the number of students, which is the
   * other way round from the obvious alternative — reading every active student's
   * `branch_id` and counting in JS — and the reason to prefer it. Six queries returning
   * six integers beats one returning nine hundred rows.
   */
  const counts = await Promise.all(
    branches.map(async (branch) => {
      const { count } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('branch_id', branch.id)
        .eq('status', 'active')
      return count
    }),
  )

  const rows: BranchListItem[] = branches.map((branch, index) => ({
    id: branch.id,
    name: branch.name,
    address: branch.address,
    active: branch.active,
    // As it came, `null` and all: a head count answers `null` when the query failed and
    // not when it found nobody, and BranchRow reads null as "draw no figure".
    studentCount: counts[index] ?? null,
  }))

  const isHq = isHqMember(session.active)
  const activeCount = rows.filter((row) => row.active).length

  /*
   * What the next building adds to the monthly bill, in a whole sentence, and only for
   * the reader who can add one. A pinned manager's list is their own branch alone, so a
   * figure worked out from `activeCount` here would be the price of the organisation's
   * second building on the screen of its fifth.
   */
  const nextCost = isHq ? nextBranchCostBdt(session.plan, activeCount) : 0
  const costLine = !isHq
    ? null
    : nextCost === 0
      ? t.addFree(INSTITUTION_INCLUDED_BRANCHES)
      : t.addCost(formatTaka(nextCost))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/settings', label: d.settings.hub.title }}
        subtitle={rows.length === 0 ? t.subtitle : t.count(activeCount)}
        /* §8.3's comparison, in the bar rather than under the last row — it used to be
           below every building, on the screen where an owner has just finished naming
           them. Only the head office, and only once there is something to compare: the
           table itself refuses a pinned manager, and a door into a refusal is worse than
           no door. A plain underlined word, because the primary action on this screen is
           the form in the rail. */
        actions={
          rows.length > 0 &&
          isHq && (
            <Link
              href="/hq"
              className="inline-flex min-h-tap items-center font-medium text-brand-800
                underline underline-offset-4 hover:text-brand-900 lg:min-h-0"
            >
              {d.hq.title} →
            </Link>
          )
        }
      />

      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">
        {/* Whose decision this is, said before the row rather than after a refused tap.
            The policies would refuse the write anyway; a manager who read "could not
            save" would go looking for a bug instead of for the head office.

            In the rail's place from `xl` and first on a phone: this reader has no form to
            be shown, and the sentence explaining that is what the width beside their one
            row is for. */}
        {!isHq && (
          <Card className="xl:order-2 xl:col-span-5">
            <h2 className="font-semibold text-ink">{t.mineTitle}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t.mineBody}</p>
          </Card>
        )}

        {/* The list column. `contents` below `xl`, so the stack on a phone is one column
            with one gap and not a box inside a box. */}
        <div className="contents xl:order-1 xl:col-span-7 xl:flex xl:flex-col xl:gap-4">
          {rows.length === 0 && isHq && (
            <Card>
              <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
              <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
            </Card>
          )}

          {rows.length > 0 && (
            <ul className="flex flex-col gap-2">
              {rows.map((row) =>
                isHq ? (
                  <BranchRow
                    key={row.id}
                    branch={row}
                    countNoun={t.students(row.studentCount ?? 0)}
                    t={d.branchForm}
                    common={d.common}
                  />
                ) : (
                  /* The same row without the way in. Not `BranchRow` with a flag: the
                     whole of that component below the header is forms, and a version of
                     it that hides them would be two components sharing a file. */
                  <li
                    key={row.id}
                    id={`branch-${row.id}`}
                    className="flex scroll-mt-20 items-center justify-between gap-3
                      rounded-xl border border-line bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-ink">
                        <span className="truncate">{row.name}</span>
                        {!row.active && (
                          <span
                            className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5
                              text-xs font-semibold text-ink-faint"
                          >
                            {d.branchForm.off}
                          </span>
                        )}
                      </p>
                      {row.address && (
                        <p className="truncate text-sm text-ink-soft">{row.address}</p>
                      )}
                    </div>
                    {row.studentCount !== null && (
                      <span className="shrink-0 text-sm text-ink-soft">
                        <span className="num">{row.studentCount}</span>{' '}
                        {t.students(row.studentCount)}
                      </span>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>

        {/* The rail, and it does not scroll away from a list of eleven buildings: the
            question "what does the next one cost" is asked at the bottom of the list as
            often as at the top. Last on a phone, where a form above six rows would put
            the building being typed in over the six already there. `top-16` is the sticky
            page bar plus 8px — see components/page-header.tsx. */}
        {isHq && costLine && (
          <div className="xl:sticky xl:top-16 xl:order-3 xl:col-span-5">
            <AddBranch
              title={t.addTitle}
              costLine={costLine}
              t={d.branchForm}
              common={d.common}
            />
          </div>
        )}
      </div>
    </div>
  )
}
