import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'

import { pageCenter, getSession, isStaffAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { todayInDhaka, formatDate, formatMonth } from '@/lib/bd/time'
import { sumTaka, formatTaka } from '@/lib/money'
import { dict, DEFAULT_LOCALE, type Locale, type T } from '@/lib/i18n'
import type { PaymentMethod } from '@/lib/supabase/types'
import { PrintButton } from '../../print-button'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).receipt.title} — CoachDesk` }
}

/**
 * One payment, as a piece of paper.
 *
 * This is the last step of the transaction the whole fee board exists for: money
 * crosses a desk, a row is written, and the parent gets something to take home.
 * Until now they got nothing, and "I paid last month" against an owner's memory is
 * how a coaching centre loses a family.
 *
 * TWO COPIES ON ONE SHEET, guardian and office, split by a cut line — which is how
 * every slip book sold in a Bangladeshi stationery shop is laid out, and the point
 * is that the owner does not have to be taught. On screen only the first is drawn:
 * both would be the same receipt twice, which reads as a rendering bug. The second
 * appears when the sheet does.
 *
 * THE BALANCE IS AS OF THIS RECEIPT, not as of now. That is the one arithmetic
 * decision on this page and it matters more than it looks: a receipt reprinted six
 * months later must say what it said the day it was handed over, or the parent
 * holding the original is right and the paper is wrong. So the figure is the
 * invoice's net less every payment up to and including this one, in the order the
 * money actually arrived.
 *
 * STAFF ADMIN ONLY, like the collecting half of the board. A teacher holding
 * `can_view_fees` reads what their own students owe; issuing the receipt is the
 * act of the person who took the money, and it is signed by them.
 *
 * A miss is notFound() rather than forbidden(), for the reason the exam page gives:
 * RLS decides what is visible, and a 403 on someone else's payment id would confirm
 * that the id exists.
 */
export default async function ReceiptPage({
  params,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  params: Promise<{ paymentId: string }>
}) {
  const { paymentId } = await params
  const session = await pageCenter()
  if (!isStaffAdmin(session)) forbidden()

  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.receipt

  const { data: payment } = await supabase
    .from('fee_payments')
    .select('id, receipt_no, amount_bdt, method, reference, paid_at, invoice_id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', paymentId)
    .maybeSingle()

  if (!payment) notFound()

  const [{ data: invoice }, { data: center }, { data: siblings }] = await Promise.all([
    // Through the balance view rather than fee_invoices, because `net_bdt` is
    // billed-less-discount and that subtraction is numeric(10,2) arithmetic that
    // belongs in Postgres. The student's name comes from the same row, so the
    // receipt cannot name one child while the balance belongs to another.
    supabase
      .from('fee_invoice_balances')
      .select('period_month, amount_bdt, discount_bdt, net_bdt, student_name, student_code')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', payment.invoice_id)
      .maybeSingle(),
    // The letterhead. The app shell's header is print:hidden, so this is the only
    // thing on the sheet that says which centre took the money.
    supabase
      .from('coaching_centers')
      .select('name, phone, address')
      .eq('id', session.active.centerId)
      .maybeSingle(),
    // Every payment on the same invoice, for the as-of figure below.
    supabase
      .from('fee_payments')
      .select('receipt_no, amount_bdt, paid_at')
      .eq('coaching_center_id', session.active.centerId)
      .eq('invoice_id', payment.invoice_id),
  ])

  if (!invoice) notFound()

  // Chronological, with the receipt number breaking a tie. paid_at is the order the
  // money arrived and is what a parent would reconstruct from their own memory;
  // receipt_no settles two payments taken in the same second, and cannot be relied
  // on alone because an imported slip legitimately carries a number from the old
  // paper book while its paid_at is months earlier.
  const upToHere = (siblings ?? []).filter(
    (p) =>
      p.paid_at < payment.paid_at
      || (p.paid_at === payment.paid_at && p.receipt_no <= payment.receipt_no),
  )

  const net = Number(invoice.net_bdt ?? 0)
  const paidSoFar = sumTaka(upToHere.map((p) => Number(p.amount_bdt)))
  const balance = sumTaka([net, -paidSoFar])

  const copy: CopyProps = {
    t,
    locale,
    methods: d.feeRow.methods,
    center: {
      name: center?.name ?? session.active.centerName,
      phone: center?.phone ?? null,
      address: center?.address ?? null,
    },
    receiptNo: payment.receipt_no,
    // paid_at is a timestamptz handed back in UTC. Slicing ten characters off it
    // would date a payment taken at 1am Dhaka to the day before, and the date on a
    // receipt is the thing a dispute turns on.
    date: todayInDhaka(new Date(payment.paid_at)),
    studentName: invoice.student_name ?? d.common.unknown,
    studentCode: invoice.student_code,
    periodMonth: invoice.period_month,
    amount: Number(payment.amount_bdt),
    method: payment.method,
    reference: payment.reference,
    billed: net,
    discount: Number(invoice.discount_bdt ?? 0),
    balance,
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href="/fees"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          ← {t.backToFees}
        </Link>
        <PrintButton label={t.print} />
      </div>

      <Copy {...copy} label={t.guardianCopy} />

      {/* Paper only. On screen the office copy would be the same receipt drawn a
          second time, which reads as a bug rather than as a second slip. */}
      <div className="hidden print:block">
        <CutLine label={t.cutHere} />
        <Copy {...copy} label={t.officeCopy} />
      </div>
    </div>
  )
}

type CopyProps = {
  t: T<'receipt'>
  locale: Locale
  methods: Record<PaymentMethod, string>
  center: { name: string; phone: string | null; address: string | null }
  receiptNo: number
  date: string
  studentName: string
  studentCode: string | null
  periodMonth: string | null
  amount: number
  method: PaymentMethod
  reference: string | null
  billed: number
  discount: number
  balance: number
}

/**
 * One slip.
 *
 * `break-inside-avoid` is what keeps a copy whole: without it a receipt that lands
 * near the foot of a sheet is split across the fold, and half a receipt is not a
 * receipt. Two of these plus the cut line fit inside A4 at 12mm margins, which is
 * what the @page rule in globals.css is set to.
 */
function Copy({ label, ...p }: CopyProps & { label: string }) {
  const { t, locale, methods } = p

  return (
    <section
      className="break-inside-avoid rounded-xl border border-line bg-white p-4
        print:rounded-none print:border-ink-faint"
    >
      <header className="flex items-start justify-between gap-4 border-b border-line pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink">{p.center.name}</h1>
          {p.center.address && (
            <p className="text-sm text-ink-soft">{p.center.address}</p>
          )}
          {p.center.phone && (
            <p className="num text-sm text-ink-soft">{p.center.phone}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-medium text-ink-soft">{label}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{t.receiptNo}</p>
          {/* The largest thing on the slip after the amount. It is what a parent
              reads down a phone line and what the owner searches by, so it has to
              survive a photocopy. */}
          <p className="num text-xl font-bold text-ink">{p.receiptNo}</p>
        </div>
      </header>

      <dl className="mt-3 flex flex-col gap-1.5">
        <Line label={t.date} value={formatDate(p.date, locale)} num />
        <Line
          label={t.student}
          value={
            p.studentCode ? `${p.studentName} · ${p.studentCode}` : p.studentName
          }
        />
        {p.periodMonth && (
          <Line label={t.month} value={formatMonth(p.periodMonth, locale)} />
        )}
        <Line label={t.method} value={methods[p.method]} />
        {/* Only when there is one. Cash has no transaction id, and an empty row
            labelled "Transaction ID" invites somebody to write one in. */}
        {p.reference && <Line label={t.reference} value={p.reference} num />}
      </dl>

      {/* The amount, set apart. This is the figure the receipt is for. */}
      <div className="mt-3 flex items-baseline justify-between gap-4 rounded-lg
        bg-brand-50 px-3 py-2">
        <span className="font-medium text-brand-800">{t.amount}</span>
        <span className="num text-2xl font-bold text-brand-900">
          {formatTaka(p.amount)}
        </span>
      </div>

      <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
        <Line label={t.billed} value={formatTaka(p.billed)} num />
        {/* Three outcomes, and the paper has to be unambiguous about which. A ✓
            rather than "৳0 বাকি", because zero owed is the thing the family came to
            hear and a figure of zero does not read as good news. */}
        {p.balance > 0 ? (
          <Line label={t.balanceAfter} value={formatTaka(p.balance)} num strong />
        ) : p.balance < 0 ? (
          <Line label={t.inCredit} value={formatTaka(-p.balance)} num strong />
        ) : (
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-ink-soft">{t.balanceAfter}</span>
            <span className="font-semibold text-present">{t.paidInFull}</span>
          </div>
        )}
      </dl>

      <div className="mt-6 flex items-end justify-between gap-4">
        <p className="max-w-[60%] text-xs text-ink-faint">{t.footNote}</p>
        {/* A blank line for a pen. A printed name would be worse than nothing: the
            slip's authority comes from the person who took the cash signing it in
            front of the parent, and a pre-printed signature is exactly what a
            family would learn not to trust. */}
        <div className="shrink-0 text-center">
          <div className="h-7 w-40 border-b border-ink-faint" />
          <p className="mt-1 text-xs text-ink-faint">{t.signature}</p>
        </div>
      </div>
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
 * A dashed rule with the words on it, because an unlabelled dashed line in the
 * middle of a page is as likely to be read as a section divider — and then the
 * office copy goes home with the parent and the centre keeps nothing.
 */
function CutLine({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="flex items-center gap-2 py-4 text-xs text-ink-faint"
    >
      <span className="h-0 flex-1 border-t border-dashed border-ink-faint" />
      <span>✂ {label}</span>
      <span className="h-0 flex-1 border-t border-dashed border-ink-faint" />
    </div>
  )
}
