import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  PAYMENT_PURPOSES,
  purchaseReceipt,
  transferReference,
  type ReceiptPaymentRow,
} from '../src/lib/billing/receipt.ts'
import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * The receipt for money a centre paid us — §9.9's last printable.
 *
 * WHAT THESE TESTS ARE ABOUT is not arithmetic, because there is almost none: the amount is
 * a column and there is no as-of total to freeze. They are about the three decisions the
 * sheet makes that a reader cannot check for themselves.
 *
 * WHICH NUMBER IT IS CALLED BY. `payments` has no series — only `fee_payments` got one — so
 * the heading is chosen from what exists, and the choice has to be stable. An owner rings up
 * quoting a code; if the paper and the founder panel pick differently, nobody finds the row.
 *
 * WHICH NOTE IS FIT TO PRINT. `settle_payment_intent` writes `note` itself as
 * `purpose::text || ' x' || quantity`, so a customer's receipt would otherwise read
 * "student_capacity x40" — a column name and a multiplication sign, on the one sheet that
 * says what our software cost.
 *
 * WHAT IT REFUSES TO WORK OUT. §3.8 wants the rate the places were sold at, and it is not
 * stored anywhere. The last test reads the page's source to prove it does not guess, because
 * the guess would look right: `capacityBands` would happily price *the next* purchase, since
 * `student_capacity` has already gone up by the time the sheet is printed.
 */

const ROOT = path.join(import.meta.dirname, '..')

const INTENT_ID = '3f2a91bc-7d40-4c11-9e88-0b5c1d6a2f77'

/** A capacity purchase as `settle_payment_intent` leaves it. */
function settled(over: Partial<ReceiptPaymentRow> = {}): ReceiptPaymentRow {
  return {
    intent_id: INTENT_ID,
    amount_bdt: 720,
    method: 'bkash',
    reference: 'BKA7X2M9QL',
    covers_period_start: null,
    covers_period_end: null,
    note: 'student_capacity x40',
    paid_at: '2026-09-02T09:14:00+00:00',
    payment_intents: {
      purpose: 'student_capacity',
      quantity: 40,
      grants_capacity: 40,
      branch_id: null,
    },
    ...over,
  }
}

test('a settled capacity purchase is headed by the code the owner quoted', () => {
  const sheet = purchaseReceipt(settled())

  // The same string /settings/plan printed beside the transfer instructions and the founder
  // panel lists the open purchase by. This is the whole point of preferring it: the paper
  // closes the loop the purchase opened instead of opening a second one.
  assert.deepEqual(sheet.number, {
    kind: 'purchase',
    value: transferReference(INTENT_ID),
  })
  assert.equal(sheet.number?.value, 'CD-3F2A91BC')
})

test('the wallet transaction number is kept underneath, not swallowed by the heading', () => {
  // Two different identifiers for one event: what we called the sale, and what the bank
  // called it. Somebody reconciling a bKash statement needs the second one.
  assert.equal(purchaseReceipt(settled()).reference, 'BKA7X2M9QL')
})

test('the machine-written note never reaches the paper', () => {
  assert.equal(purchaseReceipt(settled()).note, null)
})

test('a note somebody typed is printed', () => {
  const sheet = purchaseReceipt(settled({ note: 'Agreed over the phone with Jamshed bhai' }))
  assert.equal(sheet.note, 'Agreed over the phone with Jamshed bhai')
})

test('only the exact machine string is dropped', () => {
  // A note that merely resembles it is somebody's words. Dropping by pattern would silently
  // eat "student_capacity x40 - second branch" and there would be nothing on the sheet to
  // show anything had been removed.
  for (const note of [
    'student_capacity x41',
    'student_capacity x40 - second branch',
    'teacher_seat x40',
    'x40',
  ]) {
    assert.equal(purchaseReceipt(settled({ note })).note, note, note)
  }
})

test('the embedded intent is read whichever shape postgrest returns', () => {
  // `payments_intent_fkey` is composite and generated as `isOneToOne: false`, so the client
  // may hand back a row or a one-row array and the house style unwraps both.
  const asRow = purchaseReceipt(settled())
  const asArray = purchaseReceipt(
    settled({ payment_intents: [settled().payment_intents as never] }),
  )
  assert.deepEqual(asArray, asRow)
})

test('an empty embed is the same as none, and does not throw', () => {
  const empty: (ReceiptPaymentRow['payment_intents'])[] = [[], null, undefined]
  for (const embed of empty) {
    const sheet = purchaseReceipt(settled({ payment_intents: embed, intent_id: null }))
    assert.equal(sheet.purpose, null)
    assert.equal(sheet.quantity, 0)
    assert.equal(sheet.placesAdded, 0)
  }
})

test('a payment the founder recorded directly is headed by its wallet number', () => {
  const sheet = purchaseReceipt(
    settled({ intent_id: null, payment_intents: null, note: 'August subscription' }),
  )

  assert.deepEqual(sheet.number, { kind: 'transfer', value: 'BKA7X2M9QL' })
  // Not twice on one sheet: it is already the heading.
  assert.equal(sheet.reference, null)
  assert.equal(sheet.note, 'August subscription')
})

test('a payment with neither an intent nor a reference is given no number at all', () => {
  // A `CD-` code minted off the payment id would look searchable to the founder and match
  // nothing. The sheet says the date and the amount identify it instead.
  const sheet = purchaseReceipt(
    settled({ intent_id: null, payment_intents: null, reference: null, note: null }),
  )
  assert.equal(sheet.number, null)
  assert.equal(sheet.reference, null)
})

test('a blank reference counts as no reference', () => {
  const sheet = purchaseReceipt(
    settled({ intent_id: null, payment_intents: null, reference: '   ' }),
  )
  assert.equal(sheet.number, null)
})

test('a numeric amount arriving as a string is still a number on the paper', () => {
  assert.equal(purchaseReceipt(settled({ amount_bdt: '720.00' })).amount, 720)
})

test('places added is the grant, and is zero on every other purpose', () => {
  assert.equal(purchaseReceipt(settled()).placesAdded, 40)

  // Mirrors `payment_intents_grant_matches_purpose`: capacity grants its quantity, every
  // other purpose grants nothing. The sheet must not offer to raise a limit it did not.
  const months = purchaseReceipt(
    settled({
      note: 'subscription x12',
      payment_intents: {
        purpose: 'subscription',
        quantity: 12,
        grants_capacity: 0,
        branch_id: null,
      },
    }),
  )
  assert.equal(months.purpose, 'subscription')
  assert.equal(months.quantity, 12)
  assert.equal(months.placesAdded, 0)
})

test('a covered period is drawn only when both ends of it are known', () => {
  const both = purchaseReceipt(
    settled({ covers_period_start: '2026-09-01', covers_period_end: '2027-08-31' }),
  )
  assert.deepEqual(both.coverage, { from: '2026-09-01', to: '2027-08-31' })

  // Half a period is not a period, and "covers 1 September — " on a receipt reads as an
  // open-ended subscription nobody sold.
  for (const half of [
    { covers_period_start: '2026-09-01', covers_period_end: null },
    { covers_period_start: null, covers_period_end: '2027-08-31' },
  ]) {
    assert.equal(purchaseReceipt(settled(half)).coverage, null)
  }
})

test('paid_at is handed on untouched, for the page to convert', () => {
  // A timestamptz, unlike `expenses.spent_on`. Converting it here and again in the page
  // would date a payment taken at 1am Dhaka to the day before.
  const stamp = '2026-09-02T20:30:00+00:00'
  assert.equal(purchaseReceipt(settled({ paid_at: stamp })).paidAt, stamp)
})

test('the transfer code is stable, short and printable', () => {
  assert.equal(transferReference(INTENT_ID), 'CD-3F2A91BC')
  assert.equal(transferReference(INTENT_ID), transferReference(INTENT_ID))
  assert.match(transferReference(INTENT_ID), /^CD-[0-9A-F]{8}$/)
  // Upper case is not decoration: it is read down a phone line and written on a bKash form.
  assert.equal(transferReference(INTENT_ID.toUpperCase()), transferReference(INTENT_ID))
})

test('every purpose the database allows has a label on the paper', () => {
  // The gap this closes is a receipt with a blank "what this paid for" line. `tsc` already
  // fails on a missing key via ALL_PURPOSES_LISTED and the dictionary's shared type; this
  // asserts the labels actually render, in both languages, for one and for many.
  for (const purpose of PAYMENT_PURPOSES) {
    for (const d of [bn, en]) {
      const label = d.purchaseReceipt.bought[purpose]
      assert.equal(typeof label, 'function', purpose)
      for (const n of [1, 12]) {
        assert.ok(label(n).trim().length > 0, `${purpose} x${n}`)
      }
    }
  }
})

test('the sheet does not recompute what the places cost', () => {
  // §3.8 wants the rate applied on the record and `payment_intents` does not store it. The
  // trap is that recomputing looks harmless: by the time this sheet is printed
  // `settle_payment_intent` has already raised `student_capacity`, so the bands would price
  // the *next* purchase — and a per-place average matches no published band whenever one
  // purchase straddles two. So the sheet prints the amount charged and nothing derived, and
  // the missing figure is recorded as a schema gap rather than guessed at on paper.
  const page = readFileSync(
    path.join(ROOT, 'src', 'app', '(app)', 'settings', 'plan', 'receipt', '[paymentId]', 'page.tsx'),
    'utf8',
  )
  for (const banned of ['capacityBands', 'priceIntent', 'capacityCostBdt', 'studentCeiling']) {
    assert.doesNotMatch(page, new RegExp(banned), banned)
  }
})
