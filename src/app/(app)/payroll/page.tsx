import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { SearchBox, SearchEmpty } from '@/components/search-box'
import { Card, LinkButton } from '@/components/ui'
import { getSession, pageCapability } from '@/lib/auth/session'
import { formatDate, todayInDhaka } from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { PER_CLASS_BASIS } from '@/lib/payroll/basis'
import { billRows, payeeValue, tallyBill, withoutTerms, type Payee } from '@/lib/payroll/bill'
import { has, planName, PLANS } from '@/lib/plans'
import { matchesSearch, searchTerms } from '@/lib/search'
import { can } from '@/lib/staff/capabilities'
import { EMPLOYEE_ROLES, jobTitle } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import { TermsForm } from './terms-form'
import { TermsRow } from './terms-row'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).payroll.title} — CoachDesk` }
}

/**
 * One line, not a concatenation — see the note on the fee board's own COLUMNS for what
 * splitting this across two lines does to type inference. Every column of
 * `TermsSourceRow`, because that type is what the tested arithmetic takes.
 */
const TERMS_COLUMNS =
  'id, employee_id, teacher_id, basis, basic_bdt, allowances_bdt, other_bdt, deductions_bdt, net_bdt, per_class_bdt, effective_from, note'

/**
 * What the centre has agreed to pay its people, and what that comes to every month.
 *
 * THE THIRD TERM OF THE PROFIT LINE. §9.8 is `collected − expenses − payroll`, and
 * `center_profit_month` (20260811000049) takes the last term from `salary_payments` rather
 * than from the salary expense category. But a payment screen with nothing behind it is a
 * form that asks an owner what they pay their teacher every single month, so the agreement
 * comes first and the payment screen is prefilled from it. Until this page existed the
 * payroll term was structurally zero and the profit line was collections minus rent.
 *
 * A LIST OF CARDS AND NOT A TABLE, unlike the spending screen next door. Each line here
 * carries seven facts — who, what job, which basis, the figure, since when, a note, and
 * whether they have left — plus a verb that needs a sentence beside it before it is tapped.
 * The spending table carries six facts and no verb. A sentence does not fit a `<td>`, and a
 * `tfoot` total would sit under rows it does not include.
 *
 * THE JOIN IS DONE IN TYPESCRIPT. 20260811000005 replaced every simple foreign key with one
 * on (sibling_id, coaching_center_id), and `salary_terms` reaches two tables that way at
 * once; an embed PostgREST cannot disambiguate answers PGRST201 and this screen renders
 * empty. Both staff lists are read anyway — they fill the picker and they answer "who have
 * we missed" — so naming a payee costs a map lookup over a few dozen people.
 *
 * WHICH PLAN GATES IT: `centerWideReporting`, not `staffManagement`, and ./actions.ts
 * argues why at length. They are true together on every plan that has either, so the choice
 * is invisible today; if they diverge, gating on staff management would let a plan show
 * expenses and the profit line while hiding the wage bill.
 *
 * STAFF ADMIN ONLY, matching `salary_terms_staff_admin_read`. There is deliberately no
 * teacher policy on that table at all, not even for their own row: what a colleague is paid
 * is not something we hand a teacher, and their own figure needs a payslip screen to open a
 * policy for.
 *
 * AND `payroll` (§6.2), which the read is narrowed by as well as the write — so a manager
 * whose owner unticked it would get an empty list, and an empty list here means a centre
 * that pays nobody. `pageCapability` is the same 403 the rank check was, one call.
 */
export default async function PayrollPage({
  searchParams,
}: {
  /**
   * Whose salary the form should open on — `employee:<id>` or `teacher:<id>`, from a row
   * on the bill or from the list of people with no agreement.
   *
   * In the URL rather than in client state, for the reason SearchBox gives about its own
   * query: it survives a reload, a back button and the offline cache, and it needs no
   * JavaScript to work at all. Validated against the people this page is actually offering
   * below, so a hand-typed id is ignored rather than answered with a selection that is not
   * in the list.
   */
  searchParams: Promise<{ payee?: string; q?: string }>
}) {
  const session = await pageCapability('payroll')

  const locale = session.locale
  const d = dict(locale)
  const t = d.payroll

  /** The way out, in one place because all three endings of this screen need it. */
  const back = { href: '/fees' as const, label: t.backToFees }

  // Before the query, like the spending screen's own plan branch: this return draws
  // none of the bill, so reading it would be work for a screen that cannot show it.
  if (!has(session.plan, 'centerWideReporting')) {
    return (
      // One column, and the cap on the card rather than the column: there is one thing to
      // read here, and a 7/5 split with an empty rail beside it is most of a laptop screen
      // saying nothing.
      <div className="flex flex-col gap-4">
        <PageHeader title={t.title} back={back} />
        <Card className="max-w-2xl">
          {/* An h2, because the bar above owns the h1 now. */}
          <h2 className="font-semibold text-ink">{t.lockedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(planName(session.plan, locale), planName(PLANS.center, locale))}
          </p>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()
  const centerId = session.active.centerId

  /*
   * Three reads, none of them embedded, all three scoped on the centre as well as
   * governed by RLS — the roster's argument: an owner of two centres passes
   * `is_staff_admin` for both, so the policies alone would draw the other centre's wage
   * bill under a switcher saying this one.
   *
   * Live agreements only. The retired rows are the history that makes last April's
   * salary explicable, and this screen is about what the centre pays now; a partial
   * unique index means there is at most one live row per person, so the bill cannot
   * print somebody twice.
   *
   * Everybody on both staff lists, active or not, because the bill has to be able to
   * name the payee of an agreement belonging to somebody who has since left — that row
   * is the one this screen exists to flag.
   *
   * No pageAll: at most one live agreement per person, and a centre with more than a
   * thousand people on its payroll is not a coaching centre. Ordering is left to the
   * sort below, which is the only place that can see a name.
   */
  const [{ data: terms }, { data: employees }, { data: teachers }] = await Promise.all([
    supabase
      .from('salary_terms')
      .select(TERMS_COLUMNS)
      .eq('coaching_center_id', centerId)
      .eq('active', true),
    supabase
      .from('employees')
      .select('id, name, role, designation, active')
      .eq('coaching_center_id', centerId),
    supabase
      .from('teachers')
      .select('id, name, active')
      .eq('coaching_center_id', centerId),
  ])

  /*
   * FAILING CLOSED ON ANY OF THE THREE, and each one for its own reason. A dropped
   * `salary_terms` read drawn as an empty bill is "nobody is paid anything" under a form,
   * so the owner's next move is to agree a figure that is already agreed — and the
   * trigger would retire the real one to make room for it. A dropped staff list is worse
   * in the other direction: the bill would print rows with no names, and the list of
   * people still to be recorded would be empty, which reads as "you are finished".
   */
  if (terms === null || employees === null || teachers === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t.title} back={back} />
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  /*
   * The two tables as one list of payees, kinds and all. The kind travels with every id
   * because these two tables share no namespace: a map keyed on the bare uuid would hand
   * a cook's salary to a teacher the first time two ids collided.
   *
   * A teacher's `job` is null on purpose — teaching is the job, and the row prints the
   * word rather than leaving the line blank. An employee's is the centre's own word for
   * it or the role's, decided in one place by `jobTitle`.
   */
  const people: Payee[] = [
    ...employees.map((e) => ({
      id: e.id,
      kind: 'employee' as const,
      name: e.name,
      job: jobTitle(e.role, e.designation, d.settings.staff.roles),
      active: e.active,
    })),
    ...teachers.map((x) => ({
      id: x.id,
      kind: 'teacher' as const,
      name: x.name,
      job: null,
      active: x.active,
    })),
  ]

  /*
   * GONE FIRST, then by name, and this is the opposite of what the staff list does with
   * the same flag. There, somebody who has left is history and sinks to the bottom so
   * fourteen ex-employees do not bury the cook who is here today. Here their agreement is
   * still live and still in the total: it is the one row on the page with something to be
   * done about it, and a flag in the middle of twenty cards does not say which one. The
   * count in the rail says how many; this puts them where a thumb lands.
   */
  const rows = billRows(terms, people).sort(
    (a, b) =>
      Number(b.gone) - Number(a.gone) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'bn-BD'),
  )

  const tally = tallyBill(rows)

  // Active people only, by name: somebody who left and was never given terms is not an
  // omission. See `withoutTerms`.
  const missing = withoutTerms(people, rows).sort((a, b) =>
    a.name.localeCompare(b.name, 'bn-BD'),
  )

  // The picker offers the people a centre could agree a figure with today, which is not
  // the same list as the one the bill draws: somebody who has left keeps their line and
  // must not be selectable, because the action refuses them anyway and a form that
  // submits into a refusal is a worse way to learn it than an absent option.
  const pickable = people
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'bn-BD'))

  /*
   * `?payee=` PICKED UP HERE, against the same list the picker is drawn from.
   *
   * A row on the bill and a name in the "nobody has agreed a salary" list both link back
   * to this page with the person's value, which is the whole of what those two taps do —
   * the alternative was finding the form again and picking a name out of twenty, and the
   * question an owner arrives with is almost always about somebody they were just
   * looking at. Somebody who has left is not `pickable` and so is not offered by a URL
   * either, exactly as they are not offered by the select.
   */
  const { payee: wantedPayee, q: rawQuery } = await searchParams
  const defaultPayee =
    typeof wantedPayee === 'string' &&
    pickable.some((p) => payeeValue(p.kind, p.id) === wantedPayee)
      ? wantedPayee
      : ''

  /*
   * THE BOX THAT FINDS ONE AGREEMENT IN TWENTY, which is what this screen is opened for.
   * Every other long list in the product has one — the fee board, the register, the exams
   * list, the roster, the weekly list — and the wage bill was the odd one out: a centre pays
   * fourteen people and an owner looking for one of them was reading fourteen cards. It
   * matters more here than on those, because the question is usually "what does she earn"
   * or "give her a rise", asked about a name somebody already has in mind.
   *
   * IT FILTERS THE LIST AND NOTHING ELSE, the fee board's own rule and the reason
   * `lib/search.ts` matches in memory: the total in the rail, the count of monthly
   * agreements and the warning about somebody who has left are all computed from the
   * unfiltered rows. An owner typing a name is asking which row is hers, not asking the
   * centre's wage bill to become hers.
   *
   * Two lists narrow, because two lists answer the same question about the same people:
   * the bill, and the people with nothing agreed yet. `?payee=` is not one of the box's
   * `keep` values on purpose: choosing a person is the form's job, and a search that left
   * the last pick behind would open the form on somebody the reader is no longer looking
   * at.
   */
  const query = typeof rawQuery === 'string' ? rawQuery : ''
  // `words` and not `terms`: this page already has one of those, and it is the live salary
  // agreements the bill is built from.
  const words = searchTerms(query)

  const shown =
    words.length === 0
      ? rows
      : rows.filter((row) => matchesSearch([row.name, row.job, row.note], words))

  const shownMissing =
    words.length === 0
      ? missing
      : missing.filter((p) => matchesSearch([p.name, p.job], words))

  /*
   * Whether this centre may write, answered once for the form and for every row's stop
   * verb. `requireWritable` is in front of both actions and is the check that counts; this
   * is so a lapsed subscription is learned from the sentence the shell is already showing
   * rather than from a confirm dialog that refuses. A read-only centre keeps the whole
   * bill — the figures are what they need to decide whether to renew.
   */
  const canWrite = session.access === 'full'

  /*
   * Whether the form may write a person as well as an agreement, answered here so the field
   * exists only where it could work. Two gates, both re-checked in the action: `staff`
   * (§6.2 — the policies on `employees` are staff-admin's), and the centre plan's staff
   * management, which is what buys the staff screen at all.
   */
  const canHire =
    canWrite && can(session.active.capabilities, 'staff') && has(session.plan, 'staffManagement')

  // Whether the centre has ever written down a teacher. Read from the list already in hand
  // — a centre that pays nobody through a teacher row is exactly the centre the form's
  // "this adds staff, not teachers" note is for.
  const noTeachers = (teachers ?? []).length === 0

  // The fourteen jobs, labelled once for the form's one picker. Same list and same order as
  // the staff screen's own, because it is the same column behind both.
  const roles = EMPLOYEE_ROLES.map((role) => ({
    value: role,
    label: d.settings.staff.roles[role],
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t.title}
        back={back}
        subtitle={t.subtitle}
        /*
         * THE WAY THROUGH TO A MONTH, and the two screens are not the same question. What
         * is agreed here is a standing figure with no month attached and no money moved;
         * the profit line subtracts `salary_payments`, which is what that screen writes.
         * An owner who agreed fourteen figures and never opened it has a wage bill on
         * paper and a payroll term of zero in every month's profit.
         *
         * A door and not an underlined line of text, and in the bar rather than adrift
         * above the form: agreeing a salary is what a centre does twice a year, and paying
         * one is what it does every month, so the monthly errand is the one that gets the
         * button — and in the bar it stays on screen while the bill scrolls. No `?month=`
         * — that screen opens on this month by itself, and a link carrying one would go
         * stale in a bookmark. Not gated on `canWrite`: a read-only centre can read the
         * month, and the figures are part of what they need to decide whether to renew.
         */
        actions={
          <LinkButton href="/payroll/pay" variant="tinted">
            {t.payLink} →
          </LinkButton>
        }
      />

      {/* One column on a phone, then seven of the bill beside five of everything that is
          not the bill — the fee board's split, for the same reason: the rail holds a form.
          `lg` and not the spending screen's `xl`, because the rows here are cards rather
          than a 36rem table, so a narrow column wraps a card instead of scrolling a table
          sideways.

          Nested under the bar rather than holding it as a twelfth-column cell: a sticky
          box only travels inside its containing block, and a grid cell's block is one grid
          row. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        {/* The rail, written before the bill because `order` moves nothing for a keyboard or
            a screen reader and this column holds the form. What it carries, top to bottom: the
            figure the bill comes to, the form that adds to it, and the people it has missed. */}
        <div className="contents lg:order-3 lg:col-span-5 lg:flex lg:flex-col lg:gap-4">
          {/*
            THE FIGURES ABOVE THE ROWS ON A PHONE AND BESIDE THEM ON A LAPTOP, which is the
            change on this screen: this section used to be under the cards, so a centre with
            twenty agreements scrolled past all twenty to reach what they add up to. Every
            figure in it is either what the total covers or what it does not — `tallyBill`
            returns five numbers instead of one because a bill of four monthly agreements and
            two per-class ones has a total over four of its six rows.

            `rows.length` tested here as well as below rather than one ternary wrapping both:
            the bill and its total are in different columns now, and a ternary cannot span two.
          */}
          {rows.length > 0 && (
            <section className="order-3 rounded-xl border border-line bg-white p-4">
              {tally.monthlyCount > 0 ? (
                <>
                  <h2 className="font-medium text-ink-soft">{t.monthlyTotal}</h2>
                  <p className="num text-3xl font-bold text-ink">{formatTaka(tally.monthly)}</p>
                  <p className="text-sm text-ink-faint">{t.monthlyCount(tally.monthlyCount)}</p>
                </>
              ) : (
                /* Not a ৳0 total. Every row here is per-class, and zero over teachers who
                   are certainly paid something is a figure an owner would stop and check
                   for nothing. */
                <p className="text-ink-soft">{t.noMonthly}</p>
              )}

              {/* Only when there is any, like the spending screen's deferred lines: in a
                  bill with no per-class agreements these two would be a zero and a
                  paragraph about nothing. */}
              {tally.perClassCount > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="font-medium text-ink">
                    {t.perClassCount(tally.perClassCount)}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">{t.perClassNote}</p>
                </div>
              )}

              {/* The one thing on this page that is a fault rather than a fact, so it is the
                  one thing drawn in the warning colour. A rule and coloured words rather than
                  a tinted box: a bordered panel inside a bordered section is the nested
                  container §20.7 forbids, and the colour is doing the work either way.
                  Words as well as colour — these screens are read in bad light. */}
              {tally.goneCount > 0 && (
                <div className="mt-3 border-t border-late/40 pt-3">
                  <p className="font-medium text-late">{t.goneCount(tally.goneCount)}</p>
                  <p className="mt-1 text-sm text-ink-soft">{t.goneNote}</p>
                </div>
              )}
            </section>
          )}

          {/* A read-only centre keeps the bill and loses the form, the same call the
              spending screen makes: `requireWritable` is in front of the action, and a form
              that submits into a refusal is a worse way to learn the subscription lapsed
              than the sentence the shell is already showing. */}
          {canWrite && (
            // `id` is the anchor the two links into this form land on. Below `lg` the
            // rail's blocks are in `order` and the form is not the first of them, so a tap
            // on a name at the foot of the page would otherwise leave the reader at the
            // top of a page they have to scroll again.
            //
            // And keyed on the person it opens on, because `useState` in a client
            // component reads its initial value once — a soft navigation from one row to
            // another re-renders this with a new `defaultPayee` and the picker would keep
            // showing the last person it was given.
            <Card className="order-4 scroll-mt-4" id="agree">
              <TermsForm
                key={defaultPayee || 'none'}
                people={pickable}
                bases={t.bases}
                roles={roles}
                canHire={canHire}
                noTeachers={noTeachers}
                defaultPayee={defaultPayee}
                t={d.salaryForm}
                common={d.common}
                // Computed here, once, on the server: a client component that read the
                // clock would render one date on the server and another in the browser for
                // six hours out of every twenty-four. See ExpenseForm's own note.
                today={todayInDhaka()}
              />
            </Card>
          )}

          {/*
            WHO HAS BEEN MISSED, which is the question this screen is actually opened with the
            first time. The bill cannot ask it: an absent row looks like an absent person.
            Last in the rail and last on a phone, because on a centre's first visit the bill is
            empty and this list is most of the screen, and on every later visit the bill is
            what they came for.
          */}
          {shownMissing.length > 0 && (
            <section
              className="order-6 rounded-xl border border-dashed border-line bg-surface-alt
                p-4"
            >
              <h2 className="font-medium text-ink">{t.missingTitle}</h2>
              <p className="mt-1 text-sm text-ink-soft">{t.missingBody}</p>
              {/* Every name is the way to agree it. This list exists to answer "who have we
                  missed", and until it was tappable the answer it gave was a name the owner
                  then had to find again in a picker of twenty, above them on a phone. One
                  tap now opens the form on that person — the same `?payee=` the bill's rows
                  use. */}
              <ul className="mt-2 flex flex-col">
                {shownMissing.map((p) => (
                  <li key={`${p.kind}:${p.id}`}>
                    <Link
                      href={`/payroll?payee=${payeeValue(p.kind, p.id)}#agree`}
                      className="flex min-h-tap items-center justify-between gap-3 text-sm
                        text-ink hover:text-brand-800"
                    >
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-ink-faint">
                        {p.job ?? t.teacherJob} →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="contents lg:order-2 lg:col-span-7 lg:flex lg:flex-col lg:gap-4">
          {/* One ordered block and a ternary inside it: the bill is either a centre with no
              agreements yet or a list of them, and both land in the same place. */}
          <div className="order-5 flex flex-col gap-3">
            {rows.length === 0 ? (
              // The sentence and, under it, the way to stop it being true. This card is the
              // whole of the main column on a centre's first visit, and it used to be a
              // fact with nothing to press — on a phone the form it describes is above
              // the fold by then, and on a laptop it is the column beside it.
              <Card>
                <p className="text-ink-soft">{t.empty}</p>
                {canWrite && (
                  <Link
                    href="/payroll#agree"
                    className="mt-3 inline-flex min-h-tap items-center font-medium
                      text-brand-800 underline underline-offset-4 hover:text-brand-900"
                  >
                    {t.emptyDoor} →
                  </Link>
                )}
              </Card>
            ) : (
              <>
                <h2 className="font-medium text-ink">{t.billTitle}</h2>

                {/* Under the heading rather than above it, unlike the other lists: here the
                    heading names what the cards are, and the box filters them. On the fee
                    board the box is the whole control surface and there is no heading over
                    the rows at all. */}
                <SearchBox
                  q={query}
                  t={d.search}
                  count={{ shown: shown.length, total: rows.length }}
                />

                {/* Two cards abreast wherever there is room for two, one where there is not.
                    Each card is a name, a figure, a line of small print and a verb — a shape
                    that wastes two thirds of its width on a wide row, and a centre with twenty
                    agreements was scrolling all twenty. The middle step back to one column is
                    not fussiness: from `lg` this column is 401px, and half of that is narrower
                    than the phone the card was drawn for. */}
                {shown.length === 0 ? (
                  /* Not `t.empty`, which is a fact about the centre. "No salary has been
                     agreed with anybody yet" under a filtered bill is the app telling an
                     owner their payroll is empty because they typed a name wrong — the
                     same trap SearchEmpty exists for on the board. */
                  <SearchEmpty t={d.search} />
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {shown.map((row) => (
                      <TermsRow
                        key={row.termsId}
                        termsId={row.termsId}
                        name={row.name ?? d.common.unknown}
                        job={row.job ?? t.teacherJob}
                        gone={row.gone}
                        offLabel={t.inactive}
                        // The figure the row prints, built here because both shapes of it take
                        // an argument and `T` maps a function leaf to `never`. A per-class row
                        // shows a rate and says so in words: ৳350 printed where the row above
                        // prints ৳13,000 is a teacher who looks very cheap.
                        figure={
                          row.basis === PER_CLASS_BASIS
                            ? row.perClass === null
                              ? '—'
                              : t.perClassRate(formatTaka(row.perClass))
                            : formatTaka(row.net)
                        }
                        // How the salary is worked out and the day it began, joined here the way
                        // the staff list joins its own small print: `since` takes an argument, so
                        // the row cannot be handed the words to build it for itself. The basis is
                        // in the faint line rather than beside the figure — under a per-class
                        // figure that already says "per class" it would be the same word twice.
                        meta={`${t.bases[row.basis]} · ${t.since(formatDate(row.since, locale))}`}
                        note={row.note}
                        // The way to a raise, with the person already chosen. Null for somebody
                        // who has left: the form refuses them and does not offer them, so a
                        // link that lands on an empty picker would be a door into a wall.
                        changeTo={row.gone ? null : payeeValue(row.payeeKind, row.payeeId)}
                        canWrite={canWrite}
                        t={d.salaryRow}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
