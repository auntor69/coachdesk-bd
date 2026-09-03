/**
 * The SMS ledger and the consent roster — the one screen that spends the owner's money.
 *
 * WHAT THIS FILE IS GUARDING. Four figures stacked down a 1,216px column, each in a card
 * the width of the screen, then ten dispatches, then three hundred families at two rows
 * each with a dropdown as wide as the roster. The figures are a 386px column now, the
 * dispatch list the 550px beside them, and a family is one line from `sm`.
 *
 * §38 IS WHY THE ASSERTIONS BELOW OUTNUMBER THE LAYOUT ONES. Every number here is money
 * or consent: the three centre-scoped reads, the two that page rather than trust
 * PostgREST's silent thousand, the exhaustive status Record that turns a new enum value
 * into a build error, the `tally` that withholds a figure it cannot prove instead of
 * showing a flattering zero, and — on the roster — the two separate forms, because one
 * form would have the switch writing whatever the dropdown happened to be showing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const PAGE = read('src', 'app', '(app)', 'settings', 'sms', 'page.tsx')
const LIST = read('src', 'app', '(app)', 'settings', 'sms', 'opt-out-list.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('the figures and what they were spent on are side by side from xl', () => {
  assert.ok(
    PAGE.includes(
      '<div className="flex flex-col gap-5 xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">',
    ),
    'one column below xl, a 5/7 grid above it',
  )
  assert.ok(
    PAGE.includes('<div className="flex flex-col gap-5 xl:col-span-5">'),
    'the balance and the three tallies in one 386px column',
  )
  assert.ok(PAGE.includes('<section className="flex flex-col gap-3 xl:col-span-7">'))
  assert.equal(count(PAGE, 'xl:col-span-5'), 1)
  assert.equal(count(PAGE, 'xl:col-span-7'), 1)

  // `items-start`, or the ten-row list stretches to the height of the figures beside it.
  assert.doesNotMatch(PAGE, /xl:items-stretch/)
  assert.doesNotMatch(PAGE, /(?<=["\s`])order-\d/)

  // Source order is reading order at both widths: the balance is what they came for.
  assert.ok(PAGE.indexOf('{t.balance}') < PAGE.indexOf('{t.statusTitle}'))
  assert.ok(PAGE.indexOf('{t.statusTitle}') < PAGE.indexOf('{t.recentTitle}'))
})

test('the not-live banner is above every figure it is the caveat on', () => {
  // It used to sit between the balance and the tallies, which is where a grid cannot
  // put it and where a reader meets it after believing the numbers.
  assert.ok(PAGE.indexOf('{t.notLiveTitle}') < PAGE.indexOf('{t.balance}'))
  assert.ok(PAGE.includes('{!smsProviderConfigured() && ('), 'and still only when it is true')
  assert.ok(
    PAGE.includes(
      '<div className="max-w-4xl rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">',
    ),
    'capped: two sentences of warning are unreadable at 1,216px',
  )
})

test('the furniture is the one the other twenty-five settings screens use', () => {
  assert.ok(
    PAGE.includes('className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"'),
  )
  assert.ok(PAGE.includes('<h1 className="mt-1 text-xl font-bold text-ink lg:text-2xl">'))
  assert.equal(count(PAGE, '<h1'), 1, 'one screen, one heading')

  // A sentence about a dropped read is a sentence, not a page-wide banner.
  assert.ok(PAGE.includes('<Card className="max-w-2xl">'))
  assert.equal(count(PAGE, 'max-w-2xl'), 1)
})

test('a family is one line from sm and two rows on a phone', () => {
  assert.ok(
    LIST.includes(`            className="flex flex-col gap-2 rounded-xl border border-line bg-white
              px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4"`),
  )
  // `contents` rather than a second copy of the name and the switch behind a breakpoint.
  assert.ok(LIST.includes('<div className="flex items-center gap-3 sm:contents">'))
  assert.equal(count(LIST, 'sm:contents'), 1)
  assert.doesNotMatch(LIST, /(?<=["\s`])order-\d/)

  // Neither control may grow to the width of the roster.
  assert.ok(LIST.includes('<form action={formAction} className="shrink-0">'))
  assert.ok(LIST.includes('<form action={markAction} className="shrink-0 sm:w-48">'))
  assert.ok(
    LIST.includes('<section className="flex max-w-4xl flex-col gap-3">'),
    'and the row itself is capped, or the switch ends up a hand from the name',
  )

  // Name, then permission, then preference — at both widths, from source order alone.
  assert.ok(LIST.indexOf('{student.name}') < LIST.indexOf('name="optOut"'))
  assert.ok(LIST.indexOf('name="optOut"') < LIST.indexOf('name="channel"'))
})

/* -------------------------------------------------------------------------- */
/* §38: the three reads, and the boundary they are read across                */
/* -------------------------------------------------------------------------- */

test('every read is scoped to this centre where the gate can see it', () => {
  assert.ok(PAGE.includes("const session = await pageRole('manager')"))

  // RLS is the guarantee; the filter is the boundary, because an owner of two centres
  // passes the policy for both — and one of these reads hands out guardians' numbers.
  assert.equal(count(PAGE, ".eq('coaching_center_id', session.active.centerId)"), 3)
  for (const table of ['sms_dispatches', 'sms_logs', 'students']) {
    assert.ok(PAGE.includes(`.from('${table}')`), table)
  }
})

test('the two reads that could outgrow a thousand rows still page', () => {
  // The status tallies became the tallies of a thousand rows in no particular order the
  // day a centre passed its thousandth message; the roster silently lost its tail.
  assert.equal(count(PAGE, 'pageAll((from, to) =>'), 2)
  assert.equal(count(PAGE, '.range(from, to),'), 2)
  assert.ok(PAGE.includes(".select('status')"), 'one enum column wide, so paging is cheap')
  assert.ok(
    PAGE.includes(".select('id, name, guardian_phone, sms_opt_out, preferred_channel')"),
  )
  assert.ok(PAGE.includes(".eq('status', 'active')"))

  // Ten dispatches, newest first — the one read that is meant to be capped.
  assert.ok(PAGE.includes('.limit(10)'))
  assert.ok(PAGE.includes(".order('created_at', { ascending: false })"))

  // `.order('id')` last on both paged reads, or two rows that tie on the sort column
  // make the offset walk repeat one and skip the other.
  assert.equal(count(PAGE, "\n        .order('id')"), 2)
  assert.equal(count(PAGE, "\n        .order('name', { ascending: true })"), 1)
  assert.equal(count(PAGE, "\n      .order('created_at', { ascending: false })"), 1)
})

/* -------------------------------------------------------------------------- */
/* §38: the figures, and what is drawn when they cannot be proved             */
/* -------------------------------------------------------------------------- */

test('a new sms_status is a build error and not a missing row', () => {
  assert.ok(PAGE.includes('const counts: Record<SmsStatus, number> = {'))
  for (const status of ['queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled']) {
    assert.ok(PAGE.includes(`    ${status}: 0,`), status)
  }
  assert.ok(PAGE.includes("for (const log of 'rows' in logs ? logs.rows : []) counts[log.status]++"))

  // 'sending' is waiting, not sent: the worker has it and nobody has heard anything yet.
  assert.ok(PAGE.includes('const waiting = counts.queued + counts.sending'))
  assert.ok(PAGE.includes('{tally(counts.sent + counts.delivered)}'))
})

test('a figure that cannot be proved is a dash and never a flattering zero', () => {
  assert.equal(count(PAGE, 'worstFailure('), 2, 'the tallies and the roster, separately')
  assert.ok(PAGE.includes("const tally = (n: number) => (statusProblem === null ? String(n) : '—')"))
  assert.equal(count(PAGE, 'tally('), 3, 'declared once and used on all three tallies')

  // Not red on a dash either: an unread count is not a delivery failure.
  assert.ok(PAGE.includes("statusProblem === null && counts.failed > 0 ? 'text-absent' : 'text-ink'"))
  assert.ok(PAGE.includes("{statusProblem === 'tooLarge' ? t.statusTooLarge : t.statusUnknown}"))
  assert.ok(PAGE.includes("{rosterProblem === 'tooLarge' ? t.rosterTooLarge : t.rosterUnreadable}"))
})

test('a failed dispatch read says so instead of sending the owner on an errand', () => {
  // `null` is the failed read and `[]` the honest empty one, which is why this is two
  // arms and not `?? []` — `noneYet` tells them where to go and send one.
  assert.ok(PAGE.includes('{dispatches === null ? ('))
  assert.ok(PAGE.includes('{t.recentUnreadable}'))
  assert.ok(PAGE.includes(') : dispatches.length === 0 ? ('))
  assert.ok(PAGE.includes('{t.noneYet}'))
  assert.ok(PAGE.includes('{t.segmentNote(UCS2_SEGMENT)}'), 'and 70 characters, not 160')
})

/* -------------------------------------------------------------------------- */
/* §38: the roster is a consent control, not a list                           */
/* -------------------------------------------------------------------------- */

test('the switch and the dropdown are still two forms', () => {
  // One form would have the switch writing whatever the dropdown happened to be
  // showing, and a dropdown change toggling the switch.
  assert.equal(count(LIST, 'useActionState<ActionState, FormData>('), 2)
  assert.ok(LIST.includes('useActionState<ActionState, FormData>(\n    toggleSmsOptOut,'))
  assert.ok(LIST.includes('useActionState<ActionState, FormData>(\n    setPreferredChannel,'))
  assert.equal(count(LIST, '<form action='), 2)
  assert.equal(count(LIST, 'name="studentId"'), 2, 'each carries its own subject')

  // The submitted value is the flip of what is stored, computed on the server's copy.
  assert.ok(LIST.includes("value={student.optOut ? 'false' : 'true'}"))
  assert.ok(LIST.includes('aria-pressed={!student.optOut}'))
  assert.ok(LIST.includes('disabled={pending}'))
  assert.ok(LIST.includes('disabled={marking}'))
})

test('a channel cannot be offered here and missing on the chips', () => {
  assert.ok(LIST.includes('{CHASE_CHANNELS.map((channel) => ('))
  assert.ok(LIST.includes('{channels[channel]}'))
  // The empty string is how a form says null; the dropdown is seeded from the server.
  assert.ok(LIST.includes('<option value="">{t.channelAny}</option>'))
  assert.ok(LIST.includes("defaultValue={student.preferredChannel ?? ''}"))
  assert.ok(LIST.includes('onChange={(event) => event.currentTarget.form?.requestSubmit()}'))
  // Every control names the family it acts on, because the visible word is the state.
  assert.ok(LIST.includes('aria-label={fill(t.channelFor, { name: student.name })}'))
  assert.ok(LIST.includes('aria-label={fill(student.optOut ? t.turnOn : t.turnOff, {'))
})
