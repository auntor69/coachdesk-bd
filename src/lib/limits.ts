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
