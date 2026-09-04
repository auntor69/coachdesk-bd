/**
 * The four exam screens (§20.8), which nothing read before this file.
 *
 * WHAT IS BEING GUARDED. Every ending on each screen now draws a `PageHeader` instead of
 * the screen writing its own heading block — either one bar per ending, or, where a screen
 * grew a third, one hoisted `head` the endings share. Each screen made a different width
 * decision:
 *
 *   - `/exams` is the only one that spends the desktop. Forty rows is a list density
 *     helps, so the width buys a second column from `xl` rather than a 672px column on
 *     a 1,216px screen — the phone-stretched-to-fit shape §20 exists to end.
 *   - the other three are a form, a marks sheet and a correction form. Nothing goes
 *     beside them, so the cap goes on the content and the width goes back. It may never
 *     go on the page's own column: the bar bleeds to the workspace edges with `lg:-mx-8`
 *     and a capped root would stop its border and background 672px in.
 *
 * And the §38 half: nothing in the redesign moved a permission gate or let a dropped
 * read reach a sentence about the centre. Those assertions are here because a layout
 * refactor is exactly when they get lost.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const EXAMS = ['src', 'app', '(app)', 'exams']
const LIST = read(...EXAMS, 'page.tsx')
const NEW = read(...EXAMS, 'new', 'page.tsx')
const SHEET = read(...EXAMS, '[examId]', 'page.tsx')
const EDIT = read(...EXAMS, '[examId]', 'edit', 'page.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** The marks screen's main bar alone — the two refusal arms write theirs on one line. */
const SHEET_BAR = SHEET.slice(
  SHEET.indexOf('      <PageHeader\n'),
  SHEET.indexOf('{rows.length === 0 ?'),
)

/** And the sheet's own group, so a cap on it cannot be satisfied by a refusal card. */
const SHEET_GROUP = SHEET.slice(SHEET.indexOf('<MarksSheet'))

/* -------------------------------------------------------------------------- */
/* One bar per ending, and no screen writes its own heading                    */
/* -------------------------------------------------------------------------- */

test('every ending on all four screens draws the bar and none draws a heading', () => {
  // A screen with three endings draws three bars, each naming the screen that refused —
  // that is the whole reason the bar is a component and not part of the shell.
  assert.equal(count(LIST, '<PageHeader'), 2, 'the list: the rows and a failed read')
  assert.equal(count(SHEET, '<PageHeader'), 3, 'the sheet: the sheet and two failed reads')
  assert.equal(count(EDIT, '<PageHeader'), 3, 'the edit form: the form, a failed read, read-only')

  // The new-exam form has three endings too — the form, a failed batch read, and a centre
  // that cannot save — and one bar between them, hoisted so a crumb cannot go missing from
  // whichever arm a later pass edits. Both halves asserted: one bar written, three drawn.
  assert.equal(count(NEW, '<PageHeader'), 1, 'the form: one bar for all three endings')
  assert.equal(count(NEW, 'const head = ('), 1)
  assert.equal(count(NEW, '{head}'), 3)

  for (const [name, src] of [
    ['list', LIST],
    ['new', NEW],
    ['sheet', SHEET],
    ['edit', EDIT],
  ] as const) {
    assert.equal(count(src, '<h1'), 0, `${name}: still writes its own heading`)
    assert.ok(
      src.includes("import { PageHeader } from '@/components/page-header'"),
      `${name}: draws the bar without importing it`,
    )
  }
})

test('the list carries no crumb and the three sub-screens all do', () => {
  // `/exams` is a nav-level destination: the sidebar and the tab bar are how a reader
  // got here, so a "back" pointing at nothing above it would be furniture.
  assert.doesNotMatch(LIST, /back=\{\{/)

  // One crumb for all three of the new-exam form's endings, because the bar is hoisted.
  assert.equal(count(NEW, "back={{ href: '/exams', label: t.title }}"), 1)

  // All three of the sheet's, including the failed reads — the list it returns to still
  // has the exam on it, so the way out is drawn even when the row would not load.
  assert.equal(count(SHEET, "back={{ href: '/exams', label: t.title }}"), 3)

  // The arm where the exam row itself did not arrive names the screen and not the exam:
  // the title is precisely what did not load. The arm where only the sheet's two reads
  // failed does name it, because that read succeeded.
  assert.match(SHEET, /<PageHeader title=\{t\.marksTitle\} back=/)
  assert.match(SHEET, /<PageHeader title=\{exam\.title\} back=/)

  // And no screen keeps a hand-rolled crumb beside the bar's own.
  for (const [name, src] of [
    ['new', NEW],
    ['sheet', SHEET],
    ['edit', EDIT],
  ] as const) {
    assert.doesNotMatch(src, /← \{t\.title\}/, `${name}: hand-rolled crumb`)
    assert.doesNotMatch(src, /← \{t\.back\}/, `${name}: hand-rolled crumb`)
  }
})

/* -------------------------------------------------------------------------- */
/* The list is the one screen that spends the desktop                         */
/* -------------------------------------------------------------------------- */

test('the list is one column to lg and two from xl', () => {
  // Not a table: a row carries a title, a batch, a subject, a date, a full mark, a
  // fraction, an amber remainder and an SMS state, and seven columns at 375px is
  // horizontal scroll on the screen teachers actually use.
  assert.match(LIST, /<ul className="grid gap-2 xl:grid-cols-2">/)

  // `h-full` on the link, so two rows sharing a line are the same height whether or not
  // one of them carries the amber remainder line.
  assert.match(LIST, /className="flex h-full items-center gap-3 rounded-xl border/)

  // Two and not three. At `2xl` a third column is 390px and the title truncates
  // mid-word; a row needs about 460.
  assert.doesNotMatch(LIST, /grid-cols-3/)
})

test('the list column is never capped, and its three cards are', () => {
  // On the column the cap would stop the bar's own border and background 672px into a
  // 1,216px workspace, because the bar bleeds out to the edges with `lg:-mx-8`.
  assert.match(LIST, /return \(\n {4}<div className="flex flex-col gap-5">\n {6}<PageHeader/)

  // A failed read, an empty centre and the missing-figures aside. All three are a
  // paragraph of prose, which is the one thing 1,216px genuinely hurts.
  assert.equal(count(LIST, 'max-w-2xl'), 3)
})

test('the New button is in the bar, gated, and gone when the read failed', () => {
  const BAR = LIST.slice(LIST.indexOf('      <PageHeader'), LIST.indexOf('{indexed.length'))
  // Anchored at the start of its own line: `actions={` is a substring of any typo'd
  // prop name, so an unanchored match is satisfied by the prop it was meant to catch.
  assert.match(BAR, /\n\s+actions=\{\n\s+canMark && \(/)
  assert.ok(BAR.includes('href="/exams/new"'))

  // The refusal arm draws the bar without it: creating an exam is only safe for a reader
  // who can see the ones that already exist, and that is exactly what failed.
  assert.match(LIST, /<PageHeader title=\{t\.title\} subtitle=\{t\.subtitle\} \/>/)
})

/* -------------------------------------------------------------------------- */
/* The three that give the width back                                         */
/* -------------------------------------------------------------------------- */

test('the new-exam form is capped on its content and not on the page', () => {
  assert.match(NEW, /return \(\n {4}<div className="flex flex-col gap-5">\n {6}\{head\}/)
  // `ExamForm` takes no className, so the cap is a wrapper around it.
  assert.match(NEW, /<div className="max-w-2xl">\n {10}<ExamForm/)
  assert.equal(count(NEW, 'max-w-2xl'), 4, 'the form, both refusal cards, and the note')
})

test('the marks sheet, its notices and the metered gate share one capped group', () => {
  assert.match(SHEET, /return \(\n {4}<div className="flex flex-col gap-5">\n {6}<PageHeader/)
  assert.match(SHEET, /<div className="flex max-w-2xl flex-col gap-5">\n {10}<MarksSheet/)
  assert.equal(count(SHEET, 'max-w-2xl'), 4)

  // A row is a name, a 64px mark box, two 44px buttons and a note field under it. The
  // note field is `w-full`, so uncapped it is 1,160px wide for a five-word note and the
  // mark box sits a screen away from the name it belongs to.
  const notices = SHEET_GROUP.indexOf('<ResultNotices')
  const gate = SHEET_GROUP.indexOf('<SmsGate')
  // Both found before they are ordered: -1 reads as "before everything" and a renamed
  // component would pass the comparison below rather than fail it.
  assert.ok(notices > 0 && gate > 0, 'a component under the sheet was renamed')
  // The tap-through list above the metered queue, because it is the one that works.
  assert.ok(notices < gate)
})

test('the correction form is capped, and its crumb goes back to the exam', () => {
  assert.match(EDIT, /return \(\n {4}<div className="flex flex-col gap-5">\n {6}<PageHeader/)
  assert.match(EDIT, /<div className="flex max-w-2xl flex-col gap-5">/)
  assert.equal(count(EDIT, 'max-w-2xl'), 3, 'the form group, the failed read, and the note')

  // Where the reader came from, and where the marks they were looking at still are.
  assert.match(EDIT, /back=\{\{ href: `\/exams\/\$\{exam\.id\}`, label: t\.back \}\}/)
  assert.match(EDIT, /subtitle=\{t\.lead\}/)

  // The failed read goes to the list instead: `/exams/${examId}` reads the same row and
  // would refuse again.
  assert.match(EDIT, /back=\{\{ href: '\/exams', label: d\.exams\.title \}\}/)

  // Nothing in the file links by hand any more, so the import went with the crumbs.
  assert.doesNotMatch(EDIT, /from 'next\/link'/)
})

test('neither exam form is drawn to a centre that cannot save', () => {
  /*
   * §4.4. `createExam`, `updateExam` and `deleteExam` all run requireWritable, so both of
   * these screens could only ever be filled in and refused — and the reader filling them
   * in is a teacher standing in front of the class the paper is for, on a phone, between
   * two batches. The repo-wide half of this is in read-only.test.ts; what is here is the
   * two facts particular to these screens.
   */
  for (const [name, src] of [['new', NEW], ['edit', EDIT]] as const) {
    assert.match(src, /if \(session\.access !== 'full'\) \{/, `${name}: draws the form anyway`)
    assert.match(src, /<ReadOnlyNote t=\{d\.readOnly\} className="max-w-2xl" \/>/, `${name}: no note`)

    // Below the permission gate, which asks a different and earlier question: whether this
    // reader may be on the screen at all. A teacher without the owner's "Exams & marks"
    // tick gets the 403 they would get at a paying centre.
    assert.ok(
      src.indexOf('canManageExams()') < src.indexOf("if (session.access !== 'full') {"),
      `${name}: the standing is checked before the permission is`,
    )
  }

  // The crumb is the exam and not the list, the same as the form arm's: a read-only centre
  // still reads everything, so the screen the reader came from is where they go back to.
  assert.match(EDIT, /back=\{\{ href: `\/exams\/\$\{examId\}`, label: t\.back \}\}/)
})

/* -------------------------------------------------------------------------- */
/* The identity line, and the quiet way out of a mistyped exam                */
/* -------------------------------------------------------------------------- */

test('four stacked paragraphs of exam identity became one subtitle', () => {
  // Batch, subject and kind, then the day, the full mark and the pass mark. One fact —
  // which exam this is — and a reader checks them together or not at all.
  assert.ok(SHEET_BAR.includes('{subtitle && <>{subtitle} · </>}'))
  assert.ok(SHEET_BAR.includes('{formatDate(exam.exam_date, locale)} · {t.fullMarks}'))
  assert.match(SHEET_BAR, /exam\.pass_marks !== null && \(/)
  assert.ok(SHEET_BAR.includes('· {t.pass} <span className="num">'))

  // The old block's two paragraphs, which were the second and third lines of a heading
  // that is now one line plus a subtitle.
  assert.doesNotMatch(SHEET, /mt-0\.5 text-ink-soft/)
  assert.doesNotMatch(SHEET, /mt-0\.5 text-sm text-ink-faint/)
})

test('the edit link is an action on the bar, still quiet and still gated', () => {
  // The errand on this screen is entering marks, not correcting the heading — so a text
  // link at the end of the line rather than a second button competing with the sheet.
  assert.match(SHEET_BAR, /\n\s+actions=\{\n\s+canMark && \(/)
  assert.ok(SHEET_BAR.includes('{d.examEdit.title} →'))
  assert.match(SHEET_BAR, /text-sm font-medium\n\s+text-brand-700/)
  assert.doesNotMatch(SHEET_BAR, /bg-brand-600/, 'the quiet link became a button')

  // `canMark` is `canManageExams()`, the same gate the edit screen and both its actions
  // check, so a teacher without it is never offered a door that answers 403.
  assert.ok(SHEET.includes('const [canSend, canMark] = await Promise.all([canSendSms(), canManageExams()])'))
})

/* -------------------------------------------------------------------------- */
/* §38: the redesign moved no gate                                            */
/* -------------------------------------------------------------------------- */

test('every exam screen is teacher-or-above, and both write screens need the tick', () => {
  for (const [name, src] of [
    ['list', LIST],
    ['new', NEW],
    ['sheet', SHEET],
    ['edit', EDIT],
  ] as const) {
    assert.ok(src.includes("await pageRole('teacher')"), `${name}: unguarded`)
  }

  // The owner's "Exams & marks" tick, and a 403 rather than a form that fails on submit.
  // A bookmark, a back button and a typed URL all still arrive at both of these.
  assert.ok(NEW.includes('if (!(await canManageExams())) forbidden()'))
  assert.ok(EDIT.includes('if (!(await canManageExams())) forbidden()'))

  // The list is deliberately not gated — a teacher who may not create exams still needs
  // to read the marks for the class they teach, which is the distinction the permission
  // draws. The tick only decides whether the two doors to /exams/new are drawn.
  assert.doesNotMatch(LIST, /forbidden\(\)/)
  assert.ok(LIST.includes('const canMark = await canManageExams()'))
  assert.equal(count(LIST, 'canMark && ('), 2)

  // A miss is a 404 and not a 403 on both screens that take an id, so a URL cannot be
  // used to find out which exam ids exist in other centres.
  assert.ok(SHEET.includes('if (!exam) notFound()'))
  assert.ok(EDIT.includes('if (!exam) notFound()'))
})

test('no dropped read on any of the four reaches a sentence about the centre', () => {
  // The list: `(history ?? [])` put a failed read into "no exams yet" under a button
  // offering to create the centre's first — at a centre with two hundred exams on file.
  assert.ok(LIST.includes('if (indexed === null) {'))
  assert.ok(LIST.includes('countsProblem = worstFailure(enrolled, results, notices)'))

  // The new-exam form: an empty picker is a form that submits nothing, and the empty card
  // reads "you need a batch first" under the one control that makes a duplicate batch.
  assert.ok(NEW.includes('const noBatchesOfMine = mine?.length === 0'))
  assert.ok(NEW.includes("const scopeUnreadable = scope !== null && 'unreadable' in scope"))
  assert.ok(NEW.includes('if (rows === null) {'))

  // The marks sheet: a blank box is a deliberate erase to `saveMarks`, so an unread
  // `exam_results` plus three marks typed and saved silently deletes the other
  // thirty-seven. The roster for the attendance screen's reason.
  assert.ok(SHEET.includes('if (enrollments === null || results === null) {'))
  // Not the notices read, which fails open: unread it says nobody was told, so a family
  // may hear twice; withheld, the ones who have not heard at all would not be listed.
  assert.ok(SHEET.includes('for (const notice of notices ?? []) {'))

  // The edit form: `updateExam` writes `exam_type_id` from this form on every save, so a
  // kind picker the form did not draw arrives as '' and clears the column.
  assert.ok(EDIT.includes('examTypes === null\n      ? null'))
  assert.ok(EDIT.includes('frozen={!facts || facts.smsSent}'))
})

test('the metered gate is still drawn only when it can do something', () => {
  // No BTRC sender ID, so no aggregator, so no gateway — and every tier grants zero
  // credits. Drawn unconditionally this was a send button arithmetic guaranteed was
  // disabled, under a red line about credits no screen in the product can sell.
  assert.ok(SHEET.includes('{(providerLive || exam.sms_sent_at || !canSend) && ('))
  assert.ok(SHEET.includes('const providerLive = smsProviderConfigured()'))

  // And the count and cost on it come from the same function the send action calls, so
  // the figure shown is the figure that would be charged.
  assert.ok(SHEET.includes('const plan = await planResultSms(supabase, {'))
})





