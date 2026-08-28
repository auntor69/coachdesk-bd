import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { pageCenter, getSession, isStaffAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { has, planName, PLANS } from '@/lib/plans'
import { todayInDhaka, formatDate, formatMonth } from '@/lib/bd/time'
import { sumTaka, formatTaka } from '@/lib/money'
import { dict, DEFAULT_LOCALE, type Dictionary, type Locale } from '@/lib/i18n'
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
 * A PAID PLAN ONLY for the sheet, and not for the number. The trigger stamps a
 * receipt number on every payment on every tier, so a free teacher reads it out
 * to the parent and searches by it later — which is why the locked branch below
 * still shows it, in the same size the slip would have. What Pro sells is the
 * paper: a teacher who has handed out thirty printed slips cannot go back to a
 * notebook, because the parents now expect one.
 *
 * THE SAME SHEET PRINTS A REFUND, because a refund is a `fee_payments` row with a
 * negative amount and nothing else — see lib/fees/refund.ts. So one flag runs through
 * this page: the slip names itself in words, the amount block says what was handed back
 * rather than what came in, and the figure is printed unsigned. Everything else is
 * unchanged, including the as-of balance, which nets the refund by arithmetic that was
 * already correct. A parent who was given cash back has nothing in writing until this
 * is printed, which is the whole reason it is the same page and not a stub.
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

  const { data: payment, error: paymentError } = await supabase
    .from('fee_payments')
    .select('id, receipt_no, amount_bdt, method, reference, paid_at, invoice_id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', paymentId)
    .maybeSingle()

  /*
   * The read that failed, ahead of the 404 — because `notFound()` was answering for
   * both, and of everywhere in this product that is true, here it costs cash.
   *
   * The dictionary's own `notFound` spells out how a miss is meant to read: "it may
   * belong to another centre, or it may have been removed". A receipt is opened with a
   * parent at the desk, often seconds after the money went in, and the one promise this
   * product makes about money is that a payment cannot be deleted from a browser. So a
   * 404 here is the app appearing to break that promise, and what happens next is the
   * cash taken again or a slip written by hand — the drawer out by the amount either
   * way, and nothing on paper to reconcile it against.
   *
   * The refusal says the payment is saved before it says anything else. No receipt
   * number on this branch, unlike the two below it: the number is what did not arrive.
   */
  if (paymentError) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/fees"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          ← {t.backToFees}
        </Link>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.paymentUnreadable}</p>
        </Card>
      </div>
    )
  }

  if (!payment) notFound()

  /**
   * Which direction the money went. `fee_payments.amount_bdt` is `check (<> 0)`, so
   * there is no third case — and the sign is the only thing that distinguishes a refund
   * row from a payment row, by design: the register nets rather than counts, and one
   * table is what keeps the drawer reconcilable.
   */
  const amount = Number(payment.amount_bdt)
  const isRefund = amount < 0
  /** Unsigned on the paper. The words say which way it went; see the dictionary. */
  const shown = Math.abs(amount)

  // The paywall, before the three queries the sheet needs. Only the student's name
  // is fetched instead, because the locked card is not a stub: it confirms that the
  // money landed on the right child and carries the number the parent will quote.
  // An owner who taps here and is told nothing at all cannot tell a locked feature
  // from a payment that failed to save.
  if (!has(session.plan, 'printedReceipts')) {
    const { data: locked } = await supabase
      .from('fee_invoice_balances')
      .select('student_name')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', payment.invoice_id)
      .maybeSingle()

    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/fees"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          ← {t.backToFees}
        </Link>

        <Card>
          <p className="text-sm font-medium text-ink-soft">{t.receiptNo}</p>
          {/* The same weight it has on the slip. This is the thing that is not
              withheld, and printing it small next to a paywall would read as a
              consolation rather than as the answer. */}
          <p className="num text-3xl font-bold text-ink">{payment.receipt_no}</p>
          {/* Named here too, and for the same reason as on the sheet: this card is
              read to confirm the money landed on the right child, and "জমার পরিমাণ"
              over a refund would confirm the opposite of what happened. */}
          {isRefund && (
            <p className="mt-1 font-semibold text-ink">{t.refundTitle}</p>
          )}

          <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            <Line
              label={t.student}
              // `Unknown` used to stand here on a dropped read, on the one card whose
              // stated job is to confirm the money landed on the right child — which
              // makes it a claim that the centre does not know who paid, worse than the
              // truth and worth an owner's phone call. `?? unknown` is kept for the
              // field itself, which the view can only leave null for a student row that
              // is genuinely gone.
              value={locked ? (locked.student_name ?? d.common.unknown) : t.studentUnreadable}
            />
            <Line
              label={t.date}
              value={formatDate(todayInDhaka(new Date(payment.paid_at)), locale)}
              num
            />
            <Line
              label={isRefund ? t.refundAmount : t.amount}
              value={formatTaka(shown)}
              num
              strong
            />
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold text-ink">{t.paperTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.paperBody(
              planName(session.plan, locale),
              planName(PLANS.teacher_plus, locale),
            )}
          </p>
        </Card>
      </div>
    )
  }

  const [invoiceRow, { data: center }, { data: siblings }] = await Promise.all([
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

  // Destructured on its own line, the way the batch edit screen does it: `error` picks
  // one of the two answers below and the array above has no room left for it.
  const { data: invoice, error: invoiceError } = invoiceRow

  /*
   * The bill behind the payment, and the same refusal as the payment itself — see the
   * note up there for why the money is named first.
   *
   * Worth its own guard rather than folding into `!invoice` below, because the two are
   * not equally likely here: `invoice_id` is a foreign key and this is a view over the
   * table it points at, so a row that is genuinely absent means the bill was deleted
   * under a payment, which the schema does not allow. Nearly every null arriving here is
   * a dropped read wearing a 404.
   *
   * The receipt number is not offered on this branch even though the payment row did
   * arrive. It would be the third card on this page carrying it, and the two that do
   * are the two whose reader has something to do with it — a paywall to weigh, or a
   * balance line to wait for. There is nothing to weigh here.
   */
  if (invoiceError) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/fees"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          ← {t.backToFees}
        </Link>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.paymentUnreadable}</p>
        </Card>
      </div>
    )
  }

  if (!invoice) notFound()

  /*
   * THE ONE FIGURE ON THIS SHEET THAT CANNOT BE GUESSED, AND WHY A DROPPED READ TAKES
   * THE WHOLE SHEET AWAY.
   *
   * `siblings` is every payment on this bill, and the as-of balance is the net less the
   * ones up to this receipt. Read as an empty list it summed to nought, so the balance
   * became the entire fee — and this page does not leave a blank where it does not
   * know: the block below picks one of three sentences, and at `balance > 0` it picks
   * "balance after this receipt". A family who has already paid ৳2,000 of ৳3,000
   * would be handed printed paper, on the centre's own letterhead, asking for the whole
   * ৳3,000. Once that has left the desk nothing in this product can call it back, and
   * the parent holding it is the one who has to argue.
   *
   * Printing the sheet with the balance line left off was the other way and is worse for
   * being quieter. The two figures still on it are the month's fee and this payment, so
   * the reader subtracts them — and for the family with an earlier payment that answer
   * is wrong too. The owner cannot see that a line is missing; they do not know the
   * layout by heart, and the slip looks finished.
   *
   * So the paper is withheld and the payment is named instead: the number, the child,
   * the amount, all three off reads that did arrive. There is a parent standing at the
   * desk and the receipt number read aloud is what they came for. The sheet is one tap
   * away as soon as the read comes back — which is the whole reason this is worth
   * refusing over, because printing is the only thing here that cannot be done twice.
   */
  if (siblings === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/fees"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          ← {t.backToFees}
        </Link>

        <Card>
          <p className="text-sm font-medium text-ink-soft">{t.receiptNo}</p>
          {/* The size it has on the slip, for the reason the locked card gives: this
              is the part that is not missing, and printing it small beside a refusal
              would read as an apology rather than as the answer. */}
          <p className="num text-3xl font-bold text-ink">{payment.receipt_no}</p>
          {isRefund && (
            <p className="mt-1 font-semibold text-ink">{t.refundTitle}</p>
          )}

          <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            <Line
              label={t.student}
              value={invoice.student_name ?? d.common.unknown}
            />
            <Line
              label={t.date}
              value={formatDate(todayInDhaka(new Date(payment.paid_at)), locale)}
              num
            />
            <Line
              label={isRefund ? t.refundAmount : t.amount}
              value={formatTaka(shown)}
              num
              strong
            />
          </dl>
        </Card>

        {/* No print button on this branch, and that is not an omission. The browser's
            own Ctrl+P would put this card on paper without the balance line, which is
            the second of the two things the note above refuses. */}
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  // Chronological, with the receipt number breaking a tie. paid_at is the order the
  // money arrived and is what a parent would reconstruct from their own memory;
  // receipt_no settles two payments taken in the same second, and cannot be relied
  // on alone because an imported slip legitimately carries a number from the old
  // paper book while its paid_at is months earlier.
  const upToHere = siblings.filter(
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
    amount: shown,
    isRefund,
    method: payment.method,
    reference: payment.reference,
    // The fee, then what was waived, then what that left. `billed` used to be handed
    // `net` — which was true of the arithmetic below it and wrong on the label: a slip
    // reading "মাসের মোট ফি ৳১,৫০০" over "৳১,৫০০ জমা" hides the ৳৫০০ the centre gave
    // away, and the parent's copy is the only place that record ever reaches the family.
    billed: Number(invoice.amount_bdt ?? 0),
    discount: Number(invoice.discount_bdt ?? 0),
    net,
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
  /**
   * The whole group, functions and all — not `T<'receipt'>`.
   *
   * `T` poisons function leaves because a function cannot be serialised across
   * the client boundary, and every prop type in this app that does cross one uses
   * it. `Copy` does not cross one: it renders on the server and emits markup. So
   * the group arrives intact, and the paywall sentence below can be a function
   * whose two arguments the compiler checks, rather than a template filled in the
   * browser with placeholder names nobody type-checks.
   */
  t: Dictionary['receipt']
  locale: Locale
  methods: Record<PaymentMethod, string>
  center: { name: string; phone: string | null; address: string | null }
  receiptNo: number
  date: string
  studentName: string
  studentCode: string | null
  periodMonth: string | null
  /** Unsigned. `isRefund` carries the direction, so that the paper can say it in words. */
  amount: number
  isRefund: boolean
  method: PaymentMethod
  reference: string | null
  /** `amount_bdt` — the fee the centre charges, before any waiver. */
  billed: number
  /** `discount_bdt`. Zero on almost every slip, which is why both lines are conditional. */
  discount: number
  /** `net_bdt` — the fee less the waiver, and what the balance below is measured from. */
  net: number
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

      {/* Across the slip, not tucked into a corner, and in words rather than a colour:
          these sheets come off the cheapest black-and-white laser in the building, and
          a parent filing this next to last month's payment slip has to be able to tell
          the two apart at a glance in a year's time. The border is decoration on top of
          a sentence that already says it. */}
      {p.isRefund && (
        <p
          className="mt-3 rounded-lg border-2 border-late px-3 py-1.5 text-center
            font-bold text-ink"
        >
          {t.refundTitle}
        </p>
      )}

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

      {/* The amount, set apart. This is the figure the receipt is for. Green is money
          in; a refund gets the neutral fill and a ruled edge instead, because green on
          a slip for money going out is the one wrong signal on the page. Both keep
          `text-ink` — the direction is in the label, not in a hue somebody's printer
          or eyes may not resolve. */}
      <div
        className={`mt-3 flex items-baseline justify-between gap-4 rounded-lg px-3 py-2
          ${p.isRefund ? 'border-2 border-late bg-surface-alt' : 'bg-brand-50'}`}
      >
        <span className={`font-medium ${p.isRefund ? 'text-ink' : 'text-brand-800'}`}>
          {p.isRefund ? t.refundAmount : t.amount}
        </span>
        <span
          className={`num text-2xl font-bold ${
            p.isRefund ? 'text-ink' : 'text-brand-900'
          }`}
        >
          {formatTaka(p.amount)}
        </span>
      </div>

      <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
        <Line label={t.billed} value={formatTaka(p.billed)} num />
        {/* Only when the centre waived something, which is a minority of slips — two
            extra lines on every other receipt would be two lines of nothing. Read as a
            column of arithmetic the parent can follow: the fee, the deduction, the total.
            The deduction is signed, because that is the only thing that makes the three
            figures add up on paper. */}
        {p.discount > 0 && (
          <>
            <Line label={t.discountGiven} value={`-${formatTaka(p.discount)}`} num />
            <Line label={t.netAfterDiscount} value={formatTaka(p.net)} num strong />
          </>
        )}
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
        <p className="max-w-[60%] text-xs text-ink-faint">
          {p.isRefund ? t.refundFootNote : t.footNote}
        </p>
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
