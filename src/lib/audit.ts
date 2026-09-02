/**
 * What a log line means, in the words a centre owner uses.
 *
 * MASTERPLAN §10 asks for "actor, action, target, before, after, when". The table
 * (20260811000046) stores six mechanical facts instead — which table, which of insert,
 * update or delete, and exactly which values moved — and says why in as many words:
 *
 *   > the log records what it can be certain of ... and the screen in §16's step 18 names
 *   > the action from that. "Discount granted" is `entity = 'fee_invoices' and before ?
 *   > 'discount_bdt'`, computed where it can be corrected without touching history.
 *
 * This is that computation. It lives here rather than in the screen because it is the
 * one part of the log that can be wrong, so it is the part that needs tests.
 *
 * WHAT IS DRAWN AND WHAT IS NOT. A line names an action, the row it happened to, one
 * figure when money moved, and one from-to when a status, a plan or a role moved.
 * Everything else that changed is counted, not listed: labelling all seventy audited
 * columns in two languages would be seventy chances to mistranslate a column name, and
 * the question §10 exists to answer — "who recorded that payment?" — is answered by the
 * first four. The whole diff is in the table when a support conversation needs it.
 *
 * Pure, and importable by `node --test`: relative imports with the extension, no
 * database, no dictionary. Words are the screen's job.
 */

import type {
  AttendanceStatus,
  AuditOperation,
  CenterStatus,
  MemberRole,
  PlanType,
  StudentStatus,
} from './supabase/types.ts'

/**
 * The seventeen tables 20260811000046, 20260811000057, 20260811000064 and
 * 20260811000069 attach a trigger to.
 *
 * Listed so the filter on the screen offers exactly what the log can contain, and so a
 * table gaining a trigger without gaining a label here is a type error rather than a
 * blank option.
 *
 * That guard only ever bound the labels to this list, not this list to the database, and
 * two tables walked through the gap: `payment_intents` and `fee_scholarships` were
 * audited by their own migrations while this said fifteen, so every line either of them
 * wrote read as "Changed" by somebody, with the table's name suppressed — `isAuditedTable`
 * gates the one word that says what was changed. `scripts/check-migrations.mjs` now
 * compares this list against the triggers themselves, which is the direction that was
 * missing.
 */
export const AUDITED_TABLES = [
  'fee_payments',
  'fee_invoices',
  'fee_scholarships',
  'expenses',
  'salary_payments',
  'salary_terms',
  'students',
  'guardians',
  'attendance_records',
  'teachers',
  'teacher_permissions',
  'employees',
  'center_members',
  'coaching_centers',
  'payments',
  'payment_intents',
  'subscriptions',
] as const

export type AuditedTable = (typeof AUDITED_TABLES)[number]

export function isAuditedTable(value: string): value is AuditedTable {
  return (AUDITED_TABLES as readonly string[]).includes(value)
}

/** Every action this module can name. A new arm without a word for it fails to build. */
export type AuditAction =
  | 'planChanged'
  | 'placesBought'
  | 'placesReduced'
  | 'centerStatusChanged'
  | 'subscriptionExtended'
  | 'trialChanged'
  | 'paymentNumberChanged'
  | 'creditsChanged'
  | 'roleChanged'
  | 'memberAdded'
  | 'memberStopped'
  | 'memberRestored'
  | 'loginCreated'
  | 'teacherAdded'
  | 'teacherStopped'
  | 'teacherRestored'
  | 'permissionsChanged'
  | 'employeeAdded'
  | 'employeeLeft'
  | 'employeeStopped'
  | 'studentAdmitted'
  | 'studentStatusChanged'
  | 'studentMoved'
  | 'guardianPhoneChanged'
  | 'consentChanged'
  | 'attendanceOverridden'
  | 'feeRaised'
  | 'feeVoided'
  | 'discountGranted'
  | 'discountRemoved'
  | 'feeAmountChanged'
  | 'feeDueDateChanged'
  | 'paymentReceived'
  | 'awardCreated'
  | 'awardRenamed'
  | 'awardRetired'
  | 'awardRestored'
  | 'salarySet'
  | 'salaryRetired'
  | 'salaryTermsChanged'
  | 'salaryPaid'
  | 'expenseRecorded'
  | 'platformPaymentRecorded'
  | 'paymentRequested'
  | 'paymentSettled'
  | 'paymentFailed'
  | 'paymentCancelled'
  | 'paymentRefunded'
  | 'subscriptionStarted'
  | 'rowCreated'
  | 'rowUpdated'
  | 'rowDeleted'

/**
 * The one before-and-after a line draws, when there is one worth drawing.
 *
 * Tagged by how it must be rendered rather than by which column it came from: the screen
 * needs `planName` for a plan and the student-status dictionary for a status, and a
 * column name would leave it guessing.
 */
export type AuditShift =
  | { kind: 'plan'; from: PlanType | null; to: PlanType | null }
  | { kind: 'centerStatus'; from: CenterStatus | null; to: CenterStatus | null }
  | { kind: 'studentStatus'; from: StudentStatus | null; to: StudentStatus | null }
  | { kind: 'role'; from: MemberRole | null; to: MemberRole | null }
  | { kind: 'attendanceStatus'; from: AttendanceStatus | null; to: AttendanceStatus | null }
  | { kind: 'money'; from: number | null; to: number | null }
  | { kind: 'count'; from: number | null; to: number | null }
  | { kind: 'date'; from: string | null; to: string | null }

/** The row this line is about, for the one lookup the screen makes per table. */
export type AuditSubject = {
  table: 'students' | 'teachers' | 'employees'
  id: string
}

export type AuditEntry = {
  id: string
  entity: string
  /**
   * The row it happened to.
   *
   * Not the same question as `subject`, which is the person a screen can name. This is
   * the invoice, the payment or the guardian record itself — and on an update it is the
   * only way back to that person, because a snapshot holds only the columns that moved
   * and `student_id` is never one of them.
   */
  entityId: string | null
  operation: AuditOperation
  action: AuditAction
  subject: AuditSubject | null
  /** A name or number the snapshot itself carried, when it carried one. */
  label: string | null
  amountBdt: number | null
  shift: AuditShift | null
  /** Columns that moved and are not drawn. */
  otherCount: number
  actor: string | null
  actorRole: string | null
  at: string
}

/** The shape the screen selects. `unknown` for the two jsonb columns, as they arrive. */
export type AuditLogRow = {
  id: string
  entity: string
  entity_id: string | null
  operation: AuditOperation
  before: unknown
  after: unknown
  actor: string | null
  actor_role: string | null
  created_at: string
}

type Snapshot = Record<string, unknown>

/**
 * Bookkeeping no reader asked about: which row, which centre, when it was made — and the
 * stamps a guard trigger writes alongside a change the line already names. An override
 * moves `marked_by`, `marked_at` and `revision` every single time, and all three are
 * already on the line as its actor, its time and the fact that it is a correction, so
 * counting them would be counting the line's own contents. `called_by` and `called_at`
 * are frozen and cannot move, and are here so that a support session moving them by hand
 * does not read as three anonymous details.
 */
const NOISE = new Set([
  'id',
  'coaching_center_id',
  'created_at',
  'updated_at',
  'idempotency_key',
  'marked_at',
  'marked_by',
  'revision',
  'called_at',
  'called_by',
])

type Facts = {
  op: AuditOperation
  moved: Set<string>
  before: Snapshot
  after: Snapshot
}

type Rule = {
  /** Defaults to 'updated', which is what all but a handful of rules are about. */
  on?: AuditOperation
  /** A column that must have moved for this rule to apply. */
  column?: string
  /** Anything the column alone cannot decide — which direction, or from what. */
  is?: (f: Facts) => boolean
  action: AuditAction
  /** Drawn as a before-and-after, using `column` unless another is named. */
  shift?: AuditShift['kind']
  shiftColumn?: string
}

/**
 * First match wins, so the order in each list is the priority.
 *
 * A save that moved both `amount_bdt` and `note` is a fee amount change, and putting
 * `amount_bdt` above the catch-all is the whole of how that is said.
 */
const RULES: Record<AuditedTable, Rule[]> = {
  coaching_centers: [
    { on: 'created', action: 'rowCreated' },
    { column: 'plan', action: 'planChanged', shift: 'plan' },
    {
      column: 'student_capacity',
      is: (f) => num(f.after.student_capacity) > num(f.before.student_capacity),
      action: 'placesBought',
      shift: 'count',
    },
    { column: 'student_capacity', action: 'placesReduced', shift: 'count' },
    { column: 'status', action: 'centerStatusChanged', shift: 'centerStatus' },
    { column: 'paid_through', action: 'subscriptionExtended', shift: 'date' },
    { column: 'trial_ends_at', action: 'trialChanged' },
    { column: 'trial_plan', action: 'trialChanged' },
    { column: 'payment_number', action: 'paymentNumberChanged' },
    { column: 'payment_wallet', action: 'paymentNumberChanged' },
    { column: 'sms_credit_balance', action: 'creditsChanged', shift: 'count' },
  ],
  center_members: [
    { on: 'created', action: 'memberAdded' },
    { column: 'role', action: 'roleChanged', shift: 'role' },
    { column: 'active', is: (f) => f.after.active === false, action: 'memberStopped' },
    { column: 'active', action: 'memberRestored' },
  ],
  teachers: [
    { on: 'created', action: 'teacherAdded' },
    // A login is `user_id` arriving on a record that had none — §5.1's "Create Login
    // Account", and the half of §10's "accounts created" that is not a membership row.
    { column: 'user_id', is: (f) => f.before.user_id === null, action: 'loginCreated' },
    { column: 'active', is: (f) => f.after.active === false, action: 'teacherStopped' },
    { column: 'active', action: 'teacherRestored' },
  ],
  teacher_permissions: [
    { on: 'created', action: 'permissionsChanged' },
    { action: 'permissionsChanged' },
  ],
  employees: [
    { on: 'created', action: 'employeeAdded' },
    { column: 'left_on', is: (f) => f.after.left_on !== null, action: 'employeeLeft' },
    { column: 'active', is: (f) => f.after.active === false, action: 'employeeStopped' },
  ],
  students: [
    { on: 'created', action: 'studentAdmitted' },
    { column: 'status', action: 'studentStatusChanged', shift: 'studentStatus' },
    { column: 'branch_id', action: 'studentMoved' },
    { column: 'guardian_phone', action: 'guardianPhoneChanged' },
    { column: 'sms_opt_out', action: 'consentChanged' },
  ],
  guardians: [
    { column: 'phone', action: 'guardianPhoneChanged' },
    { column: 'sms_opt_out', action: 'consentChanged' },
  ],
  // One rule and no condition, because the condition is in the database: 20260811000064
  // attaches its trigger with a WHEN clause, so the only line that can reach here is a
  // status changed by somebody other than the teacher who called the mark.
  //
  // No SUBJECT entry, and there cannot be one. `enrollment_id` does not move on a
  // correction, so it is not in the snapshot, and `entity_id` is the mark itself — nothing
  // on the line resolves to a child without a read this module does not do. The activity
  // screen does it instead, following the mark to its enrolment to its student the way it
  // already follows an invoice.
  attendance_records: [
    { column: 'status', action: 'attendanceOverridden', shift: 'attendanceStatus' },
  ],
  fee_invoices: [
    { on: 'created', action: 'feeRaised' },
    { column: 'voided_at', is: (f) => f.after.voided_at !== null, action: 'feeVoided' },
    {
      column: 'discount_bdt',
      is: (f) => num(f.after.discount_bdt) > num(f.before.discount_bdt),
      action: 'discountGranted',
      shift: 'money',
    },
    { column: 'discount_bdt', action: 'discountRemoved', shift: 'money' },
    { column: 'amount_bdt', action: 'feeAmountChanged', shift: 'money' },
    { column: 'due_date', action: 'feeDueDateChanged', shift: 'date' },
  ],
  fee_payments: [{ on: 'created', action: 'paymentReceived' }],
  // Three rules and no catch-all, because 20260811000069 grants update on `name` and
  // `active` and nothing else: an award's rate is frozen, so the list below is the whole
  // of what an owner can do to one after creating it. The retire/restore pair is the same
  // shape as every other switched-off row in this schema.
  fee_scholarships: [
    { on: 'created', action: 'awardCreated' },
    { column: 'active', is: (f) => f.after.active === false, action: 'awardRetired' },
    { column: 'active', action: 'awardRestored' },
    { column: 'name', action: 'awardRenamed' },
  ],
  salary_terms: [
    { on: 'created', action: 'salarySet' },
    // 20260811000044 retires the previous agreement automatically, so this arm is mostly
    // the database's own doing — and is exactly the line that reads back a sequence of
    // agreements when a raise is disputed.
    { column: 'active', is: (f) => f.after.active === false, action: 'salaryRetired' },
    { action: 'salaryTermsChanged' },
  ],
  salary_payments: [{ on: 'created', action: 'salaryPaid' }],
  expenses: [{ on: 'created', action: 'expenseRecorded' }],
  payments: [{ on: 'created', action: 'platformPaymentRecorded' }],
  // Keyed on the timestamps rather than on `state`, and that is the cheaper of two honest
  // options. Each of these columns moves once, in one direction, and names exactly one
  // outcome; `state` would need a shift kind and a word for every value of the enum to say
  // the same thing. `state` moves in the same update, so nothing is lost — and a save that
  // reaches none of these (an `initiated_at`, an expiry pushed out) reads as a change to a
  // payment request, which is what it is.
  payment_intents: [
    { on: 'created', action: 'paymentRequested' },
    // Refunded above settled, and the order is the point: a refund is a settlement being
    // reversed, so a snapshot carrying both timestamps is the reversal. The trigger stores
    // only the columns that moved, which usually settles it — this decides the case where
    // something moves both.
    { column: 'refunded_at', is: (f) => f.after.refunded_at !== null, action: 'paymentRefunded' },
    { column: 'settled_at', is: (f) => f.after.settled_at !== null, action: 'paymentSettled' },
    { column: 'failed_at', is: (f) => f.after.failed_at !== null, action: 'paymentFailed' },
    {
      column: 'cancelled_at',
      is: (f) => f.after.cancelled_at !== null,
      action: 'paymentCancelled',
    },
  ],
  subscriptions: [
    { on: 'created', action: 'subscriptionStarted' },
    { column: 'plan', action: 'planChanged', shift: 'plan' },
    { column: 'status', action: 'centerStatusChanged', shift: 'centerStatus' },
  ],
}

/** The figure a `created` line leads with, per table. */
const MONEY_ON_CREATE: Partial<Record<AuditedTable, readonly string[]>> = {
  fee_invoices: ['amount_bdt'],
  fee_payments: ['amount_bdt'],
  salary_payments: ['amount_bdt'],
  expenses: ['amount_bdt'],
  payments: ['amount_bdt'],
  payment_intents: ['amount_bdt'],
  salary_terms: ['net_bdt', 'per_class_bdt'],
  // Not fee_scholarships, whose `amount_bdt` is a rule and not a sum: "৳500" under "Award
  // created" reads as five hundred taka having moved, when what happened is that a waiver
  // worth that much now exists. The award's name carries the line instead, off
  // LABEL_COLUMNS — and a percentage award has no figure to lead with at all.
}

/** Which row a line is about, when it is about one a screen can name. */
const SUBJECT: Partial<
  Record<AuditedTable, { table: AuditSubject['table']; column: string | null }[]>
> = {
  students: [{ table: 'students', column: null }],
  guardians: [{ table: 'students', column: 'student_id' }],
  fee_invoices: [{ table: 'students', column: 'student_id' }],
  fee_payments: [{ table: 'students', column: 'student_id' }],
  teachers: [{ table: 'teachers', column: null }],
  // Keyed on `teacher_id`, which is what the trigger was given as its target column.
  teacher_permissions: [{ table: 'teachers', column: null }],
  employees: [{ table: 'employees', column: null }],
  salary_terms: [
    { table: 'teachers', column: 'teacher_id' },
    { table: 'employees', column: 'employee_id' },
  ],
  salary_payments: [
    { table: 'teachers', column: 'teacher_id' },
    { table: 'employees', column: 'employee_id' },
  ],
}

/** A name or number off the snapshot itself, in the order a reader would prefer. */
const LABEL_COLUMNS = ['name', 'receipt_no', 'voucher_no', 'student_code'] as const

function snapshot(value: unknown): Snapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Snapshot)
    : {}
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function money(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/**
 * The line, described.
 *
 * Never throws and never returns nothing: an entity with no rules, or an update no rule
 * claims, comes back as `rowCreated`/`rowUpdated`/`rowDeleted` with the moved columns
 * counted. A log that cannot describe a line is worse than one that describes it
 * plainly, because the line is the evidence.
 */
export function describeAuditEntry(row: AuditLogRow): AuditEntry {
  const before = snapshot(row.before)
  const after = snapshot(row.after)

  const moved = new Set<string>()
  for (const key of [...Object.keys(before), ...Object.keys(after)]) {
    if (!NOISE.has(key)) moved.add(key)
  }

  const facts: Facts = { op: row.operation, moved, before, after }
  const rules = isAuditedTable(row.entity) ? RULES[row.entity] : []
  const matched = rules.find(
    (rule) =>
      (rule.on ?? 'updated') === row.operation
      && (rule.column === undefined || moved.has(rule.column))
      && (rule.is === undefined || rule.is(facts)),
  )

  const action: AuditAction =
    matched?.action
    ?? (row.operation === 'created'
      ? 'rowCreated'
      : row.operation === 'deleted'
        ? 'rowDeleted'
        : 'rowUpdated')

  const shiftColumn = matched?.shiftColumn ?? matched?.column
  const shift =
    matched?.shift && shiftColumn
      ? shiftOf(matched.shift, before[shiftColumn], after[shiftColumn])
      : null

  // What the line already accounts for: the column the action is named after, and the
  // one it draws a before-and-after of. Usually the same column.
  const named = new Set<string>()
  if (matched?.column !== undefined) named.add(matched.column)
  if (shiftColumn !== undefined) named.add(shiftColumn)

  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    operation: row.operation,
    action,
    subject: subjectOf(row, before, after),
    label: labelOf(before, after),
    amountBdt: amountOf(row, after),
    shift,
    // The columns the line does not draw. A create counts none: the whole row is new,
    // and "and 14 more" under "Payment received" would be counting its own existence.
    otherCount: row.operation === 'updated' ? Math.max(0, moved.size - named.size) : 0,
    actor: row.actor,
    actorRole: row.actor_role,
    at: row.created_at,
  }
}

function shiftOf(kind: AuditShift['kind'], from: unknown, to: unknown): AuditShift {
  switch (kind) {
    case 'money':
      return { kind, from: money(from), to: money(to) }
    case 'count':
      return { kind, from: money(from), to: money(to) }
    case 'date':
      return { kind, from: text(from), to: text(to) }
    case 'plan':
      return { kind, from: text(from) as PlanType | null, to: text(to) as PlanType | null }
    case 'centerStatus':
      return {
        kind,
        from: text(from) as CenterStatus | null,
        to: text(to) as CenterStatus | null,
      }
    case 'studentStatus':
      return {
        kind,
        from: text(from) as StudentStatus | null,
        to: text(to) as StudentStatus | null,
      }
    case 'role':
      return { kind, from: text(from) as MemberRole | null, to: text(to) as MemberRole | null }
    case 'attendanceStatus':
      return {
        kind,
        from: text(from) as AttendanceStatus | null,
        to: text(to) as AttendanceStatus | null,
      }
  }
}

function subjectOf(row: AuditLogRow, before: Snapshot, after: Snapshot): AuditSubject | null {
  if (!isAuditedTable(row.entity)) return null
  for (const candidate of SUBJECT[row.entity] ?? []) {
    const id =
      candidate.column === null
        ? row.entity_id
        : text(after[candidate.column]) ?? text(before[candidate.column])
    if (id !== null) return { table: candidate.table, id }
  }
  return null
}

function labelOf(before: Snapshot, after: Snapshot): string | null {
  for (const column of LABEL_COLUMNS) {
    const value = text(after[column]) ?? text(before[column])
    if (value !== null) return value
  }
  return null
}

/**
 * The figure, and only on a create.
 *
 * An update draws its money as a before-and-after instead, which says more: "৳1,500"
 * under "Fee amount changed" is the half of the sentence nobody needed.
 */
function amountOf(row: AuditLogRow, after: Snapshot): number | null {
  if (row.operation !== 'created' || !isAuditedTable(row.entity)) return null
  for (const column of MONEY_ON_CREATE[row.entity] ?? []) {
    const value = money(after[column])
    if (value !== null && value !== 0) return value
  }
  return null
}
