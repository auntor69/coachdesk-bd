/**
 * The two teaching screens: the day's list, and one batch's register.
 *
 * WHAT THIS FILE IS GUARDING. Nothing read either file before today. Both were phone
 * layouts at every width — the list put a batch name at the far left of 1,216px with its
 * Take button 900px away, and a register row put forty names that far from their tap
 * targets. Both are capped now, and both draw the page bar instead of a hand-rolled crumb
 * and a heading of their own.
 *
 * §38 is the other half, and it matters more here than on the money screens: these two
 * files hold the rule that decides whose register a reader may open, and the rule that
 * withholds the form when the check could not be made. A layout edit that moved a return
 * arm could drop either without a type error.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out: a `\n` anchor in an indexOf on a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const LIST = read('src', 'app', '(app)', 'teach', 'page.tsx')
const ROSTER = read('src', 'app', '(app)', 'teach', '[batchId]', 'page.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The day's list                                                             */
/* -------------------------------------------------------------------------- */

test('the list is titled by what it is, not by the hour of day', () => {
  // This page opened with "Good morning, Rahim" — which is what the dashboard's bar also
  // says, so the two screens a teaching owner moves between were titled the same thing.
  // The reader's own name is already in the sidebar's account block.
  assert.equal(count(LIST, '<PageHeader'), 2, 'the bar on the list and on the failed read')
  assert.equal(count(LIST, '<h1'), 0)
  assert.ok(LIST.includes('<PageHeader title={t.title} subtitle={summary} />'))
  assert.doesNotMatch(LIST, /greetingFor/, 'the greeting is the dashboard own line')
  assert.ok(LIST.includes("import { PageHeader } from '@/components/page-header'"))

  // The bar is the page's own first child, or a sticky box travels one grid row.
  assert.match(LIST, /return \(\n\s+<div className="flex flex-col gap-5">\n\s+<PageHeader/)
})

test('the day is a capped list and not a column stretched over a desktop', () => {
  // Two to six rows and no second subject to put beside them: the other batches are a
  // closed disclosure, which is a line of chrome rather than rail content. So the width
  // goes back. Six caps: the failed read, the two empty states, today's signatures, the
  // list and the disclosure.
  assert.equal(count(LIST, 'max-w-2xl'), 6)
  assert.ok(LIST.includes('<ul className="flex max-w-2xl flex-col gap-3">'))
  assert.ok(LIST.includes('<details className="max-w-2xl rounded-2xl'))

  // AND NEVER ON THE COLUMN. The bar bleeds `lg:-mx-8` to the workspace edges, so a cap
  // on the page root stops its border 672px into a 1,216px screen.
  assert.doesNotMatch(LIST, /flex flex-col gap-5[^"]*max-w-/)
  assert.doesNotMatch(LIST, /lg:grid-cols/, 'no rail was invented for a six-row list')
})

test('the clock is said on the row, and the centre is told who signed', () => {
  // 20260811000089. A class whose hour has not arrived says when it opens, one that
  // ended with nothing filed says what the day counts as, and a signature already given
  // replaces both — the three are one chain and never two at once.
  assert.ok(LIST.includes('classState({'), 'the row no longer reads the clock')
  assert.ok(LIST.includes('classWindow({'), 'the row no longer reads the batch hours')
  for (const key of ['t.opensAt', 't.countedCancelled', 't.signedEarly', 't.signedLate']) {
    assert.ok(LIST.includes(key), `${key} left the row`)
  }

  // The centre's notification, which is the half of the owner's request that has to
  // reach somebody other than the person who signed. Both sentences and the heading,
  // because a list that drew them without the words would render blank lines.
  assert.ok(LIST.includes('t.signaturesTitle'))
  assert.ok(LIST.includes('t.notifyEarly') && LIST.includes('t.notifyLate'))
  assert.ok(LIST.includes("from('attendance_unlocks')"))

  // And the Mark button stays on all three states: the gate is a signature and not a
  // wall, and a teacher with a class to file needs the door to it.
  assert.ok(LIST.includes('{t.take}'))
})

test('what the list says about the day survives the layout edit', () => {
  // §38 on the summary line, which is now the subtitle: four sentences chosen by how much
  // of the day is left, and the review wording when nothing is markable any more.
  for (const key of ['t.pending', 't.allTaken', 't.reviewPending', 't.reviewAllTaken']) {
    assert.ok(LIST.includes(key), `${key} left the summary`)
  }

  // A batch nobody is enrolled in is not work outstanding, so it is out of the tally as
  // well as out of the markable set.
  assert.ok(LIST.includes("const session = await pageRole('teacher')"))
  assert.ok(LIST.includes('isStaffAdmin(session)'))
  assert.ok(LIST.includes('await myTeacherIds()'))
})

/* -------------------------------------------------------------------------- */
/* One batch's register                                                       */
/* -------------------------------------------------------------------------- */

/** The main arm's bar, which is the only one carrying a subtitle. */
const BAR = ROSTER.slice(ROSTER.indexOf('      <PageHeader\n'), ROSTER.indexOf("verdict === 'future'"))

test('the batch is the heading on every arm that knows its name', () => {
  // Four returns: the failed batch read, the scope refusal, the failed roster read, and
  // the register. The first cannot name the batch — the name is what did not arrive — so
  // it takes the screen's own title, which is also what the tab already said.
  assert.equal(count(ROSTER, '<PageHeader'), 4)
  assert.equal(count(ROSTER, '<h1'), 0)
  assert.equal(count(ROSTER, "back={{ href: '/teach', label: t.title }}"), 4)
  assert.equal(count(ROSTER, 'title={batch.name}'), 3)
  assert.ok(ROSTER.includes('title={t.rosterTitle} back='))

  // The hand-rolled crumb is gone from all four, and with it the only reason three of
  // these arms had a `<div>` between the page column and its heading.
  assert.doesNotMatch(ROSTER, /← \{t\.title\}/)
  assert.equal(count(ROSTER, 'inline-flex min-h-tap items-center text-ink-soft'), 0)
})

test('subject, slot and day are one line under the bar', () => {
  // Three stacked paragraphs became one sentence: a reader checks these together or not
  // at all, and the bar is one 56px line with no room for a block under the title.
  assert.ok(BAR.includes('localName(subject, locale)'))
  assert.ok(BAR.includes('<BatchSlot'))
  assert.ok(BAR.includes('formatDate(sessionDate, locale)'))
  assert.match(BAR, /\{i > 0 && ' · '\}/)

  // The one fact that is a warning rather than an identifier keeps its own clause: a
  // teacher who followed a bookmark into last week must not read it as today.
  assert.match(BAR, /sessionDate !== today && ` — \$\{t\.pastDate\}`/)
  assert.doesNotMatch(ROSTER, /mt-0\.5 text-sm text-ink-faint/, 'the date paragraph is gone')
  assert.doesNotMatch(ROSTER, /mt-0\.5 text-ink-soft/, 'and the subject one')
})

test('the register is capped, and the cap is on the blocks', () => {
  // A row is a number, a name and four 44px buttons. Across 1,216px the taps are 900px
  // from the name, forty times over. Seven caps: three refusal cards, the three states
  // that replace the register, and the group the register itself is in.
  assert.equal(count(ROSTER, 'max-w-2xl'), 7)
  assert.ok(
    ROSTER.includes('<div className="flex max-w-2xl flex-col gap-4">'),
    'the register, its two notices and the notice list share one cap',
  )
  assert.doesNotMatch(ROSTER, /flex flex-col gap-4[^"]*max-w-/)
  assert.doesNotMatch(ROSTER, /lg:grid-cols/)

  // The notices below the register are the same errand a minute later — they say "save
  // the register first" until it is saved — so they are not a rail.
  const grouped = ROSTER.indexOf('<div className="flex max-w-2xl flex-col gap-4">')
  assert.ok(grouped > 0)
  const GROUP = ROSTER.slice(grouped)
  const register = GROUP.indexOf('<AttendanceRoster')
  const notices = GROUP.indexOf('savedSessionId ?')
  // Both found first: -1 reads as "before everything" and would pass the order below.
  assert.ok(register > 0 && notices > 0)
  assert.ok(register < notices)
})

test('who may open this register, and what happens when that cannot be decided', () => {
  // §38, and the two rules this file exists for. A miss is a 404 so the URL cannot be
  // used to probe which batch ids exist elsewhere; a batch at their own centre that is
  // not theirs is a 403, because there is nothing left to hide.
  assert.ok(ROSTER.includes("const session = await pageRole('teacher')"))
  assert.ok(ROSTER.includes("await supabase\n    .from('batches')"))
  assert.ok(ROSTER.includes(".eq('coaching_center_id', session.active.centerId)"))
  assert.ok(ROSTER.includes('if (!batch) notFound()'))
  assert.ok(ROSTER.includes('if (mine && (!batch.teacher_id || !mine.includes(batch.teacher_id))) forbidden()'))

  // A CHECK THAT COULD NOT BE MADE IS NOT A CHECK THAT PASSED. A teacher whose own staff
  // rows did not arrive gets neither the register nor the 403 — the register would say a
  // full batch is empty, because the enrolment read behind it is scoped and honest.
  assert.ok(ROSTER.includes('if (!isAdmin && unreadable) {'))
  assert.ok(ROSTER.includes('const mine = isAdmin ? null : ownIds'))

  // Whose batch it is decides whether saving is attendance or a correction, by the
  // `teacher_id` on the row and never by rank.
  assert.ok(ROSTER.includes('const ownBatch = batch.teacher_id !== null && ownIds.includes(batch.teacher_id)'))
  assert.ok(ROSTER.includes('registerAct({ taken: Boolean(existingSession), ownBatch })'))
})

test('the day the register is for is still decided outside the layout', () => {
  // A dropped roster read must withhold the form: an unmarked-looking sheet over a marked
  // day would spend the one revision the trigger allows on twelve wrong corrections.
  assert.ok(ROSTER.includes('if (enrollments === null || existingError) {'))

  // The window, the admin's exception, and the two amber notices that say which of the
  // two a reader is looking at. Both survived being moved inside the cap.
  assert.ok(ROSTER.includes("const writable = verdict === 'open' || (verdict === 'closed' && isAdmin)"))
  assert.ok(ROSTER.includes('attendanceVerdict(sessionDate, today, lastClass)'))
  assert.equal(count(ROSTER, 'rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3'), 2)
  assert.ok(ROSTER.includes('{t.correctionTitle}'))
  assert.ok(ROSTER.includes('{t.closedAdmin}'))

  // And the door out of a batch nobody can mark, only for the reader who can walk it.
  assert.ok(ROSTER.includes('students.length === 0 ? await canManageStudents() : false'))
})
