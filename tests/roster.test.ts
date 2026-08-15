import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseRoster, readyRows, MAX_IMPORT_ROWS, MAX_STUDENT_NAME } from '../src/lib/bd/roster.ts'

/** Shorthand: the one row a single-line paste produces. */
function one(line: string) {
  const rows = parseRoster(line)
  assert.equal(rows.length, 1, `expected one row from: ${line}`)
  return rows[0]
}

test('reads the shapes a real register is written in', () => {
  for (const line of [
    'রাফিদ হাসান 01712345678',
    '01712345678 রাফিদ হাসান',
    'রাফিদ হাসান - 01712345678',
    'রাফিদ হাসান, 017 1234 5678',
    'রাফিদ হাসান\t+8801712345678',
    '১২। রাফিদ হাসান ০১৭১২৩৪৫৬৭৮',
    '12) রাফিদ হাসান  017-1234-5678',
    'রাফিদ হাসান | (017) 12345678',
  ]) {
    const row = one(line)
    assert.equal(row.problem, null, `problem on: ${line}`)
    assert.equal(row.phone, '+8801712345678', `phone from: ${line}`)
    assert.equal(row.name, 'রাফিদ হাসান', `name from: ${line}`)
  }
})

test('a serial number is stripped without eating the phone', () => {
  // The trap: "017-" looks exactly like a serial followed by a separator, so
  // stripping serials before finding the number loses eight digits of it.
  assert.equal(one('017-1234-5678').phone, '+8801712345678')
  assert.equal(one('7. 017-1234-5678 রাফিদ').name, 'রাফিদ')
  assert.equal(one('7. 017-1234-5678 রাফিদ').phone, '+8801712345678')
})

test('a marks or fee column next to the phone is not read as part of it', () => {
  const row = one('রাফিদ হাসান 01712345678 850')
  assert.equal(row.phone, '+8801712345678')
  assert.equal(row.name, 'রাফিদ হাসান', 'the marks column leaked into the name')
})

test('digits that are not a mobile are reported, not guessed at', () => {
  // A long run must not yield a valid mobile by having eleven good digits in it.
  assert.equal(one('রাফিদ 01712345678850').problem, 'bad-phone')
  assert.equal(one('রাফিদ হাসান 0212345678').problem, 'bad-phone') // landline
  assert.equal(one('রাফিদ হাসান 01112345678').problem, 'bad-phone') // dead series
  assert.equal(one('নাম, অভিভাবকের ফোন').problem, 'no-phone') // a header row
  assert.equal(one('ক্লাস ১০ — সকাল').problem, 'bad-phone')
  assert.equal(one('01712345678').problem, 'no-name')
})

test('a second name on the line becomes the guardian', () => {
  const row = one('রাফিদ হাসান, করিম মিয়া, 01712345678')
  assert.equal(row.name, 'রাফিদ হাসান')
  assert.equal(row.guardianName, 'করিম মিয়া')
})

test('a class or section column is not filed as the guardian', () => {
  const row = one('রাফিদ হাসান, ক্লাস ১০, 01712345678')
  assert.equal(row.name, 'রাফিদ হাসান')
  assert.equal(row.guardianName, null)
})

test('a second mobile is taken out of the name and reported', () => {
  const row = one('রাফিদ হাসান 01712345678 01812345678')
  assert.equal(row.phone, '+8801712345678')
  assert.deepEqual(row.dropped, ['+8801812345678'])
  assert.equal(row.name, 'রাফিদ হাসান')
})

test('siblings on one guardian number are two students', () => {
  const rows = parseRoster('রাফিদ হাসান 01712345678\nসাদিয়া হাসান 01712345678')
  assert.equal(rows.filter((r) => r.problem === null).length, 2)
  assert.equal(readyRows(rows).length, 2)
})

test('the same student twice in one paste is flagged once', () => {
  const rows = parseRoster([
    'রাফিদ হাসান 01712345678',
    'Rafid  Hasan 01712345678', // different script, same person, sloppy spacing
    'রাফিদ   হাসান ০১৭১২৩৪৫৬৭৮', // same name, Bangla digits, extra spaces
  ].join('\n'))
  assert.equal(rows[0].problem, null)
  assert.equal(rows[1].problem, null, 'a Latin spelling is a different name')
  assert.equal(rows[2].problem, 'duplicate')
  assert.equal(readyRows(rows).length, 2)
})

test('blank lines are ignored but line numbers still point at the paste', () => {
  const rows = parseRoster('\n\nরাফিদ 01712345678\n\nসাদিয়া 01812345678\n')
  assert.deepEqual(rows.map((r) => r.line), [3, 5])
})

test('every line comes back, so nothing goes missing quietly', () => {
  const rows = parseRoster('রাফিদ 01712345678\nজঞ্জাল\nসাদিয়া 01812345678')
  assert.equal(rows.length, 3)
  assert.equal(readyRows(rows).length, 2)
})

test('readyRows hands the RPC exactly what it expects', () => {
  const rows = parseRoster('রাফিদ হাসান, করিম মিয়া, 01712345678\nজঞ্জাল')
  assert.deepEqual(readyRows(rows), [
    { name: 'রাফিদ হাসান', guardian_phone: '+8801712345678', guardian_name: 'করিম মিয়া' },
  ])
})

test('a sentence with a number in it is a problem, not a student', () => {
  // A note written into the middle of a register, with the centre's own number
  // on the end of it. No commas, so it does not split into columns — it arrives
  // as one very long "name", which is the only signal that it is not one.
  const note = 'পরীক্ষার হলে উপস্থিত থাকতে হবে '.repeat(4).trim()
  assert.ok(note.length > MAX_STUDENT_NAME)
  assert.equal(one(`${note} 01712345678`).problem, 'name-too-long')
})

test('a big paste is not truncated by the parser', () => {
  const lines = Array.from(
    { length: MAX_IMPORT_ROWS + 20 },
    (_, i) => `ছাত্র ${i} 017${String(10000000 + i).padStart(8, '0')}`,
  )
  // The cap belongs to the caller, which counts raw lines. If the parser capped,
  // an over-long paste would import its first 500 and report total success.
  assert.equal(parseRoster(lines.join('\n')).length, MAX_IMPORT_ROWS + 20)
})
