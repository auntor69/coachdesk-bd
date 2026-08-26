/**
 * When a bill may be cancelled, and how the cancelled list is built.
 *
 * The rule under test is the one the board's button, the Server Action and
 * app.guard_invoice_void() all read, so a change here that is not also made in the
 * migration is a change that lets the browser offer something the database refuses.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  cancelVerdict,
  cancelledBills,
  type CancelledInvoiceRow,
} from '../src/lib/fees/void.ts'

test('a bill nobody has paid can be cancelled', () => {
  assert.equal(cancelVerdict({ paid: 0, voidedAt: null }), 'ok')
})

test('a bill with money on it cannot be cancelled', () => {
  // The whole rule. Voiding this one would take the family's ৳500 off their own
  // record while leaving it in the centre's takings.
  assert.equal(cancelVerdict({ paid: 500, voidedAt: null }), 'paid')
})

test('a part payment is enough to refuse — it is not about being settled', () => {
  assert.equal(cancelVerdict({ paid: 1, voidedAt: null }), 'paid')
})

test('a refund the centre still owes back also refuses', () => {
  // Negative is money handed back beyond what came in. It does not belong on a bill
  // that is about to stop existing any more than a positive sum does.
  assert.equal(cancelVerdict({ paid: -200, voidedAt: null }), 'paid')
})

test('a payment handed back in full leaves a cancellable bill', () => {
  // Netted, not counted: ৳2,000 in and ৳2,000 out is two rows in fee_payments and
  // nothing on the invoice. This is the documented way through the refusal above,
  // and the same reading the migration's trigger takes.
  assert.equal(cancelVerdict({ paid: 0, voidedAt: null }), 'ok')
})

test('an unreadable paid figure refuses rather than cancelling', () => {
  // NaN is not zero. A bill whose payments could not be added up is not a bill we
  // know to be unpaid.
  assert.equal(cancelVerdict({ paid: Number.NaN, voidedAt: null }), 'paid')
})

test('an already cancelled bill answers "already", not a refusal', () => {
  // The replay. useOffline re-sends Server Actions when a phone comes back on the
  // network, so the second arrival of a request that already worked must be told the
  // same thing as the first — see lib/idempotency.ts.
  assert.equal(cancelVerdict({ paid: 0, voidedAt: '2026-08-20T06:00:00Z' }), 'already')
})

test('already cancelled wins over the money check', () => {
  // Order matters, and this is the order. A voided bill with payments against it can
  // only come from a refund recorded after the cancellation, or from data older than
  // the trigger; either way the useful answer is "it is cancelled", not a refusal to
  // do something that has already happened.
  assert.equal(
    cancelVerdict({ paid: 800, voidedAt: '2026-08-20T06:00:00Z' }),
    'already',
  )
})

/* -------------------------------------------------------------------------- */
/* The cancelled list                                                        */
/* -------------------------------------------------------------------------- */

function row(over: Partial<CancelledInvoiceRow> = {}): CancelledInvoiceRow {
  return {
    id: 'i1',
    student_name: 'করিম',
    student_code: 'S-01',
    period_month: '2026-07-01',
    net_bdt: 2000,
    voided_at: '2026-08-20T06:00:00Z',
    void_reason: 'জুনেই ছেড়ে দিয়েছে',
    ...over,
  }
}

test('nothing in, nothing out', () => {
  assert.deepEqual(cancelledBills(null, 'অজানা'), [])
  assert.deepEqual(cancelledBills(undefined, 'অজানা'), [])
  assert.deepEqual(cancelledBills([], 'অজানা'), [])
})

test('a cancelled bill arrives with its reason and its month', () => {
  const [bill] = cancelledBills([row()], 'অজানা')
  assert.equal(bill.id, 'i1')
  assert.equal(bill.name, 'করিম')
  assert.equal(bill.studentCode, 'S-01')
  assert.equal(bill.periodMonth, '2026-07-01')
  assert.equal(bill.net, 2000)
  assert.equal(bill.reason, 'জুনেই ছেড়ে দিয়েছে')
})

test('numeric arrives as a string from PostgREST and comes out a number', () => {
  const [bill] = cancelledBills([row({ net_bdt: '1500.00' })], 'অজানা')
  assert.equal(bill.net, 1500)
})

test('newest cancellation first', () => {
  const bills = cancelledBills(
    [
      row({ id: 'old', voided_at: '2026-08-01T06:00:00Z' }),
      row({ id: 'new', voided_at: '2026-08-25T06:00:00Z' }),
      row({ id: 'mid', voided_at: '2026-08-12T06:00:00Z' }),
    ],
    'অজানা',
  )
  assert.deepEqual(bills.map((b) => b.id), ['new', 'mid', 'old'])
})

test('an unstamped cancellation sorts last rather than throwing', () => {
  const bills = cancelledBills(
    [
      row({ id: 'nostamp', voided_at: null }),
      row({ id: 'bad', voided_at: 'not a date' }),
      row({ id: 'stamped', voided_at: '2026-08-01T06:00:00Z' }),
    ],
    'অজানা',
  )
  assert.equal(bills[0].id, 'stamped')
  assert.equal(bills.length, 3)
})

test('the cancellation stamp never reaches the caller', () => {
  // Sorted on and then dropped on purpose: voided_at is a UTC timestamp and nothing
  // on the screen shows it. A field carried only to be sorted by is one somebody
  // eventually renders in the wrong timezone.
  const [bill] = cancelledBills([row()], 'অজানা')
  assert.equal('voidedAt' in bill, false)
  assert.deepEqual(Object.keys(bill).sort(), [
    'id',
    'name',
    'net',
    'periodMonth',
    'reason',
    'studentCode',
  ])
})

test('a row with no id is dropped — there is nothing to restore', () => {
  const bills = cancelledBills([row({ id: null }), row({ id: 'keeps' })], 'অজানা')
  assert.deepEqual(bills.map((b) => b.id), ['keeps'])
})

test('a missing name falls back to the reader’s word for unknown', () => {
  const [bill] = cancelledBills([row({ student_name: null })], 'অজানা')
  assert.equal(bill.name, 'অজানা')
})

test('a blank reason is the same as none', () => {
  // A whitespace-only note renders as an empty line under a name, which reads as a
  // rendering fault rather than as "they left no reason".
  assert.equal(cancelledBills([row({ void_reason: '   ' })], 'অজানা')[0].reason, null)
  assert.equal(cancelledBills([row({ void_reason: '' })], 'অজানা')[0].reason, null)
  assert.equal(cancelledBills([row({ void_reason: null })], 'অজানা')[0].reason, null)
})

test('a reason keeps its own words but loses the padding', () => {
  const [bill] = cancelledBills([row({ void_reason: '  ভুল ছাত্র  ' })], 'অজানা')
  assert.equal(bill.reason, 'ভুল ছাত্র')
})

test('a missing month is empty rather than a made-up one', () => {
  // The row renders the month or nothing. Inventing one would put a bill in a month
  // it was not raised for on the one screen an owner goes to for corrections.
  assert.equal(cancelledBills([row({ period_month: null })], 'অজানা')[0].periodMonth, '')
})

test('a missing amount reads as zero rather than taking the page down', () => {
  assert.equal(cancelledBills([row({ net_bdt: null })], 'অজানা')[0].net, 0)
})
