/**
 * The paper, the instant there is money to put on it.
 *
 * WHAT THIS FILE IS GUARDING, and it was a complaint about the product rather than a design
 * note. A manager paid a salary; the form answered "Paid. Voucher no. 1042." and stopped. The
 * only way to the slip was to scroll to the register below this row, notice that the voucher
 * number in it was underlined, and guess that it was a link. The person who had just been
 * paid was standing at the desk. The same shape was everywhere money changed hands: the fee
 * receipt, the refund slip, the expense voucher — each one printable, each one reachable only
 * by finding the right number on the right list.
 *
 * SO THERE ARE TWO CONTRACTS NOW, and both are checked here rather than in prose:
 *
 *   - A write that produces a document returns the document's id, so the confirmation can
 *     offer the paper instead of a number to memorise. `paySalary` and `recordExpense` are
 *     the two that did not; the fee and refund actions already did.
 *
 *   - The way to a printable is drawn by `PaperLink`, which exists so that "the number is the
 *     button" cannot come back. In a row it is a numbered chip with a printer on it; under a
 *     confirmation it is a button that names the paper.
 *
 * WHY SOURCE-SHAPE AND NOT A RENDER. This suite runs on `node --test` with no DOM and no
 * JSX runtime — the app's own screens are only ever read as text here. So each assertion below
 * is written against the code with comments stripped first, because a comment is a substring
 * like any other and every one of these files explains the very thing it is being checked for.
 *
 * THE REPLAY BRANCH IS THE HALF THAT IS EASY TO LOSE. Both actions answer a retried submit
 * with the row the *first* arrival wrote, which is the whole point of their idempotency index:
 * the same slip, not a second one. So the id comes back out of the read-back as well as out of
 * the insert, and that is asserted separately — a change that only wired the happy path would
 * print one button for the manager on a flaky connection and none for anybody else.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

/**
 * A file with its prose taken off.
 *
 * Every assertion here is about code, and the comments in these files quote the class names,
 * the routes and the sentences they were written about — so a check that did not strip them
 * could be satisfied by an explanation of the thing it is checking for.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAPER = read('src', 'components', 'paper-link.tsx')
const PAPER_CODE = codeOnly(PAPER)
const ICONS = read('src', 'components', 'icons.tsx')
const PAY_ACTION = read('src', 'app', '(app)', 'payroll', 'pay', 'actions.ts')
const PAY_ROW = read('src', 'app', '(app)', 'payroll', 'pay', 'pay-row.tsx')
const PAY_PAGE = read('src', 'app', '(app)', 'payroll', 'pay', 'page.tsx')
const EXPENSE_ACTION = read('src', 'app', '(app)', 'expenses', 'actions.ts')
const EXPENSE_FORM = read('src', 'app', '(app)', 'expenses', 'expense-form.tsx')
const EXPENSE_PAGE = read('src', 'app', '(app)', 'expenses', 'page.tsx')
const FEE_ROW = read('src', 'app', '(app)', 'fees', 'payment-row.tsx')
const FEE_REFUND = read('src', 'app', '(app)', 'fees', 'refund.tsx')
const FEE_REGISTER = read('src', 'app', '(app)', 'fees', 'register', 'page.tsx')

/* -------------------------------------------------------------------------- */
/* The shared control                                                          */
/* -------------------------------------------------------------------------- */

test('the paper link is a link with a name, a printer, and the same floor as every button', () => {
  const code = codeOnly(PAPER)

  // A link and not a button: the destination is a route (the sheet), and the sheet is where
  // the Print button lives. Nothing in here may call `window.print()` itself.
  assert.match(code, /<Link\n\s+href=\{href\}/)
  assert.doesNotMatch(code, /window\.print/)

  // The accessible name is required, because in the chip the visible text is a number.
  assert.match(code, /label: string/)
  assert.match(code, /aria-label=\{label\}/)

  // 48px, the floor ui.tsx states, on both variants.
  assert.match(code, /const BUTTON =[\s\S]*?min-h-tap/)
  assert.match(code, /const CHIP =[\s\S]*?min-h-tap/)

  // The chip is the one that prints: `/fees/register` is itself a printed sheet, and a receipt
  // column that printed as blank would be a register nobody could reconcile. So the box comes
  // off on paper and the printer glyph goes with it — never the number.
  assert.match(code, /print:min-h-0 print:gap-0 print:rounded-none print:border-0/)
  assert.match(code, /print:bg-transparent/)
  assert.match(code, /print:text-ink/)
  // Scoped to the chip's own constant, and not "the first print:hidden anywhere after it" —
  // the icon on the line below carries one, and a `[\s\S]*?` from here reaches it.
  const chip = code.slice(code.indexOf('const CHIP ='), code.indexOf('export function'))
  assert.doesNotMatch(chip, /print:hidden/, 'the numbered chip must survive the printer')

  // The button, by contrast, is chrome and is hidden when printed — `PrintButton`'s rule.
  assert.match(code, /const BUTTON =[\s\S]*?print:hidden/)

  // A printer that inherits the text colour rather than an image in a second colour.
  assert.match(ICONS, /export function PrintIcon/)
  assert.match(code, /<PrintIcon className=\{dense \? 'size-4 shrink-0 print:hidden' : 'size-4 shrink-0'\}/)
})

/* -------------------------------------------------------------------------- */
/* Payroll                                                                     */
/* -------------------------------------------------------------------------- */

test('a paid salary answers with the slip it wrote, insert and replay alike', () => {
  // The id travels with the voucher number, out of the insert …
  assert.match(PAY_ACTION, /\.select\('id, voucher_no'\)\n\s+\.single\(\)/)
  assert.match(PAY_ACTION, /paymentId = written\.id/)

  // … and out of the read-back, which is the branch a retried submit lands on. Missing this
  // one would hand the manager a button on the first tap and nothing on the second.
  assert.match(PAY_ACTION, /paymentId = existing\.id/)

  assert.match(
    PAY_ACTION,
    /return \{ ok: t\.savedVoucher\(voucherNo\), receipt: \{ id: paymentId, no: voucherNo \} \}/,
  )

  // One state for the sentence and the button, so a failure can never leave a slip behind.
  assert.match(
    PAY_ACTION,
    /export type PayState =\n\s+\| \{ error\?: string; ok\?: string; receipt\?: \{ id: string; no: number \} \}/,
  )
})

test('the payroll row offers the payslip the moment the payment lands', () => {
  const code = codeOnly(PAY_ROW)

  assert.match(code, /import \{ PaperLink \} from '@\/components\/paper-link'/)
  assert.match(code, /\{state\?\.receipt && \(\n\s+<PaperLink\n\s+href=\{`\/payroll\/payslip\/\$\{state\.receipt\.id\}`\}/)
  assert.match(code, /label=\{`\$\{t\.printSlip\} \$\{state\.receipt\.no\}`\}/)
  assert.match(code, /\{t\.printSlip\}/)
})

test('the payroll register links its vouchers through the shared control', () => {
  const code = codeOnly(PAY_PAGE)

  assert.match(code, /import \{ PaperLink \} from '@\/components\/paper-link'/)
  assert.match(code, /<PaperLink\n\s+dense\n\s+href=\{`\/payroll\/payslip\/\$\{v\.id\}`\}/)
  // The number is still the label — it is what an owner matches against the paper in hand.
  assert.match(code, /\{v\.voucherNo\}\n\s+<\/PaperLink>/)
})

/* -------------------------------------------------------------------------- */
/* Spending                                                                    */
/* -------------------------------------------------------------------------- */

test('a recorded expense answers with the voucher it wrote, insert and replay alike', () => {
  assert.match(EXPENSE_ACTION, /\.select\('id, voucher_no'\)\n\s+\.single\(\)/)
  assert.match(EXPENSE_ACTION, /voucherId = written\.id/)
  assert.match(EXPENSE_ACTION, /voucherId = existing\.id/)
  assert.match(
    EXPENSE_ACTION,
    /return \{ ok: t\.savedVoucher\(voucherNo\), receipt: \{ id: voucherId, no: voucherNo \} \}/,
  )
  assert.match(
    EXPENSE_ACTION,
    /export type ExpenseState =\n\s+\| \{ error\?: string; ok\?: string; receipt\?: \{ id: string; no: number \} \}/,
  )
})

test('the spending form offers the voucher the moment it is written', () => {
  const code = codeOnly(EXPENSE_FORM)

  assert.match(code, /import \{ PaperLink \} from '@\/components\/paper-link'/)
  assert.match(code, /\{state\?\.receipt && \(\n\s+<PaperLink\n\s+href=\{`\/expenses\/voucher\/\$\{state\.receipt\.id\}`\}/)
  assert.match(code, /\{t\.printVoucher\}/)
})

test('the spending register links its vouchers through the shared control', () => {
  const code = codeOnly(EXPENSE_PAGE)

  assert.match(code, /import \{ PaperLink \} from '@\/components\/paper-link'/)
  assert.match(code, /<PaperLink\n\s+dense\n\s+href=\{`\/expenses\/voucher\/\$\{r\.id\}`\}/)
})

/* -------------------------------------------------------------------------- */
/* Fees                                                                        */
/* -------------------------------------------------------------------------- */

test('taking money and handing it back both offer the slip in one tap', () => {
  for (const [name, source] of [
    ['the payment row', FEE_ROW],
    ['the refund panel', FEE_REFUND],
  ] as const) {
    const code = codeOnly(source)

    assert.match(code, /import \{ PaperLink \} from '@\/components\/paper-link'/, name)
    assert.match(
      code,
      /\{state\?\.receipt && \(\n\s+<div className="[^"]*">\n\s+<PaperLink\n\s+href=\{`\/fees\/receipt\/\$\{state\.receipt\.id\}`\}/,
      name,
    )
    assert.match(code, /\{t\.receiptLink\}/, name)
    // The number is still read out loud beside the button, and no longer *inside* it.
    assert.match(code, /#\{state\.receipt\.no\}/, name)
  }
})

test('the fee register is still printable, and now says so on screen', () => {
  const code = codeOnly(FEE_REGISTER)

  assert.match(code, /import \{ PaperLink \} from '@\/components\/paper-link'/)
  assert.match(code, /<PaperLink\n\s+dense\n\s+href=\{`\/fees\/receipt\/\$\{r\.id\}`\}/)
  // The sheet is printed; the chip is what carries the number onto it (asserted above on the
  // component itself), so nothing here may make the link print:hidden.
  assert.doesNotMatch(code, /print:hidden[\s\S]{0,80}receiptNo/)
})
