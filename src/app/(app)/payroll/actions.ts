'use server'

/**
 * What the centre has agreed to pay the people who work for it, and standing an
 * agreement down.
 *
 * THE THIRD TERM OF THE PROFIT LINE. §9.8 is `collected − expenses − payroll`, and
 * `center_profit_month` (20260811000049) takes that last term from `salary_payments`
 * rather than from the salary expense category — which is right, because a centre using
 * both screens would otherwise be charged twice for the same wages. But a payment screen
 * with nothing behind it is a form that asks an owner what they pay their teacher every
 * single month. This is what it is prefilled from.
 *
 * A RAISE IS ONE WRITE, and that is the migration's decision rather than this file's.
 * `salary_terms_retire_previous` (20260811000044) is a BEFORE INSERT trigger that switches
 * off the payee's previous live agreement, and a partial unique index makes sure there was
 * only ever one. So there is no update path here and no "edit" verb: a new figure is a new
 * agreement, the old one stays in the table with the day it applied from, and last April's
 * salary can still be explained by the row that was live in April. An UPDATE would answer
 * "why was he paid ৳12,000 in April" with today's number.
 *
 * WHICH PLAN GATES IT: `centerWideReporting`, not `staffManagement`. They are true together
 * on every plan that has either, so today the choice is invisible — but if they ever
 * diverge, the two failures are not the same size. Gating on staff management would let a
 * plan that shows expenses and the profit line hide the wage bill, and an owner reading
 * `collected − rent` as profit is being told they made money they did not. Gating on
 * reporting can only produce a screen that is missing, which an owner can see.
 *
 * STAFF-ADMIN, re-checked here. The role half matches `salary_terms_staff_admin_write`
 * exactly, so a teacher is refused by the policy even if this file forgot — and there is
 * deliberately no teacher policy at all on this table, not even for their own row, until
 * there is a payslip screen to open one for. The plan half has nothing behind it: no
 * trigger knows what a centre bought, so it is checked here or it is not checked at all.
 * A Server Action is a public HTTP endpoint; the locked card on the page is for the reader.
 *
 * NOTHING HERE DELETES, and nothing needs to. `salary_terms` is the only half of this pair
 * a browser session may update at all — `salary_payments` revokes UPDATE and DELETE
 * outright — and the one column it makes sense to update is `active`. That is the stop
 * verb at the bottom of this file, and without it the wage bill is permanently overstated
 * for everybody who ever leaves.
 */
import { revalidatePath } from 'next/cache'

import {
  requireRole,
  requireWritable,
  requireCapability,
  authRefusal,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { todayInDhaka } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { MAX_NAME, MAX_TEXT, clamp } from '@/lib/limits'
import { MAX_TAKA, parseTaka, sumTaka } from '@/lib/money'
import { PER_CLASS_BASIS, SALARY_BASES } from '@/lib/payroll/basis'
import { NEW_PAYEE, readPayeeValue, type PayeeKind } from '@/lib/payroll/bill'
import { has } from '@/lib/plans'
import { can } from '@/lib/staff/capabilities'
import { EMPLOYEE_ROLES } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import type { EmployeeRole, SalaryBasis } from '@/lib/supabase/types'

export type PayrollState = { error?: string; ok?: string } | null

/**
 * A membership test rather than a cast, built from the canonical list.
 *
 * `basis` cast from the form would reach Postgres as an invalid input value for the enum —
 * `22P02`, and "something went wrong" on the screen. The list carries a compile-time check
 * that it holds every value of `salary_basis`, so a third basis added in a migration fails
 * the build in lib/payroll/basis.ts rather than arriving here as a value this file
 * silently refuses.
 */
const BASES = new Set<SalaryBasis>(SALARY_BASES)

/**
 * The fourteen jobs, for the one field the new-person branch reads.
 *
 * A membership test rather than a cast, for `BASES`'s reason one line up: a role cast off
 * a form reaches Postgres as `22P02` and the reader is told the salary could not be saved.
 */
const ROLES = new Set<EmployeeRole>(EMPLOYEE_ROLES)

/** The shape a date input submits and a `date` column takes. See the expense action. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Nobody agreed a salary with a coaching centre running this app before then. */
const EARLIEST_TERMS = '2000-01-01'

/**
 * The caller, or the sentence to show somebody who may not be one.
 *
 * Two refusals in one function, and they are different in kind — the same split the staff
 * action makes. The role check is a fence and `authRefusal` writes its sentence, including
 * the separate one a lapsed subscription gets. The plan check is an entitlement, and its
 * sentence has to name what is missing rather than say "not allowed": an owner on a teacher
 * plan who reached this endpoint is not doing anything wrong.
 *
 * Three now, with `payroll` (§6.2). What somebody's salary is happens to be the most
 * private figure a coaching centre holds about its own people, so it is the narrowing an
 * owner most often wants and the one this chain has least excuse to get wrong.
 */
async function caller(): Promise<CenterSession | PayrollState> {
  let session: CenterSession
  try {
    session = requireCapability('payroll', requireWritable(await requireRole('manager')))
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: await authRefusal(err, (d) => d.denied.title) }
    }
    throw err
  }

  if (!has(session.plan, 'centerWideReporting')) {
    return { error: dict(session.locale).payroll.errors.needsCenter }
  }
  return session
}

function isSession(value: CenterSession | PayrollState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * One of the three optional parts of a monthly figure: blank is zero, nonsense is null.
 *
 * Blank and zero are the same thing here and that is not a shortcut — the columns default
 * to 0 and most agreements are a single number, so an owner who leaves allowances empty has
 * said "none". Nonsense is a refusal rather than a zero, for the reason parseTaka returns
 * null at all: a ৳1,500 allowance typed as `1,5OO` silently becoming nothing is a wage bill
 * short by ৳1,500 that nobody will ever look for.
 */
function part(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? '').trim()
  if (!text) return 0
  return parseTaka(text)
}

/**
 * Whether this centre has such a person, and whether they still work here.
 *
 * Read before the insert, and not out of caution: the composite foreign key would refuse an
 * id from another centre anyway, but as `23503` with a constraint name in it, which this
 * file could only report as "it did not save". One round trip on a rare action buys a
 * sentence that says which of the two things went wrong.
 *
 * Two branches and not one computed table name, because the answer has to come back typed:
 * a `from(kind === 'employee' ? ... : ...)` hands the client a union it cannot narrow, and
 * `data.active` stops being a boolean.
 *
 * A malformed id reads as missing rather than as a failure. `maybeSingle` hands back no row
 * and an error Postgres raised on the uuid cast, and "this centre has no such person" is
 * the true statement about a value that cannot name one.
 */
async function payeeState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: CenterSession,
  kind: PayeeKind,
  id: string,
): Promise<'here' | 'gone' | 'missing'> {
  const centerId = session.active.centerId

  if (kind === 'employee') {
    const { data } = await supabase
      .from('employees')
      .select('active')
      .eq('id', id)
      .eq('coaching_center_id', centerId)
      .maybeSingle()

    return data ? (data.active ? 'here' : 'gone') : 'missing'
  }

  const { data } = await supabase
    .from('teachers')
    .select('active')
    .eq('id', id)
    .eq('coaching_center_id', centerId)
    .maybeSingle()

  return data ? (data.active ? 'here' : 'gone') : 'missing'
}

/**
 * Agrees a figure with somebody, which is also how a raise is recorded.
 *
 * NO FUTURE DATES, and this is the one refusal here that the table would not make.
 * `salary_terms_retire_previous` fires on every insert of an active row and knows nothing
 * about `effective_from`, so a raise dated the 1st of next month would switch off the
 * agreement that is live today the moment it was written — and every screen that reads the
 * live row, including the pay form on the next screen along, would show the new figure
 * straight away. The schema's model is "active means current". A centre that wants a raise
 * to start next month records it next month.
 *
 * A ZERO AGREEMENT IS REFUSED TOO, and the table permits one: all four columns default to 0
 * and only their sum is checked, nowhere. But an agreement of ৳0 is not an agreement, it is
 * an empty form submitted, and it would sit on the wage bill as a line that says the centre
 * pays this person nothing.
 *
 * NO IDEMPOTENCY KEY, unlike the expense and payment forms. A double submit here inserts a
 * second identical agreement and retires the first, which leaves the bill showing exactly
 * what it showed before and two rows in the history with the same figure and the same date.
 * Nothing is double-counted and no money moves — the cost of a retry is a duplicate line in
 * a history nobody reads, against the cost on `fee_payments`, which is money recorded twice
 * and undeletable.
 */
export async function setSalaryTerms(
  _prev: PayrollState,
  formData: FormData,
): Promise<PayrollState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).payroll

  /*
   * WHO THE FIGURE IS FOR, in one of the two shapes the picker offers.
   *
   * `NEW_PAYEE` is the form saying "nobody on this list — take the name below". That is not
   * a payee and is not handed to `readPayeeValue`; it becomes an `employees` row further
   * down, in the same submit that writes the agreement. The alternative this replaces was
   * the reader leaving for the staff screen, adding somebody and coming back — for a
   * sentence the form was already asking them to answer.
   *
   * The name and the role are validated here, before anything at all is written, so a
   * mistake in either leaves the database exactly as it was: an employee created by a form
   * that then refused the salary is a person on the staff list nobody meant to add.
   */
  const rawPayee = String(formData.get('payee') ?? '')
  const wantsNew = rawPayee === NEW_PAYEE

  let payee = wantsNew ? null : readPayeeValue(rawPayee)
  let newPerson: { name: string; role: EmployeeRole } | null = null

  if (wantsNew) {
    /*
     * TWO PERMISSIONS, because the write this branch makes is not the one this screen is
     * behind. `payroll` gets somebody to this action; adding a person is `staff` and the
     * `staffManagement` plan, and the policies on `employees` would refuse the insert
     * anyway. Checked here so the answer is a sentence rather than a constraint name, and
     * checked before any typing is looked at so a reader without it learns why from the
     * empty picker instead of from a refusal after filling in a salary.
     */
    if (!can(session.active.capabilities, 'staff')) return { error: t.errors.cantHire }
    if (!has(session.plan, 'staffManagement')) {
      return { error: dict(session.locale).settings.errors.staffNeedsCenter }
    }

    const name = clamp(String(formData.get('newName') ?? '').trim(), MAX_NAME)
    const role = String(formData.get('newRole') ?? '') as EmployeeRole
    if (!name) return { error: t.errors.newNameRequired }
    if (!ROLES.has(role)) return { error: t.errors.newRoleRequired }
    newPerson = { name, role }
  } else if (!payee) {
    return { error: t.errors.payeeRequired }
  }

  const basis = String(formData.get('basis') ?? '')
  if (!BASES.has(basis as SalaryBasis)) return { error: t.errors.basisRequired }

  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim()
  if (!DATE_RE.test(effectiveFrom)) return { error: t.errors.dateRequired }
  if (effectiveFrom < EARLIEST_TERMS) return { error: t.errors.dateTooOld }
  // String comparison of two YYYY-MM-DD, where lexicographic order is chronological
  // order. Today in Dhaka and not in UTC: for six hours every evening those are
  // different days, and the one the owner means is theirs.
  if (effectiveFrom > todayInDhaka()) return { error: t.errors.dateFuture }

  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)

  /*
   * The figures, in whichever shape the basis calls for, and zeroes in the columns the
   * other basis uses. The table checks each column is non-negative and that the rate is
   * present on exactly the right basis; what it does not check — and what is checked here —
   * is that the four parts add up to something a person could be paid.
   */
  const money = { basic: 0, allowances: 0, other: 0, deductions: 0, perClass: null as number | null }

  if (basis === PER_CLASS_BASIS) {
    const rate = parseTaka(String(formData.get('perClass') ?? ''))
    if (rate === null) return { error: t.errors.rateRequired }
    if (rate <= 0) return { error: t.errors.rateZero }
    if (rate > MAX_TAKA) return { error: t.errors.amountTooLarge }
    money.perClass = rate
  } else {
    const basic = parseTaka(String(formData.get('basic') ?? ''))
    if (basic === null) return { error: t.errors.basicRequired }

    const allowances = part(formData.get('allowances'))
    const other = part(formData.get('other'))
    const deductions = part(formData.get('deductions'))
    if (allowances === null || other === null || deductions === null) {
      return { error: t.errors.partUnreadable }
    }

    const four = [basic, allowances, other, deductions]
    // The columns' own `check (>= 0)`, caught here so a minus sign typed into allowances
    // reads as a sentence about the box rather than as a constraint name. A deduction is
    // entered as a positive number and subtracted by the generated column; typing it
    // negative would add it to the salary.
    if (four.some((n) => n < 0)) return { error: t.errors.partNegative }
    if (four.some((n) => n > MAX_TAKA)) return { error: t.errors.amountTooLarge }

    // The same arithmetic the generated column will do, done once here to check it — not
    // stored, and not what any screen reads back. See the header for why zero and negative
    // are two different mistakes with two different sentences.
    const net = sumTaka([basic, allowances, other, -deductions])
    if (net === 0) return { error: t.errors.netZero }
    if (net < 0) return { error: t.errors.deductionsTooBig }

    money.basic = basic
    money.allowances = allowances
    money.other = other
    money.deductions = deductions
  }

  const supabase = await createClient()

  /*
   * THE PERSON FIRST, when the form brought one, and only after every figure above has been
   * read. That order is the point: the boxes have all been checked by now, so a refusal
   * further up never leaves a half-added cook on the staff list.
   *
   * `branch_id` is left out on purpose — 20260811000054's stamp files the row under the
   * branch of whoever is writing it, which is the honest answer for a desk that is pinned
   * to one building and for a head office that is not pinned to any.
   *
   * No phone, no note, no start date: joined_on is today, and the staff screen is where
   * those are filled in later if anybody wants to. Insisting on them here would be the
   * form asking four questions to answer one.
   */
  let newEmployeeId: string | null = null

  if (newPerson) {
    const { data, error } = await supabase
      .from('employees')
      .insert({
        coaching_center_id: session.active.centerId,
        name: newPerson.name,
        role: newPerson.role,
        joined_on: todayInDhaka(),
      })
      .select('id')
      .maybeSingle()

    if (error || !data) return { error: t.errors.hireFailed }
    newEmployeeId = data.id
    // The staff list is one screen away and reads the same table; without this it keeps
    // saying the centre employs nobody until the next full load.
    revalidatePath('/settings/staff')
  }

  if (newEmployeeId) {
    payee = { kind: 'employee', id: newEmployeeId }
  } else if (payee) {
    const where = await payeeState(supabase, session, payee.kind, payee.id)
    if (where === 'missing') return { error: t.errors.payeeNotFound }
    // Refused rather than written, though the bill knows how to draw it: an agreement made
    // with somebody who has left is either the wrong person picked off a stale form, or a
    // centre that has taken somebody back and not said so on the staff screen. The second
    // one has a fix, and the sentence names it.
    if (where === 'gone') return { error: t.errors.payeeGone }
  }

  // Unreachable — every branch above either set one or returned — and kept as a guard
  // rather than an assertion, because the day a fourth branch arrives this is the line
  // that should fail loudly instead of passing `null` down to a foreign key.
  if (!payee) return { error: t.errors.payeeRequired }

  const { error } = await supabase.from('salary_terms').insert({
    coaching_center_id: session.active.centerId,
    // Exactly one of the pair, which `salary_terms_one_payee` enforces. The kind decides
    // which, and it came out of one picker value rather than two fields the browser could
    // disagree about.
    employee_id: payee.kind === 'employee' ? payee.id : null,
    teacher_id: payee.kind === 'teacher' ? payee.id : null,
    basis: basis as SalaryBasis,
    basic_bdt: money.basic,
    allowances_bdt: money.allowances,
    other_bdt: money.other,
    deductions_bdt: money.deductions,
    // Null on a monthly agreement and set on a per-class one, which is
    // `salary_terms_basis_matches_rate` said in TypeScript. `gross_bdt` and `net_bdt` are
    // not here at all: they are generated columns, and writing to one is an error rather
    // than a duplicated sum.
    per_class_bdt: money.perClass,
    effective_from: effectiveFrom,
    // Written out although it is the column default, because the retirement of the
    // previous agreement hangs on it — the trigger leaves an inactive insert alone, which
    // is how history is back-filled and not how a raise is granted.
    active: true,
    note: note || null,
  })

  if (error) return { error: t.errors.failed }

  revalidatePath('/payroll')
  return { ok: t.saved }
}

/**
 * Stands an agreement down, so the wage bill stops counting it.
 *
 * THE VERB WITHOUT WHICH THE BILL IS WRONG FOREVER. Marking somebody as gone on the staff
 * screen does not touch their agreement — the two tables know nothing about each other, and
 * deliberately, because an employment record and a salary agreement are different facts with
 * different dates. So a cook who left in March is still on the bill in August at ৳8,000 a
 * month until somebody says otherwise, and a wage bill that is too big makes the profit line
 * too small. The bill flags those rows; this is what the flag is for.
 *
 * AN UPDATE AND NOT A DELETE, and the row keeps everything else it says. Last April's salary
 * has to stay explicable by the agreement that was live in April, and a deleted row explains
 * nothing. `salary_terms` is the only half of this pair a browser session may update at all —
 * `salary_payments` revokes UPDATE and DELETE outright — and `active` is the column the
 * partial unique index reads, so this also frees the payee to be given new terms later.
 *
 * There is no way back from this screen on purpose. Switching a retired row back on by hand
 * would collide with `salary_terms_employee_active_idx` whenever the payee has since been
 * given a newer agreement, which is a Postgres error rather than a sentence; agreeing a
 * figure again is what the form above the bill is for, and it retires whatever it finds.
 */
export async function stopSalaryTerms(
  _prev: PayrollState,
  formData: FormData,
): Promise<PayrollState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).payroll
  const termsId = String(formData.get('termsId') ?? '')
  if (!termsId) return { error: t.errors.notFound }

  const supabase = await createClient()

  /*
   * Scoped on the centre as well as governed by RLS, for the reason the roster gives: an
   * owner of two centres passes `is_staff_admin` for both, so the policy alone would let an
   * id from the other centre through under a switcher that says this one.
   *
   * `active` is in the filter as well as in the update, so this cannot report success for a
   * second tap on a stale page — the row it would have changed is already off the bill.
   * `.select()` is what makes that visible at all: an update that matches nothing is not an
   * error in PostgREST, it is an empty result.
   */
  const { data, error } = await supabase
    .from('salary_terms')
    .update({ active: false })
    .eq('id', termsId)
    .eq('coaching_center_id', session.active.centerId)
    .eq('active', true)
    .select('id')
    .maybeSingle()

  if (error) return { error: t.errors.failed }
  if (!data) return { error: t.errors.notFound }

  revalidatePath('/payroll')
  // Returned, and probably never read: the bill queries live agreements only, so the row
  // leaves the list the moment the revalidation lands and takes the component holding this
  // sentence with it. The confirmation is the line going and the total dropping, which says
  // more than the sentence would. An error is different — nothing moved, so the row is still
  // there to show it. Same shape as the fee board's cancel step.
  return { ok: t.stopped }
}
