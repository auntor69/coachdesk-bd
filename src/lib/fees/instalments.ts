/**
 * A one-off fee agreed in advance and collected in parts. MASTERPLAN.md §9.3.
 *
 * AN INSTALMENT PLAN IS N BILLS, NOT ONE BILL WITH A SCHEDULE. A parallel schedule table
 * would need its own allocation rule — which instalment does a ৳500 payment pay? — and its
 * own arrears arithmetic, which means two answers to "what does this family owe" and one of
 * them wrong. Raising three bills instead reuses every mechanism already keyed to an
 * invoice: partial payments, the arrears list, receipts, the register, a waiver, cancelling,
 * month close, and the profit view. "Instalment 2 is overdue" is `due_date` on its own row.
 *
 * THE MONTH FOLLOWS THE DUE DATE. Every report in this product groups by `period_month`, so
 * three ৳2,000 instalments are billed in three months rather than all in the first. Stacking
 * them would show a ৳6,000 spike in a month when only ৳2,000 was collectible, and then a
 * collection rate over 100% in the two months that collected against it.
 *
 * Relative imports with the extension, like every other unit-tested module here.
 */
import { addMonths } from '../bd/time.ts'
import { poisha } from './discount.ts'

/** Fewer than two parts is not a plan; the form calls 1 "pay in full". */
export const MIN_INSTALMENTS = 2

/**
 * Twelve, because a year of instalments is the longest thing an owner writes down as one
 * agreement. Past that it is a subscription, and this product bills those monthly already.
 */
export const MAX_INSTALMENTS = 12

/**
 * Why a plan can or cannot be raised.
 *
 * `tooSmall` is separate from `outOfRange` because it is about the amount, not the count: a
 * ৳2 fee cannot be split three ways without an instalment of nothing, and `amount_bdt >= 0`
 * would accept that row while no owner would call it a bill.
 */
export type InstalmentVerdict = 'ok' | 'unreadable' | 'outOfRange' | 'tooSmall'

export function instalmentVerdict(count: number, total: number): InstalmentVerdict {
  if (!Number.isFinite(count) || !Number.isInteger(count)) return 'unreadable'
  if (count < MIN_INSTALMENTS || count > MAX_INSTALMENTS) return 'outOfRange'
  if (!Number.isFinite(total) || total <= 0) return 'unreadable'
  if (poisha(total) < count) return 'tooSmall'
  return 'ok'
}

/**
 * How many parts a submission asked for, or null when the field is unreadable.
 *
 * ONE MEANS PAY IN FULL and is the default, so a request that carries no field at all — a
 * replayed offline charge queued before this existed — raises the single bill it always did
 * rather than failing. A field that is not text at all counts as absent, which is what
 * FormData hands back for a box nobody filled in, exactly as `readBasis` reads its own.
 *
 * Anything else non-numeric is null, because a form that sent "three" is a form that went
 * wrong and guessing at it would bill a family on a schedule nobody agreed.
 */
export function readInstalmentCount(raw: unknown): number | null {
  if (typeof raw !== 'string') return 1

  const text = raw.trim()
  if (text === '') return 1

  const value = Number(text)
  if (!Number.isInteger(value) || value < 1 || value > MAX_INSTALMENTS) return null
  return value
}

/**
 * The total split into `count` parts that add back up to it exactly.
 *
 * Split in whole poisha, and the remainder goes a poisha at a time to the earliest parts:
 * ৳5,000 over three is 1,666.67 / 1,666.67 / 1,666.66. The direction matters less than the
 * guarantee — the parts must sum to what the owner typed, or the family is billed a figure
 * nobody agreed — but earliest-first is the one an owner can explain, because the odd poisha
 * is collected first and the last instalment is never the surprising one.
 *
 * Empty for anything `instalmentVerdict` refuses, so a caller cannot bill a plan of zeroes.
 */
export function splitInstalments(total: number, count: number): number[] {
  if (instalmentVerdict(count, total) !== 'ok') return []

  const whole = poisha(total)
  const each = Math.floor(whole / count)
  const spare = whole - each * count

  return Array.from({ length: count }, (_, i) => (each + (i < spare ? 1 : 0)) / 100)
}

/** One bill of a plan, as the insert needs it. */
export type Instalment = {
  /** 1-based, and what the bill is labelled with on screen. */
  no: number
  of: number
  amountBdt: number
  periodMonth: string
  dueDate: string
}

/**
 * The whole agreement: what each part costs, which month it is billed in, and when it is due.
 *
 * `dueDay` is 1–28 for the reason the charge form's picker only offers those: the same choice
 * has to mean the same thing in February, and a plan is the one place a day of 31 would land
 * on a month that does not have one. Clamped rather than refused — the picker cannot produce
 * anything else, and a hand-made request asking for the 30th means the end of the month.
 *
 * Empty when the plan is not raisable, which is the same answer `splitInstalments` gives and
 * for the same reason.
 */
export function instalmentPlan({
  total,
  count,
  firstMonth,
  dueDay,
}: {
  total: number
  count: number
  firstMonth: string
  dueDay: number
}): Instalment[] {
  const parts = splitInstalments(total, count)
  if (parts.length === 0) return []

  const day = Math.min(28, Math.max(1, Math.trunc(dueDay) || 1))

  return parts.map((amountBdt, i) => {
    const periodMonth = addMonths(firstMonth, i)
    return {
      no: i + 1,
      of: count,
      amountBdt,
      periodMonth,
      dueDate: `${periodMonth.slice(0, 7)}-${String(day).padStart(2, '0')}`,
    }
  })
}
