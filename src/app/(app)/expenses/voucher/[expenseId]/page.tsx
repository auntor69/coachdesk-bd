import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { getSession, pageCapability } from '@/lib/auth/session'
import { addMonths, formatDate } from '@/lib/bd/time'
import type { CategoryLabels } from '@/lib/expenses/categories'
import { categoryUpTo, type VoucherCategoryMonth } from '@/lib/expenses/voucher'
import { dict, DEFAULT_LOCALE, type Dictionary, type Locale } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { has, planName, PLANS } from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import type { ExpenseCategory, PaymentMethod } from '@/lib/supabase/types'
import { PrintButton } from '../../../fees/print-button'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).expenseVoucher.title} — CoachDesk`,
  }
}

/** One line, not a concatenation — see the fee board's own COLUMNS on type inference. */
const VOUCHER_COLUMNS =
  'voucher_no, category, amount_bdt, spent_on, method, reference, note, branch_id'

/**
 * One expense, as a piece of paper. §9.9's fourth printable, and the last one the finance
 * side is missing.
 *
 * WHAT IT IS FOR IS NOT WHAT A RECEIPT OR A PAYSLIP IS FOR. Those two go to the other party:
 * the parent keeps proof they paid, the employee keeps proof they were paid. Here the centre
 * is the paying side, and §10 says in as many words what the sheet has to answer — "my
 * manager says he never entered that". 20260811000045 answers half of it with a row a
 * browser session cannot edit or delete; the other half is a signature, which no column can
 * hold. So the office copy is the primary one and the recipient's is the second, which is the
 * reverse of both sheets already shipped.
 *
 * THREE SIGNATURES for the same reason: the row records who typed it, and what it cannot
 * record is who took the cash and who agreed it could go.
 *
 * THE CATEGORY TOTAL IS FROZEN AT THIS VOUCHER, by voucher number rather than by date —
 * lib/expenses/voucher.ts argues it at length, and the short of it is that `spent_on` is a
 * date an owner may backdate, so ordering by it would let a row written next week change what
 * this sheet said today.
 *
 * NOTHING HERE IS PUT THROUGH `todayInDhaka`, and that is the difference from a payslip.
 * `salary_payments.paid_at` is a timestamptz, so the slip has to convert or a salary handed
 * over at 1am is dated to the day before. `spent_on` is a `date` whose default is already
 * `(now() at time zone 'Asia/Dhaka')::date` — converting a plain date again would read it as
 * a UTC midnight and hand back the day before. Same rule as lib/expenses/tally.ts.
 *
 * STAFF ADMIN ONLY, matching `expenses_staff_admin_read`, and it needs nothing widened: this
 * is the paper an owner or a manager prints, and the person receiving the money signs the
 * centre's copy rather than logging in. Teachers are out, and deliberately not let in through
 * §6.5's `can_view_fees` — that permission is about collecting for a batch, which is not the
 * same act as reading what the centre pays in rent.
 *
 * THE SAME PLAN GATE AS /expenses, and its sentence, because it is the same gate and the same
 * purchase. `centerWideReporting` is true on no plan where `printedReceipts` is false, so a
 * second check would be a branch nobody can reach.
 *
 * A miss is notFound() rather than a 403: RLS decides what is visible, and refusing another
 * centre's voucher id by name would confirm the id exists.
 */
export default async function ExpenseVoucherPage({
  params,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  params: Promise<{ expenseId: string }>
}) {
  const { expenseId } = await params
  const session = await pageCapability('expenses')

  const locale = session.locale
  const d = dict(locale)
  const t = d.expenseVoucher

  // Before the query, like /expenses itself: this return draws none of the voucher.
  if (!has(session.plan, 'centerWideReporting')) {
    return (
      <div className="flex flex-col gap-4">
        <BackToSpending label={t.backToSpending} />
        <Card>
          <h1 className="font-semibold text-ink">{d.expenses.lockedTitle}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {d.expenses.lockedBody(
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

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .select(VOUCHER_COLUMNS)
    .eq('coaching_center_id', centerId)
    .eq('id', expenseId)
    .maybeSingle()

  /*
   * The read that failed, ahead of the 404, and it says the expense is saved before it says
   * anything else. `expenses` revokes DELETE, so a voucher that appears to have vanished is
   * the app appearing to break a promise it cannot break — and an owner who believes an entry
   * was lost writes it again, onto a table that will hold both rows for good and a profit
   * figure that is wrong until somebody notices and writes a minus row.
   */
  if (expenseError) {
    return (
      <div className="flex flex-col gap-4">
        <BackToSpending label={t.backToSpending} />
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  if (!expense) notFound()

  const amount = Number(expense.amount_bdt)
  /** A minus row: the only way 20260811000045 allows a mistake to be undone. */
  const isCorrection = amount < 0
  /** Unsigned on the paper. The words say which way it went; see the dictionary. */
  const shown = Math.abs(amount)

  const branchId = expense.branch_id
  // Plain string arithmetic on a plain date, and no timezone anywhere near it: `spent_on` is
  // already the Dhaka calendar day. Half-open below, so nothing on either boundary is counted
  // twice or dropped — /expenses reads its month the same way.
  const month = `${expense.spent_on.slice(0, 7)}-01`
  const nextMonth = addMonths(month, 1)

  const [{ data: center }, branchRow, { data: siblings }] = await Promise.all([
    // The letterhead. The app shell's header is print:hidden, so this is the only thing on the
    // sheet that says which centre paid the money.
    supabase
      .from('coaching_centers')
      .select('name, phone, address')
      .eq('id', centerId)
      .maybeSingle(),
    /*
     * Which building's cost it was. Read from `branches` by id and not through
     * `branchChoicesFor`, which filters on `active`: a building that has since closed still
     * paid this bill, and a voucher reprinted afterwards has to name it.
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
     * This category's other entries in the same month, for the as-of total. Cheap: the index
     * `expenses_center_category_idx on (coaching_center_id, category, spent_on desc)` was made
     * for exactly this shape of question.
     */
    supabase
      .from('expenses')
      .select('voucher_no, amount_bdt')
      .eq('coaching_center_id', centerId)
      .eq('category', expense.category)
      .gte('spent_on', month)
      .lt('spent_on', nextMonth),
  ])

  /*
   * The sheet is printed whatever those two reads did, which is the opposite of the fee
   * receipt's call about its own balance line — and the difference is what the missing figure
   * would be. There the balance is an obligation and an absent line reads as settled, so the
   * paper is withheld. Here every figure comes off the expense row itself and is already
   * correct; what a dropped read costs is a building's name or a category total, and the one
   * that matters says so on the paper instead.
   */
  const category = categoryUpTo(expense.voucher_no, siblings)

  const copy: CopyProps = {
    t,
    locale,
    methods: d.feeRow.methods,
    categories: d.expenses.categories,
    center: {
      name: center?.name ?? session.active.centerName,
      phone: center?.phone ?? null,
      address: center?.address ?? null,
    },
    // Null when the row names no building, and null again when the name could not be read: an
    // institution's voucher loses a line either way, and neither is worth a sentence about
    // itself on a sheet somebody is waiting to sign.
    branchName: branchRow?.data?.name ?? null,
    voucherNo: expense.voucher_no,
    date: expense.spent_on,
    categoryKey: expense.category,
    amount: shown,
    isCorrection,
    method: expense.method,
    reference: expense.reference,
    note: expense.note,
    category,
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <BackToSpending label={t.backToSpending} month={month} />
        <PrintButton label={t.print} />
      </div>

      <Copy {...copy} label={t.officeCopy} />

      {/* Paper only. On screen the second copy would be the same voucher drawn again, which
          reads as a bug rather than as a second slip. */}
      <div className="hidden print:block">
        <CutLine label={t.cutHere} />
        <Copy {...copy} label={t.recipientCopy} />
      </div>
    </div>
  )
}

type CopyProps = {
  /** The whole group, functions and all — see the fee receipt's note on why `T` is wrong. */
  t: Dictionary['expenseVoucher']
  locale: Locale
  methods: Record<PaymentMethod, string>
  categories: CategoryLabels
  center: { name: string; phone: string | null; address: string | null }
  /** The building it was spent on, or null for head office and for a name that would not read. */
  branchName: string | null
  voucherNo: number
  /** `spent_on` as stored: a Dhaka calendar day already, converted by nothing. */
  date: string
  categoryKey: ExpenseCategory
  /** Unsigned. `isCorrection` carries the direction, so the paper can say it in words. */
  amount: number
  isCorrection: boolean
  method: PaymentMethod
  reference: string | null
  note: string | null
  /** Null when the month's other entries could not be read. See lib/expenses/voucher.ts. */
  category: VoucherCategoryMonth | null
}

/**
 * One voucher.
 *
 * `break-inside-avoid` is what keeps a copy whole: without it a voucher that lands near the
 * foot of a sheet is split across the fold, and half a voucher is not a voucher. Two of these
 * plus the cut line fit inside A4 at the 12mm margins globals.css sets.
 */
function Copy({ label, ...p }: CopyProps & { label: string }) {
  const { t, locale, methods, categories } = p
  const what = categories[p.categoryKey]

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
          {/* Under the address, because it is part of the address: §8.3 compares what each
              building spends, and a voucher that names only the organisation cannot be filed
              by whoever keeps that branch's papers. */}
          {p.branchName && (
            <p className="text-sm text-ink-soft">
              {t.branch}: {p.branchName}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-medium text-ink-soft">{label}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{t.voucherNo}</p>
          {/* The largest thing on the voucher after the amount. It is what the spending list is
              searched by and what somebody quotes down a phone line, so it has to survive a
              photocopy. */}
          <p className="num text-xl font-bold text-ink">{p.voucherNo}</p>
        </div>
      </header>

      {/* Across the voucher and in words rather than a colour, the refunded receipt's reason:
          these sheets come off the cheapest black-and-white laser in the building, and
          somebody filing this beside the entry it corrects has to tell the two apart at a
          glance in a year's time. */}
      {p.isCorrection && (
        <p
          className="mt-3 rounded-lg border-2 border-late px-3 py-1.5 text-center font-bold
            text-ink"
        >
          {t.correctionTitle}
        </p>
      )}

      <dl className="mt-3 flex flex-col gap-1.5">
        <Line label={t.date} value={formatDate(p.date, locale)} num />
        <Line label={t.category} value={what} />
        {/* The words the category could not carry — which month's rent, which printer. Only
            when there are some: an empty row labelled "What for" invites somebody to write in
            an answer the record does not have. */}
        {p.note && <Line label={t.note} value={p.note} />}
        <Line label={t.method} value={methods[p.method]} />
        {p.reference && <Line label={t.reference} value={p.reference} num />}
      </dl>

      {/* The amount, set apart. This is the figure the voucher is for. Green is money the
          centre received; an expense is money leaving, so the block is neutral with a ruled
          edge and the direction is in the label rather than in a hue somebody's printer or
          eyes may not resolve. */}
      <div
        className={`mt-3 flex items-baseline justify-between gap-4 rounded-lg px-3 py-2
          ${p.isCorrection ? 'border-2 border-late bg-surface-alt' : 'bg-surface-alt'}`}
      >
        <span className="font-medium text-ink">
          {p.isCorrection ? t.correctionAmount : t.amount}
        </span>
        <span className="num text-2xl font-bold text-ink">{formatTaka(p.amount)}</span>
      </div>

      {/* The month's spending in this category up to this voucher, past one entry only — the
          duplicate check the spending list exists to make possible, printed at the moment the
          money leaves. See lib/expenses/voucher.ts on why one entry draws nothing. */}
      {p.category === null ? (
        <p className="mt-3 text-xs text-ink-faint">{t.categoryUnreadable}</p>
      ) : (
        p.category.entries > 1 && (
          <dl className="mt-3 border-t border-line pt-3">
            <Line
              label={t.categoryTotal(what, p.category.entries)}
              value={formatTaka(p.category.spent)}
              num
              strong
            />
          </dl>
        )
      )}

      {/* Three blank lines for a pen, and a grid rather than the payslip's fixed widths
          because three of those do not fit a phone. The row already records who typed it;
          what it cannot record is who took the cash and who agreed it could go, which is the
          question §10 predicts somebody asking. A printed name would be worse than nothing. */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Sign label={t.receivedBy} />
        <Sign label={t.paidBy} />
        <Sign label={t.approvedBy} />
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        {p.isCorrection ? t.correctionFootNote : t.footNote}
      </p>
    </section>
  )
}

/** One label-and-value row of the voucher. */
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

/** One ruled line and the word under it. Full width of its column, so three of them fit. */
function Sign({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="h-7 border-b border-ink-faint" />
      <p className="mt-1 text-xs text-ink-faint">{label}</p>
    </div>
  )
}

/**
 * Where the scissors go.
 *
 * A dashed rule with the words on it: an unlabelled dashed line in the middle of a page is as
 * likely to be read as a section divider, and then the office copy goes out of the building
 * with whoever took the money and the centre keeps nothing signed.
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
 * /expenses opens on this month by itself, so a bare link from February's voucher would land
 * an owner in September and leave them to find the picker. The locked and unreadable branches
 * have no month to pass and get the plain link.
 */
function BackToSpending({ label, month }: { label: string; month?: string }) {
  return (
    <Link
      href={month ? `/expenses?month=${month}` : '/expenses'}
      className="inline-flex min-h-tap items-center font-medium text-brand-700"
    >
      ← {label}
    </Link>
  )
}
