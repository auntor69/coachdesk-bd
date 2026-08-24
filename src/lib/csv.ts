/**
 * CSV, as the spreadsheet on a Windows laptop in Dhaka actually reads it.
 *
 * Three things about this file are not stylistic, and each of them is a way an
 * export can arrive looking like a bug in the product rather than a file:
 *
 * THE BYTE ORDER MARK. Excel on Windows does not detect UTF-8 in a .csv it was
 * double-clicked into; it decodes using the system code page. Every Bangla name in
 * the file then arrives as mojibake, which for a Bengali-primary product is not a
 * cosmetic problem — it is the whole export destroyed. A leading U+FEFF is what
 * makes Excel read UTF-8, costs three bytes, and is ignored by every other CSV
 * reader worth using.
 *
 * CRLF LINE ENDINGS. RFC 4180 says CRLF, and old Excel builds on Windows join two
 * rows into one when handed bare LF. Nothing loses by writing what the standard
 * says.
 *
 * THE FORMULA GUARD. A cell whose first character is `=`, `+`, `-` or `@` is a
 * formula to Excel, LibreOffice and Google Sheets alike, and this product's text
 * fields are typed by people — a student's name, a payment reference, a note. A
 * name pasted in from somewhere else that happens to begin with `=` becomes code
 * running on the owner's own machine when they open their own export. So a text
 * cell that starts like a formula is prefixed with an apostrophe, which every
 * spreadsheet reads as "the rest of this is text". Numbers never go through that
 * path — a refund of -500 must stay a number the accountant's SUM can add.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: force Excel to keep the leading zero on a
 * phone number. `01712345678` is eleven digits and Excel will read it as the number
 * 1712345678 on a double-click. The fixes for that are all worse than the problem —
 * `="01712345678"` stops the file being CSV and puts a formula in every phone cell,
 * and a bare apostrophe shows up literally in half the readers that are not Excel.
 * A missing leading zero on a Bangladeshi mobile is recoverable by anyone who has
 * ever dialled one, because every one of them starts 01. Mojibake is not
 * recoverable, which is why the BOM is the fight worth picking.
 */

/**
 * What a cell may hold.
 *
 * `number` and `string` are genuinely different here rather than a convenience:
 * the formula guard applies to one and must never apply to the other.
 */
export type CsvCell = string | number | null | undefined

/** RFC 4180: quote if the field holds a delimiter, a quote, a newline. */
const NEEDS_QUOTING = /["\r\n,]/

/** Leading whitespace a reader would silently trim, so it is quoted to survive. */
const EDGE_SPACE = /^\s|\s$/

/** Characters that begin a formula in every spreadsheet that matters. */
const FORMULA_START = /^[=+\-@\t\r]/

export const CSV_BOM = '\ufeff'
export const CSV_EOL = '\r\n'

/** Content type with the charset spelled out, for readers that trust it. */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'

function quote(field: string): string {
  return `"${field.replace(/"/g, '""')}"`
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'number') {
    // Not Intl, not formatTaka: a spreadsheet column is arithmetic, and a thousands
    // separator or a ৳ turns the column into text the owner cannot total. NaN and
    // Infinity would both serialise to something no reader parses, so they leave as
    // blank — the same as no value, which is what they mean.
    if (!Number.isFinite(value)) return ''
    return String(value)
  }

  const text = FORMULA_START.test(value) ? `'${value}` : value
  return NEEDS_QUOTING.test(text) || EDGE_SPACE.test(text) ? quote(text) : text
}

export function csvRow(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(',')
}

/**
 * A finished file: BOM, header, rows, and a trailing newline.
 *
 * The trailing newline is there because a file that does not end in one makes
 * `wc -l` disagree with the row count and makes some parsers drop the last row.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string {
  const lines = [csvRow(header), ...rows.map(csvRow)]
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL
}

/**
 * The Content-Disposition for a download, with both filename forms.
 *
 * `filename` is the ASCII fallback every browser understands; `filename*` is
 * RFC 5987 and is what a browser picks when it can, so a centre called
 * "উদ্ভাস কোচিং" gets its own name on the file instead of a transliteration
 * somebody would have had to invent. Quotes and backslashes are stripped from the
 * ASCII form rather than escaped: the fallback only has to be a valid filename,
 * and a header a browser cannot parse is a download with no name at all.
 */
export function contentDisposition(asciiName: string, fullName = asciiName): string {
  const safe = asciiName.replace(/["\\]/g, '').replace(/[^\x20-\x7e]/g, '')
  return (
    `attachment; filename="${safe}"; ` +
    `filename*=UTF-8''${encodeURIComponent(fullName)}`
  )
}
