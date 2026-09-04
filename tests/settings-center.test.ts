/**
 * The centre's own record: a name, a wallet, a number, and the message they make.
 *
 * WHAT THIS FILE IS GUARDING. The form was one column at every width — a 670px box
 * for a centre's name, and the SMS preview below the fields where a desktop reader
 * had to scroll away from the name to see what it did to the message. The preview is
 * the point of this screen, so from `xl` it is a 386px panel beside the fields and the
 * two are on screen together. Below `xl` it stays under them: it is the consequence of
 * the edits, and reading a consequence first means nothing.
 *
 * §38 MATTERS MORE HERE THAN ANYWHERE IN SETTINGS. This form decides which wallet a
 * month of fees is sent to, and a dropped read of the row once cleared it silently.
 * The layout moved every one of those decisions, and none of them may have changed:
 * the owner-only gate, the centre-scoped sample reads, the `centerError` screen that
 * refuses to draw a form at all, and the worst-case check behind "it fits".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const PAGE = read('src', 'app', '(app)', 'settings', 'center', 'page.tsx')
const FORM = read('src', 'app', '(app)', 'settings', 'center', 'center-form.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('the fields and the message they make are side by side from xl', () => {
  assert.ok(
    FORM.includes(`      className="flex max-w-xl flex-col gap-4 xl:grid xl:max-w-none xl:grid-cols-12
        xl:items-start xl:gap-6"`),
    'a capped column below xl, a 7/5 grid above it, and the panel not stretched',
  )
  assert.ok(FORM.includes('<div className="flex flex-col gap-4 xl:col-span-7">'))
  assert.ok(
    FORM.includes(`        className="rounded-2xl border border-line bg-brand-50/40 p-5 xl:sticky
          xl:top-16 xl:col-span-5"`),
    'sticky, because the fields it answers do not all fit beside it at once',
  )

  // 5 of 12 at `lg` is 279px, and the preview is a message, not a column of one.
  assert.doesNotMatch(FORM, /lg:grid-cols/)
  assert.doesNotMatch(FORM, /(?<=["\s`])order-\d/)

  // Source order is the argument: the cause, then what it costs. An `order-N` that
  // put the preview first would be the one thing this screen must never do.
  assert.ok(FORM.indexOf('xl:col-span-7') < FORM.indexOf('xl:col-span-5'))
  assert.ok(FORM.indexOf('name="name"') < FORM.indexOf('{preview.body}'))
})

test('the save button is a phone button on a phone and not a 550px one on a desktop', () => {
  assert.ok(
    FORM.includes(`          full
          disabled={pending}
          className="sm:w-auto sm:self-start"`),
  )
  // Inside the fields column, under the field it saves — not under the preview.
  assert.ok(FORM.indexOf('{pending ? common.saving : common.save}') < FORM.indexOf('{preview.body}'))
})

test('the furniture is the page bar the other settings screens use', () => {
  assert.ok(PAGE.includes('<PageHeader'))
  assert.equal(count(PAGE, '<PageHeader'), 1, 'one screen, one bar')
  assert.equal(count(PAGE, '<h1'), 0, 'the bar owns the heading')
  assert.ok(
    PAGE.includes("back={{ href: '/settings', label: d.settings.hub.title }}"),
    'and the way back is the crumb every other settings screen puts there',
  )
  assert.ok(PAGE.includes('subtitle={t.subtitle}'))

  // Neither card is a page: a manager's whole screen is three short lines, and the
  // refusal is one. Capped on the card so the bar still reaches the workspace edges.
  assert.ok(PAGE.includes('<Card className="max-w-2xl border-late/30 bg-late/5">'))
  assert.ok(PAGE.includes('<Card className="max-w-2xl">'))
})

/* -------------------------------------------------------------------------- */
/* §38: who may write it, and what it is written from                         */
/* -------------------------------------------------------------------------- */

test('the gate is still the owner and the manager still only reads', () => {
  assert.ok(PAGE.includes("const session = await pageRole('manager')"))
  assert.ok(PAGE.includes("const isOwner = session.active.role === 'owner'"))
  assert.ok(PAGE.includes('{t.readOnly}'), 'and is told which it is')

  // "Only the centre's owner can change these" is suppressed for the owner, who is the
  // owner: the true reason their form is gone is the note below it.
  assert.ok(
    PAGE.includes('{!isOwner && <p className="mt-3 text-sm text-ink-faint">{t.readOnly}</p>}'),
  )

  // The screen that draws no form at all, because a dropped row seeded the form with
  // "no wallet" and a save then wrote that over a centre that had one.
  assert.ok(PAGE.includes('{centerError ? ('))
  assert.ok(PAGE.includes('{t.unreadable}'))
  assert.ok(PAGE.includes('const wallet = center?.payment_wallet ?? null'))
  assert.ok(PAGE.includes('const number = center?.payment_number ?? null'))
  assert.ok(PAGE.includes('{t.noNumber}'), 'the manager is told when there is none')
})

test('a lapsed owner keeps the two facts and loses the form', () => {
  /*
   * §4.4, and the one screen in the product where the reads deliberately stay above the
   * decision: what a manager reads here — the centre's name and the wallet a parent sends
   * fees to — is exactly what an owner of a lapsed centre still needs to read out over the
   * phone. So the form goes, the facts stay, and the owner falls into the manager's arm.
   */
  assert.ok(PAGE.includes("const canEdit = isOwner && session.access === 'full'"))
  assert.ok(PAGE.includes('{isOwner && <ReadOnlyNote t={d.readOnly} className="max-w-2xl" />}'))
  assert.equal(count(PAGE, 'max-w-2xl'), 3, 'both cards and the note, and none of them a page')

  // No early return, therefore, and no second bar: the decision is a const.
  assert.doesNotMatch(PAGE, /if \(session\.access !== 'full'\) \{/)
  assert.ok(PAGE.indexOf('await Promise.all') < PAGE.indexOf('const canEdit'))
})

test('the sample the preview is built from is still this centre own', () => {
  // A minor's name from the owner's other centre must not appear in the sample
  // message: RLS passes them for both, so the filter is the boundary.
  assert.equal(count(PAGE, ".eq('coaching_center_id', session.active.centerId)"), 2)
  assert.ok(PAGE.includes(".eq('id', session.active.centerId)"))
  assert.ok(PAGE.includes(".select('name, payment_wallet, payment_number')"))
  assert.ok(PAGE.includes(".eq('status', 'active')"))
  assert.ok(PAGE.includes(".eq('active', true)"))
  // One row each, and `null` the honest answer for a centre with no active student
  // and no priced batch. (Counted with the `.maybeSingle()` attached, because the
  // note above them says `.limit(1)` too and a comment is also a substring.)
  assert.equal(count(PAGE, '.limit(1)\n        .maybeSingle()'), 2)

  // The stand-ins are Bangla and stay out of the dictionary: they sit inside a
  // message a guardian reads, and a guardian reads Bangla.
  assert.ok(PAGE.includes("student?.name ?? 'রাফিদ হাসান'"))
  assert.ok(PAGE.includes('Number(batch?.monthly_fee_bdt ?? 0) || 1500'))
  assert.ok(PAGE.includes('monthLabel: monthName(periodMonth, locale)'))
})

test('the form still writes the three names the action reads, and no autofill', () => {
  assert.ok(FORM.includes('name="name"'))
  assert.ok(FORM.includes('name="paymentWallet"'))
  assert.ok(FORM.includes('name="paymentNumber"'))
  assert.ok(FORM.includes("const WALLET_ORDER: PayoutWallet[] = ['bkash', 'nagad', 'rocket']"))

  // A browser offering any number it has stored would send a month of fees to
  // somebody else's wallet without a word on screen.
  assert.ok(FORM.includes('autoComplete="off"'))
  assert.ok(FORM.includes('type="tel"'))
  assert.ok(FORM.includes('inputMode="numeric"'))
  assert.ok(FORM.includes('{wallet && ('), 'no number box until a wallet is picked')
})

test('the preview still answers the worst case and not only this name', () => {
  assert.ok(FORM.includes('buildFeeReminderSms({ ...input, studentName: WORST_CASE_NAME })'))
  assert.ok(FORM.includes('inThis: configured && shown.body.includes(digits)'))
  assert.ok(FORM.includes('inWorst: configured && worst.body.includes(digits)'))
  assert.ok(FORM.includes('{preview.inWorst ? ('))
  assert.ok(FORM.includes('{t.fitsAll}'))
  assert.ok(FORM.includes('{t.fitsSome}'))
  assert.ok(FORM.includes('{t.fitsNone}'))

  // Bangla in the preview whatever the reader's language, and `lang` so a screen
  // reader does not read it as English.
  assert.ok(FORM.includes('lang="bn"'))
  assert.ok(FORM.includes("centerName: name.trim() || 'কোচিং'"))
  assert.ok(FORM.includes('{fill(t.previewTitle, { month: example.monthLabel })}'))
})
