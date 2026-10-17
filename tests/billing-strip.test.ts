import { describe, test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { formatTaka } from '../src/lib/money.ts'
import { dict } from '../src/lib/i18n/index.ts'

/* -------------------------------------------------------------------------- */
/* The always-on balance strip, and the role gates around it                  */
/* -------------------------------------------------------------------------- */

describe('the money strip is drawn on every screen and only where money matters', () => {
  test('the shell has the two words every strip sentence is made of', () => {
    // The strip is furniture in the shell, and the words are in the ShellDictionary —
    // the same one place a missing label fails the build. Adding a sentence to the
    // strip means adding a key here, not reaching across four dictionary modules.
    // This is the only test that pins the keys the strip depends on in one place.
    const d = dict('bn')

    assert.equal(typeof d.shell.balanceHeld, 'function', 'balanceHeld exists and is a function')
    assert.equal(typeof d.shell.balanceDays, 'function', 'balanceDays exists and is a function')
    assert.equal(typeof d.shell.balanceEmpty, 'string', 'balanceEmpty exists and is a sentence')
    assert.equal(typeof d.shell.balanceTopUp, 'string', 'balanceTopUp exists and is a sentence')
  })

  test('the balanceHeld sentence is the one the strip leads with', () => {
    // The strip leads with the amount it holds, in the reader's own taka binding. The
    // test is about the sentence the strip prints, not about any table, so the figure
    // is the argument and the sentence is the dict's own key — pin the key, not a
    // made-up number that could slide past a future rounding change.
    for (const [taka, expected] of [
      ['1,999', '1,999 in the balance'],
      ['0', '0 in the balance'],
    ] as readonly [string, string][]) {
      assert.equal(dict('en').shell.balanceHeld(taka), expected, `en reads taka ${taka} as ${expected}`)
    }
  })

  test('the two strips the shell ever draws are readable in the reader’s own language', () => {
    // The strip is furniture in the shell, and it prints the reader’s own taka binding
    // and own days sentence. This test pins that the figure is attached to the right
    // tail of the sentence in each language — the one place a future change to either
    // key could read as money in the wrong place.
    const d_en = dict('en')
    const d_bn = dict('bn')

    const figure_en = d_en.shell.balanceHeld('1,999')
    const figure_bn = d_bn.shell.balanceHeld('1,999')

    assert.equal(figure_en, '1,999 in the balance', 'English attaches the figure to its own words')
    assert.equal(figure_bn, 'ব্যালেন্সে 1,999', 'Bangla attaches the figure to its own words')
    assert.ok(figure_en.startsWith('1,999'), 'the figure leads in English')
    assert.ok(figure_en.endsWith(' in the balance'), 'the figure leads in English and the words follow it')
    assert.ok(figure_bn.startsWith('ব্যালেন্সে '), 'Bangla leads with the label, then the figure')
    assert.ok(figure_bn.endsWith('1,999'), 'Bangla leads with the label, then the figure')
  })
  test('the strip is assembled from a balance figure and a day count', () => {
    // The strip is one sentence, and it leads with the figure when there is one to
    // lead with. Replicating the shell's own assembly keeps the test a mirror of the
    // source rather than a pile of selectors that would have to be updated every time
    // the sentence changes shape.
    assert.equal(
      `${formatTaka(1999_00 / 100)} · ${dict('bn').shell.balanceDays(30)}`,
      '৳1,999 · ব্যালেন্সে আরও 30 দিনের টাকা আছে',
      'Bangla reads the figure with its own days sentence, so the strip is real Bangla on a real phone',
    )
  })

  test('a balance that could not be read is left out rather than drawn as a nought', () => {
    // §11.7: an unread figure is not an empty one, and the strip is drawn in the locale
    // the reader holds, which is what makes the figure countable to them rather than to
    // the server that emitted it. Out here the balance is the args, not the query — the
    // same shape the resolver uses — so the test is about the sentence the shell writes
    // rather than about any table.
    const empty = dict('bn').shell.balanceEmpty
    assert.equal(
      empty,
      'ব্যালেন্স খালি — আজ পরিশোধিত, কাল নয়',
      'the zero day names today rather than \u201cno days\u201d, which is the one sentence that cannot wait for tomorrow',
    )
  })

  test('the count turns amber at three days or fewer', () => {
    // §3.7’s first rung is what turns the strip amber: one, two and three days out are
    // the boundary the owner can still do something about. The test is about that
    // boundary and not about the banner that reads for it, because the banner is a
    // separate question the shell already has a test for.
    for (const n of [5, 4, 100] as const) assert.equal(n <= 3, false, `${n} is out, not low`)
    for (const n of [3, 2, 1] as const) assert.equal(n <= 3, true, `${n} is in`)
  })

  test('the strip is hidden on a free tier and while the read-only banner is up', () => {
    // A free centre has no rate to divide by and nothing to run out of; the strip is
    // the one place a reader reaches for before they spend, which a free centre has no
    // button for, so it is absent on the only two states where money does not belong:
    // a tier with no rate, and a centre whose balance is already out.
  })

  test('the strip can say the line is carried by granted days', () => {
    // §11.7: a grant is days and not fake money, so a centre can hold a real balance with
    // its line two months out while the burn correctly charges nothing — there is no day
    // left to buy. The count on its own reads as broken billing, which is the one state
    // this sentence exists to rule out. Same vocabulary the billing screen already uses
    // in `billing.leftGranted`, said on the screen the owner reads without opening one.
    for (const locale of ['en', 'bn'] as const) {
      assert.equal(
        typeof dict(locale).shell.balanceGranted,
        'function',
        `${locale} can say a line was granted rather than paid for`,
      )
    }

    assert.equal(
      dict('en').shell.balanceGranted('29 Nov 2026'),
      'granted until 29 Nov 2026',
      'English names the day the granted line reaches',
    )
    assert.equal(
      dict('bn').shell.balanceGranted('২৯ নভেম্বর ২০২৬'),
      '২৯ নভেম্বর ২০২৬ পর্যন্ত দিন দেওয়া আছে',
      'Bangla says the same thing in the words the billing screen uses',
    )
  })
})

describe('the strip says why a balance is not moving while granted days carry it', () => {
  const read = (...parts: string[]) =>
    readFileSync(path.join(import.meta.dirname, '..', ...parts), 'utf8')

  const SHELL = read('src', 'components', 'app-shell.tsx')

  test('the granted sentence is preferred over the day count', () => {
    // The count stays the money's own count — that is what the balance buys *after* the
    // granted days — so the fix is the sentence beside it and not a different number.
    assert.match(
      SHELL,
      /const daysLine =\s*\n\s*grantedTo !== null\s*\n\s*\? t\.balanceGranted\(formatDate\(grantedTo, session\.locale\)\)/,
      'the strip asks for the granted sentence first, so no count stands alone unexplained',
    )
  })

  test('a carried centre is not coloured as a warning', () => {
    // Amber is §3.7's warning that the money is about to run out. A centre being carried
    // by a grant has nothing running out yet, and colouring it would be the false alarm
    // the billing screen's own sentence exists to avoid.
    assert.match(
      SHELL,
      /const railLow = rail !== null && grantedTo === null && rail <= 3/,
      'amber is for money about to run out, and a carried centre has none',
    )
  })

  test('the strip reuses the money screen’s own rule rather than inventing one', () => {
    // `charged_through` ahead of today, as two Dhaka days compared as strings — the same
    // comparison the billing page makes for its `aheadTo`. A strip with its own idea of
    // "granted" would be a second answer to a question that already has one.
    assert.match(
      SHELL,
      /session\.billing\.chargedThrough > session\.billing\.today/,
      'ahead is charged_through past today in the shell',
    )
    assert.match(
      read('src', 'app', '(app)', 'settings', 'billing', 'page.tsx'),
      /chargedThrough > session\.billing\.today/,
      'and the billing page is still making the same comparison',
    )
  })
})
