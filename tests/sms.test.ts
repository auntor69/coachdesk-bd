import { test } from 'node:test'
import assert from 'node:assert/strict'

import { measureSms, creditCost } from '../src/lib/sms/encoding.ts'
import {
  buildResultSms,
  buildFeeReminderSms,
  buildFeeReminderText,
} from '../src/lib/sms/templates.ts'

test('plain ASCII is GSM-7 and fits 160 characters', () => {
  const short = measureSms('Result published')
  assert.equal(short.encoding, 'gsm7')
  assert.equal(short.segments, 1)

  const exact = measureSms('a'.repeat(160))
  assert.equal(exact.segments, 1, '160 GSM characters is still one SMS')

  const over = measureSms('a'.repeat(161))
  assert.equal(over.segments, 2, 'one character past 160 costs a second SMS')
})

test('any Bangla character forces UCS-2 for the whole message', () => {
  const mixed = measureSms('Result: ভালো')
  assert.equal(mixed.encoding, 'ucs2')

  // This is the expensive fact the whole module exists for: 70, not 160.
  assert.equal(measureSms('অ'.repeat(70)).segments, 1)
  assert.equal(measureSms('অ'.repeat(71)).segments, 2)
})

test('concatenated messages lose capacity to the reassembly header', () => {
  // 153 septets per part once a message splits, not 160.
  assert.equal(measureSms('a'.repeat(306)).segments, 2)
  assert.equal(measureSms('a'.repeat(307)).segments, 3)

  // 67 UCS-2 characters per part, not 70.
  assert.equal(measureSms('অ'.repeat(134)).segments, 2)
  assert.equal(measureSms('অ'.repeat(135)).segments, 3)
})

test('GSM escape characters cost two septets', () => {
  assert.equal(measureSms('[').length, 2)
  assert.equal(measureSms('a'.repeat(159) + '[').segments, 2)
})

test('an empty message costs nothing', () => {
  const empty = measureSms('')
  assert.equal(empty.segments, 0)
  assert.equal(creditCost('', 40), 0)
})

test('credits are per recipient per segment', () => {
  // 40 parents, one Bangla segment each.
  assert.equal(creditCost('ফলাফল', 40), 40)
  // A message that spilled to two segments doubles the bill.
  assert.equal(creditCost('অ'.repeat(71), 40), 80)
})

const CENTER = 'আলো কোচিং সেন্টার'

test('a result message fits one segment', () => {
  const sms = buildResultSms({
    studentName: 'রাফিদ হাসান',
    examTitle: 'সাপ্তাহিক পরীক্ষা',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: CENTER,
  })

  assert.equal(sms.segments, 1, `two segments: ${sms.body}`)
  assert.ok(sms.body.includes('42/50'))
  assert.ok(sms.body.includes('রাফিদ'))
})

test('the centre name survives even when everything else is too long', () => {
  const sms = buildResultSms({
    studentName: 'মোহাম্মদ আব্দুল্লাহ আল মামুন চৌধুরী',
    examTitle: 'দ্বিতীয় সাময়িক মডেল টেস্ট পরীক্ষা ২০২৬',
    obtainedMarks: 88.5,
    totalMarks: 100,
    isAbsent: false,
    centerName: CENTER,
  })

  assert.equal(sms.segments, 1, `two segments: ${sms.body}`)
  // Without an identifiable sender the message reads as spam, so the brand is
  // the one part that is never sacrificed to fit.
  assert.ok(sms.body.includes('আলো'), `brand missing: ${sms.body}`)
})

test('an absent student gets words, not a zero', () => {
  const sms = buildResultSms({
    studentName: 'রাফিদ',
    examTitle: 'সাপ্তাহিক',
    obtainedMarks: null,
    totalMarks: 50,
    isAbsent: true,
    centerName: CENTER,
  })

  assert.ok(sms.body.includes('অনুপস্থিত'))
  assert.ok(!sms.body.includes('0/50'), 'absent must never read as zero marks')
})

test('the note is dropped rather than paying for a second segment', () => {
  const withLongNote = buildResultSms({
    studentName: 'রাফিদ হাসান',
    examTitle: 'সাপ্তাহিক পরীক্ষা',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: CENTER,
    note: 'হাতের লেখা আরও ভালো করতে হবে এবং নিয়মিত ক্লাসে আসতে হবে',
  })

  assert.equal(withLongNote.segments, 1)
  assert.equal(withLongNote.trimmed, true)

  const withShortNote = buildResultSms({
    studentName: 'রাফিদ',
    examTitle: 'সাপ্তাহিক',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: 'আলো',
    note: 'ভালো',
  })

  assert.equal(withShortNote.segments, 1)
  assert.equal(withShortNote.trimmed, false, 'a note that fits should be kept')
  assert.ok(withShortNote.body.includes('ভালো'))
})

test('marks keep ASCII digits and lose trailing zeros', () => {
  const sms = buildResultSms({
    studentName: 'রাফিদ',
    examTitle: 'পরীক্ষা',
    obtainedMarks: 42.5,
    totalMarks: 50,
    isAbsent: false,
    centerName: 'আলো',
  })

  assert.ok(sms.body.includes('42.5/50'), sms.body)
  assert.ok(!/[০-৯]/.test(sms.body.split(':')[1] ?? ''), 'marks must stay ASCII')
})

/* -------------------------------------------------------------------------- */
/* Fee reminders                                                              */
/* -------------------------------------------------------------------------- */

test('a fee reminder names the child, the month, the amount and the centre', () => {
  const sms = buildFeeReminderSms({
    studentName: 'মিম আক্তার',
    periodMonth: '2026-08-01',
    amount: 700,
    dueDate: '2026-08-10',
    daysLate: 1,
    centerName: 'উত্তরা আইডিয়াল কোচিং',
  })

  assert.equal(sms.segments, 1)
  assert.ok(sms.body.includes('মিম আক্তার'), sms.body)
  assert.ok(sms.body.includes('আগস্ট'), sms.body)
  assert.ok(sms.body.includes('৳700'), sms.body)
  assert.ok(sms.body.includes('উত্তরা আইডিয়াল কোচিং'), sms.body)
  // The natural phrasing, since there is room for it.
  assert.ok(sms.body.includes('বাকি আছে'), sms.body)
})

test('the worst case a real centre can produce still costs one SMS', () => {
  // Everything at its maximum at once: the longest month name in Bangla
  // (ফেব্রুয়ারি, eleven characters), a five-figure balance from a family several
  // months behind, a long student name, and a centre name longer than the brand
  // budget. This is the test that decides the name budget — at 18 characters the
  // month gets dropped here, and a parent owing two months cannot tell which one
  // the message is about.
  const sms = buildFeeReminderSms({
    studentName: 'মোহাম্মদ সাদিয়া রহমান',
    periodMonth: '2026-02-01',
    amount: 99999,
    dueDate: '2026-02-10',
    daysLate: 40,
    centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
  })

  assert.equal(sms.segments, 1, sms.body)
  assert.equal(measureSms(sms.body).encoding, 'ucs2')
  // The four things that must survive any amount of trimming.
  assert.ok(sms.body.startsWith('মোহাম্মদ'), sms.body)
  assert.ok(sms.body.includes('ফেব্রুয়ারি'), sms.body)
  assert.ok(sms.body.includes('৳99,999'), sms.body)
  assert.ok(sms.body.includes('উত্তরা'), sms.body)
})

test('reminder money stays ASCII, like every other figure a parent re-types', () => {
  const sms = buildFeeReminderSms({
    studentName: 'রাফিদ',
    periodMonth: '2026-08-01',
    amount: 1500.5,
    dueDate: '2026-08-10',
    daysLate: 0,
    centerName: 'আলো',
  })

  assert.ok(sms.body.includes('৳1,500.50'), sms.body)
  assert.ok(!/[০-৯]/.test(sms.body), 'no Bangla numerals in a fee reminder')
})

test('the WhatsApp reminder keeps what the SMS has no room for', () => {
  const text = buildFeeReminderText({
    studentName: 'মোহাম্মদ সাদিয়া রহমান',
    periodMonth: '2026-02-01',
    amount: 99999,
    dueDate: '2026-02-10',
    daysLate: 40,
    centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
  })

  // Nothing is metered here, so nothing is clamped.
  assert.ok(text.includes('মোহাম্মদ সাদিয়া রহমান'), text)
  assert.ok(text.includes('উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি'), text)
  assert.ok(text.includes('ফেব্রুয়ারি'), text)
  assert.ok(text.includes('৳99,999'), text)
  // The due date, in Bangla numerals — a date is read, not re-typed.
  assert.ok(text.includes('১০ ফেব্রুয়ারি ২০২৬'), text)
  assert.ok(text.startsWith('প্রিয় অভিভাবক,'), text)
})

test('a reminder sent before the due date does not speak in the past tense', () => {
  const base = {
    studentName: 'রাফিদ হাসান',
    periodMonth: '2026-08-01',
    amount: 1500,
    dueDate: '2026-08-10',
    centerName: 'আলো কোচিং',
  }

  // Raised on the 1st, chased the same day: the deadline is still ahead, and
  // telling a family the date "was" something in their future reads as a threat
  // over a bill that is not yet late.
  const early = buildFeeReminderText({ ...base, daysLate: 0 })
  assert.ok(early.includes('শেষ তারিখ ১০ আগস্ট ২০২৬'), early)
  assert.ok(!early.includes('ছিল'), early)

  const late = buildFeeReminderText({ ...base, daysLate: 5 })
  assert.ok(late.includes('শেষ তারিখ ছিল ১০ আগস্ট ২০২৬'), late)
})

test('a reminder tells the parent where to send the money', () => {
  const sms = buildFeeReminderSms({
    studentName: 'মিম আক্তার',
    periodMonth: '2026-08-01',
    amount: 700,
    dueDate: '2026-08-10',
    daysLate: 2,
    centerName: 'আলো কোচিং',
    paymentWallet: 'bkash',
    paymentNumber: '+8801711000012',
  })

  assert.equal(sms.segments, 1, sms.body)
  assert.ok(sms.body.includes('বিকাশ'), sms.body)
  // Local form and ASCII digits. A parent retypes this into a Send Money
  // screen, so +880 is four characters of a shape nobody writes, and Bangla
  // numerals would have to be converted in their head first.
  assert.ok(sms.body.includes('01711000012'), sms.body)
  assert.ok(!sms.body.includes('+880'), sms.body)
  assert.ok(!/[০-৯]/.test(sms.body), 'no Bangla numerals in a fee reminder')
})

test('the payment number outlives politeness but not the month or the amount', () => {
  const base = {
    studentName: 'মিম আক্তার',
    periodMonth: '2026-08-01',
    amount: 700,
    dueDate: '2026-08-10',
    daysLate: 2,
    paymentWallet: 'bkash' as const,
    paymentNumber: '+8801711000012',
  }

  // A 17-character centre name leaves no room for both the number and the
  // natural phrasing. The number stays, because a message naming it is one the
  // family can act on without ringing anybody.
  const tight = buildFeeReminderSms({ ...base, centerName: 'আলো কোচিং সেন্টার' })
  assert.equal(tight.segments, 1, tight.body)
  assert.ok(tight.body.includes('01711000012'), tight.body)
  assert.ok(!tight.body.includes('বাকি আছে'), tight.body)

  // At 21 characters even the terse form cannot hold it, and here the number is
  // what goes — not the month and not the amount. A family who cannot see the
  // number can still pay the way they always have; a family who cannot see
  // which month is being asked for cannot pay at all.
  const full = buildFeeReminderSms({ ...base, centerName: 'উত্তরা আইডিয়াল কোচিং' })
  assert.equal(full.segments, 1, full.body)
  assert.ok(!full.body.includes('01711000012'), full.body)
  assert.ok(full.body.includes('আগস্ট'), full.body)
  assert.ok(full.body.includes('৳700'), full.body)
  assert.ok(full.body.includes('মিম আক্তার'), full.body)
  assert.ok(full.body.includes('উত্তরা আইডিয়াল কোচিং'), full.body)
})

test('a centre with no wallet set sends exactly what it sent before', () => {
  const base = {
    studentName: 'রাফিদ হাসান',
    periodMonth: '2026-08-01',
    amount: 1500,
    dueDate: '2026-08-10',
    daysLate: 0,
    centerName: 'আলো কোচিং',
  }

  const none = buildFeeReminderSms(base)
  assert.equal(none.body, 'রাফিদ হাসান, আগস্ট মাসের ফি ৳1,500 বাকি আছে। -আলো কোচিং')

  // Half-configured is the same as unconfigured, in both directions. A wallet
  // with no number names an app the parent cannot send to; a number with no
  // wallet does not say which app to open. The database rejects the pair
  // outright — this is the settings form mid-keystroke, which must stay quiet.
  for (const half of [
    { ...base, paymentWallet: 'bkash' as const, paymentNumber: null },
    { ...base, paymentWallet: 'bkash' as const, paymentNumber: '017' },
    { ...base, paymentWallet: null, paymentNumber: '+8801711000012' },
  ]) {
    assert.equal(buildFeeReminderSms(half).body, none.body)
  }
})

test('the WhatsApp reminder always carries the number, on its own line', () => {
  // The case the SMS above had to drop it in: nothing is metered here, so the
  // longest centre name in the fixtures keeps everything.
  const text = buildFeeReminderText({
    studentName: 'মোহাম্মদ সাদিয়া রহমান',
    periodMonth: '2026-02-01',
    amount: 99999,
    dueDate: '2026-02-10',
    daysLate: 40,
    centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    paymentWallet: 'nagad',
    paymentNumber: '01911000013',
  })

  assert.ok(text.includes('নগদ 01911000013'), text)
  // Its own paragraph, because this is the line the parent comes back to while
  // standing in the wallet app.
  assert.ok(text.includes('\n\nফি পাঠাতে পারেন — নগদ 01911000013\n\n'), text)
  assert.ok(text.includes('৳99,999'), text)

  // And nothing dangling when there is nothing to say.
  const without = buildFeeReminderText({
    studentName: 'রাফিদ হাসান',
    periodMonth: '2026-08-01',
    amount: 1500,
    dueDate: '2026-08-10',
    daysLate: 0,
    centerName: 'আলো কোচিং',
  })
  assert.ok(!without.includes('ফি পাঠাতে পারেন'), without)
})
