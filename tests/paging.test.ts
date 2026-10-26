/**
 * The pager, and the one thing it must never do.
 *
 * Every test here is really the same test: a read that could not be finished has to
 * come back as no answer, never as the part that arrived. PostgREST's thousand-row
 * ceiling is silent — 1000 rows and a 200 — so the failure this module exists to
 * prevent is not a crash, it is a fee board that adds up to less than the centre is
 * owed and looks exactly like a correct one. A pager that returned its first three
 * pages when the fourth failed would put that same lie back, with more steps.
 *
 * The fake below is the interesting part: it clamps to PAGE_SIZE the way a real
 * project does, so the loop is exercised against the behaviour it was written for
 * rather than against a mock that hands over everything at once.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  pageAll,
  pageOrNull,
  worstFailure,
  PAGE_SIZE,
  MAX_PAGED_ROWS,
  type PageResponse,
} from '../src/lib/supabase/page.ts'

/** A row, small enough that a test can hold twenty thousand of them. */
type Row = { n: number }

/**
 * A table of `total` rows that answers a range request like PostgREST: the slice
 * asked for, never more than PAGE_SIZE of it, and nothing past the end.
 *
 * `failAt` is the 1-based call that returns an error instead, which is how the
 * later-page failure — the one that would tempt a partial answer — gets tested.
 */
function fakeTable(total: number, opts: { failAt?: number; nullData?: boolean } = {}) {
  const calls: [number, number][] = []

  const fetchPage = (from: number, to: number): Promise<PageResponse<Row>> => {
    calls.push([from, to])

    if (opts.failAt !== undefined && calls.length === opts.failAt) {
      return Promise.resolve({ data: null, error: { message: 'read failed' } })
    }
    if (opts.nullData) return Promise.resolve({ data: null, error: null })

    const width = Math.min(to - from + 1, PAGE_SIZE)
    const rows: Row[] = []
    for (let n = from; n < Math.min(from + width, total); n++) rows.push({ n })
    return Promise.resolve({ data: rows, error: null })
  }

  return { calls, fetchPage }
}

/** Unwrapped, so a test about rows does not spend two lines narrowing the union. */
function rowsOf<T>(paged: { rows: T[] } | { failed: string }): T[] {
  assert.ok('rows' in paged, `expected rows, got ${JSON.stringify(paged)}`)
  return paged.rows
}

test('a list that fits in one answer costs one round trip', async () => {
  const table = fakeTable(3)
  const paged = await pageAll(table.fetchPage)

  assert.deepEqual(rowsOf(paged), [{ n: 0 }, { n: 1 }, { n: 2 }])
  assert.deepEqual(table.calls, [[0, PAGE_SIZE - 1]])
})

test('an empty table is an empty list, not a failure', async () => {
  const paged = await pageAll(fakeTable(0).fetchPage)
  assert.deepEqual(rowsOf(paged), [])
})

test('exactly one full page asks again and stops on the empty answer', async () => {
  const table = fakeTable(PAGE_SIZE)
  const paged = await pageAll(table.fetchPage)

  // The row that used to go missing. A full page is indistinguishable from a table
  // with more in it, so the loop cannot stop there — and the second call coming back
  // empty is what ends it, at the cost of one round trip on an exact multiple.
  assert.equal(rowsOf(paged).length, PAGE_SIZE)
  assert.equal(table.calls.length, 2)
})

test('pages are read end to end, with no row repeated and none skipped', async () => {
  const table = fakeTable(2500)
  const rows = rowsOf(await pageAll(table.fetchPage))

  assert.equal(rows.length, 2500)
  // Every row exactly where the table had it. An offset walk that got its windows
  // wrong would still return 2500 rows — the wrong 2500, with a gap and a duplicate
  // that no count on any screen could show.
  assert.deepEqual(
    rows.map((r) => r.n),
    Array.from({ length: 2500 }, (_, i) => i),
  )
  assert.deepEqual(table.calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ])
})

test('a failed first page is unreadable', async () => {
  const paged = await pageAll(fakeTable(10, { failAt: 1 }).fetchPage)
  assert.deepEqual(paged, { failed: 'unreadable' })
})

test('a failed later page throws away the pages that worked', async () => {
  const table = fakeTable(2500, { failAt: 3 })
  const paged = await pageAll(table.fetchPage)

  // THE TEST THIS FILE IS FOR. Two thousand rows arrived before the third page
  // failed, and handing them back would be a fee board short by five hundred
  // invoices with nothing on it to say so. The caller gets no answer instead.
  assert.deepEqual(paged, { failed: 'unreadable' })
  assert.ok(!('rows' in paged))
})

test('null data with no error is an empty last page', async () => {
  // PostgREST answers this way on a range past the end of the table, and it is not a
  // failure — the earlier pages are still good.
  const paged = await pageAll(fakeTable(0, { nullData: true }).fetchPage)
  assert.deepEqual(rowsOf(paged), [])
})

test('past the ceiling it refuses instead of truncating', async () => {
  const table = fakeTable(MAX_PAGED_ROWS + 500)
  const paged = await pageAll(table.fetchPage)

  assert.deepEqual(paged, { failed: 'tooLarge' })
  // Stopped at the ceiling rather than reading on to find the end.
  assert.equal(table.calls.length, MAX_PAGED_ROWS / PAGE_SIZE)
})

test('a table that ends exactly on the ceiling is refused too', async () => {
  // Deliberate, and worth writing down: the last page is full, so the loop cannot
  // tell this table from a larger one without another round trip, and the honest
  // answer at that size is the same either way. Twenty thousand rows is far past the
  // largest chain in the country — reaching it means a runaway query or a customer
  // to talk to, not a screen to draw.
  const paged = await pageAll(fakeTable(MAX_PAGED_ROWS).fetchPage)
  assert.deepEqual(paged, { failed: 'tooLarge' })
})

test('the ceiling is a whole number of pages', async () => {
  // Otherwise the check after each push could be crossed mid-page and the refusal
  // would depend on how the last window happened to land.
  assert.equal(MAX_PAGED_ROWS % PAGE_SIZE, 0)
  // And the page size is PostgREST's own ceiling. A larger number is clamped back to
  // it silently, which would make every full page look short and stop the loop on
  // the first one.
  assert.equal(PAGE_SIZE, 1000)
})

test('pageOrNull hands back every row', async () => {
  const rows = await pageOrNull(fakeTable(1500).fetchPage)
  assert.equal(rows?.length, 1500)
})

test('pageOrNull is null when the read failed', async () => {
  assert.equal(await pageOrNull(fakeTable(10, { failAt: 1 }).fetchPage), null)
})

test('pageOrNull is null past the ceiling, never the first twenty thousand rows', async () => {
  // The whole reason this wrapper exists rather than callers writing `?? []`. Half
  // the screens in this app treat a failed read as an empty one, which is survivable:
  // an empty fee board is obviously wrong. A board holding twenty thousand of a
  // centre's rows and missing the rest is not, and it would be believed.
  assert.equal(await pageOrNull(fakeTable(MAX_PAGED_ROWS + 1).fetchPage), null)
})

test('worstFailure is null when every read arrived', () => {
  assert.equal(worstFailure({ rows: [1] }, { rows: [] }), null)
  // No reads at all is not a failure either, so a caller can spread a list.
  assert.equal(worstFailure(), null)
})

test('worstFailure reports the one failure there is', () => {
  assert.equal(worstFailure({ rows: [] }, { failed: 'unreadable' }), 'unreadable')
  assert.equal(worstFailure({ failed: 'tooLarge' }, { rows: [] }), 'tooLarge')
})

test('tooLarge wins over unreadable, whichever read hit it', () => {
  // The precedence is the reason this function exists rather than a ternary chain at
  // each call site. `unreadable` tells the reader to try again; `tooLarge` tells them
  // to get in touch, because no retry brings a month back under the ceiling. Answer
  // with the retryable one and they tap their way to the same wall.
  assert.equal(worstFailure({ failed: 'unreadable' }, { failed: 'tooLarge' }), 'tooLarge')
  assert.equal(worstFailure({ failed: 'tooLarge' }, { failed: 'unreadable' }), 'tooLarge')
})

test('worstFailure mixes reads of different row types', () => {
  // Two reads on one screen are rarely the same shape — a fee board reads invoices
  // and payments — so a signature that made them agree would push callers back to
  // writing the chain by hand.
  const invoices = { rows: [{ id: 'i1' }] }
  const payments: { failed: 'unreadable' } = { failed: 'unreadable' }
  assert.equal(worstFailure(invoices, payments), 'unreadable')
})

test('every paged range(from, to) query in src/ carries a unique tie-breaker order (PERF-01)', () => {
  const files: string[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(full)
    }
  }
  walk(join(process.cwd(), 'src'))

  const missing: string[] = []
  let totalPaged = 0

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue
      if (lines[i].includes('.range(from, to)')) {
        totalPaged += 1
        const window = lines.slice(Math.max(0, i - 18), i + 1).join('\n')
        const hasTieBreaker = /\.order\(\s*'(id|student_id|receipt_no)'/.test(window)
        if (!hasTieBreaker) {
          missing.push(`${file}:${i + 1}`)
        }
      }
    }
  }

  // Dashboard reminder range query replaced by direct SQL aggregation view dashboard_reminder_summary (Phase 2A)
  assert.ok(totalPaged >= 44, `expected at least 44 paged queries, found ${totalPaged}`)
  assert.deepEqual(missing, [], `paged queries without a unique tie-breaker order: ${missing.join(', ')}`)
})
