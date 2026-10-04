import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { Th, Td } from '@/components/table'
import { getSession, pageCapability } from '@/lib/auth/session'
import {
  addMonths,
  currentPeriodMonth,
  formatDate,
  formatMonth,
  todayInDhaka,
} from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { PER_CLASS_BASIS } from '@/lib/payroll/basis'
import { payeeValue, type Payee } from '@/lib/payroll/bill'
import { payLines, tallyMonth, voucherLines } from '@/lib/payroll/month'
import { has, planName, PLANS } from '@/lib/plans'
import { jobTitle } from '@/lib/staff/roles'
import { pageAll, worstFailure } from '@/lib/supabase/page'
import { createClient } from '@/lib/supabase/server'
import { PayRow, type RowFigure } from './pay-row'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).payrollPay.title} — CoachDesk`,
  }
}

/**
 * One line each, not a concatenation — see the note on the fee board's own COLUMNS for
 * what splitting these across two lines does to type inference. Every column of the two
 * source-row types, because those are what the tested arithmetic takes.
 */
const TERMS_COLUMNS =
  'id, employee_id, teacher_id, basis, basic_bdt, allowances_bdt, other_bdt, deductions_bdt, net_bdt, per_class_bdt, effective_from, note'

const PAYMENT_COLUMNS =
  'id, voucher_no, employee_id, teacher_id, amount_bdt, method, reference, note, paid_at'

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/**
 * A month's salaries: who has had what, who is still owed, and the voucher register.
 *
 * THE THIRD TERM OF THE PROFIT LINE, ON A SCREEN. §9.8 is `collected − expenses −
 * payroll`, and `center_profit_month` (20260811000049) takes that last term from
 * `salary_payments` grouped by `for_month`. /payroll records what a centre has agreed to
 * pay, which is a standing figure with no month attached and no money moved; until this
 * screen existed the payroll term was structurally zero, and an owner reading
 * `collected − rent` as their profit was being told they had made money they had not.
 *
 * A SEPARATE ROUTE FROM /payroll AND NOT A `?month=` BRANCH ON IT, matching /fees →
 * /fees/register. An agreement is one row per person that changes twice a year; a payment
 * belongs to a month and there may be several. The two screens ask different questions of
 * the same people, and a single page answering both would have two month pickers on it —
 * one of which did nothing.
 *
 * WHAT STOPS SOMEBODY BEING PAID TWICE IS THIS PAGE AND THE ACTION, IN THAT ORDER.
 * 20260811000044 deliberately has no unique index on (payee, for_month): half a salary on
 * the 5th and half on the 20th is two real rows, and a reversing correction is a third. So
 * the database will not refuse a second payment, and every row prints paid, agreed and left
 * *before* its form opens — which is what tells an owner what is already on the record.
 * Since the audit of 2026-10-04 the form is no longer the only guard: a payment that would
 * take the month past the agreed figure is refused by ./actions.ts until the form carries
 * an explicit tick, which is why the rows below hand `needsRepeat` down to the form. The
 * other half of the problem — one tap arriving twice — is the idempotency token, and
 * 20260811000051 is the index behind it.
 *
 * THE JOIN IS DONE IN TYPESCRIPT, as on /payroll and for the same reason: 20260811000005
 * replaced every simple foreign key with one on (sibling_id, coaching_center_id), so both
 * of these tables reach `employees` and `teachers` through composite keys that PostgREST
 * cannot disambiguate. An embed answers PGRST201 and the screen renders empty. Both staff
 * lists are read anyway to name the payees, so naming one costs a map lookup.
 *
 * STAFF ADMIN ONLY, matching `salary_payments_staff_admin_read` and the write policy beside
 * it. There is deliberately no teacher policy on this table at all, not even for their own
 * rows: their own figure needs a payslip screen, which would be the reason to open one.
 *
 * THREE BLOCKS AND NOT ONE COLUMN. A phone reads what the month came to, then the people,
 * then the register. A laptop puts the people in eight columns beside the figures in four,
 * with the register full width under both — it is 36rem before it wraps and eight of twelve
 * columns is 461px at `lg`. Neither column needs /payroll's `contents` wrapper: each holds
 * exactly one block, so its own `order-N lg:order-N` is enough. The figures are written
 * before the people because `order` moves neither the keyboard nor a screen reader, and
 * every control on this screen is in the people column.
 */
export default async function PayrollPayPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ month?: string }>
}) {
  const session = await pageCapability('payroll')

  const locale = session.locale
  const d = dict(locale)
  const t = d.payrollPay

  /** The way out, in one place because both endings of this screen need it. */
  const back = { href: '/payroll' as const, label: t.backToTerms }

  // Before the query, like the spending screen's own plan branch: this return draws none
  // of the month, so reading it would be work for a screen that cannot show it.
  if (!has(session.plan, 'centerWideReporting')) {
    return (
      // One column, and the cap on the card rather than the column: there is one thing to
      // read here, and an 8/4 split with an empty rail beside it is most of a laptop
      // screen saying nothing.
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

  const { month: rawMonth } = await searchParams
  // An unparseable month is this month rather than an error: the parameter arrives from a
  // URL somebody may have edited, and the picker below only offers real ones.
  const month = MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : currentPeriodMonth()

  const supabase = await createClient()
  const centerId = session.active.centerId

  /*
   * Four reads, none of them embedded, all four scoped on the centre as well as governed
   * by RLS — the roster's argument: an owner of two centres passes `is_staff_admin` for
   * both, so the policies alone would draw the other centre's payroll under a switcher
   * saying this one.
   *
   * ONE `eq` AND NO DATE WINDOW, which is the whole difference from the fee register and
   * from the spending screen. `for_month` is a `date` pinned to the first of the month by
   * a check constraint, so the month is an equality rather than a half-open range — and
   * there is no timestamptz to push across a Dhaka midnight. `paid_at` is not filtered on
   * at all: December's salary handed over in January is December's cost, and grouping by
   * the day the money moved is what would make every January read as a disaster.
   *
   * Live agreements only, and everybody on both staff lists whether active or not, both
   * for the reasons /payroll gives. No paging on those three — at most one live agreement
   * per person, and a centre with a thousand people on its payroll is not a coaching
   * centre — but the payments are paged, because that is a row per person per instalment
   * and the 1000-row ceiling is silent.
   */
  const [{ data: terms }, { data: employees }, { data: teachers }, paid] = await Promise.all([
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
    pageAll((from, to) =>
      supabase
        .from('salary_payments')
        .select(PAYMENT_COLUMNS)
        .eq('coaching_center_id', centerId)
        .eq('for_month', month)
        // Newest first, and the voucher number breaks a tie: two salaries handed over in
        // the same second are ordered by the slip in somebody's hand. `id` last so paging
        // is deterministic — without it the ceiling can drop and repeat a row.
        .order('paid_at', { ascending: false })
        .order('voucher_no', { ascending: false })
        .order('id')
        .range(from, to),
    ),
  ])

  /*
   * FAILING CLOSED ON ANY OF THE FOUR, in one card, and the payments read is the dangerous
   * one. Drawn as an empty month it would put "nothing paid yet" beside every agreement on
   * a screen whose next tap hands over money — so an owner would pay a salary that is
   * already on the record, and `salary_payments` revokes DELETE. A dropped staff list is
   * the /payroll fault: rows with no names. A dropped `salary_terms` read would draw the
   * month as if nobody were owed anything.
   */
  const problem =
    worstFailure(paid) ??
    (terms === null || employees === null || teachers === null ? 'unreadable' : null)

  const payments = 'rows' in paid ? paid.rows : null

  /*
   * The two tables as one list of payees, kinds and all, exactly as /payroll builds it.
   * The kind travels with every id because these two tables share no namespace: a map
   * keyed on the bare uuid would hand a cook's salary to a teacher the first time two ids
   * collided.
   */
  const people: Payee[] = [
    ...(employees ?? []).map((e) => ({
      id: e.id,
      kind: 'employee' as const,
      name: e.name,
      job: jobTitle(e.role, e.designation, d.settings.staff.roles),
      active: e.active,
    })),
    ...(teachers ?? []).map((x) => ({
      id: x.id,
      kind: 'teacher' as const,
      name: x.name,
      job: null,
      active: x.active,
    })),
  ]

  /*
   * STILL OWED FIRST, then by name — and this is a different sort from /payroll's, which
   * puts somebody who has left at the top. There, an unstopped agreement belonging to
   * somebody who left is the one fault on the page. Here the actionable row is whoever has
   * not been paid: that is what the screen is opened to do something about, and a thumb
   * should land on it without scrolling past fourteen settled names.
   */
  const rows = payLines(terms, payments, people).sort(
    (a, b) =>
      Number(b.pending) - Number(a.pending) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'bn-BD'),
  )

  const tally = tallyMonth(rows)
  const vouchers = voucherLines(payments, people)

  // This month and the eleven before it. Backwards only: a salary for a month that has not
  // come yet is cost filed into a profit line that is not due, and the action refuses a
  // future month for the same reason.
  const months = Array.from({ length: 12 }, (_, i) => {
    const value = addMonths(currentPeriodMonth(), -i)
    return { value, label: formatMonth(value, locale) }
  })

  /*
   * Whether this centre may write, answered once for every row's form. `requireWritable`
   * is in front of the action and is the check that counts; this is so a lapsed
   * subscription is learned from the sentence the shell is already showing rather than
   * from a form that submits into a refusal. A read-only centre keeps the whole month —
   * the figures are what they need to decide whether to renew.
   */
  const canWrite = session.access === 'full'

  /**
   * Whether there is a month to draw at all, asked once because the answer now places three
   * separate blocks rather than one branch of one ternary: the figures in the rail, the
   * people in the column beside them, and the voucher register under both.
   */
  const showMonth = problem === null && rows.length > 0

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t.title}
        back={back}
        subtitle={t.subtitle}
        /* The month being read, in the bar's own slot for it — the spending screen's shape.
           A plain GET form: no client component, and the month ends up in a URL that can be
           bookmarked or shared. The button is not decoration — Android Chrome fires no
           navigation on a bare <select> change.

           Label-less with an `aria-label`, because the select already says "August 2026" in
           the reader's own script and the bar is one line deep. */
        actions={
          <form method="get" className="flex items-center gap-2">
            <select
              name="month"
              aria-label={t.month}
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
              className="min-h-tap shrink-0 rounded-xl border-2 border-brand-500
                bg-brand-50 px-4 font-medium text-brand-800"
            >
              {t.show}
            </button>
          </form>
        }
      />

      {/* One column on a phone, then eight of the people beside four of what the month comes
          to, with the register full width under both — it is 36rem before it wraps and eight
          of twelve columns is 461px at `lg`. Neither column needs the `contents` trick the
          bill uses: each holds exactly one block, so its own `order` is enough to place it.

          Nested under the bar rather than holding it as a twelfth-column cell: a sticky box
          only travels inside its containing block, and a grid cell's block is one grid
          row. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        {/*
          THE FIGURES ABOVE THE PEOPLE ON A PHONE AND BESIDE THEM ON A LAPTOP, which is the
          change on this screen: they used to be under the last card, so an owner scrolled past
          fourteen settled names to learn whether the month was finished. Written before the
          people in the DOM and moved to the right by `order`, the rule the bill follows too —
          and nothing in here is focusable, so the DOM order costs a keyboard nothing.

          Every figure is either what the total covers or what it does not. `tallyMonth`
          returns nine numbers instead of one because a month can be over its agreed figure and
          still have somebody unpaid.
        */}
        {showMonth && (
          <section
            className="order-3 rounded-xl border border-line bg-white p-4 lg:order-4
              lg:col-span-4"
          >
            <h2 className="font-medium text-ink-soft">{t.paidTotal}</h2>
            <p className="num text-3xl font-bold text-ink">{formatTaka(tally.paid)}</p>
            <p className="text-sm text-ink-faint">{t.entries(tally.payments)}</p>

            {tally.pendingCount > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                {/* Shortfalls only, never `agreed − paid`: a teacher overpaid by ৳2,000 would
                    otherwise cancel a cook who has had nothing, and the screen would say the
                    month is settled while somebody is still waiting for their salary. */}
                {tally.outstanding > 0 ? (
                  <>
                    <h3 className="font-medium text-ink-soft">{t.outstandingTotal}</h3>
                    <p className="num text-xl font-bold text-ink">
                      {formatTaka(tally.outstanding)}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {t.pendingCount(tally.pendingCount)}
                    </p>
                  </>
                ) : (
                  /* Somebody is waiting and no figure can be put on it: every row still owed
                     something is per-class, or has no agreement behind it at all. */
                  <p className="font-medium text-ink">{t.pendingCount(tally.pendingCount)}</p>
                )}
              </div>
            ) : (
              <p className="mt-3 border-t border-line pt-3 font-medium text-ink">{t.allPaid}</p>
            )}

            {/* What the total does not cover, said out loud rather than folded in, and each
                line only when there is any of it: in a month with no per-class teachers these
                would be zeroes and a sentence about nothing. */}
            <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
              {tally.monthlyCount > 0 && (
                <p className="text-ink-soft">
                  {t.agreedTotal}{' '}
                  <span className="num font-semibold text-ink">
                    {formatTaka(tally.agreed)}
                  </span>
                </p>
              )}
              {tally.perClassCount > 0 && (
                <p className="text-ink-soft">{t.perClassCount(tally.perClassCount)}</p>
              )}
              {tally.unagreedCount > 0 && (
                <p className="text-ink-soft">{t.unagreedCount(tally.unagreedCount)}</p>
              )}
            </div>

            {/* Not a warning: nothing is wrong. What it prevents is an owner wondering why the
                dashboard's profit for this month moved when they paid a salary for last month,
                and writing the next one against the wrong month to make the figures agree. */}
            <p className="mt-3 text-sm text-ink-soft">{t.profitNote}</p>
          </section>
        )}

        <div className="order-4 flex flex-col gap-3 lg:order-3 lg:col-span-8">
          {problem !== null ? (
            /* Nothing drawn, not even a zero: every figure in the rail would be a claim about
               what the centre has paid its people, and we did not read it. */
            <Card className="border-late/30 bg-late/5">
              <p className="font-medium text-ink">
                {problem === 'tooLarge' ? t.tooLarge : t.unreadable}
              </p>
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <p className="text-ink-soft">{t.empty}</p>
            </Card>
          ) : (
            <>
              <h2 className="font-medium text-ink">{t.peopleTitle}</h2>

              {/* One card to a row and never two abreast, unlike the bill's: this card carries
                  three labelled figures and, behind a tap, a form with four money boxes in it.
                  Half of eight columns is 219px at `lg`, narrower than the phone that form was
                  drawn for. */}
              <ul className="flex flex-col gap-2">
                {rows.map((row) => {
                  const perClass = row.terms?.basis === PER_CLASS_BASIS

                  /*
                   * Whether the form the reader is about to open offers the confirmation
                   * tick ./actions.ts asks for. True for every monthly row that already
                   * has money on the month — the one case a further payment can take
                   * somebody past their agreement — and false for a first payment, for a
                   * per-class rate and for a row that has already been corrected back to
                   * nothing. It is a hint and never the fence: the action reads the same
                   * facts for itself and refuses the overshoot with or without this flag.
                   */
                  const needsRepeat = row.payments > 0 && row.remaining !== null

                  /*
                   * The three figures, built here because two of the three take an argument
                   * and `T` maps a function leaf to `never`. A per-class row's "agreed" is a
                   * rate and says so in words: ৳350 printed where the row above prints
                   * ৳13,000 is a teacher who looks very cheap. A row with no live agreement
                   * gets no agreed figure at all rather than a zero, and `hint` says why.
                   */
                  const figures: RowFigure[] = []
                  if (row.terms !== null) {
                    figures.push({
                      label: t.agreedLabel,
                      value: perClass
                        ? row.terms.perClass === null
                          ? '—'
                          : t.perClassRate(formatTaka(row.terms.perClass))
                        : formatTaka(row.terms.net),
                    })
                  }
                  figures.push({ label: t.paidLabel, value: formatTaka(row.paid) })
                  if (row.remaining !== null) {
                    figures.push({ label: t.leftLabel, value: formatTaka(row.remaining) })
                  }

                  /*
                   * The short line under the figures, joined here. Nothing paid is the state
                   * that needs saying out loud; past that, an overpayment and a settled month
                   * are different words for a remainder that is not positive, and how many
                   * rows the money came in is the fact that stops a third payment.
                   */
                  const flags: string[] = []
                  if (row.payments === 0) {
                    flags.push(t.notPaidYet)
                  } else {
                    if (row.remaining !== null && row.remaining < 0) {
                      flags.push(t.overpaid(formatTaka(-row.remaining)))
                    } else if (row.remaining === 0) {
                      flags.push(t.settled)
                    }
                    if (row.payments > 1) flags.push(t.paidTimes(row.payments))
                  }

                  return (
                    <PayRow
                      key={payeeValue(row.payeeKind, row.payeeId)}
                      payee={payeeValue(row.payeeKind, row.payeeId)}
                      forMonth={month}
                      // `unknownName` and not `common.unknown`, which is what /payroll's row
                      // uses: the register below prints the same person, and two different
                      // words for one missing name on one screen is worse than this screen
                      // differing from its sibling.
                      name={row.name ?? t.unknownName}
                      job={row.job ?? d.payroll.teacherJob}
                      gone={row.gone}
                      offLabel={d.payroll.inactive}
                      figures={figures}
                      // Why there is no "left" figure on this row, which is the one thing a
                      // reader would otherwise take for a rendering fault.
                      hint={
                        row.terms === null ? t.noTermsHint : perClass ? t.perClassLine : null
                      }
                      flag={flags.length > 0 ? flags.join(' · ') : null}
                      // Four boxes only where there is a monthly agreement to prefill them
                      // from. A per-class teacher gets one, because what the month cost is
                      // not knowable from here and four empty boxes are four questions.
                      parts={row.terms !== null && !perClass ? row.terms.parts : null}
                      needsRepeat={needsRepeat}
                      canWrite={canWrite}
                      methods={d.feeRow.methods}
                      t={d.salaryPayForm}
                      common={d.common}
                    />
                  )
                })}
              </ul>
            </>
          )}
        </div>

        {/*
          THE REGISTER, which is the other half of the guard against paying twice: a row
          printing "paid ৳13,000" does not say when, how, or under which voucher, and an owner
          checking whether they have already paid somebody wants the slip number. A table and
          not cards, like the spending screen's — six facts, no verb.

          FULL WIDTH AND UNDER BOTH COLUMNS, because it is 36rem before it wraps and eight of
          twelve columns is 461px at `lg`. Its foot no longer repeats what the month has cost:
          that figure is in the rail now, and two renderings of one number is one that can
          disagree with itself.
        */}
        {showMonth && (
          <div className="order-5 flex flex-col gap-3 lg:col-span-12">
            <h2 className="font-medium text-ink">{t.registerTitle}</h2>

            {vouchers.length === 0 ? (
              <Card>
                <p className="text-ink-soft">{t.registerEmpty}</p>
              </Card>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
                <table className="w-full min-w-[36rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-line text-left align-bottom">
                      {/* The name first, which is the one place this table departs from the
                          spending register's column order. There the first question is when
                          the money went; here every row is for the same month and the
                          question is whether this person has been paid. */}
                      <Th>{t.colName}</Th>
                      <Th num>{t.colVoucher}</Th>
                      <Th>{t.colWhen}</Th>
                      <Th>{t.colMethod}</Th>
                      <Th>{t.colNote}</Th>
                      <Th num right>
                        {t.colAmount}
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {vouchers.map((v) => (
                      <tr key={v.id} className="border-b border-line align-top">
                        <Td>
                          {v.name ?? t.unknownName}
                          {v.job && <span className="block text-ink-faint">{v.job}</span>}
                        </Td>
                        {/* The voucher number is the way to the payslip, and this is the
                            only way in: the pay action answers with a finished sentence and
                            no id, and every voucher of the month is already here. */}
                        <Td num>
                          <Link
                            href={`/payroll/payslip/${v.id}`}
                            className="font-medium text-brand-700 underline"
                          >
                            {v.voucherNo}
                          </Link>
                        </Td>
                        {/* The Dhaka calendar day, not the raw timestamp: `paid_at` comes
                            back in UTC, and 1 September at 2am there is 31 August here. */}
                        <Td num>{formatDate(todayInDhaka(new Date(v.paidAt)), locale)}</Td>
                        <Td>
                          {d.feeRow.methods[v.method]}
                          {v.reference && (
                            <span className="num ml-1.5 text-ink-faint">{v.reference}</span>
                          )}
                        </Td>
                        <Td>{v.note ?? '—'}</Td>
                        <Td num right>
                          {/* The word above the figure, not beside it, so a narrow column
                              cannot push it off the end. Words and not a colour: one minus
                              sign in a column of right-aligned figures that all look like it
                              is not a distinction anybody makes on a cheap phone. */}
                          {v.correction && (
                            <span className="block font-medium text-ink-soft">
                              {t.correctionLabel}
                            </span>
                          )}
                          {formatTaka(v.amount)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
