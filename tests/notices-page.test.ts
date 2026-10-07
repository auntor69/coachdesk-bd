/**
 * The notice log's date, and the one way it can be a day out.
 *
 * WHY THIS FILE EXISTS. The log is the record an owner opens to answer one question —
 * did Thursday's notice actually go out, and when — and it is the half of the screen
 * that survives the handset, the chat history and the receptionist. Its date came from
 * `published_at.slice(0, 10)`, and `published_at` is a `timestamptz` that Postgres
 * hands back in UTC: for the first six hours of every Bangladeshi day that slice is
 * *yesterday*, so a notice posted at 1am was filed under the previous date on the one
 * screen whose whole job is saying when something was sent.
 *
 * THE FAILURE IS TWO LINES AWAY FROM A PASSING SCREEN, which is why the assertion below
 * is the arithmetic and not only a regex. `dhakaMoment` and the ten-character slice
 * agree for eighteen hours out of twenty-four; the second test states an instant from
 * the other six, so a future edit that reaches for `.slice(0, 10)` again fails here
 * rather than on a customer's phone.
 *
 * The same conversion the collection register, the fee board's chase history
 * (tests/reminder-schedule.test.ts) and the activity log (dhakaMoment in
 * src/lib/bd/time.ts's own tests) all make.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { dhakaMoment, todayInDhaka } from '../src/lib/bd/time.ts'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const PAGE = read('src', 'app', '(app)', 'notices', 'page.tsx')

test('the log dates a notice by the Dhaka day it was published on', () => {
  assert.match(
    PAGE,
    /when: formatDate\(dhakaMoment\(row\.published_at\)\.date, locale\)/,
    'the published date goes through the Dhaka conversion',
  )
  assert.doesNotMatch(
    PAGE,
    /published_at\.slice\(0, 10\)/,
    'and never through ten characters off a timestamptz, which is the UTC day',
  )
  assert.match(
    PAGE,
    /import \{ dhakaMoment, formatDate \} from '@\/lib\/bd\/time'/,
    'the conversion is imported rather than reimplemented here',
  )
})

test('the slice that was there would have been a day out', () => {
  // 8:31pm UTC on the 6th is 2:31am on the 7th in Dhaka — a real instant from the six
  // hours this screen used to get wrong. `todayInDhaka` is the same answer by the path
  // the rest of the app takes.
  const at = '2026-10-06T20:31:39.221Z'
  assert.equal(dhakaMoment(at).date, '2026-10-07')
  assert.equal(todayInDhaka(new Date(at)), '2026-10-07')
  assert.equal(at.slice(0, 10), '2026-10-06')

  // And the other eighteen hours, where the two agree — so the bug was never visible to
  // anybody checking the screen during their working day.
  const afternoon = '2026-10-06T06:31:39.221Z'
  assert.equal(dhakaMoment(afternoon).date, '2026-10-06')
  assert.equal(afternoon.slice(0, 10), '2026-10-06')
})
