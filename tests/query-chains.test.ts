import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  chainFrom,
  chainMethods,
  dynamicQueriesIn,
  maskComments,
  queriesIn,
  selectArg,
} from '../scripts/lib/query-chains.mjs'

/**
 * The parser the gates share, tested.
 *
 * check-scoping and check-embeds both read a query out of the source through this
 * module, so a mistake here is not a wrong answer on one screen — it is a rule that
 * stopped applying to some number of queries nobody can name. That happened: five
 * queries written with `.from(table)` were counted by nothing, and the only symptom was
 * a total five lower than it should have been.
 */

test('a chain stops where the next statement starts', () => {
  // Two queries in one Promise.all. Read one character too far and the second one's
  // centre filter vouches for the first one's missing filter.
  const src = `
    supabase.from('students').select('id'),
    supabase.from('teachers').select('id').eq('coaching_center_id', c),
  `
  const [students, teachers] = queriesIn(src)
  assert.equal(students.relation, 'students')
  assert.equal(students.chain, ".from('students').select('id')")
  assert.equal(teachers.relation, 'teachers')
  assert.ok(teachers.chain.includes('coaching_center_id'))
})

test('a call inside an argument does not end the chain or count as a method', () => {
  const src = ".from('fees').select('id').eq('month', monthOf(new Date())).limit(1)"
  assert.equal(chainFrom(src, 0), src)
  assert.deepEqual(chainMethods(src), ['from', 'select', 'eq', 'limit'])
})

test('an apostrophe in a comment cannot swallow the rest of the file', () => {
  const src = `
    supabase
      // createStudent's own insert
      .from('students')
      .select('id')
      .eq('coaching_center_id', c)
  `
  const [query] = queriesIn(src)
  assert.ok(query.chain.includes('coaching_center_id'))
})

test('a select is read whole, however it is wrapped', () => {
  const chain = ".from('students').select(`id, name,\n  batches (name)`)"
  assert.equal(selectArg(chain), '`id, name,\n  batches (name)`')

  // The second argument is head/count bookkeeping and not part of the column list.
  assert.equal(selectArg(".from('x').select('id', { count: 'exact', head: true })"), "'id'")
})

test('masking leaves every line and column where it was', () => {
  const src = "a // .from('students')\nb /* .from('teachers') */ c\n"
  const masked = maskComments(src)
  assert.equal(masked.length, src.length)
  assert.equal(masked.split('\n').length, src.split('\n').length)
  assert.equal(queriesIn(masked).length, 0)
  // What is left is the code, with the prose gone and its room kept.
  assert.equal(masked.replace(/\s+/g, ' '), 'a b c ')
})

test('an escaped slash in a regex is not a comment', () => {
  // The raw text is \/\/, which read as a comment would blank the query beside it.
  const src = "const re = /https?:\\/\\// ; supabase.from('students').select('id')"
  assert.deepEqual(
    queriesIn(maskComments(src)).map((q) => q.relation),
    ['students'],
  )
})

test('a query whose table name is a variable is reported, not skipped', () => {
  // The shape that was invisible: a helper taking the table name. Every one of these
  // was a real query against a real centre-scoped table, and the gate counted none.
  const src = `
    const byId = (table, ids) =>
      supabase.from(table).select('id, name').eq('coaching_center_id', c).in('id', ids)
  `
  assert.equal(queriesIn(src).length, 0)
  const [found] = dynamicQueriesIn(src)
  assert.equal(found.argument, 'table')
  assert.equal(found.line, 3)

  // Double quotes are just as invisible, so they are refused too rather than blessed.
  assert.equal(dynamicQueriesIn(`supabase.from("students").select('id')`).length, 1)
  assert.equal(dynamicQueriesIn(`supabase.from('students').select('id')`).length, 0)
})

test('Array.from and the dictionary are not queries', () => {
  const months = 'const months = Array.from({ length: 12 }, (_, i) => i).map(String)'
  assert.equal(dynamicQueriesIn(months).length, 0)

  // A select inside a callback is not this chain reading rows, and Array is refused by
  // name as well so it cannot start looking like one.
  const nested = "Array.from({ length: 2 }, () => supabase.from('students').select('id'))"
  assert.equal(dynamicQueriesIn(nested).length, 0)

  // t.from is a dictionary function: a price, not a table.
  assert.equal(dynamicQueriesIn('const line = t.from(formatTaka(floor))').length, 0)
})

test('a .from with no rows behind it is left alone', () => {
  // Something that is not a query yet — no select, no write. Nothing to scope.
  assert.equal(dynamicQueriesIn('const q = supabase.from(table)').length, 0)
  // Every write shape counts, because an insert payload is how a write scopes itself.
  for (const method of ['insert', 'update', 'upsert', 'delete']) {
    assert.equal(
      dynamicQueriesIn(`supabase.from(table).${method}({ coaching_center_id: c })`).length,
      1,
      `a .${method}() on a variable table was not reported`,
    )
  }
})
