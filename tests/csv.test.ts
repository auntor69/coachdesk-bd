import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  csvCell,
  csvRow,
  toCsv,
  contentDisposition,
  CSV_BOM,
  CSV_EOL,
} from '../src/lib/csv.ts'

test('a plain field is written as it stands', () => {
  assert.equal(csvCell('Rafid Hasan'), 'Rafid Hasan')
  assert.equal(csvCell('রাফিদ হাসান'), 'রাফিদ হাসান')
  assert.equal(csvCell(1500), '1500')
  assert.equal(csvCell(0), '0')
})

test('nothing is written for nothing', () => {
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(''), '')
})

test('a comma, a quote or a newline gets quoted, and quotes get doubled', () => {
  assert.equal(csvCell('Hasan, Rafid'), '"Hasan, Rafid"')
  assert.equal(csvCell('He said "yes"'), '"He said ""yes"""')
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"')
  assert.equal(csvCell('line one\r\nline two'), '"line one\r\nline two"')
})

test('space at either edge is quoted, because a reader would trim it', () => {
  assert.equal(csvCell(' Rafid'), '" Rafid"')
  assert.equal(csvCell('Rafid '), '"Rafid "')
  assert.equal(csvCell('Rafid Hasan'), 'Rafid Hasan')
})

test('a text cell that starts like a formula is disarmed', () => {
  // The whole point: this is a file the owner opens on their own machine, and the
  // names in it were typed or pasted by whoever was holding the register.
  assert.equal(csvCell('=1+1'), "'=1+1")
  assert.equal(csvCell('=cmd|calc'), "'=cmd|calc")
  assert.equal(csvCell('+8801712345678'), "'+8801712345678")
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(csvCell('-lead'), "'-lead")
  // A tab or a CR at the start is the same attack wearing whitespace. The tab stays
  // — it needs no quoting in CSV and Excel keeps it — but it no longer leads.
  assert.equal(csvCell('\t=1+1'), "'\t=1+1")
  assert.equal(csvCell('\r=1+1'), '"\'\r=1+1"')
})

test('a negative number stays a number the accountant can total', () => {
  // A refund is stored as a negative payment. Apostrophe it and every SUM in the
  // owner's spreadsheet silently stops counting refunds.
  assert.equal(csvCell(-500), '-500')
  assert.equal(csvCell(-1500.5), '-1500.5')
})

test('a number is written for arithmetic, not for reading', () => {
  // No thousands separator and no ৳: the column has to add up.
  assert.equal(csvCell(1234567), '1234567')
  assert.equal(csvCell(799.5), '799.5')
})

test('a number that is not a number is blank rather than the word NaN', () => {
  assert.equal(csvCell(Number.NaN), '')
  assert.equal(csvCell(Number.POSITIVE_INFINITY), '')
})

test('a row is comma-joined', () => {
  assert.equal(csvRow(['a', 1, null, 'b, c']), 'a,1,,"b, c"')
})

test('a file leads with the BOM, breaks on CRLF and ends on one', () => {
  const csv = toCsv(['Name', 'Fee'], [['Rafid', 800], ['Mim', 950]])
  assert.ok(csv.startsWith(CSV_BOM), 'no BOM — Excel would render Bangla as mojibake')
  assert.equal(csv, `${CSV_BOM}Name,Fee${CSV_EOL}Rafid,800${CSV_EOL}Mim,950${CSV_EOL}`)
})

test('a file with no rows is still a file with its columns', () => {
  // An owner who exports an empty month should get a header they can read, not a
  // zero-byte download that looks like the feature failed.
  assert.equal(toCsv(['Name', 'Fee'], []), `${CSV_BOM}Name,Fee${CSV_EOL}`)
})

test('the download carries an ASCII name and the real one', () => {
  const header = contentDisposition('coachdesk-students-2026-08.csv')
  assert.equal(
    header,
    'attachment; filename="coachdesk-students-2026-08.csv"; '
      + "filename*=UTF-8''coachdesk-students-2026-08.csv",
  )
})

test('a Bangla centre name survives in filename* and is dropped from the fallback', () => {
  const header = contentDisposition(
    'coachdesk-students-2026-08.csv',
    'উদ্ভাস-students-2026-08.csv',
  )
  assert.ok(header.includes('filename="coachdesk-students-2026-08.csv"'))
  assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent('উদ্ভাস-students-2026-08.csv')}`))
})

test('a quote in a filename cannot end the header early', () => {
  const header = contentDisposition('evil".csv')
  assert.ok(header.includes('filename="evil.csv"'))
})
