import Link from 'next/link'
import { forbidden } from 'next/navigation'
import type { Route } from 'next'

import { PageHeader } from '@/components/page-header'
import {
  pageCenter,
  isStaffAdmin,
  canManageStudents,
  canManageBatches,
  getSession,
} from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile } from '@/lib/bd/phone'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { planName, hasStaff, has, overStaffSeats, capIsQuota } from '@/lib/plans'
import { can } from '@/lib/staff/capabilities'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.hub.title} — CoachDesk` }
}

/**
 * Everything on this page that only an owner or a manager may read.
 *
 * Split out so it can be skipped rather than fetched and then not rendered. Four
 * of the six queries feed rows a permitted teacher does not get — and one of them
 * is the centre's payment number, which is the figure every fee reminder points at.
 * Reading it for somebody who cannot be shown it would be a needless second copy of
 * it in a server response.
 *
 * Returned as one promise so the caller keeps a single round of parallelism: an
 * owner is the common reader here and must not pay a second round trip for a check
 * that was added for somebody else.
 */
async function staffCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  centerId: string,
) {
  const [
    { count: teacherCount },
    { count: subjectCount },
    { count: examTypeCount },
    { data: center, error: centerError },
  ] = await Promise.all([
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('active', true),
    supabase
      .from('subjects')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('active', true),
    supabase
      .from('exam_types')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('active', true),
    supabase
      .from('coaching_centers')
      .select('payment_wallet, payment_number')
      .eq('id', centerId)
      .maybeSingle(),
  ])

  /*
   * Passed on as they came, `null` and all. A head count answers `null` when the query
   * failed, not when it found nothing — and the caller's `count` field already means
   * "no chip", so an unknown number draws nothing instead of the "0" it used to.
   *
   * Which matters most on the row this page decides whether to draw at all: see the
   * teachers row below, where a nought used to take the row away.
   *
   * `centerError` rides along for the same reason and one the counts do not have. A
   * missing count draws no chip; a missing payment row used to draw a sentence — the
   * hint below said there is no number to pay into, which is a nudge to go and set
   * one, on a screen an owner may have set it on months ago.
   */
  return { teacherCount, subjectCount, examTypeCount, center, centerError }
}

/**
 * Which heading a row sits under (§20.8 step 9).
 *
 * Four questions, not thirteen answers: what this centre is, who is in it, what is
 * taught, and what has been written down. `null` is the founder's row, which is about
 * every centre rather than this one and is drawn below the groups.
 */
type HubGroup = 'centre' | 'people' | 'teaching' | 'records'

type HubItem = {
  href: Route
  label: string
  hint: string
  count: number | null
  group: HubGroup | null
}

/** The rows themselves, and nothing when the reader holds none of them. */
function HubRows({ items }: { items: HubItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="flex items-center gap-3 rounded-xl border border-line
              bg-white px-4 py-3 transition-colors hover:border-brand-300"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{item.label}</p>
              <p className="truncate text-sm text-ink-soft">{item.hint}</p>
            </div>
            {item.count !== null && (
              <span className="num shrink-0 text-sm font-semibold text-ink-soft">
                {item.count}
              </span>
            )}
            <span aria-hidden className="shrink-0 text-ink-faint">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * A heading and its rows, or nothing at all.
 *
 * The empty check is the point: a teacher handed admissions has rows in one of the
 * four groups, and three headings over nothing would read as three features being
 * withheld. The type treatment is the sidebar's own (app-nav.tsx), so the app has one
 * voice for "this is a group of destinations", inset to this screen's rows.
 */
function HubSection({ heading, items }: { heading: string; items: HubItem[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h2
        className="px-4 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide
          text-ink-faint"
      >
        {heading}
      </h2>
      <HubRows items={items} />
    </section>
  )
}

/**
 * The customization hub.
 *
 * Everything a centre needs to shape the app to how it actually runs — its own
 * subjects, its own batches and slots, its own exam types, its own teachers and
 * what each may do. Counts are shown next to each entry so an owner can see at
 * a glance what is set up and what is still empty, which is the question they
 * have in their first week.
 *
 * NOT A RANK ANY MORE, and that is the point of this commit. `pageRole('manager')`
 * is what made `can_manage_students` and `can_manage_batches` decorative: a teacher
 * with either box ticked could not reach the hub, so they could not reach the two
 * screens the boxes were about. Now the guard is the union — staff-admin, or one of
 * the two permissions — and the list is built from what the reader actually holds.
 * A teacher handed admissions sees one row, and the plan, the credits, the payment
 * number and their colleagues' names are not among them.
 *
 * FOUR GROUPS AND TWO COLUMNS FROM `xl` (§20.8 step 9). Before this the page was
 * thirteen identical rows in one column 1,216px wide, in an order that was the order
 * they had been written in — the payment number, the roster, the batches, the subjects,
 * the teachers, the log, the plan, all equally weighted and all equally unrelated. §20.2
 * asks for two levels and no more: a group, and the pages inside it.
 *
 * `xl` and not `lg` for the second column, from the shell's arithmetic: two columns at
 * `lg` are 340px, less the row's own padding, and the longest hint on the page —
 * "Morning / noon / afternoon / evening, which days" — wants more than what is left. At
 * `xl` each column is 468px and every hint fits on its line.
 *
 * THE CREDIT BALANCE MOVED INTO THE HEADER BAND, out of a Card the full width of the
 * workspace holding one number. It is a fact about the centre, like the name beside it,
 * and it keeps the link to the ledger because that is where credits are bought.
 */
export default async function SettingsPage() {
  const session = await pageCenter()
  const staff = isStaffAdmin(session)
  const [mayStudents, mayBatches] = await Promise.all([
    canManageStudents(),
    canManageBatches(),
  ])

  // Nothing to show rather than an empty page. Both helpers already return true for
  // a staff-admin, so `staff` here is only carrying the owner who holds neither
  // permission row — which is every owner.
  if (!staff && !mayStudents && !mayBatches) forbidden()

  /*
   * And whether the two rows about colleagues are this reader's business (§6.2).
   *
   * Every write on both screens behind them asks for `staff` — the teacher list, its
   * permission boxes, the login buttons, and the whole of settings/staff — so a manager
   * whose owner unticked it would open a page of forms that each refuse. Reads on those
   * tables are not narrowed, which is why this is a hidden row rather than a 403: nothing
   * was hidden from them, and there is nothing there for them to do.
   *
   * Off the session, and false for a teacher, who never had either row.
   */
  const mayStaff = staff && can(session.active.capabilities, 'staff')

  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).settings.hub

  const [{ count: batchCount }, { count: studentCount }, staffOnly] =
    await Promise.all([
      supabase
        .from('batches')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true),
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('status', 'active'),
      staff ? staffCounts(supabase, session.active.centerId) : null,
    ])

  // A count would say nothing here, so the hint carries the answer: either the
  // number a parent will be told to pay, or the fact that there isn't one. An
  // owner who has not set this is losing fees to a question they answer by hand.
  //
  // Three answers rather than two, because "there isn't one" was also what a
  // dropped read said — a nudge to go and set a number, on the one row of this
  // hub whose screen may have had it set months ago. See center.unreadable for
  // what that same read does to the screen this row opens.
  const payHint = staffOnly?.centerError
    ? t.payUnreadable
    : staffOnly?.center?.payment_number
      ? t.feesGoTo(formatBdMobile(staffOnly.center.payment_number))
      : t.noPaymentNumber

  // The centre's own plan, not the free one. Every tier below `center` has caps,
  // so this line is read by paying owners too.
  //
  // capIsQuota rather than `=== null`: both centre tiers now cap batches at a hundred
  // as an abuse ceiling, and "Coaching Center plan: 100 batches" would tell a paying
  // owner the guardrail is what they bought. What they bought is students. The
  // unlimited sentence stays true for them — the ceiling sits far above any need it
  // claims to cover, which is the whole reason it was set where it was.
  const maxBatches = capIsQuota(session.plan, 'maxBatches') ? session.plan.maxBatches : null
  const planLine =
    maxBatches === null
      ? t.planUnlimited(planName(session.plan, locale))
      : t.plan(planName(session.plan, locale), maxBatches)

  const items: HubItem[] = [
    ...(staff
      ? [
          {
            href: '/settings/center' as Route,
            label: t.center,
            hint: payHint,
            count: null,
            group: 'centre' as HubGroup,
          },
        ]
      : []),
    /*
     * The two rows a teacher can be given. In the same places they have always
     * been, because for an owner both flags are true and nothing about this list
     * moved — the only reader who sees a shorter page is the one who was previously
     * refused the whole of it.
     */
    ...(mayStudents
      ? [
          {
            href: '/settings/students' as Route,
            label: t.students,
            hint: t.studentsHint,
            // Not `?? 0`. A chip reading "0" beside "Students" on the hub of a centre
            // with three hundred of them is the one figure on this page an owner in
            // their first week is actually checking, and a dropped count is not an
            // empty roster. No chip says as much as the truth allows.
            count: studentCount,
            group: 'people' as HubGroup,
          },
        ]
      : []),
    ...(mayBatches
      ? [
          {
            href: '/settings/batches' as Route,
            label: t.batches,
            hint: t.batchesHint,
            /** See the students row. */
            count: batchCount,
            group: 'teaching' as HubGroup,
          },
        ]
      : []),
    ...(staffOnly
      ? [
          {
            href: '/settings/subjects' as Route,
            label: t.subjects,
            hint: t.subjectsHint,
            count: staffOnly.subjectCount,
            group: 'teaching' as HubGroup,
          },
          /*
           * Staff appears only where there is staff. On a one-teacher plan this row
           * led to a list containing the owner and an add button the action refuses,
           * which reads as a feature withheld rather than a plan that does not have
           * colleagues in it.
           *
           * Unless the centre has colleagues anyway. A downgrade leaves the teacher
           * rows behind — see overStaffSeats — and the screen this row leads to is
           * the only one that can switch them off, so hiding it stranded an owner
           * who was being told on the plan screen that they were over their seats.
           * The count beside the label is the number that is wrong.
           *
           * Or did not arrive, which is the same stranding by a quieter road: a failed
           * count used to read as nought, nought is not over the seats, and the only
           * door to the list disappeared. An unread count cannot rule out the state
           * this row exists for, so the row is drawn and the chip is left off.
           */
          ...(mayStaff &&
          (hasStaff(session.plan) ||
            staffOnly.teacherCount === null ||
            overStaffSeats(session.plan, staffOnly.teacherCount))
            ? [
                {
                  href: '/settings/teachers' as Route,
                  label: t.teachers,
                  hint: t.teachersHint,
                  count: staffOnly.teacherCount,
                  group: 'people' as HubGroup,
                },
              ]
            : []),
          /*
           * Who else works here, and what they are paid. Gated on the plan and not on
           * a count, unlike the teachers row above: `staffManagement` is bought or it
           * is not, and there is no downgrade that can leave a free plan holding
           * employees — a plan without staff never had a screen to add one on.
           *
           * Hidden rather than shown locked, unlike the export row. The difference is
           * what the reader would do with it: the export screen's locked branch is a
           * feature a centre already has data for and can buy access to today, while
           * an owner on a one-teacher plan has no accountant and no cleaner to write
           * down. A row that opens a card saying "not on your plan" is an
           * advertisement, and the plan screen is where we sell.
           */
          ...(mayStaff && has(session.plan, 'staffManagement')
            ? [
                {
                  href: '/settings/staff' as Route,
                  label: t.staff,
                  hint: t.staffHint,
                  // No chip, and no query for one. A count of employees would cost
                  // every owner a round trip to print a number that is on the screen
                  // this row opens; the hint is doing the work here.
                  count: null,
                  group: 'people' as HubGroup,
                },
              ]
            : []),
          /*
           * Who else administers the centre — §6.2's own screen. Two gates, and both are
           * copies of a rule that lives elsewhere: `staffManagement` because a plan with
           * no colleagues has nobody to appoint, and `owner` because 20260811000061 made an
           * `owner` or `manager` row in `center_members` writable only by `app.is_owner`.
           * A manager following this row would reach a list of forms the database refuses,
           * so the page 403s them as well.
           */
          ...(has(session.plan, 'staffManagement') && session.active.role === 'owner'
            ? [
                {
                  href: '/settings/managers' as Route,
                  label: t.managers,
                  hint: t.managersHint,
                  count: null,
                  group: 'people' as HubGroup,
                },
              ]
            : []),
          /*
           * The buildings, on the one tier that has more than one. Gated on the plan
           * like the staff row above and hidden rather than shown locked, for the same
           * reason: an owner of a single-building centre has nothing to write down here,
           * and a row that opens a card saying "not on your plan" is an advertisement.
           * The plan screen is where we sell.
           *
           * No chip, and no query for one. A count of branches would cost every owner of
           * every centre a round trip to print a number that is on the screen this row
           * opens, and only institutions would ever read it.
           */
          ...(has(session.plan, 'multipleBranches')
            ? [
                {
                  href: '/settings/branches' as Route,
                  label: t.branches,
                  hint: t.branchesHint,
                  count: null,
                  group: 'centre' as HubGroup,
                },
              ]
            : []),
          {
            href: '/settings/exam-types' as Route,
            label: t.examTypes,
            hint: t.examTypesHint,
            count: staffOnly.examTypeCount,
            group: 'teaching' as HubGroup,
          },
          {
            href: '/settings/sms' as Route,
            label: t.sms,
            hint: t.smsHint,
            count: null,
            group: 'centre' as HubGroup,
          },
          /*
           * Shown whether or not the plan includes it, unlike the staff row above.
           * The difference is that this one can be bought: a teacher plan will never
           * have colleagues on it at any price, so that row leads nowhere, while the
           * export screen's locked branch is a price and a link. The hint says which
           * it is, so nobody taps to find out.
           */
          {
            href: '/settings/export' as Route,
            label: t.exports,
            hint: has(session.plan, 'exportReports')
              ? t.exportsHint
              : t.exportsLocked,
            count: null,
            group: 'records' as HubGroup,
          },
          /*
           * §10, and the one row inside this spread that a manager must not see. The
           * log's whole use is the conversation where a manager says they never entered
           * something, so the reader has to be the person asking rather than the person
           * asked — `audit_log_owner_read` says the same thing in SQL, and the screen
           * behind this row 403s a manager who types the path.
           */
          ...(session.active.role === 'owner'
            ? [
                {
                  href: '/settings/activity' as Route,
                  label: t.activity,
                  hint: t.activityHint,
                  count: null,
                  group: 'records' as HubGroup,
                },
              ]
            : []),
          /*
           * The plan, last, and now a row rather than the grey line this page used
           * to end with. The sentence is unchanged — it is still the plan and its
           * batch cap — but it has somewhere to lead. An owner who reads "৫টি ব্যাচ"
           * and wants a sixth had no next step from a paragraph.
           */
          {
            href: '/settings/plan' as Route,
            label: t.plans,
            hint: planLine,
            count: null,
            group: 'centre' as HubGroup,
          },
        ]
      : []),
    /*
     * The founder's own way in, and the only row here gated on a property of the
     * reader rather than of the centre. Outside the `staffOnly` spread on purpose:
     * `is_platform_admin` is not a role in any centre, so it must not depend on
     * being a manager of this one.
     *
     * This is the whole of the panel's discoverability — no nav item, no dashboard
     * card — because /founder answers with a 404 to everybody else and a link that
     * 404s for every customer is a link that does not belong in the shell. See
     * pagePlatformAdmin for why the answer is 404 and not 403.
     */
    ...(session.isPlatformAdmin
      ? [
          {
            href: '/founder' as Route,
            label: t.founder,
            hint: t.founderHint,
            count: null,
            // Under no heading: the four groups are all about this centre, and this
            // row is about every centre. Drawn below them, on its own.
            group: null,
          },
        ]
      : []),
  ]

  const inGroup = (group: HubGroup) => items.filter((item) => item.group === group)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.title}
        /* No crumb: this is where the nav sends people, so there is no level above it.
           The centre's name under the title rather than beside it — on a phone the two
           of them on one line left about nine characters for each. */
        subtitle={session.active.centerName}
        /* Whose credits they are. A teacher cannot top them up, cannot open the ledger
           the "details" link points at, and does not need to know what the centre has
           left — the send screen tells them the cost of the message in front of them,
           which is the only balance question they have.

           In the bar rather than in a Card of its own: one number does not need 1,216px
           of white box, and up here it reads as another fact about the centre, which is
           what it is. Label and figure on one line, because the bar is one line and
           every sticky rail in the app starts below it. */
        actions={
          staff && (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-sm text-ink-soft">{t.smsCredits}</span>
                <span className="num text-xl font-bold text-ink">
                  {session.active.smsCreditBalance}
                </span>
              </p>
              <Link
                href="/settings/sms"
                className="inline-flex min-h-tap items-center text-sm font-medium
                  text-brand-700 hover:text-brand-900 lg:min-h-0"
              >
                {t.details}
              </Link>
            </>
          )
        }
      />

      {/* Two columns from `xl`, and the shorter group not stretched by the taller.
          Source order is reading order — centre and people first, because the row an
          owner opens in their first week is the payment number and the one they open
          every week after that is the roster. */}
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <HubSection heading={t.groups.centre} items={inGroup('centre')} />
        <HubSection heading={t.groups.people} items={inGroup('people')} />
        <HubSection heading={t.groups.teaching} items={inGroup('teaching')} />
        <HubSection heading={t.groups.records} items={inGroup('records')} />
      </div>

      <HubRows items={items.filter((item) => item.group === null)} />
    </div>
  )
}
