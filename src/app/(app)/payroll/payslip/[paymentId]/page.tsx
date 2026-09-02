import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { getSession, pageCapability } from '@/lib/auth/session'
import { formatDate, formatMonth, todayInDhaka } from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE, type Dictionary, type Locale } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { monthUpTo, slipBreakdown, type SlipBreakdown } from '@/lib/payroll/slip'
import { has, planName, PLANS } from '@/lib/plans'
import { jobTitle } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import type { PaymentMethod } from '@/lib/supabase/types'
import { PrintButton } from '../../../fees/print-button'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).payslip.title} — CoachDesk`,
  }
}

/** One line, not a concatenation — see the fee board's own COLUMNS on type inference. */
const SLIP_COLUMNS =
  'id, voucher_no, employee_id, teacher_id, for_month, basic_bdt, allowances_bdt, other_bdt, deductions_bdt, amount_bdt, method, reference, note, paid_at, branch_id'

/**
 * One salary, as a piece of paper. §9.9's second printable, and the one 20260811000044
 * has been pointing at since it was written.
 *
 * THE BREAKDOWN IS THE ROW'S OWN AND NOT THE AGREEMENT'S, which is that migration's
 * decision and the reason this screen can exist at all: `salary_payments` copies basic,
 * allowances, other and deductions onto every payment instead of joining `salary_terms`,
 * "because terms change, and a payslip printed in March has to still read in December".
 * Nothing on this sheet reads the live agreement. A raise in April cannot rewrite the slip
 * for February.
 *
 * TWO COPIES ON ONE SHEET, employee and office, split by a cut line — the fee receipt's
 * layout and the layout of every voucher book in a Bangladeshi stationery shop. On screen
 * only the first is drawn: both would be the same slip twice, which reads as a rendering
 * bug. The second appears when the sheet does.
 *
 * TWO SIGNATURES, which is the one place this differs in kind from a fee receipt rather
 * than in direction. A fee slip is signed by whoever took the cash. Here the office copy
 * carries the employee's signature, and that is the centre's only record that the salary
 * actually left the building — there is no column that can hold it.
 *
 * STAFF ADMIN ONLY, matching `salary_payments_staff_admin_read`, and it stays that way. A
 * teacher cannot read this table at all — not even their own vouchers — and 20260811000044
 * §4 argues at length that widening the policy is not the same act as building a screen.
 * This page is the paper an owner prints and hands over, so it needs nothing widened.
 *
 * THE SAME PLAN GATE AS /payroll AND /payroll/pay, and only that one. `centerWideReporting`
 * is true on no plan where `printedReceipts` is false, so a second check would be a branch
 * nobody can reach; the sentence is the sibling screens' own, because it is the same gate
 * and the same purchase.
 *
 * A miss is notFound() rather than a 403, the exam page's reason: RLS decides what is
 * visible, and refusing another centre's voucher id by name would confirm the id exists.
 */
export default async function PayslipPage({
  params,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  params: Promise<{ paymentId: string }>
}) {
  const { paymentId } = await params
  const session = await pageCapability('payroll')

  const locale = session.locale
  const d = dict(locale)
  const t = d.payslip

  // Before the query, like both sibling screens: this return draws none of the slip.
  if (!has(session.plan, 'centerWideReporting')) {
    return (
      <div className="flex flex-col gap-4">
        <BackToMonth label={t.backToMonth} />
        <Card>
          <h1 className="font-semibold text-ink">{d.payrollPay.lockedTitle}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {d.payrollPay.lockedBody(
              planName(session.plan, locale),
              planName(PLANS.center, locale),
            )}
          </p>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()
  const centerId = session.active.centerId

  const { data: payment, error: paymentError } = await supabase
    .from('salary_payments')
    .select(SLIP_COLUMNS)
    .eq('coaching_center_id', centerId)
    .eq('id', paymentId)
    .maybeSingle()

  /*
   * The read that failed, ahead of the 404, and on this table it costs cash the way the fee
   * receipt's own does. `salary_payments` revokes DELETE, so a voucher that appears to have
   * vanished is the app appearing to break a promise it cannot break — and what an owner
   * does next is hand the salary over again, onto a table with no unique index to stop them.
   * So the refusal says the payment is saved before it says anything else.
   */
  if (paymentError) {
    return (
      <div className="flex flex-col gap-4">
        <BackToMonth label={t.backToMonth} />
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  if (!payment) notFound()

  /*
   * Which of the two people tables the payee is in. `salary_payments_one_payee` is a check
   * constraint, so exactly one column is set and the third case cannot exist — notFound()
   * rather than a card, because a row shaped like that is not a state the reader can act on.
   * Narrowing here is also what lets the read below pass a `string` rather than a `?? ''`
   * that Postgres would refuse as a malformed uuid.
   */
  const payee = payment.employee_id
    ? ({ kind: 'employee', id: payment.employee_id } as const)
    : payment.teacher_id
      ? ({ kind: 'teacher', id: payment.teacher_id } as const)
      : null
  if (payee === null) notFound()

  const amount = Number(payment.amount_bdt)
  /** A reversing row: the only way 20260811000044 allows a mistake to be undone. */
  const isReversal = amount < 0
  /** Unsigned on the paper. The words say which way it went; see the dictionary. */
  const shown = Math.abs(amount)

  const branchId = payment.branch_id

  const [{ data: center }, employeeRow, teacherRow, branchRow, { data: siblings }] =
    await Promise.all([
      // The letterhead. The app shell's header is print:hidden, so this is the only thing on
      // the sheet that says which centre paid the money.
      supabase
        .from('coaching_centers')
        .select('name, phone, address')
        .eq('id', centerId)
        .maybeSingle(),
      /*
       * Whose slip it is, out of whichever of the two people tables holds them. Two slots
       * rather than one ternary, and that is a type problem rather than a style one: a
       * conditional between two reads collapses to the narrower row shape by subtype
       * reduction, so `role` and `designation` were quietly not there. Only one of these
       * ever runs — the other is the constraint saying it cannot.
       */
      payee.kind === 'employee'
        ? supabase
            .from('employees')
            .select('name, role, designation')
            .eq('coaching_center_id', centerId)
            .eq('id', payee.id)
            .maybeSingle()
        : null,
      payee.kind === 'teacher'
        ? supabase
            .from('teachers')
            .select('name')
            .eq('coaching_center_id', centerId)
            .eq('id', payee.id)
            .maybeSingle()
        : null,
      /*
       * Which building paid it, from the snapshot 20260811000052 stamps — not from the payee's
       * branch today, which is the whole point of that column: "a payslip stays in the building
       * that paid it and July's follows them across". Closed branches included, deliberately,
       * because a slip reprinted after a building shuts still happened there, and
       * `branchChoicesFor` filters on `active` and would drop the line.
       */
      branchId === null
        ? null
        : supabase
            .from('branches')
            .select('name')
            .eq('coaching_center_id', centerId)
            .eq('id', branchId)
            .maybeSingle(),
      /*
       * Every voucher for this person and this month, for the as-of total. Cheap: the partial
       * index `salary_payments_employee_idx` on (employee_id, for_month desc) was created for
       * this screen. Two chains again rather than one `.eq(column, id)`, which would type the
       * filter's value as `never`; both select the same columns, so nothing is lost this time.
       */
      payee.kind === 'employee'
        ? supabase
            .from('salary_payments')
            .select('voucher_no, amount_bdt, paid_at')
            .eq('coaching_center_id', centerId)
            .eq('for_month', payment.for_month)
            .eq('employee_id', payee.id)
        : supabase
            .from('salary_payments')
            .select('voucher_no, amount_bdt, paid_at')
            .eq('coaching_center_id', centerId)
            .eq('for_month', payment.for_month)
            .eq('teacher_id', payee.id),
    ])

  const employee = employeeRow?.data ?? null
  const teacher = teacherRow?.data ?? null

  /*
   * The sheet is printed whatever these three reads did, which is the opposite of the fee
   * receipt's call about its own balance line — and the difference is what the missing figure
   * would be. There, the balance is the invoice's obligation and an absent line reads as
   * settled, so the paper is withheld. Here every figure on the slip comes off the payment
   * row itself and is already correct; what a dropped read costs is a name, a building or a
   * month's total, and the two that can go quiet say so on the paper instead.
   */
  const month = monthUpTo(
    { voucherNo: payment.voucher_no, paidAt: payment.paid_at },
    siblings,
  )

  const copy: CopyProps = {
    t,
    locale,
    methods: d.feeRow.methods,
    center: {
      name: center?.name ?? session.active.centerName,
      phone: center?.phone ?? null,
      address: center?.address ?? null,
    },
    // Null when the row names no building, and null again when the name could not be read:
    // an institution's slip loses a line either way, and neither is worth a sentence about
    // itself on a piece of paper the employee is waiting for.
    branchName: branchRow?.data?.name ?? null,
    voucherNo: payment.voucher_no,
    // paid_at is a timestamptz handed back in UTC. Slicing ten characters off it would date
    // a salary handed over at 1am Dhaka to the day before, and the date on a voucher is what
    // a dispute turns on.
    date: todayInDhaka(new Date(payment.paid_at)),
    payeeName: employee?.name ?? teacher?.name ?? d.payrollPay.unknownName,
    // A teacher's job is teaching, so their line carries the word rather than a designation
    // they do not have — /payroll's own rule.
    payeeJob: employee
      ? jobTitle(employee.role, employee.designation, d.settings.staff.roles)
      : d.payroll.teacherJob,
    forMonth: payment.for_month,
    amount: shown,
    isReversal,
    method: payment.method,
    reference: payment.reference,
    note: payment.note,
    parts: slipBreakdown(payment),
    month,
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <BackToMonth label={t.backToMonth} month={payment.for_month} />
        <PrintButton label={t.print} />
      </div>

      <Copy {...copy} label={t.employeeCopy} />

      {/* Paper only. On screen the office copy would be the same slip drawn a second time,
          which reads as a bug rather than as a second voucher. */}
      <div className="hidden print:block">
        <CutLine label={t.cutHere} />
        <Copy {...copy} label={t.officeCopy} />
      </div>
    </div>
  )
}

type CopyProps = {
  /** The whole group, functions and all — see the fee receipt's note on why `T` is wrong. */
  t: Dictionary['payslip']
  locale: Locale
  methods: Record<PaymentMethod, string>
  center: { name: string; phone: string | null; address: string | null }
  /** The building that paid it, or null for head office and for a name that would not read. */
  branchName: string | null
  voucherNo: number
  date: string
  payeeName: string
  payeeJob: string
  /** `for_month` — which month's salary this settles, not the month it was paid in. */
  forMonth: string
  /** Unsigned. `isReversal` carries the direction, so the paper can say it in words. */
  amount: number
  isReversal: boolean
  method: PaymentMethod
  reference: string | null
  note: string | null
  parts: SlipBreakdown
  /** Null when the month's other vouchers could not be read. See lib/payroll/slip.ts. */
  month: { paid: number; payments: number } | null
}

/**
 * One voucher.
 *
 * `break-inside-avoid` is what keeps a copy whole: without it a slip that lands near the
 * foot of a sheet is split across the fold, and half a payslip is not a payslip. Two of
 * these plus the cut line fit inside A4 at the 12mm margins globals.css sets.
 */
function Copy({ label, ...p }: CopyProps & { label: string }) {
  const { t, locale, methods, parts } = p

  return (
    <section
      className="break-inside-avoid rounded-xl border border-line bg-white p-4
        print:rounded-none print:border-ink-faint"
    >
      <header className="flex items-start justify-between gap-4 border-b border-line pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink">{p.center.name}</h1>
          {p.center.address && <p className="text-sm text-ink-soft">{p.center.address}</p>}
          {p.center.phone && <p className="num text-sm text-ink-soft">{p.center.phone}</p>}
          {/* Under the address, because it is part of the address: an institution running
              six buildings pays six payrolls, and a slip that names only the organisation
              cannot be filed by whoever keeps that branch's papers. */}
          {p.branchName && (
            <p className="text-sm text-ink-soft">
              {t.branch}: {p.branchName}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-medium text-ink-soft">{label}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{t.voucherNo}</p>
          {/* The largest thing on the slip after the amount. It is what the register is
              searched by and what somebody quotes down a phone line, so it has to survive
              a photocopy. */}
          <p className="num text-xl font-bold text-ink">{p.voucherNo}</p>
        </div>
      </header>

      {/* Across the slip and in words rather than a colour, the refunded receipt's reason:
          these sheets come off the cheapest black-and-white laser in the building, and
          somebody filing this next to last month's payslip has to tell the two apart at a
          glance in a year's time. */}
      {p.isReversal && (
        <p
          className="mt-3 rounded-lg border-2 border-late px-3 py-1.5 text-center font-bold
            text-ink"
        >
          {t.reversalTitle}
        </p>
      )}

      <dl className="mt-3 flex flex-col gap-1.5">
        <Line label={t.date} value={formatDate(p.date, locale)} num />
        <Line label={t.payee} value={`${p.payeeName} · ${p.payeeJob}`} />
        <Line label={t.month} value={formatMonth(p.forMonth, locale)} />
        <Line label={t.method} value={methods[p.method]} />
        {/* Only when there is one. Cash has no transaction id, and an empty row labelled
            "Reference" invites somebody to write one in. */}
        {p.reference && <Line label={t.reference} value={p.reference} num />}
        {p.note && <Line label={t.note} value={p.note} />}
      </dl>

      {/* What the salary was made of, and only when it was made of more than one thing —
          see `itemised`. Read as a column of arithmetic: the parts, the gross, what came
          off. The deduction is signed, because that is the only thing that makes the
          figures add up on paper. */}
      {parts.itemised && (
        <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
          <Line label={t.basic} value={formatTaka(parts.basic)} num />
          {parts.allowances !== 0 && (
            <Line label={t.allowances} value={formatTaka(parts.allowances)} num />
          )}
          {parts.other !== 0 && (
            <Line label={t.other} value={formatTaka(parts.other)} num />
          )}
          {(parts.allowances !== 0 || parts.other !== 0) && (
            <Line label={t.gross} value={formatTaka(parts.gross)} num strong />
          )}
          {parts.deductions !== 0 && (
            <Line
              label={t.deductions}
              value={`-${formatTaka(parts.deductions)}`}
              num
            />
          )}
        </dl>
      )}

      {/* The amount, set apart. This is the figure the voucher is for. Green is money the
          centre received; a salary is money leaving, so the block is neutral with a ruled
          edge and the direction is in the label rather than in a hue somebody's printer or
          eyes may not resolve. */}
      <div
        className={`mt-3 flex items-baseline justify-between gap-4 rounded-lg px-3 py-2
          ${p.isReversal ? 'border-2 border-late bg-surface-alt' : 'bg-surface-alt'}`}
      >
        <span className="font-medium text-ink">
          {p.isReversal ? t.reversalAmount : t.amount}
        </span>
        <span className="num text-2xl font-bold text-ink">{formatTaka(p.amount)}</span>
      </div>

      {/* The month up to this voucher, past one payment only — see lib/payroll/slip.ts on
          why a single-voucher month draws nothing, and the dictionary on why a month with
          two needs this line at all. */}
      {p.month === null ? (
        <p className="mt-3 text-xs text-ink-faint">{t.monthUnreadable}</p>
      ) : (
        p.month.payments > 1 && (
          <dl className="mt-3 border-t border-line pt-3">
            <Line
              label={t.monthTotal(p.month.payments)}
              value={formatTaka(p.month.paid)}
              num
              strong
            />
          </dl>
        )
      )}

      <div className="mt-6 flex items-end justify-between gap-4">
        {/* Two blank lines for a pen, and the employee's is the one the centre keeps. A
            printed name would be worse than nothing: the slip's authority comes from the
            person who took the money signing for it. */}
        <div className="text-center">
          <div className="h-7 w-36 border-b border-ink-faint" />
          <p className="mt-1 text-xs text-ink-faint">{t.receivedBy}</p>
        </div>
        <div className="text-center">
          <div className="h-7 w-36 border-b border-ink-faint" />
          <p className="mt-1 text-xs text-ink-faint">{t.paidBy}</p>
        </div>
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        {p.isReversal ? t.reversalFootNote : t.footNote}
      </p>
    </section>
  )
}

/** One label-and-value row of the slip. */
function Line({
  label,
  value,
  num = false,
  strong = false,
}: {
  label: string
  value: string
  /** Tabular figures, for anything the reader will compare against something else. */
  num?: boolean
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd
        className={`min-w-0 text-right ${num ? 'num' : ''} ${
          strong ? 'font-semibold text-ink' : 'font-medium text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Where the scissors go.
 *
 * A dashed rule with the words on it: an unlabelled dashed line in the middle of a page is
 * as likely to be read as a section divider, and then the office copy goes home in somebody
 * else's pocket and the centre keeps nothing signed.
 */
function CutLine({ label }: { label: string }) {
  return (
    <div aria-hidden className="flex items-center gap-2 py-4 text-xs text-ink-faint">
      <span className="h-0 flex-1 border-t border-dashed border-ink-faint" />
      <span>✂ {label}</span>
      <span className="h-0 flex-1 border-t border-dashed border-ink-faint" />
    </div>
  )
}

/**
 * The way back, carrying the month when there is one to carry.
 *
 * /payroll/pay opens on this month by itself, so a bare link from February's slip would
 * land an owner in September and leave them to find the picker. The locked and unreadable
 * branches have no month to pass and get the plain link.
 */
function BackToMonth({ label, month }: { label: string; month?: string }) {
  return (
    <Link
      href={month ? `/payroll/pay?month=${month}` : '/payroll/pay'}
      className="inline-flex min-h-tap items-center font-medium text-brand-700"
    >
      ← {label}
    </Link>
  )
}
