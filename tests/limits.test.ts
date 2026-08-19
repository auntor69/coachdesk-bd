import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_NAME, MAX_LABEL, MAX_NOTE, MAX_TEXT, clamp } from '../src/lib/limits.ts'

test('clamp leaves anything within the cap exactly as it was', () => {
  // Identity matters more than it looks: these values are written straight to
  // columns, and a clamp that trimmed or normalised would silently rewrite a
  // transaction id somebody is about to check against a bKash SMS.
  for (const value of ['', 'a', 'রাফিদ হাসান', 'BKH7X29QW1', 'x'.repeat(MAX_LABEL)]) {
    assert.equal(clamp(value, MAX_LABEL), value)
  }
})

test('clamp cuts to the cap, counting the way the cap is written', () => {
  assert.equal(clamp('x'.repeat(MAX_LABEL + 1), MAX_LABEL).length, MAX_LABEL)
  assert.equal(clamp('rider', 3), 'rid')
})

test('a note that rides in an SMS is capped tighter than one that does not', () => {
  // The whole reason there are two. MAX_NOTE is small because a teacher's line
  // about one student is paid for by the segment; MAX_TEXT is a paragraph that
  // never leaves the screen. If these ever met in the middle, the result SMS
  // would start costing two segments for a sentence nobody sent.
  assert.ok(MAX_NOTE < MAX_TEXT)
  assert.ok(MAX_LABEL < MAX_NAME)
})

test('the Bangla a cap counts is the Bangla a browser counts', () => {
  // maxLength counts UTF-16 code units, and so does String.length — so the
  // browser and the Server Action agree even on a name full of conjuncts. They
  // would not agree with a byte count or with grapheme clusters, which is why
  // neither is used here.
  const name = 'শ্রাবন্তী চৌধুরী'
  assert.equal(clamp(name, MAX_NAME), name)
  assert.equal([...name].length <= name.length, true)
})
