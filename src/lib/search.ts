/**
 * Finding one student in a screen full of them.
 *
 * A centre with three hundred names has no use for a list of three hundred names, and
 * every screen in this product was built to be read top to bottom by an owner who knew
 * what they were looking at. This is the box that fixes that, and it is deliberately
 * one function shared by every screen rather than an `ilike` written into six queries:
 * a search that behaves differently on the fee board and on the roster is a search an
 * owner stops trusting after the second time it finds nothing.
 *
 * IT MATCHES IN MEMORY, ON ROWS THE PAGE HAD ALREADY FETCHED. Not because the database
 * could not do it — it could, better — but because the totals on these screens must not
 * move when somebody types in the box. An owner searching for "আলী" on the fee board is
 * asking which of these rows is Ali's; they are not asking for the centre's outstanding
 * to become Ali's outstanding. Filtering the list and leaving the figures alone is the
 * only reading of that box that cannot mislead, and it costs one pass over a few hundred
 * rows that are in memory already.
 *
 * FOUR THINGS ARE FOLDED AWAY, each because a real owner hits it on a real phone:
 *
 *   - Case, for the Latin half of a bilingual product. Bangla has none.
 *   - Bangla digits, in both directions. A Bangla keyboard types ০১৭; the phone column
 *     holds 017. Neither would find the other, and the person typing has no way to
 *     guess which one the screen wants.
 *   - Punctuation and spaces, on a second pass. "01712 345678" finds 01712345678, and
 *     "S01" finds S-01, without anybody being taught how the codes were typed in.
 *   - Word order. Every word in the query has to appear somewhere in the row, but not
 *     in the order given and not next to each other — so "রহমান আলী" finds আলী উর রহমান,
 *     and "ali 017" finds the Ali whose guardian's number starts that way, which is how
 *     you tell two of them apart.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import { toAsciiDigits } from './bd/phone.ts'

/**
 * Everything that is not a letter or a digit, in either script.
 *
 * The Bangla block is spelled as a range because the alternative is listing sixty
 * codepoints: U+0980–U+09FF covers the letters, the vowel signs that sit on them, and
 * the digits, which have already been folded to ASCII by the time this runs — a name is
 * matched with its marks intact, because dropping them would make আলি and আলী the same
 * word and a search that cannot tell two children apart is worse than one that finds
 * neither.
 */
const NOT_WORD = /[^a-z0-9ঀ-৿]+/g

/**
 * How long a query may be.
 *
 * The box is not a note and nothing is stored from it; the cap is here because the query
 * arrives in a URL a person can edit, and a megabyte of it would be matched against
 * every row on the page. Generous enough that a full name and a phone number both fit.
 */
export const MAX_QUERY = 60

/**
 * A query or a field, reduced to what matching actually compares.
 *
 * Lowercased, Bangla digits folded to ASCII, whitespace collapsed. Kept separate from
 * `squash` below because the two passes answer different questions and a row matches if
 * either of them says so.
 */
export function normalizeSearch(raw: string | null | undefined): string {
  return toAsciiDigits(String(raw ?? ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The same, with every space and every piece of punctuation gone. */
function squash(normalized: string): string {
  return normalized.replace(NOT_WORD, '')
}

/**
 * The query as the words it is made of, or an empty list when there is nothing to
 * search for.
 *
 * Read once per page and handed to `matchesSearch` for every row, so the splitting and
 * the folding are not redone three hundred times. An empty list is the signal that no
 * filtering should happen at all — which is not the same as a filter that matches
 * everything, because the screen also has to decide whether to say "showing 4 of 312".
 */
export function searchTerms(raw: string | null | undefined): string[] {
  const trimmed = normalizeSearch(raw).slice(0, MAX_QUERY)
  return trimmed ? trimmed.split(' ') : []
}

/**
 * Does this row answer the query?
 *
 * Every term has to be found, each one independently, anywhere across the fields given —
 * so a term may match the name and the next may match the phone. Nulls are skipped
 * rather than turned into the string "null", which would make a search for "null" find
 * every row with a missing guardian number.
 */
export function matchesSearch(
  fields: readonly (string | null | undefined)[],
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true

  const hay = normalizeSearch(fields.filter((f) => f != null).join(' '))
  const tight = squash(hay)

  return terms.every((term) => {
    if (hay.includes(term)) return true
    // A term of pure punctuation squashes to nothing, and every string contains
    // nothing — so without this a query of "-" would match every row on the page and
    // the count above the list would claim it had filtered something.
    const tightTerm = squash(term)
    return tightTerm !== '' && tight.includes(tightTerm)
  })
}
