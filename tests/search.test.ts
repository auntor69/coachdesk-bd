/**
 * The search box's matching.
 *
 * One function stands behind every search box in the product, so what is tested here is
 * every way a real owner types a name they are looking for on a real phone: a Bangla
 * keyboard's digits against an ASCII phone column, a code typed without its dash, two
 * words in the order they came to mind rather than the order they are stored in, and the
 * empty box that must not quietly filter the list down to nothing.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { searchTerms, matchesSearch, normalizeSearch, MAX_QUERY } from '../src/lib/search.ts'

/** A row as the fee board would hand it over: name, code, guardian's number. */
const ALI = ['আলী উর রহমান', 'S-01', '01712345678']
const MIM = ['মিম আক্তার', 'S-02', '01898765432']
const JOHN = ['John Karim', 'S-103', null]

/** Which of the three rows a query finds, in order. */
function found(query: string): string[] {
  const terms = searchTerms(query)
  return [ALI, MIM, JOHN].filter((row) => matchesSearch(row, terms)).map((row) => String(row[1]))
}

test('an empty box filters nothing', () => {
  // The signal a screen reads to decide whether to say "showing 4 of 312" at all. A
  // search that hid every row until something was typed would be a screen that looks
  // broken the moment it loads.
  for (const nothing of ['', '   ', null, undefined]) {
    assert.deepEqual(searchTerms(nothing), [])
    assert.equal(matchesSearch(ALI, searchTerms(nothing)), true)
  }
})

test('part of a name is enough', () => {
  assert.deepEqual(found('রহমান'), ['S-01'])
  assert.deepEqual(found('মিম'), ['S-02'])
})

test('two words are found in any order, and need not be next to each other', () => {
  // "রহমান আলী" is how somebody says a name they are half remembering, and আলী উর রহমান
  // is how it was typed in. Requiring the given order would find neither.
  assert.deepEqual(found('রহমান আলী'), ['S-01'])
  assert.deepEqual(found('আলী রহমান'), ['S-01'])
})

test('every word has to be found, or it is a different student', () => {
  // The whole point of more than one word: an owner with two Alis types the second word
  // to tell them apart, and a search that returned both would have wasted the typing.
  assert.deepEqual(found('আলী মিম'), [])
})

test('a word may match the name and the next the phone', () => {
  // Which is how two children with the same name are told apart on a screen that shows
  // the guardian's number beside it.
  assert.deepEqual(found('আলী 01712'), ['S-01'])
  assert.deepEqual(found('আলী 01898'), [])
})

test('a Bangla keyboard finds an ASCII phone number', () => {
  // The column holds 01712345678 because that is what normalizeBdMobile stores. The
  // person searching is on a Bangla keyboard and types ০১৭. Nobody can be expected to
  // guess which script the screen wants.
  assert.deepEqual(found('০১৭১২'), ['S-01'])
  assert.deepEqual(found('০১৮৯৮'), ['S-02'])
})

test('a phone number typed with a space or a dash still finds it', () => {
  assert.deepEqual(found('01712 345678'), ['S-01'])
  assert.deepEqual(found('01712-345678'), ['S-01'])
})

test('a student code found without its punctuation', () => {
  // S-01 typed as s01, and typed as it is stored. Neither is the wrong way round.
  assert.deepEqual(found('s01'), ['S-01'])
  assert.deepEqual(found('S-01'), ['S-01'])
  assert.deepEqual(found('s-103'), ['S-103'])
})

test('case is folded for the Latin half of a bilingual product', () => {
  assert.deepEqual(found('JOHN'), ['S-103'])
  assert.deepEqual(found('john karim'), ['S-103'])
})

test('a missing field is skipped, not matched as the word null', () => {
  // John has no guardian number. A search for "null" that returned him would be a
  // search that found the absence of a phone rather than a child.
  assert.deepEqual(found('null'), [])
  assert.deepEqual(found('undefined'), [])
})

test('a query of pure punctuation does not match everything', () => {
  // It squashes to nothing, and every string contains nothing. Without the guard the
  // count above the list would claim to have filtered a list it had not touched.
  assert.deepEqual(found('---'), [])
})

test('vowel marks are kept, because they are what tells two children apart', () => {
  // আলি and আলী are two names. Stripping the marks to be generous would make the
  // search unable to distinguish them, which is worse than finding neither.
  assert.equal(matchesSearch(['আলি'], searchTerms('আলী')), false)
  assert.equal(matchesSearch(['আলী'], searchTerms('আলী')), true)
})

test('a query longer than the cap is cut rather than refused', () => {
  // It arrives in a URL somebody can edit. Sixty characters is a full name and a phone
  // number; past that there is nothing to be gained by matching more of it.
  const long = 'ali'.repeat(40)
  const terms = searchTerms(long)
  assert.equal(terms.length, 1)
  assert.equal(terms[0].length, MAX_QUERY)
})

test('normalizeSearch collapses the whitespace a phone keyboard inserts', () => {
  assert.equal(normalizeSearch('  Ali   Ur  '), 'ali ur')
})
