import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  customers,
  customersFileName,
  customersSheet,
  platformTotals,
  sizeLine,
  QUIET_AFTER_DAYS,
  type PlatformCenterRow,
} from '../src/lib/platform/centers.ts'
import { CENTER_MONTHLY_FLOOR_BDT, PLANS } from '../src/lib/plans.ts'
import { csvCell } from '../src/lib/csv.ts'

/**
 * The founder panel's own arithmetic.
 *
 * What is NOT tested here is anything the database decided: the counts, the
 * thirty-day windows and who the owner is are all `platform_centers()`, and
 * scripts/test-rls.mjs exercises them against real Postgres. What is left for this
 * file is the part that goes wrong in JavaScript — a numeric arriving as a string
 * and being concatenated, a bill computed off the wrong count, a quiet flag that
 * fires on a customer who used the product this morning.
 */

const NOW = new Date('2026-08-25T09:00:00.000Z')

/** A row shaped like PostgREST's, with only the interesting fields named. */
function row(over: Partial<PlatformCenterRow> = {}): PlatformCenterRow {
  return {
    center_id: 'c1',
    center_name: 'উদ্ভাস কোচিং',
    center_phone: '+8801711000111',
    bd_area: 'Mirpur',
    status: 'active',
    plan: 'center',
    created_at: '2026-06-01T04:00:00.000Z',
    owner_name: 'Jamshed Rahman',
    owner_phone: '+8801711000111',
    students: 40,
    teachers: 3,
    batches: 6,
    sms_credit_balance: 0,
    attendance_30d: 22,
    exams_30d: 4,
    fee_payments_30d: 31,
    // A string, because that is what PostgREST sends for numeric. Every test below
    // that touches money depends on this being a string and not a number.
    collected_30d: '41500.00',
    taps_30d: 57,
    notes_30d: 9,
    sms_30d: 0,
    last_active_at: '2026-08-24T11:00:00.000Z',
    paid_bdt: '1999.00',
    last_paid_at: '2026-08-01T06:00:00.000Z',
    // A `date`, and one that has not run out yet: the default row is a customer who
    // is paid up, so every `owes` test below has to say what it changed.
    paid_through: '2026-08-31',
    // Nobody has asked for anything. The left join in platform_centers() returns all
    // three as null together, so the default customer is one with no open request and
    // every test about a request has to opt in.
    wants_plan: null,
    wants_since: null,
    wants_note: null,
    ...over,
  }
}

test('numeric columns arrive as strings and are added, not concatenated', () => {
  // The bug this exists to catch: `collected30d` left as a string makes the totals
  // strip read 41500.0041500.00 for two centres, which looks like a font problem
  // rather than a type error.
  const list = customers([row(), row({ center_id: 'c2' })], 'No name', NOW)

  assert.equal(list[0].collected30d, 41500)
  assert.equal(list[0].paidBdt, 1999)
  assert.equal(platformTotals(list).collected30d, 83000)
  assert.equal(platformTotals(list).paidBdt, 3998)
})

test('the bill comes from plans.ts, at the count the RPC reported', () => {
  // 40 students in the first band is 40 × ৳25 = ৳1000, under the floor, so the
  // floor is what a centre this size pays. One teacher over the two free seats
  // adds ৳100. Asserted against the constant rather than the literal so a change
  // to the floor changes one place.
  const list = customers([row({ students: 40, teachers: 3 })], 'No name', NOW)
  assert.equal(list[0].billBdt, CENTER_MONTHLY_FLOOR_BDT + 100)

  // A teacher tier is flat whatever it holds — the seat maths must not reach it.
  const pro = customers(
    [row({ plan: 'teacher_plus', students: 150, teachers: 1 })],
    'No name',
    NOW,
  )
  assert.equal(pro[0].billBdt, PLANS.teacher_plus.priceBdt)

  const free = customers([row({ plan: 'teacher_free', students: 30 })], 'No name', NOW)
  assert.equal(free[0].billBdt, 0)
})

test('an unknown plan bills as the free tier rather than crashing', () => {
  // The column is an enum today, but planFor takes anything and this panel is the
  // last screen that should white-page over a value somebody wrote by hand.
  const list = customers(
    [row({ plan: 'gold' as PlatformCenterRow['plan'] })],
    'No name',
    NOW,
  )
  assert.equal(list[0].billBdt, 0)
})

test('quiet is measured in whole days and only past the threshold', () => {
  const at = (days: number) =>
    new Date(NOW.getTime() - days * 86_400_000).toISOString()

  const list = customers(
    [
      row({ center_id: 'today', last_active_at: NOW.toISOString() }),
      row({ center_id: 'edge', last_active_at: at(QUIET_AFTER_DAYS - 1) }),
      row({ center_id: 'over', last_active_at: at(QUIET_AFTER_DAYS) }),
      row({ center_id: 'never', last_active_at: null }),
    ],
    'No name',
    NOW,
  )

  const by = (id: string) => list.find((c) => c.centerId === id)!

  assert.equal(by('today').daysQuiet, 0)
  assert.equal(by('today').quiet, false)

  assert.equal(by('edge').daysQuiet, QUIET_AFTER_DAYS - 1)
  assert.equal(by('edge').quiet, false, 'the day before the threshold is not quiet')

  assert.equal(by('over').daysQuiet, QUIET_AFTER_DAYS)
  assert.equal(by('over').quiet, true)

  // A centre that never did anything has no day count to show, and the screen says
  // so in words. null and 0 are opposite facts here and must not collapse.
  assert.equal(by('never').daysQuiet, null)
  assert.equal(by('never').quiet, true)
})

test('a future timestamp clamps to zero rather than going negative', () => {
  // Clock skew between the database and the server. "-1 days quiet" on a founder's
  // screen is a bug report about the panel rather than about the clock.
  const list = customers(
    [row({ last_active_at: '2026-09-01T00:00:00.000Z' })],
    'No name',
    NOW,
  )
  assert.equal(list[0].daysQuiet, 0)
  assert.equal(list[0].quiet, false)
})

test('the order the RPC returned is the order kept', () => {
  const list = customers(
    [row({ center_id: 'a' }), row({ center_id: 'b' }), row({ center_id: 'c' })],
    'No name',
    NOW,
  )
  assert.deepEqual(
    list.map((c) => c.centerId),
    ['a', 'b', 'c'],
    'the CSV and the screen must list the same centres in the same sequence',
  )
})

test('missing values become the fact they stand for, not NaN', () => {
  const list = customers(
    [
      row({
        center_name: null,
        center_phone: null,
        bd_area: null,
        status: null,
        plan: null,
        owner_name: null,
        owner_phone: null,
        students: null,
        teachers: null,
        batches: null,
        sms_credit_balance: null,
        collected_30d: null,
        paid_bdt: null,
        taps_30d: null,
        notes_30d: null,
        last_active_at: null,
        last_paid_at: null,
        paid_through: null,
      }),
    ],
    'নাম নেই',
    NOW,
  )

  const c = list[0]
  assert.equal(c.name, 'নাম নেই')
  assert.equal(c.students, 0)
  assert.equal(c.collected30d, 0)
  assert.equal(c.paidBdt, 0)
  assert.equal(c.ownerName, null)
  // A null status is a centre the enum has not caught up with. Trial is the
  // smallest thing to assume about a customer, and never billed.
  assert.equal(c.status, 'trial')
  assert.equal(c.plan, 'teacher_free')
  assert.equal(c.billBdt, 0)
  // Null is its own answer, not a date and not a zero: nothing has been paid, or
  // what was paid did not say what it bought. The screen omits the line.
  assert.equal(c.paidThrough, null)
  // And a row with nothing in it does not owe. Trial, free tier, no bill — three
  // separate reasons, and any one of them is enough.
  assert.equal(c.owes, false)
})

test('a row with no centre id is skipped rather than rendered', () => {
  const list = customers([row({ center_id: null }), row({ center_id: 'ok' })], 'x', NOW)
  assert.equal(list.length, 1)
  assert.equal(list[0].centerId, 'ok')
})

test('MRR counts active centres only, and trials sit in the pipeline', () => {
  // The one number checked daily, and the worst one to be wrong: a free signup
  // must not make revenue go up. A suspended centre is in neither total — it is
  // not billing and it is not going to convert without a conversation.
  const list = customers(
    [
      row({ center_id: 'live', status: 'active', students: 40, teachers: 2 }),
      row({ center_id: 'trying', status: 'trial', students: 40, teachers: 2 }),
      row({ center_id: 'stopped', status: 'suspended', students: 40, teachers: 2 }),
      row({ center_id: 'gone', status: 'cancelled', students: 40, teachers: 2 }),
    ],
    'x',
    NOW,
  )

  const totals = platformTotals(list)
  assert.equal(totals.centers, 4)
  assert.equal(totals.active, 1)
  assert.equal(totals.trial, 1)
  assert.equal(totals.mrrBdt, CENTER_MONTHLY_FLOOR_BDT)
  assert.equal(totals.pipelineBdt, CENTER_MONTHLY_FLOOR_BDT)
  // Students and teachers are counted across every centre, billing or not: they
  // are how big the thing is, not how much it earns.
  assert.equal(totals.students, 160)
  assert.equal(totals.teachers, 8)
})

/* -------------------------------------------------------------------------- */
/* Who owes money                                                             */
/* -------------------------------------------------------------------------- */

test('owes is a live billing customer whose coverage has run out', () => {
  // NOW is 25 August 2026, 09:00 UTC — which is 3pm in Dhaka, so the founder's day
  // is unambiguously the 25th and no fixture here sits on the boundary.
  const list = customers(
    [
      row({ center_id: 'current', paid_through: '2026-08-31' }),
      row({ center_id: 'lapsed', paid_through: '2026-07-31' }),
      row({ center_id: 'never', paid_through: null }),
      // The last day of coverage is a day they have paid for, not the first day
      // they owe. A founder ringing a customer on the morning of the day their
      // month expires is the mistake this boundary exists to prevent.
      row({ center_id: 'today', paid_through: '2026-08-25' }),
      row({ center_id: 'yesterday', paid_through: '2026-08-24' }),
    ],
    'x',
    NOW,
  )

  const owes = (id: string) => list.find((c) => c.centerId === id)!.owes

  assert.equal(owes('current'), false)
  assert.equal(owes('lapsed'), true)
  // Never paid, and switched on anyway. This is the pay-first-at-signup case
  // half-done, and it is the row the founder most needs to see.
  assert.equal(owes('never'), true)
  assert.equal(owes('today'), false, 'the last day covered is still covered')
  assert.equal(owes('yesterday'), true)
})

test('only a live centre on a billing plan can owe anything', () => {
  const lapsed = { paid_through: '2026-07-31' } as const

  const list = customers(
    [
      row({ center_id: 'live', status: 'active', ...lapsed }),
      row({ center_id: 'trying', status: 'trial', ...lapsed }),
      row({ center_id: 'stopped', status: 'suspended', ...lapsed }),
      row({ center_id: 'gone', status: 'cancelled', ...lapsed }),
      // A free teacher owes nothing at any date, which is the whole point of the
      // tier. Marking one as owing would put a non-customer on the call list.
      row({ center_id: 'free', status: 'active', plan: 'teacher_free', ...lapsed }),
    ],
    'x',
    NOW,
  )

  const owes = (id: string) => list.find((c) => c.centerId === id)!.owes

  assert.equal(owes('live'), true)
  assert.equal(owes('trying'), false, 'a trial owes nothing by definition')
  // Suspended is usually suspended *because* nothing was paid. Counting those
  // would turn the call list into a graveyard — see the note on `owes`.
  assert.equal(owes('stopped'), false)
  assert.equal(owes('gone'), false)
  assert.equal(owes('free'), false)
})

test('the paid-up boundary is Dhaka’s day, not UTC’s', () => {
  // 1am in Dhaka on the 1st of September is still 7pm on the 31st of August in UTC.
  // A UTC date would call this centre paid up for another five hours; the founder
  // holding the phone is in Dhaka and it is September.
  const dhakaFirst = new Date('2026-08-31T19:00:00.000Z')

  const c = customers([row({ paid_through: '2026-08-31' })], 'x', dhakaFirst)[0]
  assert.equal(c.owes, true)

  // And the mirror: 11pm on the 31st in Dhaka is the 31st, and covered.
  const dhakaLast = new Date('2026-08-31T17:00:00.000Z')
  assert.equal(customers([row({ paid_through: '2026-08-31' })], 'x', dhakaLast)[0].owes, false)
})

test('the totals carry the call list and one month of what is on it', () => {
  const list = customers(
    [
      row({ center_id: 'a', status: 'active', students: 40, teachers: 2, paid_through: '2026-07-31' }),
      row({ center_id: 'b', status: 'active', students: 40, teachers: 2, paid_through: null }),
      row({ center_id: 'c', status: 'active', students: 40, teachers: 2, paid_through: '2026-08-31' }),
      row({ center_id: 'd', status: 'trial', students: 40, teachers: 2, paid_through: null }),
    ],
    'x',
    NOW,
  )

  const totals = platformTotals(list)
  assert.equal(totals.owing, 2)
  assert.equal(totals.owedBdt, CENTER_MONTHLY_FLOOR_BDT * 2)
  // A subset of MRR by construction — every centre counted is active and billing.
  // If this ever exceeds mrrBdt, one of the two rules has drifted.
  assert.ok(totals.owedBdt <= totals.mrrBdt)
})

test('the three send figures are totalled apart from each other', () => {
  // Fee chases and week notes are both free from the owner's own handset; gateway
  // sends cost us money per segment. All three stay separate for two different
  // reasons, and a single "messages" figure would lose both: which kind of
  // customer this is, and what they cost us.
  const list = customers(
    [
      row({ taps_30d: 57, notes_30d: 9, sms_30d: 0 }),
      row({ center_id: 'c2', taps_30d: 12, notes_30d: 40, sms_30d: 4 }),
    ],
    'x',
    NOW,
  )
  const totals = platformTotals(list)
  assert.equal(totals.taps30d, 69)
  assert.equal(totals.notes30d, 49)
  assert.equal(totals.sms30d, 4)
})

test('a centre whose only use of the product is the week note is not silent', () => {
  // The bug this exists to catch, and the worst class this panel can have: a Pro
  // teacher who collects cash in the room and sends forty parents a note every
  // week reading as a customer who sends nothing. A founder acts on that — they
  // ring the wrong centre, or write off a live one.
  const c = customers(
    [row({ taps_30d: 0, notes_30d: 40, sms_30d: 0, plan: 'teacher_plus' })],
    'x',
    NOW,
  )[0]

  assert.equal(c.taps30d, 0)
  assert.equal(c.notes30d, 40)
  assert.equal(platformTotals([c]).notes30d, 40)
})

test('totals of nothing are zeroes, not NaN', () => {
  const totals = platformTotals([])
  for (const [key, value] of Object.entries(totals)) {
    assert.equal(value, 0, key)
  }
})

/* -------------------------------------------------------------------------- */
/* Who asked to change plan                                                   */
/* -------------------------------------------------------------------------- */

test('an open request comes through as a plan, a date and what they wrote', () => {
  const c = customers(
    [
      row({
        plan: 'teacher_plus',
        wants_plan: 'center',
        wants_since: '2026-08-20T05:00:00.000Z',
        wants_note: 'Two branches from Ashwin',
      }),
    ],
    'x',
    NOW,
  )[0]

  // The tier they are on is untouched by the asking. A shaper that let the request
  // overwrite `plan` would have the founder panel showing a customer as Centre
  // before anybody had invoiced them for it.
  assert.equal(c.plan, 'teacher_plus')
  assert.equal(c.wantsPlan, 'center')
  assert.equal(c.wantsSince, '2026-08-20T05:00:00.000Z')
  assert.equal(c.wantsNote, 'Two branches from Ashwin')
})

test('a centre nobody has heard from carries no request at all', () => {
  const c = customers([row()], 'x', NOW)[0]
  assert.equal(c.wantsPlan, null)
  assert.equal(c.wantsSince, null)
  assert.equal(c.wantsNote, null)
})

test('a note of nothing but whitespace is no note', () => {
  // The card renders the quotation marks by asking whether this is null, so three
  // spaces would draw an empty “” under a customer's name.
  const c = customers(
    [row({ wants_plan: 'center', wants_note: '   \n  ' })],
    'x',
    NOW,
  )[0]
  assert.equal(c.wantsNote, null)
  assert.equal(c.wantsPlan, 'center', 'the request itself still stands')
})

test('the asking total counts requests whatever the centre’s status', () => {
  const list = customers(
    [
      row({ center_id: 'a', status: 'active', wants_plan: 'institution' }),
      // The most valuable row this panel can hold: somebody on a free trial asking
      // to be put on a paid tier. A status filter here would drop it.
      row({ center_id: 'b', status: 'trial', wants_plan: 'center' }),
      row({ center_id: 'c', status: 'suspended', wants_plan: 'center' }),
      row({ center_id: 'd', status: 'active' }),
    ],
    'x',
    NOW,
  )

  assert.equal(platformTotals(list).asking, 3)
  // And it is a count of customers, not of the money — the two tiles beside it are
  // taka and this one is a queue length.
  assert.equal(platformTotals([]).asking, 0)
})

/* -------------------------------------------------------------------------- */
/* The download                                                               */
/* -------------------------------------------------------------------------- */

const HEADINGS = {
  name: 'সেন্টার',
  area: 'এলাকা',
  status: 'অবস্থা',
  plan: 'প্ল্যান',
  bill: 'মাসিক বিল',
  owner: 'মালিক',
  ownerPhone: 'মালিকের নম্বর',
  centerPhone: 'সেন্টারের নম্বর',
  students: 'শিক্ষার্থী',
  teachers: 'শিক্ষক',
  batches: 'ব্যাচ',
  signedUp: 'যোগ দিয়েছে',
  attendance: 'হাজিরা',
  exams: 'পরীক্ষা',
  payments: 'আদায় সংখ্যা',
  collected: 'আদায় টাকা',
  taps: 'মেসেজ',
  notes: 'সপ্তাহের খবর',
  sms: 'গেটওয়ে SMS',
  smsCredits: 'SMS ক্রেডিট',
  lastActive: 'শেষ কাজ',
  quietDays: 'চুপচাপ কত দিন',
  paid: 'মোট দিয়েছে',
  lastPaid: 'শেষ পেমেন্ট',
  paidThrough: 'কোন তারিখ পর্যন্ত দেওয়া',
  owes: 'বিল বাকি',
  wants: 'যে প্ল্যান চেয়েছে',
  wantsSince: 'কবে চেয়েছে',
  wantsNote: 'যা লিখেছে',
}

const WORDS = {
  headings: HEADINGS,
  status: {
    trial: 'ট্রায়াল',
    active: 'চালু',
    suspended: 'বন্ধ',
    cancelled: 'বাতিল',
  } as const,
  yes: 'বাকি',
  no: 'দেওয়া আছে',
}

test('the sheet has one row per centre and a heading for every column', () => {
  const list = customers([row(), row({ center_id: 'c2' })], 'x', NOW)
  const { header, rows } = customersSheet(list, WORDS)

  assert.equal(header.length, Object.keys(HEADINGS).length)
  assert.equal(rows.length, 2)
  for (const r of rows) {
    assert.equal(r.length, header.length, 'a row shorter than the header shifts columns')
  }
})

test('money and counts leave as bare numbers a spreadsheet can total', () => {
  const list = customers([row()], 'x', NOW)
  const { header, rows } = customersSheet(list, WORDS)
  const at = (heading: string) => rows[0][header.indexOf(heading)]

  // Numbers, not '৳1,999' — a ৳ or a thousands separator turns the column into
  // text and the founder's own SUM stops working, which is the entire reason to
  // download it.
  assert.equal(typeof at(HEADINGS.bill), 'number')
  assert.equal(at(HEADINGS.collected), 41500)
  assert.equal(at(HEADINGS.paid), 1999)
  assert.equal(at(HEADINGS.students), 40)
  assert.equal(csvCell(at(HEADINGS.collected)), '41500')
  // Its own column, and not folded into the chases beside it.
  assert.equal(at(HEADINGS.taps), 57)
  assert.equal(at(HEADINGS.notes), 9)
})

test('dates leave as ISO timestamps, which sort and subtract', () => {
  const list = customers([row()], 'x', NOW)
  const { header, rows } = customersSheet(list, WORDS)
  const at = (heading: string) => rows[0][header.indexOf(heading)]

  assert.equal(at(HEADINGS.signedUp), '2026-06-01T04:00:00.000Z')
  assert.equal(at(HEADINGS.lastActive), '2026-08-24T11:00:00.000Z')
  assert.equal(at(HEADINGS.quietDays), 0)
  // A `date` column, so no time and no Z — already sortable and already the shape
  // the founder's spreadsheet will subtract from.
  assert.equal(at(HEADINGS.paidThrough), '2026-08-31')
})

test('the owes column is a word, so it can be filtered on', () => {
  const paid = customers([row({ paid_through: '2026-08-31' })], 'x', NOW)
  const late = customers([row({ paid_through: '2026-07-31' })], 'x', NOW)
  const { header, rows } = customersSheet([...paid, ...late], WORDS)
  const at = (i: number) => rows[i][header.indexOf(HEADINGS.owes)]

  // Not TRUE/FALSE and not 1/0. This column is read and filtered by one person in
  // one language, and the heading beside it is in that language too.
  assert.equal(at(0), 'দেওয়া আছে')
  assert.equal(at(1), 'বাকি')
})

test('the status word is localised and the plan is its product name', () => {
  const list = customers([row({ status: 'suspended', plan: 'teacher_plus' })], 'x', NOW)
  const { header, rows } = customersSheet(list, WORDS)
  const at = (heading: string) => rows[0][header.indexOf(heading)]

  assert.equal(at(HEADINGS.status), 'বন্ধ')
  // Not `teacher_plus`. Nobody calls it that, and this file is read by a person.
  assert.equal(at(HEADINGS.plan), PLANS.teacher_plus.nameEn)
})

test('the request columns are last, and blank for the centres who never asked', () => {
  const asked = customers(
    [
      row({
        center_id: 'asked',
        plan: 'teacher_plus',
        wants_plan: 'center',
        wants_since: '2026-08-20T05:00:00.000Z',
        wants_note: 'Two branches from Ashwin',
      }),
    ],
    'x',
    NOW,
  )
  const quietly = customers([row({ center_id: 'quiet' })], 'x', NOW)
  const { header, rows } = customersSheet([...asked, ...quietly], WORDS)
  const at = (i: number, heading: string) => rows[i][header.indexOf(heading)]

  // The product name, like the `plan` column beside it — this file is read by a
  // person, and the tier they are on and the tier they want must be comparable at a
  // glance rather than one being an enum and the other a name.
  assert.equal(at(0, HEADINGS.wants), PLANS.center.nameEn)
  assert.equal(at(0, HEADINGS.plan), PLANS.teacher_plus.nameEn)
  // ISO through, so the founder's own sheet can sort the call list by who has been
  // waiting longest.
  assert.equal(at(0, HEADINGS.wantsSince), '2026-08-20T05:00:00.000Z')
  assert.equal(at(0, HEADINGS.wantsNote), 'Two branches from Ashwin')

  // Blank and not a word: sorting this column has to put everybody who asked at one
  // end, and "—" or "No" would sort in among the plan names.
  assert.equal(at(1, HEADINGS.wants), null)
  assert.equal(at(1, HEADINGS.wantsSince), null)
  assert.equal(at(1, HEADINGS.wantsNote), null)
})

test('a note a centre owner typed cannot run in the founder’s spreadsheet', () => {
  // The one free-text field on this sheet a customer controls end to end: an owner
  // types it into /settings/plan and the founder opens it in Excel. `+` rather than
  // `=` because it is the realistic case — the note most owners will write is the
  // number they want ringing, and a cell beginning `+880` is a formula to Excel.
  const list = customers(
    [row({ wants_plan: 'center', wants_note: '+8801711000111 ring me' })],
    'x',
    NOW,
  )
  const { header, rows } = customersSheet(list, WORDS)
  assert.equal(
    csvCell(rows[0][header.indexOf(HEADINGS.wantsNote)]),
    "'+8801711000111 ring me",
  )
})

test('a centre name that looks like a formula is neutralised on the way out', () => {
  // The founder opening their own export must not run a centre owner's typing.
  const list = customers([row({ center_name: '=1+1' })], 'x', NOW)
  const { header, rows } = customersSheet(list, WORDS)
  assert.equal(csvCell(rows[0][header.indexOf(HEADINGS.name)]), "'=1+1")
})

test('the filename carries the day and is ASCII', () => {
  assert.equal(customersFileName(NOW), 'coachdesk-customers-2026-08-25.csv')
  assert.match(customersFileName(NOW), /^[\x20-\x7e]+$/)
})

test('the size line uses Bangla numerals in Bangla and ASCII in English', () => {
  // Prose counts follow the reader; money never does. Both rules in one line.
  const c = customers([row({ students: 40, batches: 6, teachers: 3 })], 'x', NOW)[0]
  const words = { students: 'শিক্ষার্থী', batches: 'ব্যাচ', teachers: 'শিক্ষক' }

  assert.equal(sizeLine(c, 'bn', words), '৪০ শিক্ষার্থী · ৬ ব্যাচ · ৩ শিক্ষক')
  assert.equal(
    sizeLine(c, 'en', { students: 'students', batches: 'batches', teachers: 'teachers' }),
    '40 students · 6 batches · 3 teachers',
  )
})
