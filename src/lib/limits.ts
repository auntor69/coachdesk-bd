/**
 * What a field accepts. Not what a plan holds — that is `./plans.ts`.
 *
 * The distinction matters because the two fail differently. A plan limit is a
 * business rule an owner can pay to move, and hitting it is a sales
 * conversation. A cap here is a storage rule nobody can move, and hitting it
 * means the owner types a shorter name and gets on with their morning.
 *
 * Every cap lives here rather than at its check because each one is enforced in
 * at least two places — a `maxLength` in the browser so the field stops
 * accepting keystrokes, and a length check in the Server Action because a Server
 * Action is a public HTTP endpoint and `maxLength` is a suggestion to a browser
 * that chose to honour it. Two literals in two files is one edit away from a
 * field that silently truncates, or a form that refuses a name it let you type.
 *
 * No imports, on purpose, and for the reason given at the top of
 * `./i18n/locale.ts`: the browser forms import these numbers, so anything this
 * file pulls in ships to a phone on 3G. The sentences that quote these numbers
 * live in `./i18n/messages.ts`, which only the server reads.
 */

/**
 * Every name an owner types: a subject, a batch, a student, a teacher, an exam,
 * the centre itself.
 *
 * 80 rather than the column's own limit because these are names people read on a
 * phone in a list, and the longest real one in the seed data is 21 characters.
 * The cap exists to stop a paste accident from making a row unreadable, not to
 * describe what Postgres can hold.
 */
export const MAX_NAME = 80

/**
 * A code or a short label that sits in a table cell: a centre's own roll number,
 * "HSC ২য় বর্ষ", a bKash transaction id.
 *
 * Not a name, because nobody reads these as words — they get compared against a
 * receipt or a register, and a long one means somebody pasted the wrong thing.
 */
export const MAX_LABEL = 40

/**
 * A teacher's one line about one student's marks. Sixty because it also has to
 * fit in the result SMS after the marks and the centre's name, and because a
 * teacher writing more than that on forty students will not finish.
 */
export const MAX_NOTE = 60

/**
 * A paragraph that stays on the screen: why today's class was short, what a
 * parent said when they paid half.
 *
 * Bigger than MAX_NOTE because nothing carries it anywhere — the 60 above is
 * small because it rides inside an SMS somebody pays for, and this one only ever
 * gets read by the person who opens the record. Still capped, because it arrives
 * from a public endpoint and lands in a column.
 */
export const MAX_TEXT = 200

/**
 * A notice the whole batch is told: closed for Eid, the exam moved, bring the book.
 *
 * Larger than MAX_TEXT because this one does leave the screen — it goes on the
 * owner's clipboard and into forty families' phones — and the three sentences that
 * actually stop forty parents ringing to ask do not fit in two hundred characters of
 * Bangla. Smaller than the column, because every character past the first seventy is
 * another whole SMS the owner pays for, and 400 is already five of them.
 */
export const MAX_NOTICE = 400

/**
 * Cuts an optional field down to its cap instead of refusing the whole write.
 *
 * For the fields a browser already capped, which is all of them: `maxLength`
 * stopped the keystrokes, so anything longer arriving here came from something
 * that is not the form. That is worth defending against — an unbounded string
 * from a public endpoint lands in a column and then in a list on somebody's
 * phone — but it is not worth a sentence, because no real owner will ever read
 * it. The required fields still refuse and say why: `name` is the one an owner
 * actually typed, and silently shortening it would be a lie.
 */
export function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

