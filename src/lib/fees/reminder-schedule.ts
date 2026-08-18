/**
 * When a family should be reminded about an unpaid fee, and when they should be
 * left alone.
 *
 * The fee board can already answer "who owes money" — it is a filter on a view.
 * That is not the same question as "who should I message today", and the gap
 * between the two is where the money is lost. An owner looking at forty
 * outstanding rows on a Tuesday has no way to tell which of them they messaged
 * on Sunday, which are three days from a deadline nobody has missed yet, and
 * which have been quietly ignored for six weeks. So they either work down the
 * whole list again — and families who paid attention the first time get chased
 * twice, learn the messages are noise, and stop reading them — or they do
 * nothing, which is what actually happens.
 *
 * The masterplan's three touchpoints are due−3, the due date, and due+7. This
 * module is that schedule, expressed as a pure function of two calendar dates so
 * it can be unit-tested, run inside a page render, and later run inside a cron
 * worker without a second implementation existing.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import { addDays, daysBetween } from '../bd/time.ts'

/**
 * The four moments in an invoice's life where a message is worth sending.
 *
 * 'soon' — three days out, nothing is wrong yet. The most valuable of the four
 * and the one a paper register can never produce: a parent who is reminded
 * before the deadline mostly pays on time, and an invoice paid on the due date
 * never becomes a conversation about being late.
 *
 * 'due' — the deadline itself.
 *
 * 'late' — a week past. Long enough that the deadline was genuinely missed
 * rather than mislaid, short enough that the family has not written the month
 * off.
 *
 * 'owing' — still unpaid a fortnight after that, and every fortnight after.
 * Not in the masterplan's three, and deliberately added: the schedule as
 * specified sends its last message on day 7 and then goes silent forever, so a
 * family two months behind sits on the board being counted in the outstanding
 * total and contacted by nobody. That is the debt most worth chasing. A
 * fortnight is the cadence because it is slow enough not to read as harassment
 * and fast enough that the amount is still recognisable to the family.
 */
export type ReminderStage = 'soon' | 'due' | 'late' | 'owing'

/** Days before the due date that the first reminder becomes available. */
const AHEAD = 3

/** Days after the due date that 'late' opens. */
const LATE_AFTER = 7

/** How often 'owing' comes back around, in days, once 'late' has passed. */
const CADENCE = 14

/**
 * The least time between two messages to the same family about the same
 * invoice, whatever stage each one belonged to.
 *
 * Three days, which is exactly the gap between 'soon' and 'due', so a schedule
 * followed to the day is never held back by this: a family reminded on the day
 * 'soon' opened becomes eligible again precisely on the due date. What it stops
 * is the off-schedule case — the owner who chases someone on their own initiative
 * the afternoon before a deadline and would otherwise be told to do it again the
 * next morning, because a new stage opened overnight.
 *
 * A held reminder is deferred, not dropped. The stage stays open for days and
 * this is recomputed every time the screen is rendered, so the message goes as
 * soon as the cooldown expires.
 */
const COOLDOWN = 3

export type StageWindow = {
  stage: ReminderStage
  /**
   * The day this stage opened, YYYY-MM-DD. A reminder sent on or after it has
   * covered this stage; one sent before it belonged to an earlier stage.
   */
  since: string
  /**
   * 0 for the first pass through 'late', then 1, 2, 3… for each fortnight of
   * 'owing'. Carried so a screen can say "third reminder" without recomputing
   * the arithmetic, and so a future worker can tell an escalating message from
   * a repeated one.
   */
  cycle: number
}

/**
 * Which stage an invoice due on `dueDate` has reached by `today`, or null when
 * it is too early to be asking for money at all.
 *
 * Stages are cumulative rather than exact days, and that is the whole design.
 * "Message the families whose due date is exactly three days away" is a rule for
 * a cron that has run every single day without fail; a rule that produces an
 * empty list for anyone the day after a deployment, a Supabase auto-pause, or a
 * weekend of the owner not opening the app. Asking instead which milestone the
 * invoice has *passed* means a bill raised backdated, an invoice imported from a
 * paper register, or a day nobody looked at the screen all resolve to the right
 * message rather than to silence.
 */
export function reminderStage(dueDate: string, today: string): StageWindow | null {
  const late = daysBetween(dueDate, today)

  if (late >= LATE_AFTER) {
    // Fortnights since 'late' opened. cycle 0 is 'late' itself, so the two
    // stages are one series and no invoice can fall between them.
    const cycle = Math.floor((late - LATE_AFTER) / CADENCE)
    return {
      stage: cycle === 0 ? 'late' : 'owing',
      since: addDays(dueDate, LATE_AFTER + cycle * CADENCE),
      cycle,
    }
  }

  if (late >= 0) return { stage: 'due', since: dueDate, cycle: 0 }

  if (late >= -AHEAD) return { stage: 'soon', since: addDays(dueDate, -AHEAD), cycle: 0 }

  return null
}

/** Why a family that owes money is not being messaged today. */
export type ChaseHold =
  /** This stage has already been covered — wait for the next one to open. */
  | 'covered'
  /** Contacted too recently, whatever it was about. */
  | 'cooldown'

export type ChaseInput = {
  /** YYYY-MM-DD, from fee_invoices.due_date. */
  dueDate: string
  /**
   * The Dhaka calendar day of the most recent reminder for this invoice,
   * YYYY-MM-DD, or null if it has never been chased. Any channel counts,
   * including a call: the question is when this family was last contacted about
   * this bill, not how.
   */
  lastRemindedOn: string | null
}

export type ChaseDecision = {
  /** Null before the stage window opens — nothing is owed to this family yet. */
  stage: ReminderStage | null
  /** The stage's opening day, for a screen that wants to explain itself. */
  since: string | null
  cycle: number
  /** Negative before the due date, positive after. */
  daysLate: number
  /** True when a message should go today. */
  chase: boolean
  /** Set only when `chase` is false and the invoice is inside a stage. */
  held: ChaseHold | null
}

/**
 * The decision for one unpaid invoice.
 *
 * Takes no view of whether the family is *reachable* — no phone number, an SMS
 * opt-out — on purpose. That is a different axis with different remedies: a
 * missing number is a data problem the owner fixes on the students screen, and
 * an opt-out silences the two message channels while leaving a phone call
 * perfectly appropriate. Folding either into this function would mean a screen
 * could no longer tell "nothing is due today" apart from "six things are due and
 * you cannot send any of them", which are opposite situations.
 *
 * Nor does it look at the amount. A family owing ৳50 gets the same schedule as
 * one owing ৳5000, because the alternative is a threshold below which the
 * product quietly stops working, and small balances are usually the last
 * instalment of a fee that was mostly paid.
 */
export function chaseDecision(input: ChaseInput, today: string): ChaseDecision {
  const daysLate = daysBetween(input.dueDate, today)
  const window = reminderStage(input.dueDate, today)

  if (!window) {
    return { stage: null, since: null, cycle: 0, daysLate, chase: false, held: null }
  }

  const base = {
    stage: window.stage,
    since: window.since,
    cycle: window.cycle,
    daysLate,
  }

  if (!input.lastRemindedOn) return { ...base, chase: true, held: null }

  // Both are YYYY-MM-DD, so a string comparison is a date comparison — fixed
  // width, zero-padded, most significant first. Kept as a comparison rather than
  // a day count because "was the last reminder before this stage opened" is the
  // question, and subtracting to answer it invites an off-by-one on the day the
  // stage opens.
  if (input.lastRemindedOn >= window.since) return { ...base, chase: false, held: 'covered' }

  if (daysBetween(input.lastRemindedOn, today) < COOLDOWN) {
    return { ...base, chase: false, held: 'cooldown' }
  }

  return { ...base, chase: true, held: null }
}

/** One outstanding invoice, as the counter needs it. */
export type ChaseCandidate = ChaseInput & {
  /**
   * False when there is no guardian number on file. Kept out of chaseDecision on
   * purpose — see the note there — but folded in here, because this number is
   * printed on a link and a link must promise what the list will deliver.
   */
  reachable: boolean
}

/**
 * How many families are due a message today.
 *
 * The figure two other screens advertise: the fee board and the owner's
 * dashboard both put it on the way into the worklist, and the worklist itself
 * arrives at its heading by bucketing the same rows. Three numbers from one
 * function, because an owner who taps "৬ জনকে" and lands on a list of four does
 * not conclude that two were unreachable — they conclude the tool is wrong, and
 * they are the kind of right that loses a customer.
 *
 * Unreachable rows are excluded for exactly that reason. The worklist keeps them,
 * but in a card of their own headed "no guardian number", which is a data problem
 * with a different fix and no send button.
 *
 * An SMS opt-out is not unreachable and is deliberately still counted: that family
 * appears in the worklist with its message chips silenced and its call chip live,
 * so there is still a row for the owner to act on.
 */
export function countChasesDue(rows: ChaseCandidate[], today: string): number {
  let due = 0
  for (const row of rows) {
    if (row.reachable && chaseDecision(row, today).chase) due++
  }
  return due
}

/**
 * Worklist order: the money that has been owed longest, first.
 *
 * Not the order the stages happen in. An owner with twenty minutes should spend
 * them on the six-week-old debt, and a screen that opens with the friendly
 * pre-deadline nudges buries that under the pleasant work.
 */
export const STAGE_ORDER: readonly ReminderStage[] = ['owing', 'late', 'due', 'soon']
