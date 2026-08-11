import { test } from 'node:test'
import assert from 'node:assert/strict'

import { measureSms, creditCost } from '../src/lib/sms/encoding.ts'
import { buildResultSms } from '../src/lib/sms/templates.ts'

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
