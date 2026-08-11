import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sumTaka, tallyOutstanding, parseTaka, formatTaka } from '../src/lib/money.ts'

test('the float problem this module exists to prevent is real', () => {
  // Not a test of our code — a test of the premise. If this ever starts passing
  // with plain addition, JavaScript has grown an exact decimal type and this
  // whole module can go.
  assert.notEqual(1500.1 + 1500.1 + 1500.1, 4500.3)
  assert.equal(sumTaka([1500.1, 1500.1, 1500.1]), 4500.3)
})

test('a fee board total matches the hand calculation exactly', () => {
  // The plan's requirement: a full payment, a partial payment, and a refund,
  // and the outstanding total has to match arithmetic done on paper.
  //
  //   Rafid    1500 fee,  1500 paid            ->    0
  //   Mim      1500 fee,   800 paid            ->  700
  //   Sadia    1200 fee,  1200 paid, 200 back  ->  200
  //   Tanvir   1500 fee,     0 paid            -> 1500
  //                                    total   -> 2400
  const remaining = [
    1500 - sumTaka([1500]),
    1500 - sumTaka([800]),
    1200 - sumTaka([1200, -200]),
    1500 - sumTaka([]),
  ]
  assert.deepEqual(remaining, [0, 700, 200, 1500])
  assert.equal(sumTaka(remaining), 2400)
})

test('an overpayment is never netted against what other families owe', () => {
  // Measured in the browser before this test existed: four invoices of 1500,
  // paid 1500 / 800 / 1300 / 1600. The board showed ৳800 outstanding above two
  // unpaid rows of 700 and 200, because Tanvir's 100 credit had been subtracted
  // from other people's debt. Tap through the rows, add them up, get a different
  // number than the card — which is how an owner stops trusting the screen.
  const remainders = [0, 700, 200, -100]
  const { outstanding, credit } = tallyOutstanding(remainders)
  assert.equal(outstanding, 900)
  assert.equal(credit, 100)
  // The netted total is the bug, kept here so a future refactor that
  // reintroduces it fails loudly rather than quietly under-reporting debt.
  assert.notEqual(outstanding, sumTaka(remainders))
})

test('a board with nothing outstanding and nothing in credit is two zeros', () => {
  assert.deepEqual(tallyOutstanding([]), { outstanding: 0, credit: 0 })
  assert.deepEqual(tallyOutstanding([0, 0]), { outstanding: 0, credit: 0 })
})

test('several credits add up as a credit, not as negative debt', () => {
  const { outstanding, credit } = tallyOutstanding([-100, -50.5, 200])
  assert.equal(outstanding, 200)
  assert.equal(credit, 150.5)
})

test('a refund is a negative payment, not a deleted one', () => {
  // Paid in full, then fully refunded: the family owes the whole fee again and
  // the original payment is still on the record.
  assert.equal(sumTaka([1200, -1200]), 0)
  // Refunded more than was paid — a mistake, but it must still add up rather
  // than being clamped into a number nobody can reconcile.
  assert.equal(sumTaka([1200, -1500]), -300)
})

test('fractional taka survive being added up', () => {
  assert.equal(sumTaka([1250.5, 1250.5]), 2501)
  assert.equal(sumTaka([0.1, 0.2]), 0.3)
  assert.equal(sumTaka(Array(10).fill(0.1)), 1)
  // A hundred invoices at a price that has no exact float representation.
  assert.equal(sumTaka(Array(100).fill(1500.1)), 150010)
})

test('an empty board is zero, not NaN', () => {
  assert.equal(sumTaka([]), 0)
})

test('a missing amount is skipped rather than poisoning the total', () => {
  assert.equal(sumTaka([1500, Number.NaN, 500]), 2000)
  assert.equal(sumTaka([1500, Number.POSITIVE_INFINITY]), 1500)
})

test('parses what an owner actually types, including Bangla digits', () => {
  assert.equal(parseTaka('1500'), 1500)
  assert.equal(parseTaka('১৫০০'), 1500)
  assert.equal(parseTaka('1,500'), 1500)
  assert.equal(parseTaka('৳1500'), 1500)
  assert.equal(parseTaka(' 1500 '), 1500)
  assert.equal(parseTaka('1500.50'), 1500.5)
  assert.equal(parseTaka('১২৫০.৫০'), 1250.5)
})

test('parsing tells nonsense apart from zero', () => {
  assert.equal(parseTaka(''), null)
  assert.equal(parseTaka('abc'), null)
  assert.equal(parseTaka('১৫০০ টাকা'), null)
  assert.equal(parseTaka('--5'), null)
  assert.equal(parseTaka('0'), 0)
  // A refund is entered as a negative amount, so the sign has to survive.
  assert.equal(parseTaka('-200'), -200)
})

test('parsing rounds to the precision the column stores', () => {
  // numeric(10, 2) would round this on insert anyway; doing it here means the
  // owner is told the same number the database will hold.
  assert.equal(parseTaka('1500.005'), 1500.01)
  assert.equal(parseTaka('1500.994'), 1500.99)
})

test('money is displayed in ASCII digits, grouped, without pointless decimals', () => {
  assert.equal(formatTaka(1500), '৳1,500')
  assert.equal(formatTaka(0), '৳0')
  assert.equal(formatTaka(125000), '৳125,000')
  assert.equal(formatTaka(1500.5), '৳1,500.50')
  assert.equal(formatTaka(-200), '-৳200')
})

test('a broken amount renders as zero rather than breaking the page', () => {
  assert.equal(formatTaka(Number.NaN), '৳0')
})
