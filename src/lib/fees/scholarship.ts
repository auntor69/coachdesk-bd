/**
 * A waiver expressed as a share of the bill, and a named award that can be granted again
 * next month without being retyped. MASTERPLAN.md §9.3.
 *
 * WHAT THIS IS FOR, over and above lib/fees/discount.ts beside it. That module answers
 * "may this figure be waived on this bill" and is unchanged. This one answers the question
 * before it: what the figure is, when the owner said "half" or picked "sibling waiver"
 * instead of typing taka.
 *
 * THE ARITHMETIC IS THE POINT OF THE FILE. `fee_invoices_discount_percent_agrees` holds
 * `discount_bdt = round(amount_bdt * discount_percent / 100, 2)`, computed by Postgres in
 * exact decimal. This file has to produce the same figure from a float, and a disagreement
 * of one poisha is not a rounding curiosity — it is an owner who taps Save, gets a
 * constraint violation, and has nothing on screen that explains it. So nothing here
 * multiplies taka by a percentage: it multiplies whole poisha by whole hundredths of a
 * percent, which is an exact integer, and rounds by looking at the remainder rather than
 * by handing a float to Math.round.
 *
 * tests/scholarship.test.ts and scripts/test-rls.mjs share one table of (bill, percent,
 * figure) triples. The unit test asserts this file produces the figure; the RLS suite
 * writes the same triple to a real invoice and lets the check constraint be the judge.
 * Neither computes the other's answer, so they cannot drift together.
 *
 * Relative imports with the extension, like every other unit-tested module here: these
 * tests run under `node --test`, which resolves neither tsconfig paths nor extensionless
 * specifiers.
 */
import { poisha } from './discount.ts'

/** The largest share of a bill an award may waive: all of it. */
export const MAX_PERCENT = 100

/**
 * Why a percentage can or cannot be used.
 *
 * Zero is out of range rather than a way of clearing a waiver, unlike the taka figure:
 * "0%" is not something an owner types to undo anything, and `discount_percent > 0` is a
 * table check, so a zero arriving here is a form that went wrong.
 */
export type PercentVerdict = 'ok' | 'unreadable' | 'outOfRange'

export function percentVerdict(percent: number): PercentVerdict {
  if (!Number.isFinite(percent)) return 'unreadable'
  if (percent <= 0 || percent > MAX_PERCENT) return 'outOfRange'
  return 'ok'
}

/**
 * A percentage as whole hundredths of one — 12.5% is 1250 — which is the form the
 * arithmetic below needs and the form the column can hold.
 *
 * `numeric(5, 2)` rounds on the way in, so an owner pasting 33.333 would store 33.33 and
 * then fail the constraint against a figure computed from 33.333. Rounding here first
 * means the percentage that is stored is the percentage that was priced.
 */
export function percentHundredths(percent: number): number {
  return Math.round(percent * 100)
}

/** The same percentage back as taka-facing decimal, which is what the column holds. */
export function normalizePercent(percent: number): number {
  return percentHundredths(percent) / 100
}

/**
 * What a share of a bill comes to, in taka, to the poisha Postgres would round to.
 *
 * `scaled` is poisha times hundredths of a percent, so the true answer is
 * `scaled / 10000` poisha and the remainder decides the last one. Ties go away from zero
 * because that is what `round(numeric, 2)` does — Math.round would agree here, and would
 * stop agreeing the first time a float landed a hair under the half.
 */
export function percentWaiver(billed: number, percent: number): number {
  if (percentVerdict(percent) !== 'ok') return 0
  if (!Number.isFinite(billed) || billed <= 0) return 0

  const scaled = poisha(billed) * percentHundredths(percent)
  const whole = (scaled - (scaled % 10000)) / 10000
  const rest = scaled % 10000

  return (rest * 2 >= 10000 ? whole + 1 : whole) / 100
}

/**
 * An award's rule as the two nullable columns hold it: exactly one of them is set, which
 * `fee_scholarships_one_rule` enforces.
 */
export type ScholarshipRule = {
  percent: number | null
  amountBdt: number | null
}

/**
 * An award as a screen needs it: the rule, plus what to call it and what to send back.
 *
 * Both figures come out of PostgREST as strings, so a caller reads them through
 * `Number()` before they get here — same as every other numeric column in this product.
 */
export type Award = ScholarshipRule & {
  id: string
  name: string
}

/**
 * What this award waives off this bill, or null when the rule is not a rule.
 *
 * A FIXED AWARD IS CAPPED AT THE BILL, which is the one place the two kinds behave
 * differently. "Sibling waiver ৳300" against a ৳200 bill would otherwise break
 * `fee_invoices_discount_bound`, and refusing it would be the wrong answer: the family
 * owes nothing, which is what the award was for. A percentage needs no cap because the
 * column is bounded at 100.
 *
 * Null rather than zero for a malformed rule, so a caller cannot mistake "this award is
 * broken" for "this award waives nothing". Only reachable from a row written before the
 * constraint existed, or one hand-edited past it.
 */
export function ruleWaiver(rule: ScholarshipRule, billed: number): number | null {
  const percentOnly = rule.percent !== null && rule.amountBdt === null
  const amountOnly = rule.amountBdt !== null && rule.percent === null

  if (percentOnly) {
    return percentVerdict(rule.percent as number) === 'ok'
      ? percentWaiver(billed, rule.percent as number)
      : null
  }

  if (!amountOnly) return null

  const flat = rule.amountBdt as number
  if (!Number.isFinite(flat) || flat <= 0) return null
  if (!Number.isFinite(billed) || billed <= 0) return 0

  return Math.min(poisha(flat), poisha(billed)) / 100
}

/** Whether an award may be created as described. */
export type ScholarshipVerdict =
  | 'ok'
  | 'noName'
  | 'noRule'
  | 'twoRules'
  | 'percentRange'
  | 'amountRange'

/**
 * The same rule `fee_scholarships_one_rule` and the two range checks hold, said early
 * enough to be a sentence rather than a constraint name.
 *
 * `noRule` and `twoRules` are separate verdicts because they are opposite mistakes and the
 * owner needs to be told which one they made.
 */
export function scholarshipVerdict({
  name,
  percent,
  amountBdt,
}: {
  name: string
  percent: number | null
  amountBdt: number | null
}): ScholarshipVerdict {
  if (!name.trim()) return 'noName'
  if (percent === null && amountBdt === null) return 'noRule'
  if (percent !== null && amountBdt !== null) return 'twoRules'
  if (percent !== null && percentVerdict(percent) !== 'ok') return 'percentRange'
  if (amountBdt !== null && (!Number.isFinite(amountBdt) || amountBdt <= 0)) {
    return 'amountRange'
  }
  return 'ok'
}

/**
 * Which of the three ways of waiving a fee the owner picked.
 *
 * `taka` is what the box has always meant, `percent` reads the same box as a share, and
 * `scholarship` says the award carries its own rule and the box is not asked for at all.
 */
export type WaiverBasis =
  | { kind: 'taka' }
  | { kind: 'percent' }
  | { kind: 'scholarship'; id: string }

/** A uuid and nothing that merely looks like one, since this arrives from a form. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The select's `sch:` prefix, which keeps an award id out of the two plain words. */
const AWARD_PREFIX = 'sch:'

/**
 * An award id from a form, or null.
 *
 * Shape-checked here so a malformed one never reaches Postgres, where it comes back as
 * "invalid input syntax for type uuid" rather than as "no such award".
 */
export function readAwardId(raw: unknown): string | null {
  const id = typeof raw === 'string' ? raw.trim() : ''
  return UUID_RE.test(id) ? id : null
}

/**
 * What a `basis` field means, or null if it means nothing.
 *
 * MISSING IS TAKA, which is the whole reason this is a parser and not a switch. A replayed
 * offline request queued before this field existed, or any caller that never sends it,
 * must keep waiving taka rather than start failing. An unrecognised non-empty value is a
 * different thing — a form that went wrong or a hand-made request — and refusing it is
 * safer than guessing between three ways of spending the centre's money.
 */
export function readBasis(raw: unknown): WaiverBasis | null {
  const value = typeof raw === 'string' ? raw.trim() : ''

  if (!value || value === 'taka') return { kind: 'taka' }
  if (value === 'percent') return { kind: 'percent' }

  if (value.startsWith(AWARD_PREFIX)) {
    const id = readAwardId(value.slice(AWARD_PREFIX.length))
    return id ? { kind: 'scholarship', id } : null
  }

  return null
}

/** The value a select puts on an award's option, matching what `readBasis` reads. */
export function awardBasis(id: string): string {
  return `${AWARD_PREFIX}${id}`
}
