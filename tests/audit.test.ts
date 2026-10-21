import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUDITED_TABLES,
  describeAuditEntry,
  isAuditedTable,
  type AuditAction,
  type AuditLogRow,
} from '../src/lib/audit.ts'
import { bn } from '../src/lib/i18n/bn.ts'

/**
 * What the screen draws from a log line, tested.
 *
 * The database half of §10 is already covered by test-rls.mjs: the triggers fire, the
 * snapshots hold only the columns that moved, and no browser session can write or delete
 * a line. What has no coverage there is the naming — 20260811000046 deliberately leaves
 * "discount granted" to be computed from `before ? 'discount_bdt'` on the way to a
 * screen, "where it can be corrected without touching history". Corrected implies
 * wrong-able, so these are the tests for the part that can be wrong.
 *
 * The rules are a priority list, and most of what follows is about order: a save that
 * moved three columns has to be named after the one an owner would recognise.
 */

function row(over: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: 'a1',
    entity: 'students',
    entity_id: 's1',
    operation: 'updated',
    before: {},
    after: {},
    actor: 'u1',
    actor_role: 'authenticated',
    created_at: '2026-09-01T20:31:39.221Z',
    ...over,
  }
}

/**
 * Every action has a word, checked by the compiler rather than at runtime.
 *
 * A new arm in RULES widens `AuditAction`, and this assignment then fails to build until
 * bn.ts names it — and en.ts is typed against bn, so it fails there too. The alternative
 * is a screen rendering `undefined` for a line whose whole job is to be evidence.
 */
const ACTION_WORDS: Record<AuditAction, string> = bn.audit.actions

test('every audited table and every action has a word', () => {
  // The compiler covers the actions; this covers the filter, whose options come from
  // AUDITED_TABLES and whose labels do not.
  for (const table of AUDITED_TABLES) {
    assert.ok(bn.audit.entities[table], `no word for ${table}`)
  }
  assert.equal(Object.keys(bn.audit.entities).length, AUDITED_TABLES.length)
  assert.ok(ACTION_WORDS.paymentReceived)
})

test('a discount is named by which way it moved', () => {
  const granted = describeAuditEntry(
    row({
      entity: 'fee_invoices',
      before: { discount_bdt: 0 },
      after: { discount_bdt: 200 },
    }),
  )
  assert.equal(granted.action, 'discountGranted')
  assert.deepEqual(granted.shift, { kind: 'money', from: 0, to: 200 })
  // The one column that moved is the one the action is named after, so nothing is left
  // over to count.
  assert.equal(granted.otherCount, 0)

  const removed = describeAuditEntry(
    row({
      entity: 'fee_invoices',
      before: { discount_bdt: 200 },
      after: { discount_bdt: 0 },
    }),
  )
  assert.equal(removed.action, 'discountRemoved')
  // Both directions draw the figures. Which is which is in the action, not the arrow.
  assert.deepEqual(removed.shift, { kind: 'money', from: 200, to: 0 })
})

test('a void outranks everything else the same save did', () => {
  // Voiding an invoice that had a discount moves both columns. The reader needs to know
  // the bill is cancelled; that its discount went with it is detail.
  const voided = describeAuditEntry(
    row({
      entity: 'fee_invoices',
      before: { voided_at: null, discount_bdt: 200 },
      after: { voided_at: '2026-09-01T20:00:00Z', discount_bdt: 0 },
    }),
  )
  assert.equal(voided.action, 'feeVoided')
  // Two columns moved, one of them named by the action, so one other detail. The
  // snapshots hold only what changed — 20260811000046 filters both sides by the same
  // `is distinct from`, so an unchanged amount_bdt is in neither and cannot be counted.
  assert.equal(voided.otherCount, 1)
})

test('an amount change is named after the money, not the note beside it', () => {
  const entry = describeAuditEntry(
    row({
      entity: 'fee_invoices',
      before: { amount_bdt: 1500, note: null },
      after: { amount_bdt: 1200, note: 'sibling rate' },
    }),
  )
  assert.equal(entry.action, 'feeAmountChanged')
  assert.deepEqual(entry.shift, { kind: 'money', from: 1500, to: 1200 })
  assert.equal(entry.otherCount, 1)
  // A figure belongs to a create. An update says it with the before-and-after instead.
  assert.equal(entry.amountBdt, null)
})

test('a login is a user_id arriving, not a user_id changing', () => {
  const created = describeAuditEntry(
    row({ entity: 'teachers', before: { user_id: null }, after: { user_id: 'u9' } }),
  )
  assert.equal(created.action, 'loginCreated')

  // Reassigned to a different account is not §5.1's "Create Login Account", and no rule
  // claims it. The fallback says the row changed rather than inventing a story.
  const moved = describeAuditEntry(
    row({ entity: 'teachers', before: { user_id: 'u8' }, after: { user_id: 'u9' } }),
  )
  assert.equal(moved.action, 'rowUpdated')
  assert.equal(moved.otherCount, 1)
})

test('places bought and places given back are different sentences', () => {
  const bought = describeAuditEntry(
    row({
      entity: 'coaching_centers',
      entity_id: 'c1',
      before: { student_capacity: 100 },
      after: { student_capacity: 150 },
    }),
  )
  assert.equal(bought.action, 'placesBought')
  assert.deepEqual(bought.shift, { kind: 'count', from: 100, to: 150 })

  const reduced = describeAuditEntry(
    row({
      entity: 'coaching_centers',
      before: { student_capacity: 150 },
      after: { student_capacity: 100 },
    }),
  )
  assert.equal(reduced.action, 'placesReduced')

  // The plan outranks the capacity that came with it: an upgrade moves both, and "plan
  // changed" is the one an owner is looking for.
  const upgraded = describeAuditEntry(
    row({
      entity: 'coaching_centers',
      before: { plan: 'center', student_capacity: 100 },
      after: { plan: 'institution', student_capacity: 400 },
    }),
  )
  assert.equal(upgraded.action, 'planChanged')
  assert.deepEqual(upgraded.shift, { kind: 'plan', from: 'center', to: 'institution' })
  assert.equal(upgraded.otherCount, 1)
})

test('the previous salary agreement closing is its own line', () => {
  // 20260811000044 retires the old row itself when a new one is filed, so this line is
  // the database's own doing — and is what reads back a sequence of raises in a dispute.
  const retired = describeAuditEntry(
    row({
      entity: 'salary_terms',
      entity_id: 'st9',
      before: { active: true },
      after: { active: false },
    }),
  )
  assert.equal(retired.action, 'salaryRetired')
  // No teacher on it, and that is the snapshot's limit rather than a bug: `teacher_id`
  // did not move, so the trigger did not store it. The line sits directly beside the
  // `salarySet` create that replaced it, which carries the teacher.
  assert.equal(retired.subject, null)
  assert.equal(retired.entityId, 'st9')

  // Any other edit to the terms is the catch-all arm rather than the generic fallback,
  // because a salary agreement changing is worth a name even without knowing which part.
  const edited = describeAuditEntry(
    row({ entity: 'salary_terms', before: { net_bdt: 12000 }, after: { net_bdt: 14000 } }),
  )
  assert.equal(edited.action, 'salaryTermsChanged')
})

test('a create leads with its figure and counts nothing', () => {
  const paid = describeAuditEntry(
    row({
      entity: 'fee_payments',
      operation: 'created',
      after: {
        amount_bdt: 1500,
        receipt_no: 'R-0041',
        student_id: 's7',
        method: 'bkash',
        note: null,
        collected_by: 'u1',
      },
    }),
  )
  assert.equal(paid.action, 'paymentReceived')
  assert.equal(paid.amountBdt, 1500)
  assert.deepEqual(paid.subject, { table: 'students', id: 's7' })
  assert.equal(paid.label, 'R-0041')
  // Four other columns arrived with the row. "And 4 other details" under "Payment
  // received" would be counting the row's own existence.
  assert.equal(paid.otherCount, 0)

  // A salary agreement with no net figure falls through to the per-class rate, because a
  // by-the-class teacher has no monthly number and a blank line would say nothing.
  const terms = describeAuditEntry(
    row({
      entity: 'salary_terms',
      operation: 'created',
      after: { net_bdt: null, per_class_bdt: 350, teacher_id: 't3' },
    }),
  )
  assert.equal(terms.action, 'salarySet')
  assert.equal(terms.amountBdt, 350)

  // Zero is not a figure worth a line of its own — a waived fee draws the action alone.
  const waived = describeAuditEntry(
    row({ entity: 'fee_invoices', operation: 'created', after: { amount_bdt: 0 } }),
  )
  assert.equal(waived.amountBdt, null)
})

test('identity columns are never changes anybody made', () => {
  // The trigger's own diff cannot produce these on an update — `id` and
  // `coaching_center_id` do not move, and `updated_at` is dropped before the comparison.
  // The count must not depend on that promise: a create and a delete both store the whole
  // row, and a future shape change is exactly the sort of thing that would start putting
  // a housekeeping column in a diff.
  const entry = describeAuditEntry(
    row({
      entity: 'students',
      before: { status: 'active', id: 's1', coaching_center_id: 'c1', updated_at: 'x' },
      after: { status: 'inactive', id: 's1', coaching_center_id: 'c1', updated_at: 'y' },
    }),
  )
  assert.equal(entry.action, 'studentStatusChanged')
  assert.deepEqual(entry.shift, { kind: 'studentStatus', from: 'active', to: 'inactive' })
  assert.equal(entry.otherCount, 0)
})

test('a line about a person names the person, whichever column holds them', () => {
  // teacher_permissions is keyed on the teacher itself: the trigger was given
  // 'teacher_id' as its target column, so entity_id is already the teacher.
  const perms = describeAuditEntry(
    row({ entity: 'teacher_permissions', entity_id: 't3', after: { can_view_fees: true } }),
  )
  assert.equal(perms.action, 'permissionsChanged')
  assert.deepEqual(perms.subject, { table: 'teachers', id: 't3' })

  // salary_payments carries one of two columns and never both.
  const staffPay = describeAuditEntry(
    row({
      entity: 'salary_payments',
      operation: 'created',
      after: { amount_bdt: 9000, teacher_id: null, employee_id: 'e2', voucher_no: 'S-12' },
    }),
  )
  assert.deepEqual(staffPay.subject, { table: 'employees', id: 'e2' })
  assert.equal(staffPay.label, 'S-12')

  // A guardian's line is about the student — but only a create carries the column. On an
  // update the trigger stored the phone and nothing else, so the entry hands the screen
  // `entityId` and the screen turns the guardian row into a student.
  const guardian = describeAuditEntry(
    row({
      entity: 'guardians',
      entity_id: 'g4',
      before: { phone: '+8801711111111' },
      after: { phone: '+8801722222222' },
    }),
  )
  assert.equal(guardian.action, 'guardianPhoneChanged')
  assert.equal(guardian.subject, null)
  assert.equal(guardian.entityId, 'g4')
  // No name column in the snapshot, and a phone number is not a label.
  assert.equal(guardian.label, null)

  const added = describeAuditEntry(
    row({
      entity: 'guardians',
      operation: 'created',
      entity_id: 'g5',
      after: { student_id: 's7', name: 'Rahima Begum', phone: '+8801733333333' },
    }),
  )
  assert.deepEqual(added.subject, { table: 'students', id: 's7' })
  // The guardian's own name, off the row. The screen prefers the student's, and reaches
  // this only when that lookup finds nothing.
  assert.equal(added.label, 'Rahima Begum')
})

test('a line nobody wrote a rule for still says something', () => {
  // A table that gains a trigger before it gains a rule, and a delete of one that has
  // rules but none for deleting. Both are evidence, and evidence that will not render is
  // worse than evidence described plainly.
  const unknown = describeAuditEntry(
    row({ entity: 'batch_schedules', before: { day_of_week: 1 }, after: { day_of_week: 2 } }),
  )
  assert.equal(unknown.action, 'rowUpdated')
  assert.equal(unknown.subject, null)
  assert.equal(unknown.shift, null)
  assert.equal(unknown.otherCount, 1)

  const removed = describeAuditEntry(
    row({
      entity: 'teacher_permissions',
      operation: 'deleted',
      entity_id: 't3',
      before: { can_view_fees: true, can_manage_students: false },
      after: {},
    }),
  )
  assert.equal(removed.action, 'rowDeleted')
  // A delete counts nothing either: the whole row went, and every column of it moved.
  assert.equal(removed.otherCount, 0)

  // A snapshot that is not an object at all — a jsonb null, or a shape from before some
  // future change. Nothing to describe, and nothing thrown.
  const empty = describeAuditEntry(row({ entity: 'students', before: null, after: null }))
  assert.equal(empty.action, 'rowUpdated')
  assert.equal(empty.otherCount, 0)
  assert.equal(empty.label, null)
})

test('a role change reads as one, and the actor is carried through untouched', () => {
  const entry = describeAuditEntry(
    row({
      entity: 'center_members',
      entity_id: 'm5',
      before: { role: 'teacher' },
      after: { role: 'manager' },
      actor: null,
      actor_role: 'service_role',
    }),
  )
  assert.equal(entry.action, 'roleChanged')
  assert.deepEqual(entry.shift, { kind: 'role', from: 'teacher', to: 'manager' })
  // Attribution is the log's, not this module's: a null actor with service_role is the
  // cron worker, and naming it is the screen's decision to make.
  assert.equal(entry.actor, null)
  assert.equal(entry.actorRole, 'service_role')
  assert.equal(entry.at, '2026-09-01T20:31:39.221Z')
})

test('only the eighteen tables with triggers are audited', () => {
  assert.equal(isAuditedTable('fee_payments'), true)
  // 20260811000064 gave attendance an override marker, so 20260811000046's deferred
  // trigger exists — attached with a WHEN clause, so what reaches the log is a status
  // changed by somebody other than the teacher who took the register, and not every
  // student on every day.
  assert.equal(isAuditedTable('attendance_records'), true)
  // The two that were audited by their own migrations while this list said fifteen. A row
  // from either read as "Changed" with no table beside it, because the activity screen
  // asks isAuditedTable before it prints the name. scripts/check-migrations.mjs asserts
  // the other direction — that no trigger exists without a name here.
  assert.equal(isAuditedTable('payment_intents'), true)
  assert.equal(isAuditedTable('fee_scholarships'), true)
  // 20260811000089 signs a register taken outside its class time, and a signature is one
  // of the acts §10's log exists for: a class filed before it started or after it ended,
  // by a named person. The two actions are read off `reason`, so the line says which side
  // of the class it was written on rather than "Changed".
  assert.equal(isAuditedTable('attendance_unlocks'), true)
  assert.equal(isAuditedTable(''), false)
  assert.equal(AUDITED_TABLES.length, 18)
})

test('a payment request is named by which end it reached', () => {
  const settled = describeAuditEntry(
    row({
      entity: 'payment_intents',
      entity_id: 'pi-1',
      before: { state: 'initiated', settled_at: null },
      after: { state: 'settled', settled_at: '2026-09-02T09:00:00Z' },
    }),
  )
  assert.equal(settled.action, 'paymentSettled')

  const cancelled = describeAuditEntry(
    row({
      entity: 'payment_intents',
      before: { state: 'pending', cancelled_at: null },
      after: { state: 'cancelled', cancelled_at: '2026-09-02T09:00:00Z' },
    }),
  )
  assert.equal(cancelled.action, 'paymentCancelled')

  // A refund carries `settled_at` as well when anything touches both — the trigger stores
  // only what moved, so this is the support-session case — and the order in RULES is what
  // decides it, not the columns.
  const refunded = describeAuditEntry(
    row({
      entity: 'payment_intents',
      before: { state: 'settled', settled_at: '2026-08-01T09:00:00Z', refunded_at: null },
      after: {
        state: 'refunded',
        settled_at: '2026-08-01T09:00:00Z',
        refunded_at: '2026-09-02T09:00:00Z',
      },
    }),
  )
  assert.equal(refunded.action, 'paymentRefunded')

  // Created leads with the figure asked for, the way every other money table does.
  const asked = describeAuditEntry(
    row({
      entity: 'payment_intents',
      operation: 'created',
      after: { state: 'pending', amount_bdt: 1999, quantity: 1 },
    }),
  )
  assert.equal(asked.action, 'paymentRequested')
  assert.equal(asked.amountBdt, 1999)
})

test('an award is named, and its name is the line', () => {
  const created = describeAuditEntry(
    row({
      entity: 'fee_scholarships',
      operation: 'created',
      after: { name: 'Sibling discount', percent: '50.00', active: true },
    }),
  )
  assert.equal(created.action, 'awardCreated')
  assert.equal(created.label, 'Sibling discount')
  // Deliberately no money on the line: the award waives half a bill, and no taka moved.
  assert.equal(created.amountBdt, null)

  const retired = describeAuditEntry(
    row({
      entity: 'fee_scholarships',
      before: { active: true },
      after: { active: false },
    }),
  )
  assert.equal(retired.action, 'awardRetired')

  const restored = describeAuditEntry(
    row({
      entity: 'fee_scholarships',
      before: { active: false },
      after: { active: true },
    }),
  )
  assert.equal(restored.action, 'awardRestored')

  const renamed = describeAuditEntry(
    row({
      entity: 'fee_scholarships',
      before: { name: 'Merit' },
      after: { name: 'Merit 2026' },
    }),
  )
  assert.equal(renamed.action, 'awardRenamed')
})

test('an override is drawn as the mark it moved, not as three anonymous details', () => {
  const entry = describeAuditEntry(
    row({
      entity: 'attendance_records',
      entity_id: 'mark-9',
      before: {
        status: 'present',
        marked_by: 'rahim',
        marked_at: '2026-09-01T10:00:00Z',
        revision: 0,
      },
      after: {
        status: 'absent',
        marked_by: 'owner',
        marked_at: '2026-09-01T14:00:00Z',
        revision: 1,
      },
    }),
  )
  assert.equal(entry.action, 'attendanceOverridden')
  assert.deepEqual(entry.shift, { kind: 'attendanceStatus', from: 'present', to: 'absent' })
  // The stamp is the line: `marked_by` is its actor, `marked_at` is its time and
  // `revision` is the fact that it is a correction at all. "And 3 other details" under
  // "Attendance overridden" would be counting the sentence it is printed beneath.
  assert.equal(entry.otherCount, 0)
})
