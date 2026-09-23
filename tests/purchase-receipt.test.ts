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
import { QUOTE_UNITS } from '../src/lib/billing/price.ts'
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
 * WHAT IT READS RATHER THAN WORKS OUT. §3.8 wants the rate the places were sold at, and
 * since 20260811000068 `payment_intents.priced_lines` holds it. The last two tests keep it
 * that way: one reads the page's source to prove it does not derive the figure, because the
 * derivation would look right — `capacityBands` would happily price *the next* purchase,
 * since `student_capacity` has already gone up by the time the sheet is printed — and one
 * checks that a document which is not the shape it should be prints nothing at all.
 */

const ROOT = path.join(import.meta.dirname, '..')

const INTENT_ID = '3f2a91bc-7d40-4c11-9e88-0b5c1d6a2f77'

/**
 * A capacity purchase as `settle_payment_intent` leaves it.
 *
 * Two bands rather than one, because a purchase that straddles two is the case the column
 * exists for: 40 places for ৳720 averages ৳18, which is not either rate charged.
 */
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
      priced_lines: [
        { what: 'places', count: 20, rate_bdt: 20, cost_bdt: 400 },
        { what: 'places', count: 20, rate_bdt: 16, cost_bdt: 320 },
      ],
    },
    ...over,
  }
}

test('a settled capacity purchase is headed by the code the owner quoted', () => {
  const sheet = purchaseReceipt(settled())

  // The same string /settings/billing printed beside the transfer instructions and the founder
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
    assert.deepEqual(sheet.lines, [])
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
        priced_lines: [{ what: 'months', count: 12, rate_bdt: 60, cost_bdt: 720 }],
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

test('the rate applied comes off the record, band by band', () => {
  // The point of 20260811000068: 40 places for ৳720 was 20 at ৳20 and 20 at ৳16, and no
  // arithmetic on the amount recovers that. Ascending rate order is not asserted here —
  // `capacityBands` produces it and the document is stored as it came — but the lines are
  // carried through in the order they were written, which is what makes them readable.
  const sheet = purchaseReceipt(settled())
  assert.deepEqual(sheet.lines, [
    { what: 'places', count: 20, rateBdt: 20, costBdt: 400 },
    { what: 'places', count: 20, rateBdt: 16, costBdt: 320 },
  ])
  // And they still explain the amount beside them, which the check constraint enforces on
  // the way in and this repeats on the way out.
  assert.equal(
    sheet.lines.reduce((total, line) => total + line.costBdt, 0),
    sheet.amount,
  )
})

test('a stored breakdown that is not the shape it should be prints nothing', () => {
  // ALL OR NOTHING, like the constraint. Three of four bands on a sheet totals less than
  // the amount printed under them, and a customer doing that subtraction gets a wrong
  // answer about their own money — so a document with one bad line is no document.
  const bad: unknown[] = [
    null,
    'places',
    {},
    [],
    [{ what: 'hours', count: 1, rate_bdt: 1, cost_bdt: 1 }],
    [{ what: 'places', count: 0, rate_bdt: 1, cost_bdt: 0 }],
    [{ what: 'places', count: 1, rate_bdt: -1, cost_bdt: 1 }],
    [{ what: 'places', count: '20', rate_bdt: 20, cost_bdt: 400 }],
    [{ what: 'places', count: 20, rate_bdt: 20 }],
    [{ count: 20, rate_bdt: 20, cost_bdt: 400 }],
    // One good line and one bad one: the good one does not get printed on its own.
    [
      { what: 'places', count: 20, rate_bdt: 20, cost_bdt: 400 },
      { what: 'places', count: 20, rate_bdt: 'sixteen', cost_bdt: 320 },
    ],
  ]

  for (const priced_lines of bad) {
    const sheet = purchaseReceipt(
      settled({
        payment_intents: {
          purpose: 'student_capacity',
          quantity: 40,
          grants_capacity: 40,
          branch_id: null,
          priced_lines,
        },
      }),
    )
    assert.deepEqual(sheet.lines, [], JSON.stringify(priced_lines))
    // Everything else on the sheet survives it. A breakdown nobody can read is a line
    // missing from a receipt, not a receipt withheld.
    assert.equal(sheet.amount, 720)
    assert.equal(sheet.placesAdded, 40)
  }
})

test('every unit a line can count in has a label on the paper', () => {
  // Same fence as the purposes above, one row finer. A band whose unit had no label would
  // render an empty left-hand column against a real amount — the only thing worse than no
  // breakdown is one that names no units.
  for (const unit of QUOTE_UNITS) {
    for (const d of [bn, en]) {
      const label = d.purchaseReceipt.ratedLine[unit]
      assert.equal(typeof label, 'function', unit)
      for (const n of [1, 20]) {
        assert.ok(label(n, 'x').trim().length > 0, `${unit} x${n}`)
        // The rate has to actually appear: a line reading "20 places" with the price left
        // out is the field §3.8 asked for, missing.
        assert.match(label(n, 'RATE'), /RATE/, `${unit} x${n}`)
      }
    }
  }
})

/**
 * A credit as `creditCenterPayment` leaves it: negative, no window, no intent, a reason.
 *
 * Every one of those is a check constraint in 20260811000074 rather than a convention, which
 * is why the fixture can be this plain — the shapes this function would have to be defensive
 * about cannot reach it.
 */
function credited(over: Partial<ReceiptPaymentRow> = {}): ReceiptPaymentRow {
  return {
    intent_id: null,
    amount_bdt: -750,
    method: 'bkash',
    reference: null,
    covers_period_start: null,
    covers_period_end: null,
    note: 'Moved down to Pro on 12 August, three months of centre coverage unused',
    paid_at: '2026-09-02T09:14:00+00:00',
    payment_intents: null,
    ...over,
  }
}

test('a negative row is a credit note and not a receipt', () => {
  assert.equal(purchaseReceipt(credited()).kind, 'credit')
  assert.equal(purchaseReceipt(settled()).kind, 'receipt')
})

test('a credit prints its magnitude, never a minus sign', () => {
  // The heading carries the direction. `formatTaka(-750)` on a sheet titled "Payment
  // receipt" is what this avoids, and the reason `amount` is absolute rather than signed.
  const sheet = purchaseReceipt(credited())
  assert.equal(sheet.amount, 750)
  assert.ok(sheet.amount > 0)
  // Including down the string path, since `numeric` arrives as one on some reads.
  assert.equal(purchaseReceipt(credited({ amount_bdt: '-750.00' })).amount, 750)
})

test('a credit says why, because nothing can add the reason afterwards', () => {
  const sheet = purchaseReceipt(credited())
  assert.equal(
    sheet.note,
    'Moved down to Pro on 12 August, three months of centre coverage unused',
  )
})

test('a credit has no purchase code, no purpose and no period', () => {
  // All three refused at the table — payments_credit_no_intent and
  // payments_credit_no_coverage — so what this asserts is that the sheet does not invent
  // them. A credit headed by a CD- code would read as a sale.
  const sheet = purchaseReceipt(credited())
  assert.equal(sheet.number, null)
  assert.equal(sheet.purpose, null)
  assert.equal(sheet.quantity, 0)
  assert.equal(sheet.placesAdded, 0)
  assert.equal(sheet.coverage, null)
  assert.deepEqual(sheet.lines, [])
})

test('a credit paid back over a wallet is headed by that transaction number', () => {
  // The one identifier a credit can have. An owner reconciling a bKash statement needs it,
  // and it is the only thing on the sheet both sides hold.
  const sheet = purchaseReceipt(credited({ reference: 'BKA5R1T8ZP' }))
  assert.deepEqual(sheet.number, { kind: 'transfer', value: 'BKA5R1T8ZP' })
  assert.equal(sheet.reference, null)
  assert.equal(sheet.kind, 'credit')
})

test('the credit note and the receipt come off one route and one function', () => {
  // The whole reason `kind` exists rather than each reader testing the sign. If the printable
  // ever grows a second copy of that decision, two readers can disagree about what a row is —
  // and one of them will be titling a credit "Payment receipt".
  const page = readFileSync(
    path.join(ROOT, 'src', 'app', '(app)', 'settings', 'billing', 'receipt', '[paymentId]', 'page.tsx'),
    'utf8',
  )
  assert.match(page, /sheet\.kind === 'credit'/)
  assert.match(page, /creditTitle/)
  // And nowhere does it look at the sign itself.
  assert.doesNotMatch(page, /amount\s*<\s*0/)

  /*
   * THE SECOND READER IS THE LEDGER NOW, and it does not test the sign either. The plan
   * page's receipts card was the pair this assertion used to name — it badged a credit off
   * `sheet.kind` — and it went with the page at §16.1 step 27. What replaced it is the
   * billing screen's history, where a credit arrives as a `refund`/`reversal` ledger entry
   * with its own kind word and a signed figure from `signedTaka`, and the receipt link on
   * the row opens this same printable. So the direction of the rule is unchanged: no reader
   * of a payment decides what it is from its arithmetic.
   */
  const list = readFileSync(
    path.join(ROOT, 'src', 'app', '(app)', 'settings', 'billing', 'page.tsx'),
    'utf8',
  )
  assert.doesNotMatch(list, /amount\s*<\s*0/)
  assert.doesNotMatch(list, /amount_bdt\s*</)
})

test('both languages have words for a credit note', () => {
  for (const d of [bn, en]) {
    for (const key of [
      'creditTitle',
      'creditAmount',
      'creditDate',
      'creditReason',
      'creditFootNote',
      'creditNoNumberNote',
    ] as const) {
      const word = d.purchaseReceipt[key]
      assert.equal(typeof word, 'string', key)
      assert.ok(word.trim().length > 0, key)
    }
    // And the badge the billing list puts on the row, which is in the plan group rather than
    // this one because that card owns it.
    assert.ok(d.settings.plan.paid.credit.trim().length > 0)
  }
})

test('the sheet reads what the places cost and does not recompute it', () => {
  // §3.8's rate is a column now, and the trap it replaced is still open: by the time this
  // sheet is printed `settle_payment_intent` has already raised `student_capacity`, so the
  // bands would price the *next* purchase, and a per-place average matches no published
  // band whenever one purchase straddles two. So the page may print `priced_lines` and may
  // not reach for the price list.
  const page = readFileSync(
    path.join(ROOT, 'src', 'app', '(app)', 'settings', 'billing', 'receipt', '[paymentId]', 'page.tsx'),
    'utf8',
  )
  for (const banned of ['capacityBands', 'priceIntent', 'capacityCostBdt', 'studentCeiling']) {
    assert.doesNotMatch(page, new RegExp(banned), banned)
  }
  // And it does read the stored one, so this test cannot pass by the page having dropped
  // the breakdown altogether.
  assert.match(page, /priced_lines/)
  assert.match(page, /ratedLine/)
})
