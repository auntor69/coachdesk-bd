import test from 'node:test'
import assert from 'node:assert/strict'

import { growingBranches, type BranchIntake } from '../src/lib/billing/growth.ts'

const MIRPUR = '11111111-1111-1111-1111-111111111111'
const UTTARA = '22222222-2222-2222-2222-222222222222'
const SYLHET = '33333333-3333-3333-3333-333333333333'
const KHULNA = '44444444-4444-4444-4444-444444444444'

const NAMES = new Map<string | null, string>([
  [MIRPUR, 'Mirpur'],
  [UTTARA, 'Uttara'],
  [SYLHET, 'Sylhet'],
  [KHULNA, 'Khulna'],
  [null, 'Head office'],
])

/** What `/hq` passes: the table's own resolved names, with a fallback for a withheld row. */
const name = (branchId: string | null) => NAMES.get(branchId) ?? 'Another branch'

const grew = (intake: BranchIntake[], limit?: number) =>
  limit === undefined ? growingBranches(intake, name) : growingBranches(intake, name, limit)

test('the branch that took the most places is named first', () => {
  const { top, others } = grew([
    { branchId: MIRPUR, admitted: 4 },
    { branchId: UTTARA, admitted: 19 },
    { branchId: SYLHET, admitted: 11 },
  ])

  assert.deepEqual(
    top.map((row) => `${row.name} ${row.admitted}`),
    ['Uttara 19', 'Sylhet 11', 'Mirpur 4'],
  )
  assert.equal(others, 0)
})

test('a branch that took none is not on the list', () => {
  // "Sylhet is growing (0 new students)" is the sentence that makes an owner stop trusting
  // the box, and a building that did not move is not where the next places should go.
  const { top } = grew([
    { branchId: MIRPUR, admitted: 6 },
    { branchId: UTTARA, admitted: 0 },
  ])

  assert.deepEqual(top.map((row) => row.name), ['Mirpur'])
})

test('a negative figure is dropped too, not sorted to the bottom', () => {
  // The view cannot produce one — `count(*)` — but the filter is `> 0` rather than `!== 0`
  // so a future measure that can go negative shrinks off the list instead of onto it.
  const { top, others } = grew([
    { branchId: MIRPUR, admitted: -3 },
    { branchId: UTTARA, admitted: 2 },
  ])

  assert.deepEqual(top.map((row) => row.name), ['Uttara'])
  assert.equal(others, 0)
})

test('two branches growing at the same rate are named in the same order every time', () => {
  // Unordered, a refresh would reshuffle them and an owner would read that as a change.
  const intake: BranchIntake[] = [
    { branchId: UTTARA, admitted: 7 },
    { branchId: MIRPUR, admitted: 7 },
    { branchId: SYLHET, admitted: 7 },
  ]

  assert.deepEqual(grew(intake).top.map((row) => row.name), ['Mirpur', 'Sylhet', 'Uttara'])
  assert.deepEqual(
    grew([...intake].reverse()).top.map((row) => row.name),
    ['Mirpur', 'Sylhet', 'Uttara'],
  )
})

test('past the limit the rest are counted, not dropped', () => {
  // A warning box naming eleven branches is a warning box nobody reads; "and two others"
  // keeps the sentence short without lying about the shape of the growth.
  const { top, others } = grew([
    { branchId: MIRPUR, admitted: 9 },
    { branchId: UTTARA, admitted: 8 },
    { branchId: SYLHET, admitted: 7 },
    { branchId: KHULNA, admitted: 6 },
    { branchId: null, admitted: 5 },
  ])

  assert.deepEqual(top.map((row) => row.name), ['Mirpur', 'Uttara', 'Sylhet'])
  assert.equal(others, 2)
})

test('the count of others is never negative', () => {
  const { top, others } = grew([{ branchId: MIRPUR, admitted: 1 }])

  assert.equal(top.length, 1)
  assert.equal(others, 0)
})

test('a limit of one still reports the rest', () => {
  const { top, others } = grew(
    [
      { branchId: MIRPUR, admitted: 3 },
      { branchId: UTTARA, admitted: 4 },
    ],
    1,
  )

  assert.deepEqual(top.map((row) => row.name), ['Uttara'])
  assert.equal(others, 1)
})

test('head office is a branch here like everywhere else', () => {
  // §17 keeps the pool at the organisation, and head office admits students against it the
  // same as a branch does. Its null id is not a wildcard and not a total.
  const { top } = grew([
    { branchId: null, admitted: 12 },
    { branchId: MIRPUR, admitted: 3 },
  ])

  assert.deepEqual(
    top.map((row) => ({ branchId: row.branchId, name: row.name })),
    [
      { branchId: null, name: 'Head office' },
      { branchId: MIRPUR, name: 'Mirpur' },
    ],
  )
})

test('a branch whose name the caller could not resolve is still named', () => {
  // An RLS policy can withhold the branch row while the view still reports its intake. The
  // places went somewhere, and "Another branch 5" is truer than a missing line.
  const stranger = '99999999-9999-9999-9999-999999999999'
  const { top } = grew([{ branchId: stranger, admitted: 5 }])

  assert.deepEqual(top, [{ branchId: stranger, name: 'Another branch', admitted: 5 }])
})

test('nothing in means nothing to say', () => {
  assert.deepEqual(grew([]), { top: [], others: 0 })
  assert.deepEqual(grew([{ branchId: MIRPUR, admitted: 0 }]), { top: [], others: 0 })
})
