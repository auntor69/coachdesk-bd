import Link from 'next/link'
import { forbidden } from 'next/navigation'

import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { PlacesWarning } from '@/components/places-warning'
import { Th, Td } from '@/components/table'
import { pageRole, getSession } from '@/lib/auth/session'
import { openAsks } from '@/lib/billing/asks'
import { growingBranches, recentIntake } from '@/lib/billing/growth'
import { isHqMember } from '@/lib/branches'
import {
  currentPeriodMonth,
  addMonths,
  formatMonth,
  formatDate,
  todayInDhaka,
} from '@/lib/bd/time'
import {
  branchMoneyRows,
  payrollGap,
  tallyBranchMoney,
} from '@/lib/finance/branch-money'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { has, planName, capacityPressure, PLANS } from '@/lib/plans'
import { canReadMoney } from '@/lib/staff/capabilities'
import { createClient } from '@/lib/supabase/server'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).hq.title} — CoachDesk` }
}

/** One line each — see the fee board's COLUMNS for what splitting them does to inference. */
const PROFIT_COLUMNS = 'branch_id, collected_bdt, expenses_bdt, payroll_bdt, profit_bdt'
const CHARGES_COLUMNS = 'branch_id, charged_bdt, paid_bdt, outstanding_bdt'

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/**
 * §8.3: the branches as rows, so the head office can see which one is carrying the others.
 *
 * IN THE SIDEBAR NOW, under Organisation, and this paragraph used to say the opposite.
 * `NAV` in app-shell.tsx stopped being a ceiling and became a gate: the row carries
 * `when: isHqMember && canReadMoney` alongside `needs: 'multipleBranches'`, so a pinned or
 * a narrowed reader is never offered it, and a centre on a smaller tier is offered it
 * locked — the plan's own asymmetry (§20.3), where a capability hides a row and a plan
 * sells one. Two of the three refusals below therefore answer a bookmark; the locked card
 * is what the padlocked row opens on purpose.
 *
 * A NEW ROUTE AND NOT ANOTHER DASHBOARD CARD, because the dashboard already carries
 * at-risk students, attendance rates, the profit line, the setup card, the weekly note and
 * progress entry — and because this screen has a month picker, which a card cannot have
 * without putting the whole dashboard on a query string.
 *
 * THE TABLE IS THE SCREEN AND THE WIDTH IS ITS OWN (§20.8.8). Nine columns want 52rem,
 * which is more than the 704px a laptop gives the workspace, so there is no rail to be had
 * beside it: a four-column one would leave the table narrower here than it is on a phone.
 * What was being stretched is everything *under* it — five blocks of two sentences each,
 * one below the other across 1,216px. They are two subjects and are now two columns: the
 * footnotes that belong to the table on the left, and what §3.7 asks of a head office on
 * the right, where the pool, the places running out and the branches asking for more read
 * as one argument instead of three separate notes.
 *
 * THE LEVEL IS NAMED (§20.6). "Same figures at two levels is how somebody reports a
 * branch's profit as the organisation's", so the letterhead says whole organisation and
 * then the organisation's name. Cheap insurance: this is the one screen in the product
 * where every figure is an aggregate of buildings, and the sidebar's centre name looks
 * identical on the branch-level screens beside it.
 *
 * THE TABLE MUST TOTAL TO THE DASHBOARD'S PROFIT CARD. 20260811000055 made that true in
 * SQL by redefining `center_profit_month` to sum `branch_profit_month`, and the only way
 * this screen can give it away is by dropping a row — a branch whose money is here and
 * whose name is not. So `branchMoneyRows` builds its spine from the union of the branch
 * list, the money rows and the charge rows, and names an unlisted one rather than
 * skipping it. The arithmetic is in lib/finance/branch-money.ts, where it is tested
 * against fixtures; this file draws it.
 *
 * WHO SEES HOW MANY ROWS IS NOT DECIDED HERE. Both views are `security_invoker` and
 * 20260811000053's restrictive policies do the work, so a pinned manager reading the same
 * query gets exactly their own branch. The guard below is not that boundary: it is a
 * choice not to show one building a comparison of one building.
 */
export default async function HqPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ month?: string }>
}) {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.hq

  /*
   * Reachable and refused, like the branches screen's own: a plan can change under a
   * bookmark. Before the query, so a centre on a tier without branches never pays for a
   * read of views it has nothing to compare in.
   */
  if (!has(session.plan, 'multipleBranches')) {
    return (
      <Shell refusal={{ home: d.shell.nav.home, title: t.title }}>
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.lockedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(
              planName(session.plan, locale),
              planName(PLANS.institution, locale),
            )}
          </p>
        </Card>
      </Shell>
    )
  }

  /*
   * A pinned manager, and no query at all — the departure from the branches screen, which
   * does draw them their own row. There it is a list and one row is a true list; here it
   * is a comparison, and a comparison of one building tells somebody who manages one of
   * five that the organisation has one. Their own figures are on their dashboard, which
   * is what the card says.
   */
  if (!isHqMember(session.active)) {
    return (
      <Shell refusal={{ home: d.shell.nav.home, title: t.title }}>
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.pinnedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.pinnedBody}</p>
        </Card>
      </Shell>
    )
  }

  /*
   * And a narrowed manager (§6.2), which is the dashboard's profit card again with four
   * columns instead of one. Both views here are `security_invoker`, so a reader without one
   * of the three money words does not get an error — they get every branch collecting ৳0, or
   * spending ৳0, and a profit column that is wrong in the same direction for all five
   * buildings at once. A comparison built out of a missing term ranks the branches, and an
   * owner acts on the ranking.
   *
   * A 403 rather than a table with a column withheld: the whole screen is that arithmetic,
   * and the row totals have to add up to the dashboard's profit card — which this reader is
   * not being shown either.
   */
  if (!canReadMoney(session.active.capabilities)) forbidden()

  const { month: rawMonth } = await searchParams
  // An unparseable month is this month rather than an error, per the expenses screen: the
  // parameter arrives from a URL somebody may have edited.
  const month = MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : currentPeriodMonth()

  const supabase = await createClient()

  const [money, bills, branchList, centerHeads, centerTeachers, asks] = await Promise.all([
    supabase
      .from('branch_profit_month')
      .select(PROFIT_COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
      .eq('period_month', month),
    supabase
      .from('branch_charges_month')
      .select(CHARGES_COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
      .eq('period_month', month),
    supabase
      .from('branches')
      .select('id, name, active')
      .eq('coaching_center_id', session.active.centerId),
    // The pool, and it is one number for the organisation — §17 forbids per-branch
    // quotas, so this count is deliberately not filtered by branch and the per-branch
    // counts below are deliberately not added up into it. A student filed at head office
    // is in this figure and in no branch's.
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
    // The staff, for the foot of the teachers column. Not a pool and not priced per
    // branch either: seats are counted for the organisation (§5), which is why this is
    // the same unfiltered shape as the line above it.
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    // §3.7 names this screen for the asks as well as for the warning: "It appears on the
    // HQ dashboard and in the founder panel." Read for a manager too, who cannot answer
    // one — a head office reading that Mirpur has been waiting a fortnight is how the
    // person who can pay hears about it at all.
    openAsks(supabase, session.active.centerId),
  ])

  /*
   * The profit side or nothing. Every column in the table is either from this read or
   * beside something that is, and a table of noughts under a month name is a sentence
   * about five buildings that we did not read. The charges side is allowed to fail on its
   * own, because two dashed columns are a smaller lie than none of the screen.
   *
   * The branch list is in the same sentence as the money: without it every row would be
   * named "another branch", and a comparison whose rows have no names is not one.
   */
  const profitRows = money.error ? null : (money.data ?? null)
  const branches = branchList.error ? null : (branchList.data ?? null)
  const chargeRows = bills.error ? null : (bills.data ?? [])

  // This month and the eleven before it, like the spending screen. Backwards only: a
  // month that has not happened has no branch to compare.
  const months = Array.from({ length: 12 }, (_, i) => {
    const value = addMonths(currentPeriodMonth(), -i)
    return { value, label: formatMonth(value, locale) }
  })

  /*
   * The letterhead is the page bar (§20.1), sticky from `lg`. This screen earns that more
   * than most: nine columns overflow 704px, so an owner reading the last building's profit
   * has scrolled both ways, and the month picker is the one control they came back for.
   *
   * THE LEVEL GOES UNDER THE BAR, NOT IN THE TITLE. The bar is one line and its heading
   * truncates, so a level appended to the title is the half that gets cut — which is
   * precisely the doubt §20.6 asks this line to remove. Below the bar it is a whole
   * sentence at every width, and it leads the subtitle in ink rather than trailing it.
   *
   * The picker stays a plain GET form so the month lands in a bookmarkable URL, and the
   * button is not decoration: Android Chrome fires no navigation on a bare <select>
   * change. Label-less in the bar, where the table's own caption names the month again.
   */
  const header = (
    <PageHeader
      title={t.title}
      back={{ href: '/dashboard', label: d.shell.nav.home }}
      subtitle={
        <>
          <span className="font-medium text-ink">
            {t.level(session.active.centerName)}
          </span>{' '}
          — {t.subtitle}
        </>
      }
      actions={
        <form method="get" className="flex items-center gap-2">
          <select
            name="month"
            aria-label={t.monthLabel}
            defaultValue={month}
            className="min-h-tap max-w-44 rounded-xl border-2 border-line bg-white px-3
              font-medium text-ink sm:max-w-56"
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
  )

  if (profitRows === null || branches === null) {
    return (
      <Shell>
        {header}
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </Shell>
    )
  }

  if (branches.length === 0) {
    return (
      <Shell>
        {header}
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
          <Link
            href="/settings/branches"
            className="mt-3 inline-flex min-h-tap items-center font-medium text-brand-700"
          >
            {t.branchesLink} →
          </Link>
        </Card>
      </Shell>
    )
  }

  /*
   * How big each building is, one head query per branch in a single round — the branches
   * screen's pattern, and its note applies word for word: NOT A BOUNDARY. §8.2 forbids a
   * branch filter as a boundary in application code, and this is not one. The reader has
   * been handed every branch by the policies and the policies decide which students they
   * can count; this is a group-by for somebody who may read all of it.
   *
   * Head office is in the list, with `.is('branch_id', null)`, because it is a row on
   * this table and not a wildcard. Bounded by buildings rather than students: seven
   * queries returning seven integers beat one returning nine hundred rows.
   *
   * Two counts per building now — §20.6 asks for teachers beside students, and an owner
   * comparing two branches on profit alone cannot see that one of them earns it with half
   * the staff. Both rounds are in the one `Promise.all`.
   */
  const keys: (string | null)[] = [...branches.map((branch) => branch.id), null]
  const heads = await Promise.all(
    keys.map(async (branchId) => {
      const studentQuery = supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('status', 'active')
      // Standing staff, like the teachers screen counts them. A teacher who has left is
      // not in this building's Teachers cell, and their salary is still in its payroll.
      const teacherQuery = supabase
        .from('teachers')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true)
      const [students, teachers] = await Promise.all([
        branchId === null
          ? studentQuery.is('branch_id', null)
          : studentQuery.eq('branch_id', branchId),
        branchId === null
          ? teacherQuery.is('branch_id', null)
          : teacherQuery.eq('branch_id', branchId),
      ])
      // As it came, null and all: a count answers null when the query failed, not when
      // it found nobody, and a row with no figure beats a row claiming a building is empty.
      // Separately per count, because a narrowed reader can be allowed one and not the other.
      return { branchId, students: students.count, teachers: teachers.count }
    }),
  )

  const rows = branchMoneyRows({
    profit: profitRows,
    charges: chargeRows,
    branches,
    students: heads.map((head) => ({ branchId: head.branchId, count: head.students })),
    teachers: heads.map((head) => ({ branchId: head.branchId, count: head.teachers })),
    headOffice: t.headOffice,
    unnamed: t.unnamedBranch,
  })
  const total = tallyBranchMoney(rows)
  const gap = payrollGap(rows)

  const totalHeads = centerHeads.error ? null : centerHeads.count
  const totalTeachers = centerTeachers.error ? null : centerTeachers.count
  const pressure =
    totalHeads === null ? null : capacityPressure(session.ceiling, totalHeads)

  /*
   * Which branch names open a record. A row `branchMoneyRows` had to name itself — a
   * branch whose row a policy withheld — has an id and nothing on the branches screen to
   * scroll to, and head office is not a branch at all. Both stay plain text rather than
   * becoming a link to a screen the building is not on.
   */
  const listed = new Set(branches.map((branch) => branch.id))

  /*
   * §3.7's urgent row, and only that row: "≤ 5% — urgent, HQ told which branches are
   * growing". At ≤ 20% the plan asks for a notice and nothing more, and a box naming
   * buildings under a notice would make the two levels read the same — which is the
   * failure places-warning.tsx spends a paragraph avoiding.
   *
   * THE WINDOW IS THE LAST THREE MONTHS FROM TODAY, NOT FROM THE MONTH PICKER. The pool
   * this decorates is a live count — every active student, no month in the query — so an
   * intake keyed to a month an owner is browsing would put last February's admissions
   * under today's remaining places and invite the subtraction. The month picker moves the
   * money table; this box is about now.
   */
  const urgent =
    pressure !== null && (pressure.level === 'urgent' || pressure.level === 'full')
  const intake = urgent
    ? await recentIntake(
        supabase,
        session.active.centerId,
        addMonths(currentPeriodMonth(), -2),
        currentPeriodMonth(),
      )
    : null

  /*
   * Named off the table's own rows rather than the branch list, so a building is called the
   * same thing in both places — including the ones `branchMoneyRows` had to name itself: head
   * office, and a branch whose row an RLS policy withheld.
   */
  const named = new Map(rows.map((row) => [row.branchId, row.name]))
  const grew =
    intake === null ? null : growingBranches(intake, (id) => named.get(id) ?? t.unnamedBranch)

  return (
    <Shell>
      {header}

      {/* Nine columns do not fit 320px, and a table that wraps a taka figure onto two
          lines is a table nobody checks. The bleed follows <main>'s own padding at each
          width, so the scroll runs edge to edge instead of inside a 32px margin — width
          this screen has no second column to spend (§20.8.8). */}
      <div className="-mx-4 overflow-x-auto px-4 lg:-mx-8 lg:px-8">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          {/* The month is the table's name, not a line floating above it — and a caption
              prints with the table when a page of this gets read out at a meeting. */}
          <caption className="mb-2 text-left font-medium text-ink-soft">
            {formatMonth(month, locale)}
          </caption>
          <thead>
            <tr className="border-b-2 border-line text-left align-bottom">
              <Th>{t.branch}</Th>
              <Th num right>{t.students}</Th>
              <Th num right>{t.teachers}</Th>
              <Th num right>{t.collected}</Th>
              <Th num right>{t.spending}</Th>
              <Th num right>{t.salaries}</Th>
              <Th num right>{t.profit}</Th>
              <Th num right>{t.owed}</Th>
              <Th num right>{t.rate}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.branchId ?? 'hq'} className="border-b border-line align-top">
                <Td>
                  <span className="flex items-center gap-2">
                    {row.branchId !== null && listed.has(row.branchId) ? (
                      // §20.6 asks for a click into the branch. What exists to open today
                      // is its record on the branches screen, so that is what this opens —
                      // an anchor to the row itself, not a filtered copy of this screen,
                      // which would need a scope-narrowing mechanism §8.2 puts in the
                      // database and not in a query string.
                      <Link
                        href={`/settings/branches#branch-${row.branchId}`}
                        className="font-medium text-brand-700 underline-offset-2
                          hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{row.name}</span>
                    )}
                    {!row.active && (
                      <span
                        className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5
                          text-xs font-semibold text-ink-faint"
                      >
                        {d.branchForm.off}
                      </span>
                    )}
                  </span>
                </Td>
                <Td num right>{row.students === null ? '—' : row.students}</Td>
                <Td num right>{row.teachers === null ? '—' : row.teachers}</Td>
                <Td num right>{formatTaka(row.collected)}</Td>
                <Td num right>{formatTaka(row.expenses)}</Td>
                <Td num right>{formatTaka(row.payroll)}</Td>
                {/* The one figure on the row that can be negative, and the only one
                    coloured. A loss is worth finding in a column of eleven buildings. */}
                <Td num right>
                  <span className={row.profit < 0 ? 'font-semibold text-absent' : ''}>
                    {formatTaka(row.profit)}
                  </span>
                </Td>
                <Td num right>
                  {row.outstanding === null ? '—' : formatTaka(row.outstanding)}
                </Td>
                <Td num right>{row.ratePct === null ? '—' : `${row.ratePct}%`}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-brand-50 font-bold text-brand-900">
              <td className="px-2 py-2">{t.total}</td>
              <td className="num px-2 py-2 text-right">
                {totalHeads === null ? '—' : totalHeads}
              </td>
              <td className="num px-2 py-2 text-right">
                {totalTeachers === null ? '—' : totalTeachers}
              </td>
              <td className="num px-2 py-2 text-right">{formatTaka(total.collected)}</td>
              <td className="num px-2 py-2 text-right">{formatTaka(total.expenses)}</td>
              <td className="num px-2 py-2 text-right">{formatTaka(total.payroll)}</td>
              <td className="num px-2 py-2 text-right">{formatTaka(total.profit)}</td>
              <td className="num px-2 py-2 text-right">
                {total.outstanding === null ? '—' : formatTaka(total.outstanding)}
              </td>
              <td className="num px-2 py-2 text-right">
                {total.ratePct === null ? '—' : `${total.ratePct}%`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/*
        TWO SUBJECTS, TWO COLUMNS FROM lg. Everything below the table used to be one stack
        of two-sentence blocks running the full 1,216px — footnotes about the table's
        columns interleaved with what §3.7 asks a head office to do about the pool. Left is
        what the figures above mean; right is the decision. Source order is reading order,
        so the phone keeps the stack it has today and no `order-N` is needed.
      */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-3">
          {/* §9.1's labelling problem, in one sentence under the table it applies to: cash
              in is keyed to when the money arrived and the two bill columns to the month
              billed for, so they will not agree and an owner who cannot tell why stops
              trusting both. The two head counts in the foot are the organisation's own
              reads rather than sums of the columns above them — head office is a row of
              this table, so the only way a foot can differ from its column is a building
              this reader was not shown. */}
          <p className="text-sm text-ink-soft">{t.legend}</p>

          {chargeRows === null && (
            <p className="text-sm text-ink-soft">{t.chargesUnreadable}</p>
          )}

          {/* THE WARNING 20260811000055 LEFT TO THIS SCREEN. Entering payroll centrally
              leaves every branch but head office looking free, and every profit figure
              above is then wrong in the flattering direction. Amber and not red: nothing
              is broken, a number is missing. */}
          {gap.kind !== 'none' && (
            <div className="rounded-lg border border-late/30 bg-late/5 p-3">
              <p className="font-medium text-ink">
                {gap.kind === 'all' ? t.payrollAll : t.payrollSome(gap.names.join(', '))}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {gap.kind === 'all' ? t.payrollAllNote : t.payrollSomeNote}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* §8.3 asks for the pool on this screen and §17 says what it is: one allowance
              for the whole organisation, never a quota per building. Which is why it sits
              beside the table rather than in it — a column would invite exactly the
              division the plan forbids.

              §3.7 names this screen for the warning, so past a fifth left the section
              gives way to the shared one and the pool note travels with it. The card an
              owner reads calmly and the box telling them next week is a problem are not
              the same object. */}
          {pressure !== null &&
            (pressure.level === 'fine' ? (
              <section className="rounded-xl border border-line bg-white p-4">
                <p className="num font-medium text-ink">
                  {d.dashboard.placesLeft(pressure.remaining, pressure.ceiling)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">{t.poolNote}</p>
                <Link
                  href="/settings/plan"
                  className="mt-2 inline-flex min-h-tap items-center font-medium
                    text-brand-700"
                >
                  {d.dashboard.placesLink} →
                </Link>
              </section>
            ) : (
              <PlacesWarning pressure={pressure} t={d.dashboard} note={t.poolNote} />
            ))}

          {/*
            §3.7's other half of the urgent row: the owner is told which branches are
            growing. Under the boxed warning and never under the calm card, because the plan
            puts this on the ≤ 5% row alone.

            A FAILED READ MUST NOT READ AS "NOTHING IS GROWING". The two are opposite advice
            — one says buy places for Sylhet, the other says the register filled with
            students who were already on it — so `null` gets its own sentence rather than
            falling into the empty case. This is also why the box does not simply vanish on
            a failed read: it is attached to a warning an owner is acting on this week.
          */}
          {urgent && (
            <section className="rounded-xl border border-line bg-white p-4">
              <h2 className="font-semibold text-ink">{t.growingTitle}</h2>
              {grew === null ? (
                <p className="mt-1 text-sm text-ink-soft">{t.growingUnreadable}</p>
              ) : grew.top.length === 0 ? (
                <p className="mt-1 text-sm text-ink-soft">{t.growingNone}</p>
              ) : (
                <>
                  <p className="num mt-1 text-ink">
                    {t.growingLine(
                      grew.top.map((b) => t.growingBranch(b.name, b.admitted)).join(', '),
                    )}
                  </p>
                  {grew.others > 0 && (
                    <p className="mt-1 text-sm text-ink-soft">
                      {t.growingOthers(grew.others)}
                    </p>
                  )}
                </>
              )}
              <p className="mt-1 text-sm text-ink-soft">{t.growingNote}</p>
            </section>
          )}

          {/*
            §3.7's asks, on the screen it names for them. A LIST AND NOT A CONTROL: the two
            answers are a purchase and a refusal, both of which belong on the plan screen
            beside the price and behind `requireRole('owner')`. What this adds is that the
            head office finds out — a manager who filed an ask has no way to reach the owner
            that is not this product, and an ask nobody reads is the email we replaced.

            Silent when the read fails. The card above it is a warning about the pool, the
            table beside it is the month's money, and a line about a read that did not work
            belongs to neither; §3.7's own list is on the plan screen, which says so there.
          */}
          {asks !== null && asks.length > 0 && (
            <section className="rounded-xl border border-line bg-white p-4">
              <h2 className="font-semibold text-ink">
                {d.settings.plan.places.asksTitle}
              </h2>
              <ul className="mt-2 flex flex-col gap-1">
                {asks.map((ask) => (
                  <li key={ask.id} className="num text-sm text-ink">
                    {d.settings.plan.places.askLine(
                      ask.branchId === null
                        ? t.headOffice
                        : (ask.branchName ?? t.unnamedBranch),
                      ask.places,
                      formatDate(todayInDhaka(new Date(ask.createdAt)), locale),
                    )}
                  </li>
                ))}
              </ul>
              <Link
                href="/settings/plan"
                className="mt-2 inline-flex min-h-tap items-center font-medium
                  text-brand-700"
              >
                {d.settings.plan.places.title} →
              </Link>
            </section>
          )}
        </div>
      </div>

      <Link
        href="/settings/branches"
        className="inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        {t.branchesLink} →
      </Link>
    </Shell>
  )
}

/**
 * The page's frame, in one place because five returns need it.
 *
 * `refusal` is for the two shapes that have no month to pick — the locked and the pinned
 * card — and it now draws the same bar as the other three rather than a crumb and a heading
 * of its own. The bar sits here rather than in each arm because `PageHeader` returns a
 * fragment: its `<header>` is a direct child of this column either way, which is the whole
 * condition for a sticky box travelling the length of the page.
 */
function Shell({
  refusal,
  children,
}: {
  refusal?: { home: string; title: string }
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-6">
      {refusal && (
        <PageHeader
          title={refusal.title}
          back={{ href: '/dashboard', label: refusal.home }}
        />
      )}
      {children}
    </div>
  )
}
