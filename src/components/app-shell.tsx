/**
 * The frame every signed-in screen sits in.
 *
 * TWO LAYOUTS, on purpose, and this file used to say the opposite. Navigation lives
 * at the *bottom* on phones: teachers hold the phone one-handed while looking at a
 * room full of students, and the top of a 6.5" screen is out of thumb reach. What
 * was wrong was giving a laptop the same thing — the whole application centred in a
 * 768px column with four phone tabs stuck to the bottom of a 1440px screen, which
 * is a phone screenshot with grey either side of it. An owner reconciling a month of
 * fees against a bKash statement is on a laptop, and that is the reader this product
 * is for at the point money moves.
 *
 * So from `lg` up: a standing sidebar holding the centre, the menu and the account,
 * and a workspace that uses the width. Below `lg`: exactly what was there before.
 * The breakpoint is 1024px, which puts a tablet in portrait on the phone layout,
 * where its thumbs are.
 *
 * ONE navigation table for both, resolved once. Two lists would drift the way the
 * owner and manager arrays drifted before they were merged — see NAV below.
 */
import Link from 'next/link'
import type { Route } from 'next'

import { signOut } from '@/app/(auth)/actions'
import { switchCenter } from '@/app/(app)/actions'
import { SideNav, TabBar, type IconName, type NavEntry, type NavSection } from '@/components/app-nav'
import { LanguageSwitch } from '@/components/language-switch'
import { buttonClass, LinkButton, Logo } from '@/components/ui'
import type { MemberRole, CenterStatus } from '@/lib/supabase/types'
import type { Membership, Session } from '@/lib/auth/session'
import {
  atLeast,
  billingOf,
  canReadFees,
  canManageStudents,
  canManageBatches,
} from '@/lib/auth/session'
import { isHqMember } from '@/lib/branches'
import { can, canReadMoney } from '@/lib/staff/capabilities'
import { TRIAL_NOTICE_DAYS, trialStanding, type TrialStanding } from '@/lib/entitlement'
import { has, planName, type FeatureKey, type PlanLimits } from '@/lib/plans'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { formatDate } from '@/lib/bd/time'
import { formatTaka } from '@/lib/money'
import { dict, type Dictionary, type Locale } from '@/lib/i18n'

/**
 * `href` is `Route`, not string, so a nav entry pointing at a route that does
 * not exist fails the build. The bottom bar is the only navigation most users
 * ever touch; a dead tab here is worse than a dead link anywhere else.
 *
 * `label` is a key into the nav group rather than a string, so the table below
 * stays one table instead of one per language — and a key that does not exist in
 * the dictionary fails the build alongside a route that does not exist.
 *
 * `group` is the sidebar heading this row sits under, and `undefined` is the first
 * group, which has no heading. Keyed into the dictionary for the same reason `label`
 * is. It is only read by the sidebar: the phone bar takes the first four rows in
 * table order and puts the rest behind More, so the table's order is the order both
 * layouts show, and the groups cannot re-sort one of them.
 */
type NavGroup = keyof Dictionary['shell']['navGroups']

/**
 * Whether this reader gets this row at all, asked with the same call the screen behind it
 * makes — see `navFor` for why it lives on the row and not in a list of `if`s.
 */
type NavGate = (ctx: { plan: PlanLimits; member: Membership }) => boolean

type NavItem = {
  href: Route
  label: keyof Dictionary['shell']['nav']
  /**
   * A key into the navigation icon set (`app-nav.tsx`), drawn as an inline SVG so
   * every tab and row reads in one visual grammar instead of whatever weight the
   * Bangla font happened to give a text glyph.
   */
  icon: IconName
  group?: NavGroup
  when?: NavGate
  /**
   * The plan feature this screen belongs to, when it belongs to one.
   *
   * NOT A `when`, and MASTERPLAN.md §20.3 is explicit about the difference: a group its
   * reader's capabilities exclude is not drawn, and a group their *plan* does not include
   * is drawn and says what would unlock it, "the one place a locked door beats a hidden
   * one, because that door is also the upgrade path". So this marks the row rather than
   * removing it, and the screen behind it already draws the card naming the plan that has
   * it. Hiding these would mean a centre never learning the product does payroll.
   */
  needs?: FeatureKey
}

/**
 * The fee tab, named once because two roles reach it by different routes — the
 * table below for a staff-admin, `canReadFees` for a teacher whose owner has
 * ticked the permission. Two literals would eventually be two different icons.
 *
 * `when` is `canReadFees`'s staff-admin half, spelled out: the screen itself runs
 * `if (!(await canReadFees())) forbidden()`, and for a manager that call is exactly
 * this line. A teacher's half needs the query and stays in `navFor`; `can(null, …)`
 * is true, so this gate cannot take back what that query granted.
 */
const FEES_TAB: NavItem = {
  href: '/fees',
  label: 'fees',
  icon: 'banknote',
  group: 'money',
  when: ({ member }) => can(member.capabilities, 'fees'),
}

/** Named for the same reason, now that three roles reach it. */
const EXAMS_TAB: NavItem = { href: '/exams', label: 'exams', icon: 'pencil' }

/**
 * Settings, named for the same reason the fee tab is.
 *
 * A teacher reaches it when the owner has ticked `can_manage_students` or
 * `can_manage_batches` — the hub then shows them the one or two rows those boxes
 * open and nothing else. Until 20260811000019 there was no route in for them at
 * all, which is half of why the two checkboxes did nothing: the screens were behind
 * a rank they could not clear, and behind a tab they were never given.
 */
const SETTINGS_TAB: NavItem = {
  href: '/settings',
  label: 'settings',
  icon: 'sliders',
  group: 'organisation',
}

/**
 * Owners and managers, who see the same ten rows at most.
 *
 * One array rather than two identical ones, because the two roles had drifted:
 * both were missing /exams while a teacher had it, and a fix applied to `owner`
 * alone would have left every manager in the country unable to reach a third of
 * the product.
 *
 * SIX OF THESE ARE NEW AND WERE NOT REACHABLE FROM ANY MENU. /expenses, /payroll,
 * /notices, /progress, /at-risk and /hq have all been built, tested and guarded for
 * weeks, and the only way to any of them was a card on the dashboard — so recording
 * an expense meant going home first. That is what turned the dashboard into a menu,
 * and it is the defect this table fixes, not a redesign of anything behind it.
 *
 * Ordered as the reader sees it, groups included: the first four rows are the ones a
 * centre touches daily, because those four are the phone's bar and the rest go behind
 * More. Exams sits after attendance, matching the teacher's bar, so somebody promoted
 * from teaching finds it where they left it. Settings stays last, where every app on
 * the phone keeps it.
 */
const STAFF_ADMIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'home', icon: 'home' },
  { href: '/teach', label: 'attendance', icon: 'register' },
  EXAMS_TAB,
  FEES_TAB,
  /*
   * The roster, lifted out of the settings hub and into the menu proper. It was
   * the one screen a centre opens several times a day — admit a child, check a
   * guardian's number, find which batch somebody is in — that still took two taps
   * through a hub of other things, so the dashboard stayed the only way to
   * anywhere. Fifth, so the four above it keep the phone's four tabs; on the bar
   * it lands behind More, which is one tap rather than two.
   *
   * No `when` and no `needs`, for the reason /at-risk has neither: the screen asks
   * `pagePermission('can_manage_students')`, and every reader of this table clears
   * a roster permission by rank without the box being ticked. A teacher is not in
   * this table — theirs is a grant on the row, and they keep reaching the roster
   * through Settings, which `navFor` already opens for them.
   */
  { href: '/settings/students', label: 'students', icon: 'students' },
  {
    href: '/expenses',
    label: 'expenses',
    icon: 'expenses',
    group: 'money',
    // pageCapability('expenses'), and the plan half as `needs` so the row is drawn
    // locked rather than hidden — the screen behind it is the upsell card.
    when: ({ member }) => can(member.capabilities, 'expenses'),
    needs: 'centerWideReporting',
  },
  {
    href: '/payroll',
    label: 'payroll',
    icon: 'calendar',
    group: 'money',
    when: ({ member }) => can(member.capabilities, 'payroll'),
    needs: 'centerWideReporting',
  },
  // pageRole('manager') and nothing else: every tier has students who stop coming.
  { href: '/at-risk', label: 'atRisk', icon: 'alert', group: 'families' },
  {
    href: '/notices',
    label: 'notices',
    icon: 'envelope',
    group: 'families',
    // No plan gate on this one at all — a solo teacher on the free plan can tell a
    // batch's parents the room is shut on Thursday, and always could.
    when: ({ member }) => can(member.capabilities, 'messages'),
  },
  {
    href: '/progress',
    label: 'progress',
    icon: 'star',
    group: 'families',
    when: ({ member }) => can(member.capabilities, 'messages'),
    needs: 'parentSummary',
  },
  {
    href: '/hq',
    label: 'hq',
    icon: 'buildings',
    group: 'organisation',
    // The screen's other two checks, both of which hide rather than lock: a manager
    // pinned to one branch is not being sold anything by a row leading to a card that
    // says the comparison is not theirs to read.
    when: ({ member }) => isHqMember(member) && canReadMoney(member.capabilities),
    needs: 'multipleBranches',
  },
  SETTINGS_TAB,
]

/** The order the sidebar draws its headings in. The unheaded group is always first. */
const NAV_GROUPS: NavGroup[] = ['money', 'families', 'organisation']

/**
 * What each role sees. Each entry names an icon by key rather than carrying one: the
 * shapes are inline SVG in app-nav.tsx, which is a client component, and a component
 * reference does not serialise across that boundary. The set is drawn rather than
 * fetched — no sprite, no font, no network request on a 3G connection — and it
 * replaced the text glyphs (`⌂`, `৳`, `✎`) this table used to carry, which landed on
 * a different baseline in every Bangla font and read as decoration rather than as
 * navigation.
 *
 * Keyed by MemberRole rather than string: adding a role to the enum then breaks
 * here until someone decides what that role's navigation is, instead of
 * silently handing them an empty bar.
 *
 * THIS TABLE IS THE CEILING AND `navFor` IS THE GATE. It used to be neither — every
 * row in it was open to every plan and every capability, which is why the comment here
 * said it was not a plan gate. Six of the eleven rows above are not like that: four
 * belong to a plan feature and five turn on one of the six capability boxes, and
 * `navFor` asks the same questions the screens themselves ask. A row that survives to
 * the sidebar is a row whose screen will open — locked or not, and a locked one opens
 * the card that sells the plan it needs.
 */
const NAV: Record<MemberRole, NavItem[]> = {
  owner: STAFF_ADMIN_NAV,
  manager: STAFF_ADMIN_NAV,
  teacher: [{ href: '/teach', label: 'attendance', icon: 'register' }, EXAMS_TAB],
  student: [{ href: '/me', label: 'mine', icon: 'person' }],
  guardian: [{ href: '/me', label: 'myChild', icon: 'person' }],
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

/**
 * A reader's menu: their role's rows, less the ones their plan or their permissions do
 * not open, plus the ones a teacher was granted.
 *
 * THE GATE IS ON THE ROW, not in a ladder of `if`s down here, because the rule this
 * function exists to keep is that a row and its screen never disagree — and the way
 * that breaks is somebody adding a row to the table above and not noticing there was a
 * ladder to extend. Adjacent, it is one edit. Each `when` is written as the same call
 * the page makes, so the pairing can be read in one line rather than inferred.
 *
 * NONE OF IT COSTS A QUERY for a staff admin. `can`, `has`, `isHqMember` and
 * `canReadMoney` are all pure functions of the session the layout already holds; the
 * narrowing and the plan ride along on it. Only a teacher pays, and only for the two
 * grants that live on a teacher row rather than on the membership.
 *
 * A STAFF ADMIN CAN LOSE THE FEE TAB (§6.2). A manager whose owner unticked `fees` has
 * a fee board where 20260811000063's policies filter every row out, so the tab leads to
 * a centre that appears to have collected nothing and to be owed nothing — which is a
 * worse answer than no tab. The same reasoning is what puts a `when` on spending,
 * salaries, notices and the week.
 *
 * A PLAN DOES NOT HIDE A ROW, IT LOCKS ONE. That asymmetry is deliberate and it is
 * MASTERPLAN.md §20.3's: a reader narrowed by a capability box is being kept out of
 * something their colleague does, and a reader on a smaller plan is being sold
 * something. /expenses, /payroll, /progress and /hq carry `needs` rather than a plan
 * `when`, so a free-plan teacher sees Salaries greyed out with a padlock, and the screen
 * behind it — which already refuses nobody — says which plan has it. Hiding them is how
 * a centre owner reaches month four without knowing this product does payroll.
 *
 * The three teacher checks run together rather than in sequence: they share one memoised
 * query behind `myTeacherRows`, so the cost is a single round trip either way, but awaiting
 * them one at a time would make that look like three.
 *
 * Settings appears for either roster permission, because the hub itself now decides
 * which rows to draw — a teacher with only `can_manage_batches` gets the row and one
 * row behind it, and that is the honest thing to show rather than a menu entry that
 * leads to a page of things they cannot open.
 */
async function navFor(session: Session, role: MemberRole): Promise<NavItem[]> {
  const member = session.active
  if (!member) return NAV[role]

  const ctx = { plan: session.plan, member }
  const allowed = (items: NavItem[]) => items.filter((item) => !item.when || item.when(ctx))

  if (role !== 'teacher') return allowed(NAV[role])

  const [fees, students, batches] = await Promise.all([
    canReadFees(),
    canManageStudents(),
    canManageBatches(),
  ])

  return allowed([
    ...NAV.teacher,
    ...(fees ? [FEES_TAB] : []),
    ...(students || batches ? [SETTINGS_TAB] : []),
  ])
}

/**
 * The rows the phone's bar shows, and the rows that go behind More.
 *
 * FOUR, and the fifth slot is the sheet. A staff admin now has up to eleven
 * destinations; at 375px that is 34px a tab, so the bar keeps the four a centre
 * touches every day — the dashboard, the register, the marks and the money — and the
 * sheet holds the rest in the same order the sidebar draws them.
 *
 * A LOCKED ROW NEVER TAKES A SLOT. In the table's own order the first four are never
 * locked, but they are not fixed: a manager whose owner unticked `fees` loses the fourth,
 * and spending — which a Teacher Pro centre does not have — slides up into it. One of
 * four tabs on the only screen that reader ever sees is too much room to give an
 * advertisement, so locked rows are pushed behind More, where the upgrade path is still a
 * tap away and the daily work is not competing with it.
 *
 * Under five rows there is no sheet at all, which is every role that is not a staff
 * admin: a teacher's bar is the two or four rows it has always been, and a student's
 * single row still hides the bar entirely.
 */
const PHONE_TABS = 4

function splitForPhone(entries: NavEntry[]): { tabs: NavEntry[]; more: NavEntry[] } {
  const locked = entries.some((entry) => entry.locked)
  if (entries.length <= PHONE_TABS + 1 && !locked) return { tabs: entries, more: [] }

  const tabs = entries.filter((entry) => !entry.locked).slice(0, PHONE_TABS)
  return { tabs, more: entries.filter((entry) => !tabs.includes(entry)) }
}

/**
 * What a centre in read-only sees, on every screen, until the bill is settled.
 *
 * MASTERPLAN.md §4.4 asks for exactly this: writing stops, everything stays readable,
 * "plus a banner that says plainly what happened and how to fix it, with the founder's
 * number on it". Without it the product simply breaks — a teacher's register refuses to
 * save with a one-line form error and no screen anywhere says why.
 *
 * IN THE SHELL RATHER THAN ON THE SCREENS, because there are thirty-odd screens and the
 * ones a suspended centre reaches most are the ones nobody would remember to annotate.
 * The refusal a form prints points back up here, so this is the one place the whole
 * explanation lives.
 *
 * `print:hidden`, like the header and the nav. A receipt is handed across a desk to a
 * parent and a register is filed; neither is a place to tell them the centre owes us
 * money.
 *
 * AMBER, NOT RED. Red is for something that went wrong, and nothing has: the data is
 * intact, the app is working, and a bill is unpaid. Red here would also be permanent —
 * on every screen, all day — which is how people learn to stop reading a colour.
 */
function ReadOnlyBanner({
  status,
  coveredTo,
  money,
  t,
  canSeePlan,
}: {
  status: CenterStatus
  /**
   * The last day the centre's payments covered, already formatted, or null. Non-null
   * only when a *date* is the fact worth reading — a centre suspended by hand, or one
   * whose coverage history explains the state.
   */
  coveredTo: string | null
  /**
   * What the day costs and what is left, both already formatted as taka, or null when
   * the balance is not what stopped the writing (MASTERPLAN.md §4.4, §11.6).
   *
   * THIS IS THE ORDINARY CAUSE NOW. Under the prepaid balance a centre runs out of
   * money far more often than it is suspended by a human, and the sentence it needs is
   * about a purse rather than a tier — the two numbers below are what the owner checks
   * against their own bKash history before ringing anybody.
   */
  money: { cost: string; balance: string } | null
  t: Dictionary['readOnly']
  canSeePlan: boolean
}) {
  // `cancelled` gets its own words: that one is not about money at all, and a top-up
  // would not fix it.
  const cancelled = status === 'cancelled'

  // Three causes and three sentences, in this order: a cancelled account is a fact about
  // the contract, a dry balance is a fact about the money, and everything else — a hand
  // suspension, or a status nobody can name — gets the sentence with a phone call in it.
  const title = cancelled ? t.cancelledTitle : money ? t.balanceTitle : t.suspendedTitle
  const body = cancelled ? t.cancelledBody : money ? t.balanceBody : t.suspendedBody

  // Empty in every deployment until the founder puts their own number in, exactly as
  // on the plan screen — and the banner is not gated on it, for the reason the note
  // there gives. What is gated is the chip: a `tel:` link to nobody is worse than none.
  const salesPhone = normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')

  return (
    <div
      // `status`, not `alert`. This is the state of the screen the reader just opened,
      // not something that happened while they were on it, and `alert` would interrupt
      // a screen reader on every single navigation.
      role="status"
      className="mb-5 rounded-xl border-2 border-late/40 bg-late/5 px-4 py-3 print:hidden"
    >
      <p className="font-semibold text-late">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>

      {/* The one fact that turns a general complaint into something a customer can
          check against their own bKash history, and the figure it is checked against
          differs with the cause: a date on a coverage centre, two amounts on a balance
          one. Only when that cause is what put the banner here — on a cancelled account
          either would read as a receipt. */}
      {/*
        THE FIGURES ARE THE OWNER'S AND THE MANAGER'S. A teacher needs to know that saving
        has stopped — the sentence above says exactly that, in words — and has no business
        knowing what the centre holds or what a day costs it: `/settings/billing` is
        `pageRole('manager')` for the same reason, and the strip above the content is gated
        the same way. `canSeePlan` is that gate under this banner's own name.
      */}
      {money ? (
        canSeePlan && (
          <p className="mt-1 text-sm text-ink-soft">
            {t.balanceOut(money.cost, money.balance)}
          </p>
        )
      ) : (
        coveredTo && <p className="mt-1 text-sm text-ink-soft">{t.coveredTo(coveredTo)}</p>
      )}

      {(canSeePlan || salesPhone) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Owners and managers only, because /settings/billing is pageRole('manager') —
              offering a teacher a tab that answers with a 403 is worse than offering
              them nothing, and there is nothing for them to do here anyway. */}
          {canSeePlan && (
            <LinkButton href="/settings/billing" variant="tinted">
              {t.seePlan}
            </LinkButton>
          )}
          {salesPhone && (
            <a
              // The digits are printed rather than hidden behind the word, for the
              // reason the plan screen's own call chip gives: `tel:` opens nothing on a
              // laptop, and a number that can be read off the screen and dialled by
              // hand works on anything.
              href={`tel:${salesPhone}`}
              // An external anchor, not a route: `buttonClass` is the shared half, and
              // `LinkButton` is for the app's own pages.
              className={buttonClass('secondary')}
            >
              {t.callUs}
              <span className="num ml-1">{formatBdMobile(salesPhone)}</span>
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The fortnight of Teacher Pro a new signup gets, and the week after it ends.
 * MASTERPLAN.md §2.2.
 *
 * A SEPARATE BANNER FROM `ReadOnlyBanner` AND A DIFFERENT COLOUR, because it is a
 * different kind of fact. Read-only is a bill; this is either a gift with a date on it
 * or an explanation of why printing a receipt stopped working. Merging them would put
 * "settle the bill" in front of somebody who has never been billed.
 *
 * GREEN WHILE IT RUNS, AMBER ON THE LAST DAY AND AFTER. The colour changes exactly when
 * the sentence does, so there is one threshold in here and not two.
 */
function TrialBanner({
  standing,
  locale,
  t,
  canSeePlan,
}: {
  standing: TrialStanding
  locale: Locale
  t: Dictionary['trialNotice']
  canSeePlan: boolean
}) {
  const ending = standing.state === 'ended' || standing.daysLeft === 0
  const tier = planName(standing.plan, locale)
  const day = formatDate(
    standing.state === 'ended' ? standing.endedOn : standing.endsOn,
    locale,
  )

  return (
    <div
      // `status` for the same reason the read-only banner uses it: this is the state of
      // the screen as opened, not an event, and `alert` would interrupt a screen reader
      // on every navigation for a fortnight.
      role="status"      className={`mb-5 rounded-xl border px-4 py-3 print:hidden ${
        ending ? 'border-late/40 bg-late/5' : 'border-brand-200 bg-brand-50 shadow-sm'
      }`}>
      <p className={`font-semibold ${ending ? 'text-late' : 'text-brand-800'}`}>
        {standing.state === 'ended'
          ? t.endedTitle(tier)
          : standing.daysLeft === 0
            ? t.lastDayTitle(tier)
            : t.runningTitle(tier, standing.daysLeft)}
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        {standing.state === 'ended' ? t.endedBody(day) : t.runningBody(tier, day)}
      </p>

      {/* Owners and managers only — /settings/billing is pageRole('manager'), and a
          teacher offered a tab that answers 403 is worse off than one offered nothing.
          No sales chip here: unlike a lapse, nothing is broken and nobody needs to be
          rung today. */}
      {canSeePlan && (
        <div className="mt-3">
          {/* White while the card is green, or the button's fill would match the card it
              sits on and all that is left of it is a border — which is why the variant is
              `tinted` and the fill is the one thing overridden. */}
          <LinkButton
            href="/settings/billing"
            variant="tinted"
            className={ending ? '' : 'bg-white hover:bg-white'}
          >
            {t.keep(tier)}
          </LinkButton>
        </div>
      )}
    </div>
  )
}

/**
 * The desktop sidebar: the centre at the top, the menu in the middle, the account at
 * the foot.
 *
 * WHY IT HOLDS EVERYTHING THE PHONE HEADER HELD. The header and this are alternatives,
 * not layers — running both on a laptop would put the centre's name and the account
 * circle on screen twice. So every control from the header is in here, and the header
 * is `lg:hidden`. Nothing was dropped in the move: logo, centre switcher, account,
 * language, log out.
 *
 * `sticky top-0 h-screen` and not `fixed`, so the workspace beside it needs no left
 * margin to compensate and no magic number to keep in step with `w-64`. The nav is the
 * part that scrolls, because a reader with four centres and nine rows on a 720p laptop
 * is a real reader and the account block at the foot is the thing they must not lose.
 *
 * `print:hidden`, like the header and the bars. A receipt crosses a desk to a parent
 * and a register gets filed; neither wants a menu down the left of it.
 */
function Sidebar({
  session,
  sections,
  rows,
  t,
}: {
  session: Session
  /** Already resolved and already narrowed by role, plan and permission — see `navFor`. */
  sections: NavSection[]
  /** How many rows there are across all of them, for the one-destination case below. */
  rows: number
  t: Dictionary['shell']
}) {
  return (
    <aside
      className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r
        border-line bg-white lg:flex print:hidden"
    >
      <div className="border-b border-line px-4 py-4">
        <Logo className="text-base" />
        <CenterName session={session} t={t} />
      </div>

      {/* One destination is not a menu. A student or guardian has exactly one, and a
          sidebar drawing a single highlighted row is answering a question they never
          asked — the same reason the bottom bar has always hidden itself for them. */}
      {rows > 1 && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <SideNav sections={sections} label={t.mainMenu} lockedLabel={t.locked} />
        </div>
      )}

      {/* mt-auto so the account block sits at the foot whether or not there is a menu
          above it, and without the menu having to be a flex-1 that is sometimes absent. */}
      {/* The account block, finished: the reader's own corner of the sidebar.
          A soft surface instead of bare rows is what makes it read as a place
          rather than the list's leftovers — and it is still rows of 44px+. */}
      <div className="mt-auto border-t border-line p-2">
        <Link
          href="/account"
          className="flex min-h-tap items-center gap-3 rounded-xl px-2
            text-sm text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
        >
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full
              bg-brand-50 text-sm font-semibold text-brand-700"
          >
            {initialFor(session)}
          </span>
          {/* The name, not just a letter. There is room for it here, and on a shared
              office laptop "whose account is this" is the question the circle on the
              phone header can only hint at. */}
          <span className="min-w-0 flex-1 truncate font-medium text-ink">
            {greetingFor(session)}
          </span>
        </Link>

        <div className="mt-1 flex items-center justify-between gap-1 px-1">
          <LanguageSwitch locale={session.locale} />
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
      </div>
    </aside>
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
  const d = dict(session.locale)
  const t = d.shell

  // The rows the table above cannot decide on its own, because they turn on a plan
  // feature or on one of the six capability boxes rather than on a role. Each is asked
  // with the same call the screen guards itself with, so a menu row and its screen can
  // never disagree — see `navFor`.
  const items: NavItem[] = await navFor(session, role)

  /*
   * The labels resolved once, here, for both layouts.
   *
   * `NavItem.label` is a dictionary key so a table entry naming a string that does not
   * exist fails the build; `NavEntry.label` is the sentence, because the bars are client
   * components and a client component gets no dictionary — see the note in app-nav.tsx.
   * Doing it once is also what stops the sidebar and the tab bar wording a row
   * differently.
   *
   * `group` rides along so the sections below can be cut without pairing two arrays up
   * by index. It is a string or nothing, so it crosses into the client component the
   * same way the label does.
   *
   * `locked` is where `needs` is finally asked — once per row, against the plan the
   * session already carries, so a locked row costs the same nothing an open one does.
   * `has` is the plan's own predicate, the same call the screen behind the row makes to
   * decide whether to draw its work or the card that sells the tier holding it.
   */
  const entries = items.map((item) => ({
    href: item.href,
    icon: item.icon,
    label: t.nav[item.label],
    group: item.group,
    locked: item.needs !== undefined && !has(session.plan, item.needs),
  }))

  /*
   * The same rows, cut into the sidebar's groups.
   *
   * The unheaded group goes first and empty groups are dropped — a heading with nothing
   * under it is what a narrowed manager would otherwise get where their fee and spending
   * rows used to be.
   */
  const sections: NavSection[] = [
    { label: null, items: entries.filter((entry) => entry.group === undefined) },
    ...NAV_GROUPS.map((group) => ({
      label: t.navGroups[group],
      items: entries.filter((entry) => entry.group === group),
    })),
  ].filter((section) => section.items.length > 0)

  /* Four tabs and a sheet, or every row and no sheet. See `splitForPhone`. */
  const { tabs, more } = splitForPhone(entries)

  /*
   * A lapsed or cancelled subscription, which the banner below explains and
   * `requireWritable` is what actually refuses. See MASTERPLAN.md §4.4.
   *
   * `session.active` IS CHECKED FIRST AND IS NOT BELT-AND-BRACES. `access` is
   * `read_only` for a reader with no centre as well, because entitlement has nothing to
   * judge and fails closed — so without this an account midway through onboarding would
   * be told its centre's plan had run out, about a centre it has not made yet. The
   * layout redirects that reader to /onboarding, but Next's own docs are explicit that
   * a layout does not re-run on every navigation, and the shell is not the place to
   * rely on it having.
   *
   * THE WHOLE MEMBERSHIP RATHER THAN ITS STATUS, because since §4.4's lapse the status
   * no longer tells the banner everything: an `active` centre reaches read-only by
   * running past its grace window, and the date that happened is the sentence worth
   * reading. `status === 'active'` here IS that derivation and needs no fourth enum
   * value — nothing else in the app can make an active centre read-only, which is why
   * `Entitlement` still refuses to carry a reason. Same trick as the trial notice: ask
   * the row, not the entitlement.
   */
  const readOnly = session.active && session.access === 'read_only' ? session.active : null
  const lapsed = readOnly?.status === 'active' ? readOnly.paidThrough : null

  /*
   * Whether the *balance* is what stopped the writing, and the two figures that say so
   * (MASTERPLAN.md §4.4).
   *
   * ASKED OF THE STANDING AND NOT OF THE STATUS, which is the one thing this banner had
   * to learn when coverage stopped gating anything: a lapsed centre is still `active`, so
   * the status column cannot tell the money apart from a hand suspension. `billing.lapsed`
   * is the balance comparison itself — the same one `access` was resolved from, off the
   * same call, so the sentence and the refusal can never describe different money.
   *
   * NULL WHEN THE RATE IS UNKNOWN, and then the plan sentence is drawn instead: a banner
   * that says "a day costs nothing" because a head count failed would be worse than the
   * general words it replaces.
   */
  const cost =
    session.billing.dailyRatePoisha !== null
      ? formatTaka(session.billing.dailyRatePoisha / 100)
      : null
  const money =
    readOnly && session.billing.lapsed && cost
      ? { cost, balance: formatTaka((session.billing.balancePoisha ?? 0) / 100) }
      : null

  /*
   * The money strip (§4.4, §3.7's ladder): what is in the balance and how many more days it
   * covers, on EVERY screen.
   *
   * IT USED TO BE A FOURTEEN-DAY COUNTDOWN, drawn only once the money was nearly out, and
   * that was the wrong question asked late. What an owner reaches for before they spend
   * anything is what they hold today — and it was two taps away, behind Settings and then
   * Billing, on a screen they had to remember to open (§20.4 answers "how much is left"
   * second, and this is the same figure moved out of the drawer). The day count stays
   * because it is the honest unit once the money is theirs (§17 — "price in months, burn in
   * days"), and it is what turns amber inside three days, where it used to simply appear.
   *
   * OWNERS AND MANAGERS ONLY, because they are the only ones who can do anything about
   * it — `/settings/billing` is `pageRole('manager')`, and a countdown a teacher cannot act
   * on is a daily worry with no button on it. Not at all while the read-only banner is up:
   * that banner already says the balance is out, and repeating it above itself would be two
   * versions of one fact.
   *
   * NOT SHOWN ON A FREE TIER, because `daysLeft` is null there — there is no rate to
   * divide by and nothing to run out of.
   */
  const canTopUp = Boolean(readOnly === null && atLeast(role, 'manager'))
  const daysLeft = session.billing.daysLeft
  const balancePoisha = session.billing.balancePoisha
  const rail = canTopUp && daysLeft !== null ? daysLeft : null

  /*
   * THE LINE IS AHEAD OF TODAY, WHICH IS A GRANT AND NOT A PAYMENT.
   *
   * `charged_through` is the last day the centre is covered for. A founder's grant of
   * days moves it forward without touching the balance (§11.7 — a grant is days, not
   * fake money), so a centre can hold a real balance with its line two months out while
   * the burn charges nothing. That is correct: there is no day left to buy.
   *
   * The billing screen has said so since the granted-days pass, in `billing.leftGranted`.
   * The strip did not, and it is the surface an owner reads on every screen without
   * opening anything — so a balance that never moves looked like broken billing rather
   * than a centre waiting. The count below is still the money's own count, because that
   * is what the balance buys *after* the granted days; this is the sentence that says
   * which of the two states the reader is in.
   *
   * Two Dhaka days compared as strings, which is chronological order for `YYYY-MM-DD` —
   * the same comparison the billing page makes for its own `aheadTo`.
   */
  const grantedTo =
    canTopUp &&
    session.billing.chargedThrough !== null &&
    session.billing.today !== null &&
    session.billing.chargedThrough > session.billing.today
      ? session.billing.chargedThrough
      : null

  /**
   * Inside three days the strip turns amber, which is §3.7's first rung.
   *
   * NOT WHILE GRANTED DAYS CARRY THE LINE: amber is a warning that the money is about to
   * run out, and a centre being carried by a grant has nothing running out yet. Colouring
   * it would be the false alarm the billing screen's own sentence exists to avoid.
   */
  const railLow = rail !== null && grantedTo === null && rail <= 3

  /**
   * The strip's one sentence, with the amount leading it when there is one to lead with.
   *
   * ONE LINE AND NOT TWO. This is furniture above every screen in the product, and two
   * lines of it on a 375px phone is a paragraph the reader scrolls past before their own
   * content begins. A balance that could not be read is left out rather than drawn as
   * ৳0 — an unread figure is not an empty one (§11.7).
   */
  const daysLine =
    grantedTo !== null
      ? t.balanceGranted(formatDate(grantedTo, session.locale))
      : rail === null
        ? null
        : rail === 0
          ? t.balanceEmpty
          : t.balanceDays(rail)
  const heldLine =
    daysLine === null
      ? null
      : balancePoisha === null
        ? daysLine
        : `${t.balanceHeld(formatTaka(balancePoisha / 100))} · ${daysLine}`

  /*
   * The trial notice, asked of the row rather than of the entitlement — `Entitlement`
   * cannot say a plan came from a trial, on purpose, and `entitlement.ts` explains at
   * length why this screen is the one exception that gets to ask the question directly.
   *
   * NOT WHILE THE READ-ONLY BANNER IS UP. One ask per screen: "keep Teacher Pro" beside
   * "settle the bill" is two buttons competing for the same phone call, and the bill
   * wins. Nothing is lost by holding it back — a read-only centre cannot use the
   * features the trial is selling either way.
   *
   * The look-back is `TRIAL_NOTICE_DAYS` and lives in `entitlement.ts` beside the trial
   * rules, not here: a fortnight-old explanation is history, and a banner that never
   * leaves is furniture.
   */
  const standing = readOnly
    ? null
    : trialStanding(session.active ? billingOf(session.active) : null)
  const trial =
    standing && (standing.state === 'running' || standing.daysSince <= TRIAL_NOTICE_DAYS)
      ? standing
      : null

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/*
       * THE FIRST THING IN THE DOCUMENT AND THE FIRST THING TAB REACHES. Without it a
       * keyboard reader pays for the navigation on every screen — eleven sidebar rows on a
       * laptop, three header controls on a phone — before they reach the content they came
       * for, and that tax is paid again after every link. The sidebar is drawn before the
       * workspace in the DOM (it is the first column), so there is no other place to put
       * this and no reordering that would let the content come first without breaking the
       * visual order at `lg`.
       *
       * A PLAIN ANCHOR AND NOT A CLIENT COMPONENT: the browser's own fragment jump moves
       * focus to the target because `main` is focusable (`tabIndex={-1}`), and nothing here
       * needs JavaScript, a provider or a render. `sr-only` until focused, then a real
       * button-shaped chip in the top-left corner — `focus:not-sr-only` is what makes it
       * visible rather than merely focusable.
       *
       * Hidden on paper: a print shop does not need a skip link above a receipt.
       */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50
          focus:rounded-xl focus:border-2 focus:border-brand-600 focus:bg-white
          focus:px-4 focus:py-3 focus:font-semibold focus:text-ink focus:shadow-lg
          print:hidden"
      >
        {t.skipToContent}
      </a>

      <Sidebar session={session} sections={sections} rows={entries.length} t={t} />

      {/* min-w-0 so a wide table inside the workspace scrolls itself instead of
          stretching the flex row and pushing the sidebar off the left edge. */}
      <div className="flex min-h-full flex-1 flex-col lg:min-w-0">
        {/* print:hidden on both the header and the bar below. A receipt is handed
            across a desk and a register is filed, and neither wants a logout button
            or four tab icons on it — the sticky header would also reprint at the top
            of every sheet. What the paper needs instead is the centre's name, which
            each of those pages prints for itself as a letterhead.

            lg:hidden because the sidebar holds all of it from that width up. */}
        <header
          className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur
            lg:hidden print:hidden"
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Logo className="text-base" />
              <CenterName session={session} t={t} />
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/*
                One letter in a circle, not a third labelled button. The right-hand
                cluster already holds two words, and a 320px screen has no room for a
                third before the centre's name starts losing characters — so the entry
                point to /account is the smallest control that can still be tapped,
                with its name given to the screen reader instead of to the layout.

                It also answers a question the header never used to: whose account is
                signed in on this shared phone. The letter is the first character of
                the greeting, which is the name if there is one and the number if
                there is not.
              */}                <Link
                href="/account"
                aria-label={t.account}
                title={t.account}
                // 48px of tappable box around a 36px circle: `--spacing-tap` is the
                // size this product measures a thumb by, and the circle stays small so
                // a 320px header can hold three controls and the centre's name.
                className="group grid h-12 w-12 shrink-0 place-items-center"
              >
                <span
                  aria-hidden
                  className="grid h-9 w-9 place-items-center rounded-full
                    bg-brand-50 text-sm font-semibold text-brand-700
                    group-hover:bg-brand-100"
                >
                  {initialFor(session)}
                </span>
              </Link>

              <LanguageSwitch locale={session.locale} />

              <form action={signOut}>
                <button
                  type="submit"
                  // `min-h-tap` and not padding guesses: the words are what a thumb aims
                  // at, and a 34px-tall button is under the line this whole design is
                  // measured against. The header has room — the logo block beside it is
                  // already taller than 48px — so this costs no height.
                  className="min-h-tap rounded-lg px-3 py-2 text-sm font-medium
                    text-ink-soft hover:bg-surface-alt hover:text-ink"
                >
                  {t.logout}
                </button>
              </form>
            </div>
          </div>
        </header>

        {/* pb-24 clears the fixed bottom bar; without it the last row of any
            list sits permanently under the nav and looks like a rendering bug. There
            is no bar from `lg` up, so the padding comes back off there.

            max-w-3xl is the phone's column and stays the phone's column. From `lg`
            the ceiling goes to 7xl — wide enough that a fee board shows a month of
            columns without a horizontal scroll, bounded so that on a 27" monitor a
            line of Bangla prose is still a line and not a strip.

            On paper there is no bar and no column to centre in, so all of it comes
            off: @page owns the margins, and max-w-3xl left standing would waste a
            third of an A4 sheet the register wants for its columns. */}
        <main
          // The skip link's target. `tabIndex={-1}` is what lets a fragment jump move
          // focus here rather than only scrolling to it, which is the difference between
          // a keyboard reader landing on the screen and landing back where they were.
          id="content"
          tabIndex={-1}
          // `scroll-mt-16` on a phone, because the header above this is sticky and 64px
          // tall: without it the skip link lands with the first heading under it. Zero
          // from `lg`, where that header is gone and the page bar sticks inside main.
          className="mx-auto w-full max-w-3xl flex-1 scroll-mt-16 px-4 py-5 pb-24
            lg:max-w-7xl lg:scroll-mt-0 lg:px-8 lg:py-8 lg:pb-8
            print:max-w-none print:px-0 print:py-0 print:pb-0"
        >
          {readOnly && (
            <ReadOnlyBanner
              status={readOnly.status}
              coveredTo={lapsed ? formatDate(lapsed, session.locale) : null}
              money={money}
              t={d.readOnly}
              canSeePlan={atLeast(role, 'manager')}
            />
          )}
          {heldLine !== null && (
            <div
              role="status"
              className={`mb-5 flex flex-wrap items-center justify-between gap-2
                rounded-xl border px-4 py-3 print:hidden shadow-sm ${
                  railLow ? 'border-late/40 bg-late/5' : 'border-line bg-white'
                }`}
            >
              <p className={`text-sm font-medium ${railLow ? 'text-late' : 'text-ink-soft'}`}>
                {heldLine}
              </p>
              {/*
                The countdown's own door, and it leads to the screen that answers it:
                /settings/billing is the balance, the rate and the recharge (§20.4). The
                plan screen is still where a tier is bought; what a dry balance needs is
                the top-up, and that is here.
              */}
              <LinkButton href="/settings/billing" variant="tinted" className="text-sm">
                {t.balanceTopUp}
              </LinkButton>
            </div>
          )}
          {trial && (
            <TrialBanner
              standing={trial}
              locale={session.locale}
              t={d.trialNotice}
              canSeePlan={atLeast(role, 'manager')}
            />
          )}
          {children}
        </main>

        {entries.length > 1 && (
          <TabBar
            items={tabs}
            more={more}
            label={t.mainMenu}
            moreLabel={t.more}
            lockedLabel={t.locked}
          />
        )}
      </div>
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

/**
 * The single letter in the header's account link.
 *
 * Taken off the greeting rather than the name alone, so an account with no name on it
 * still gets a letter — the first digit of its number — instead of an empty circle.
 * `Array.from` rather than `[0]`: a Bangla name is inside the BMP and would index
 * fine, but an emoji in a name would come apart into half a surrogate pair, and a
 * broken glyph in the header on every screen is a poor trade for one character.
 */
function initialFor(session: Session): string {
  return Array.from(greetingFor(session))[0] ?? '•'
}
