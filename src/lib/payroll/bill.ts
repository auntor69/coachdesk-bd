/**
 * The salary bill: one line per live agreement, and what the lines add up to.
 *
 * IT LIVES HERE AND NOT IN THE PAGE for the reason ../expenses/tally.ts gives about its
 * own arithmetic — the figure at the foot of this screen is what a centre thinks its
 * payroll costs, §9.8 subtracts money of that size from collections to get a profit line,
 * and a sum that has never been run against a fixture is a sum nobody has checked. The
 * page renders; this file adds up.
 *
 * THE ONE THING THIS BILL CANNOT TOTAL is a per-class agreement. 20260811000044 refuses
 * to store what a per-class teacher earns in a month — "storing it would be a number that
 * goes stale the next time they teach" — so a bill containing four monthly agreements and
 * two per-class ones has a total that covers four of its own six rows. Every figure below
 * is therefore counted twice over: what is in the total, and what is not. A screen that
 * printed one number over six rows would be telling an owner their wage bill is smaller
 * than it is, which is the direction that costs them money.
 *
 * THE JOIN IS DONE HERE AND NOT BY POSTGREST, which is a decision about the composite
 * foreign keys rather than about taste. 20260811000005 replaced every simple key with one
 * on (sibling_id, coaching_center_id), and `salary_terms` reaches two tables that way at
 * once; an embed PostgREST cannot disambiguate answers PGRST201 and the screen renders
 * empty. The page needs both staff lists anyway — they fill the picker — so naming a
 * payee costs one lookup in a map over a few dozen people, and nothing is asked of the
 * relationship cache.
 *
 * A PAYEE WHO HAS LEFT KEEPS THEIR LINE, and it is flagged rather than dropped. Marking
 * somebody as gone on the staff screen does not touch their agreement — the two tables
 * know nothing about each other — so a cook who left in March is still on the bill in
 * August at ৳8,000 a month. Dropping the row would quietly correct a figure the centre
 * is wrong about; flagging it is how they find out they have an agreement to stand down.
 *
 * Relative imports with the extension, like every other unit-tested module here: these
 * tests run under `node --test`, which resolves neither tsconfig paths nor extensionless
 * specifiers.
 */
import { sumTaka } from '../money.ts'
import type { SalaryBasis } from '../supabase/types.ts'
import { PER_CLASS_BASIS } from './basis.ts'

/**
 * One `salary_terms` row, as the screen queries it.
 *
 * The money columns are `string | number` because PostgREST serialises numeric as a
 * string — typed honestly rather than as the number it is about to become, because a
 * `Number()` that everybody remembers is a `Number()` somebody eventually leaves out.
 *
 * `net_bdt` is nullable in the generated types because it is a generated column, and it
 * is read rather than re-derived: it is the database's own arithmetic over the four parts,
 * and a second implementation of `basic + allowances + other − deductions` in TypeScript
 * would be a second answer that could disagree with the first. What the null is for is
 * below.
 */
export type TermsSourceRow = {
  id: string
  employee_id: string | null
  teacher_id: string | null
  basis: SalaryBasis
  basic_bdt: string | number
  allowances_bdt: string | number
  other_bdt: string | number
  deductions_bdt: string | number
  net_bdt: string | number | null
  per_class_bdt: string | number | null
  effective_from: string
  note: string | null
}

/**
 * Which table a payee is in, and therefore which column of the terms names them.
 *
 * 20260811000044 chose one payroll pair with two possible parents over salary columns on
 * both tables, because "a report that reads one table and quietly halves the wage bill" is
 * the failure that model cannot have. This type is that decision, carried up into the app:
 * every function here that takes a payee takes a kind with it, so no call site can forget
 * which half it is looking at.
 */
export type PayeeKind = 'employee' | 'teacher'

/** Somebody the centre pays, from either table, as the bill needs them. */
export type Payee = {
  id: string
  kind: PayeeKind
  name: string
  /**
   * What they do, for the line under their name. The centre's own word or the role's for
   * an employee — see ../staff/roles.ts — and null for a teacher, who has no job title
   * because teaching is the job.
   */
  job: string | null
  /** False for an employee who has left or a teacher switched off. */
  active: boolean
}

/**
 * The value one `<option>` carries, so the form and the action agree on the shape.
 *
 * A single picker over two tables has to say which table it means, and the alternative —
 * two selects, or a hidden field the browser could disagree with — is a form that can
 * submit a teacher id under `employee_id`. The composite foreign key would refuse it, but
 * as a Postgres error rather than a sentence, and only because that id happens not to
 * exist in the other table.
 *
 * Here rather than in either caller because a prefix invented in a form and re-read in an
 * action is a format with two definitions.
 */
export function payeeValue(kind: PayeeKind, id: string): string {
  return `${kind}:${id}`
}

/**
 * The picker's third answer: somebody who is not on either staff list yet.
 *
 * A COACHING CENTRE'S FIRST VISIT TO THE SALARY SCREEN IS OFTEN ITS FIRST VISIT TO
 * ANYTHING. Nothing has been written down yet, so the picker that asks *whose* salary is
 * empty — and an empty required picker is a form that cannot be submitted, under a
 * sentence telling the reader to go to Settings, find the staff screen and come back. Two
 * screens and a lost place on the page, to answer a question the form was already asking.
 *
 * So the picker carries one value that is not a person: choosing it opens the two boxes
 * that make one — a name and what they do — and the same submit writes the staff row and
 * the agreement together. `readPayeeValue` still refuses it, deliberately: this is not a
 * payee, and the action branches on it before asking that function anything.
 *
 * Here rather than in the form because the form writes it and the action reads it, and a
 * sentinel invented in a client component and re-typed in a server file is two strings
 * that can drift apart without either failing to compile.
 */
export const NEW_PAYEE = '__new__'

/**
 * The other direction, and null for anything that is not one of ours.
 *
 * The id is not validated beyond being non-empty: whether it names somebody at this centre
 * is a question for the database, which the action asks before it writes. What this refuses
 * is the shape — an empty select, a kind that is not one of the two, a value with no colon
 * in it — so the action can answer "choose somebody" instead of passing a malformed string
 * down to a foreign key.
 */
export function readPayeeValue(raw: string): { kind: PayeeKind; id: string } | null {
  const at = raw.indexOf(':')
  if (at < 1) return null

  const kind = raw.slice(0, at)
  const id = raw.slice(at + 1)
  if (!id) return null
  if (kind !== 'employee' && kind !== 'teacher') return null

  return { kind, id }
}

/** One line of the bill. */
export type BillRow = {
  termsId: string
  payeeKind: PayeeKind
  payeeId: string
  /**
   * Null when the payee is in neither list, which is a state nothing ordinary produces:
   * the page reads every employee and every teacher, active or not, and the foreign keys
   * make an agreement without a payee impossible. Kept as a case anyway, and kept *in the
   * total*, because the money is agreed whether or not we managed to put a name to it —
   * dropping the row would take a real cost off a real bill.
   */
  name: string | null
  job: string | null
  /** Somebody switched off whose agreement is still live. See the header. */
  gone: boolean
  basis: SalaryBasis
  /**
   * The monthly net, and zero on a per-class agreement.
   *
   * Zero and not null: this is the column the total adds, and a null in it would be a
   * nullable number every caller has to remember to coalesce. What a per-class row costs
   * per month is not zero — it is not known, which is what `perClass` beside it is for and
   * what `perClassCount` in the tally says out loud.
   */
  net: number
  /** The agreed rate for one class, on a per-class agreement only. */
  perClass: number | null
  /** The day this agreement started, as stored — a `date`, so already a Dhaka day. */
  since: string
  note: string | null
}

/**
 * A money column as a number, or null if it will not parse.
 *
 * Nothing here treats an unparseable figure as zero. A bill line reading ৳0 for somebody
 * on ৳14,000 is a wrong number where an absent one would have been a question, which is
 * the call ../expenses/tally.ts makes when it drops a row it cannot read.
 */
function taka(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The live agreements, named and flagged, in the order they arrived.
 *
 * NOTHING IS SORTED HERE, and that is forced rather than chosen. Ordering by the payee's
 * name would mean `.order('employees(name)')`, which is an embed — the same embed the
 * composite foreign keys make ambiguous, so the query cannot do it and PostgREST answers
 * PGRST201 if it tries. The name is not known until the map below has been consulted, so
 * the order cannot be decided until after this function has run. Preserving the input
 * order is what lets the page decide it: see /payroll's own note on why the rows belonging
 * to somebody who has left come first.
 *
 * A row whose net will not parse is dropped rather than counted as nothing, for the reason
 * `taka` gives above. On a per-class row the net is not read at all — the column is zero by
 * construction there, and reading it would make a per-class agreement droppable on the
 * strength of a figure nothing shows.
 */
export function billRows(
  terms: readonly TermsSourceRow[] | null | undefined,
  people: readonly Payee[],
): BillRow[] {
  const byKey = new Map(people.map((p) => [payeeValue(p.kind, p.id), p]))
  const out: BillRow[] = []

  for (const t of terms ?? []) {
    // The exactly-one constraint says one of these is set. Reading the employee column
    // first and falling back is not a guess about which: a row with both set cannot exist,
    // and a row with neither is refused by `salary_terms_one_payee`.
    const payeeKind: PayeeKind = t.employee_id ? 'employee' : 'teacher'
    const payeeId = t.employee_id ?? t.teacher_id
    if (!payeeId) continue

    const perClass = t.basis === PER_CLASS_BASIS ? taka(t.per_class_bdt) : null
    const net = t.basis === PER_CLASS_BASIS ? 0 : taka(t.net_bdt)
    if (net === null) continue

    const person = byKey.get(payeeValue(payeeKind, payeeId))

    out.push({
      termsId: t.id,
      payeeKind,
      payeeId,
      name: person?.name ?? null,
      job: person?.job ?? null,
      // Unknown counts as present rather than gone: an agreement we could not put a name
      // to is not evidence that its payee left, and flagging it as such would put a
      // "stand this down" prompt on a row nobody can check.
      gone: person ? !person.active : false,
      basis: t.basis,
      net,
      perClass,
      since: t.effective_from,
      note: t.note,
    })
  }

  return out
}

/** The figures at the foot. */
export type BillTally = {
  /**
   * What the monthly agreements add up to, which is the only total this screen can print.
   * Zero on a bill of nothing but per-class agreements — and then `monthlyCount` is zero
   * too, which is how the page knows to draw no total rather than a ৳0 one.
   */
  monthly: number
  /** How many agreements carry that figure. */
  monthlyCount: number
  /** How many are per-class, and therefore in none of it. */
  perClassCount: number
  /** Every live agreement, both bases. */
  count: number
  /** How many belong to somebody who has been switched off. See the header. */
  goneCount: number
}

/**
 * The bill added up, and the parts of it that are not in the total said out loud.
 *
 * `monthlyCount + perClassCount === count` is not an accident to be relied on quietly —
 * there is a test that says so — because the whole reason this returns five figures instead
 * of one is that a reader has to be able to see which rows the total covers.
 */
export function tallyBill(rows: readonly BillRow[]): BillTally {
  const monthly = rows.filter((r) => r.basis !== PER_CLASS_BASIS)

  return {
    monthly: sumTaka(monthly.map((r) => r.net)),
    monthlyCount: monthly.length,
    perClassCount: rows.filter((r) => r.basis === PER_CLASS_BASIS).length,
    count: rows.length,
    goneCount: rows.filter((r) => r.gone).length,
  }
}

/**
 * Who the centre employs and has not agreed a figure with.
 *
 * THE QUESTION THIS SCREEN IS ACTUALLY OPENED WITH, at least the first time: a centre
 * writing down its payroll wants to know who it has missed, and the bill itself cannot
 * say — an absent row looks like an absent person. Somebody with no agreement is not paid
 * nothing, they are unrecorded, and the difference is a wage bill that is short by a cook.
 *
 * Active people only. Somebody who has left and was never given terms is not an omission,
 * and listing them would put a permanent "you have not finished" prompt on the screen of
 * every centre that has ever had staff turnover.
 */
export function withoutTerms(
  people: readonly Payee[],
  rows: readonly BillRow[],
): Payee[] {
  const covered = new Set(rows.map((r) => payeeValue(r.payeeKind, r.payeeId)))
  return people.filter((p) => p.active && !covered.has(payeeValue(p.kind, p.id)))
}
