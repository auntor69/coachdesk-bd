import Link from 'next/link'
import { forbidden } from 'next/navigation'

import { Card } from '@/components/ui'
import { getSession, isStaffAdmin, pageCenter } from '@/lib/auth/session'
import { formatDate, todayInDhaka } from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { PER_CLASS_BASIS } from '@/lib/payroll/basis'
import { billRows, tallyBill, withoutTerms, type Payee } from '@/lib/payroll/bill'
import { has, planName, PLANS } from '@/lib/plans'
import { jobTitle } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import { TermsForm } from './terms-form'
import { TermsRow } from './terms-row'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
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
 */
export default async function PayrollPage() {
  const session = await pageCenter()
  if (!isStaffAdmin(session)) forbidden()

  const locale = session.locale
  const d = dict(locale)
  const t = d.payroll

  // Before the query, like the spending screen's own plan branch: this return draws
  // none of the bill, so reading it would be work for a screen that cannot show it.
  if (!has(session.plan, 'centerWideReporting')) {
    return (
      <div className="flex flex-col gap-4">
        <BackToFees label={t.backToFees} />
        <Card>
          <h1 className="font-semibold text-ink">{t.lockedTitle}</h1>
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
        <BackToFees label={t.backToFees} />
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <Card className="border-late/30 bg-late/5">
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
   * count at the foot says how many; this puts them where a thumb lands.
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
   * Whether this centre may write, answered once for the form and for every row's stop
   * verb. `requireWritable` is in front of both actions and is the check that counts; this
   * is so a lapsed subscription is learned from the sentence the shell is already showing
   * rather than from a confirm dialog that refuses. A read-only centre keeps the whole
   * bill — the figures are what they need to decide whether to renew.
   */
  const canWrite = session.access === 'full'

  return (
    <div className="flex flex-col gap-4">
      <BackToFees label={t.backToFees} />

      <header>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="text-sm text-ink-soft">{t.subtitle}</p>
      </header>

      {/*
        THE WAY THROUGH TO A MONTH, and the two screens are not the same question. What is
        agreed here is a standing figure with no month attached and no money moved; the
        profit line subtracts `salary_payments`, which is what that screen writes. An owner
        who agreed fourteen figures and never opened it has a wage bill on paper and a
        payroll term of zero in every month's profit.

        Above the form on purpose: agreeing a salary is what a centre does twice a year, and
        paying one is what it does every month. No `?month=` — that screen opens on this
        month by itself, and a link carrying one would go stale in a bookmark. Not gated on
        `canWrite`: a read-only centre can read the month, and the figures are part of what
        they need to decide whether to renew.
      */}
      <Link
        href="/payroll/pay"
        className="inline-flex min-h-tap items-center font-medium text-brand-800 underline"
      >
        {t.payLink} →
      </Link>

      {/* A read-only centre keeps the bill and loses the form, the same call the
          spending screen makes: `requireWritable` is in front of the action, and a form
          that submits into a refusal is a worse way to learn the subscription lapsed
          than the sentence the shell is already showing. */}
      {canWrite && (
        <Card>
          <TermsForm
            people={pickable}
            bases={t.bases}
            t={d.salaryForm}
            common={d.common}
            // Computed here, once, on the server: a client component that read the
            // clock would render one date on the server and another in the browser for
            // six hours out of every twenty-four. See ExpenseForm's own note.
            today={todayInDhaka()}
          />
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <p className="text-ink-soft">{t.empty}</p>
        </Card>
      ) : (
        <>
          <h2 className="font-medium text-ink">{t.billTitle}</h2>

          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
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
                canWrite={canWrite}
                t={d.salaryRow}
              />
            ))}
          </ul>

          {/*
            The figures at the foot, and every one of them is either what the total
            covers or what it does not. `tallyBill` returns five numbers instead of one
            because a bill of four monthly agreements and two per-class ones has a total
            over four of its six rows, and an owner has to be able to see that here.
          */}
          <section className="rounded-xl border border-line bg-white p-4">
            {tally.monthlyCount > 0 ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="font-medium text-ink">
                  {t.monthlyTotal}
                  <span className="ml-2 text-sm font-normal text-ink-soft">
                    {t.monthlyCount(tally.monthlyCount)}
                  </span>
                </dt>
                <dd className="num font-bold text-ink">{formatTaka(tally.monthly)}</dd>
              </div>
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

            {/* The one thing on this page that is a fault rather than a fact, so it is
                the one thing drawn in the warning colour. Words as well as colour: these
                screens are read on cheap phones in bad light. */}
            {tally.goneCount > 0 && (
              <div className="mt-3 rounded-lg border border-late/30 bg-late/5 p-3">
                <p className="font-medium text-ink">{t.goneCount(tally.goneCount)}</p>
                <p className="mt-1 text-sm text-ink-soft">{t.goneNote}</p>
              </div>
            )}
          </section>
        </>
      )}

      {/*
        WHO HAS BEEN MISSED, which is the question this screen is actually opened with the
        first time. The bill cannot ask it: an absent row looks like an absent person.
        Drawn under the bill rather than above it, because on a centre's first visit the
        bill is empty and this list is the whole screen, and on every later visit the bill
        is what they came for.
      */}
      {missing.length > 0 && (
        <section className="rounded-xl border border-dashed border-line bg-surface-alt p-4">
          <h2 className="font-medium text-ink">{t.missingTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.missingBody}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {missing.map((p) => (
              <li key={`${p.kind}:${p.id}`} className="text-sm text-ink">
                {p.name}
                <span className="ml-2 text-ink-faint">{p.job ?? t.teacherJob}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The way back, in one place because the locked branch and the screen both need it. */
function BackToFees({ label }: { label: string }) {
  return (
    <Link
      href="/fees"
      className="inline-flex min-h-tap items-center font-medium text-brand-700"
    >
      ← {label}
    </Link>
  )
}
