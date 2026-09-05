/**
 * Turning a coaching centre's register into rows.
 *
 * §4 of the plan: we load the centre's students ourselves, from whatever they
 * have — a notebook, a WhatsApp message, an Excel column a nephew made. Nobody
 * is going to reformat two hundred lines into a CSV first, and a strict format
 * would just move the evening of typing from us to them.
 *
 * So the parser reads one student per line and is deliberately forgiving about
 * everything else. These are all the same student:
 *
 *   রাফিদ হাসান 01712345678
 *   ১২। রাফিদ হাসান — ০১৭১২৩৪৫৬৭৮
 *   01712345678  রাফিদ হাসান
 *   রাফিদ হাসান, করিম মিয়া, +880 1712-345678
 *   রাফিদ হাসান - করিম মিয়া - 01712345678
 *
 * The rule is: find the mobile number anywhere in the line, take it out, and
 * whatever is left is the name. Column order therefore does not matter, which
 * matters because every register has a different one. What separates the columns
 * does not matter either — a comma, a semicolon, a tab, a pipe, or a spaced dash
 * (see `COLUMN`), because a register written with dashes is as common as one
 * written with commas and neither owner thinks of it as a format.
 *
 * What it will NOT guess is a student code. A register's serial number is a
 * position in a notebook, not an identity — it changes the moment somebody
 * leaves — and students.student_code is unique per centre, so importing them
 * would turn one bad guess into a failed import for the whole paste.
 */

import { normalizeBdMobile, toAsciiDigits } from './phone.ts'
// The same cap the one-at-a-time form uses, checked here rather than in the
// action so the preview and the import agree on which lines count: a stray
// instruction in the middle of a register ("সবাই সকাল ৮টায় আসবে 01712345678")
// parses to a name of sentence length, and it has to be visible as a problem
// the owner can fix rather than a row dropped later.
import { MAX_NAME } from '../limits.ts'

/**
 * Why a paste is capped at all: it goes to Postgres as one jsonb value inside
 * one statement, and a 2000-line paste is a request body that a patchy mobile
 * connection will drop halfway. Chunking is the owner's problem for about four
 * seconds; a silent timeout is their problem for an hour.
 */
export const MAX_IMPORT_ROWS = 500


export type RosterProblem =
  /** No digits in the line at all — usually a header row or a section title. */
  | 'no-phone'
  /** Digits are there but they are not a BD mobile: a typo, or a landline. */
  | 'bad-phone'
  /** A number, but nothing left over to call the student. */
  | 'no-name'
  /** Too long to be a name. Almost always a sentence with a number in it. */
  | 'name-too-long'
  /** The same name and number appeared higher up in this same paste. */
  | 'duplicate'

export type RosterRow = {
  /** 1-based line number in the pasted text, so the preview can point at it. */
  line: number
  /** The line as typed, shown next to any problem so it can be found and fixed. */
  raw: string
  name: string | null
  /** E.164, ready for the database. */
  phone: string | null
  guardianName: string | null
  /** Extra valid numbers on the line, taken out of the name and reported. */
  dropped: string[]
  problem: RosterProblem | null
}

/** Exactly the shape public.import_students expects in its jsonb array. */
export type ImportStudent = {
  name: string
  guardian_phone: string
  guardian_name: string | null
}

const isDigit = (c: string) => c >= '0' && c <= '9'

/** What a human puts inside a phone number: 017-1234 5678, (017) 12345678. */
const isPhoneSeparator = (c: string) =>
  c === ' ' || c === '\t' || c === '-' || c === '.' ||
  c === '(' || c === ')' || c === '+' || c === '–' || c === '—'

type PhoneHit = { start: number; end: number; e164: string }

/**
 * Finds every BD mobile in a line, left to right.
 *
 * This counts digit positions instead of running a regex, because the number is
 * written with separators inside it (017-1234-5678) and sits right next to other
 * digits ("রাফিদ 01712345678 850" — that last column is marks). A pattern loose
 * enough to allow spaces inside the number is also loose enough to swallow the
 * marks; walking the digits and then insisting the run was not clipped out of a
 * longer one is both shorter and exact.
 *
 * Lengths are tried longest-first so +8801712345678 reads as one number rather
 * than as ten digits with junk on the end.
 */
function findPhones(ascii: string): PhoneHit[] {
  const at: number[] = []
  for (let i = 0; i < ascii.length; i++) if (isDigit(ascii[i])) at.push(i)

  const hits: PhoneHit[] = []
  let d = 0
  while (d < at.length) {
    let matched = 0
    for (const len of [13, 11, 10]) {
      if (d + len > at.length) continue
      const start = at[d]
      const end = at[d + len - 1]
      // Not a slice out of something longer: an NID or a bank account must not
      // read as a mobile just because eleven of its digits would validate.
      if (d > 0 && at[d - 1] === start - 1) continue
      if (d + len < at.length && at[d + len] === end + 1) continue
      let clean = true
      for (let i = start; i <= end && clean; i++) {
        clean = isDigit(ascii[i]) || isPhoneSeparator(ascii[i])
      }
      if (!clean) continue
      const e164 = normalizeBdMobile(ascii.slice(start, end + 1))
      if (!e164) continue
      hits.push({ start, end, e164 })
      matched = len
      break
    }
    d += matched || 1
  }
  return hits
}

/**
 * A register serial at the front of a line: "12।", "১২.", "3)", "07 -".
 *
 * Stripped only after the phone number has been cut out. Applied to the whole
 * line it would eat the "017-" of 017-1234-5678 and leave an eight-digit
 * remainder, which is the kind of bug that quietly drops a hundred parents.
 */
const SERIAL = /^\s*\d{1,3}\s*[.)।৷:\-–—]\s*/

/**
 * Cuts a leading serial. Matched against the ASCII-digit copy so that "১২।"
 * strips like "12.", then sliced off the original by length — safe because
 * toAsciiDigits replaces one character with one character.
 */
function stripSerial(remainder: string): string {
  const match = SERIAL.exec(toAsciiDigits(remainder))
  return match === null ? remainder : remainder.slice(match[0].length)
}

/** Column punctuation, and the gap left behind where a phone number was. */
const EDGE_JUNK = /^[\s,;:|\/\-–—.]+|[\s,;:|\/\-–—.]+$/g

/**
 * What separates one column from the next.
 *
 * A DASH WITH SPACE ON BOTH SIDES IS A COLUMN, and that is the whole of the second
 * half of this pattern. Half the registers in the country are written with dashes
 * rather than commas — `Rahim Ahmed - Abdul Karim - 01712345678` — and without this
 * the line arrives as one student called "Rahim Ahmed - Abdul Karim" with no
 * guardian: the father's name silently welded onto the child's, on every row of the
 * paste, in a field the owner can no longer edit once the students exist (§7.1 fixes
 * names at creation).
 *
 * SPACE ON BOTH SIDES, AND THAT IS NOT FUSSINESS. `Abdul-Karim` and `আব্দুল-করিম`
 * are one name and must stay one name, so a dash between two letters is not a
 * separator. Requiring the spaces is what tells a compound surname from a column
 * rule — the same distinction a human reader makes and for the same reason.
 *
 * Three dash characters because a phone keyboard gives you whichever it feels like:
 * hyphen-minus from an English layout, en dash from a Bangla one, em dash from
 * anything that has been through Word. The phone finder already treats all three as
 * separators *inside* a number (`isPhoneSeparator`), and this is the same alphabet
 * applied to the gap *between* fields.
 */
const COLUMN = /[,;\t|]|\s+[-–—]\s+/

function cleanNamePart(part: string): string {
  return part
    .replace(EDGE_JUNK, '')
    .split(/\s+/)
    // Bare numbers in a register line are columns, not names: the serial, this
    // month's fee, a marks total. A student's name is never a number on its own.
    // ("রাফিদ (২)", written to tell two Rafids apart, keeps its brackets and so
    // survives this; a bare "২" does not, which is the right way round.)
    .filter((token) => token !== '' && !/^\d+$/.test(toAsciiDigits(token)))
    .join(' ')
    .trim()
}

function nameFromRemainder(remainder: string) {
  const parts = remainder.split(COLUMN)
  // A guardian's name never contains a number; a class, section or fees column
  // always does. So a later column is only believed if it has no digits in it —
  // otherwise "রাফিদ, ক্লাস ১০, 01712345678" files the class as the father.
  let guardianName: string | null = null
  for (const part of parts.slice(1)) {
    // Tested before the bare numbers are stripped out, or "ক্লাস ১০" would lose
    // its digits and then pass as a perfectly plausible father.
    if (/\d/.test(toAsciiDigits(part))) continue
    const candidate = cleanNamePart(part)
    // A column of sentence length is a note somebody wrote in the margin, not a
    // father's name. Skipped rather than shortened, because half a sentence
    // filed as a guardian is worse than no guardian at all — and the student's
    // own name and number on that line are still perfectly good.
    if (candidate !== '' && candidate.length <= MAX_NAME) {
      guardianName = candidate
      break
    }
  }
  return { name: cleanNamePart(parts[0] ?? '') || null, guardianName }
}

/**
 * Reads a pasted register. One line per student, blank lines ignored.
 *
 * Every non-blank line comes back, in order, whether or not it worked — the
 * import screen shows all of them and the owner fixes the broken ones in the
 * box. A parser that silently dropped what it could not read would import 180
 * of 200 students and never say which twenty went missing.
 *
 * Deliberately uncapped: the caller counts the lines in the raw text and refuses
 * anything over MAX_IMPORT_ROWS. If this function truncated instead, a paste of
 * 800 would import exactly 500 and report complete success.
 */
export function parseRoster(text: string): RosterRow[] {
  const rows: RosterRow[] = []
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trim() === '') continue

    // toAsciiDigits is a 1:1 character replacement, so an index into the
    // converted string is the same index in the original. That is the whole
    // trick here: find the number in ASCII, cut it out of the Bangla.
    const ascii = toAsciiDigits(raw)
    const hits = findPhones(ascii)

    let remainder = raw
    for (let h = hits.length - 1; h >= 0; h--) {
      remainder = `${remainder.slice(0, hits[h].start)} ${remainder.slice(hits[h].end + 1)}`
    }

    const { name, guardianName } = nameFromRemainder(stripSerial(remainder))
    const phone = hits.length > 0 ? hits[0].e164 : null
    // The register's own column order decides which number is the guardian's:
    // the first one on the line. A second is taken out of the name and reported
    // rather than silently thrown away — usually it is the student's own mobile,
    // which someone can add by hand once they know whose it is.
    const dropped = hits.slice(1).map((hit) => hit.e164)

    let problem: RosterProblem | null = null
    if (phone === null) {
      problem = /\d/.test(ascii) ? 'bad-phone' : 'no-phone'
    } else if (name === null) {
      problem = 'no-name'
    } else if (name.length > MAX_NAME) {
      problem = 'name-too-long'
    } else {
      // Same key the SQL uses, so the preview's count and the import's count
      // agree. Name alone would collapse siblings; phone alone would collapse
      // two brothers on their father's number, which every register has.
      const key = rosterKey(name, phone)
      if (seen.has(key)) problem = 'duplicate'
      else seen.add(key)
    }

    rows.push({ line: i + 1, raw, name, phone, guardianName, dropped, problem })
  }

  return rows
}

/** The rows that are safe to send, in the shape the RPC wants. */
export function readyRows(rows: RosterRow[]): ImportStudent[] {
  return rows.flatMap((row) =>
    row.problem === null && row.name !== null && row.phone !== null
      ? [{ name: row.name, guardian_phone: row.phone, guardian_name: row.guardianName }]
      : [],
  )
}

/**
 * "Is this the same student?", in one place.
 *
 * Must stay in step with public.import_students, which matches on
 * lower(collapsed name) + guardian phone. Three callers depend on the same
 * answer: this parser's within-paste dedupe, the preview marking rows that are
 * already on the roster, and the action's plan-cap arithmetic. When they
 * disagree, the screen promises a number the import does not deliver.
 *
 * The phone is compared exactly as stored, like the SQL does, rather than
 * re-normalised here — being wrong in the same direction as the authority is
 * better than being right in a different one.
 */
export function rosterKey(name: string, phone: string): string {
  return `${name.trim().replace(/\s+/g, ' ').toLowerCase()} ${phone}`
}
