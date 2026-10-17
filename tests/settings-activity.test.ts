/**
 * The activity log — §10's "who did what", the only screen in the app with no action.
 *
 * WHAT THIS FILE IS GUARDING. Fifty log lines are the densest list this product draws and
 * were the loosest thing on a desktop: a card per line, the timestamp shoved to the far
 * right by `justify-between` so at 1,216px it sat a screen's width from the action it
 * belonged to, and the figure that settles the dispute two lines below that. A row is
 * three aligned columns from `lg` — `when | what, who, about | figure` — and two lines
 * instead of five. The filter moved onto the heading, because a select for one of
 * seventeen table names never wanted the width of the screen.
 *
 * §38 IS THE WHOLE POINT OF THIS SCREEN. It is the record an owner reads when a manager
 * says he never entered that, and every line of it is assembled here: the owner-only
 * gate, the two URL parameters that are validated before they reach PostgREST, the
 * keyset cursor, the eight centre-scoped reads that turn ids into names, and the four
 * answers `actorLabel` gives. A layout change that quietly dropped one of those would
 * make the log wrong rather than ugly, and a wrong audit log is worse than none.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const PAGE = readFileSync(
  path.join(ROOT, 'src', 'app', '(app)', 'settings', 'activity', 'page.tsx'),
  'utf8',
).replaceAll('\r\n', '\n')

const count = (needle: string) => PAGE.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('a log line is three aligned columns from lg', () => {
  assert.ok(
    PAGE.includes(`      className="flex flex-col gap-1 rounded-xl border border-line bg-white px-4 py-3
        lg:grid lg:grid-cols-[8rem_minmax(0,1fr)_auto] lg:items-baseline lg:gap-x-4"`),
    'a card in a column on a phone, and when/what/figure from lg',
  )

  // Fixed and not `max-content`: every card is its own grid, so an intrinsic width would
  // size each row to its own longest word and align none of them with the next.
  assert.doesNotMatch(PAGE, /grid-cols-\[[^\]]*content/)
  assert.doesNotMatch(PAGE, /(?<=["\s`])order-\d/)

  // Source order is reading order at both widths: the time, the sentence, the figure.
  assert.ok(PAGE.indexOf('{formatDate(when.date, locale)}') < PAGE.indexOf('{t.actions[entry.action]}'))
  assert.ok(PAGE.indexOf('{t.actions[entry.action]}') < PAGE.indexOf('{formatTaka(entry.amountBdt)}'))

  // The date over the time, because the month names are spelled out in both languages
  // and a column that fits them side by side leaves none for the two names on the line.
  assert.ok(PAGE.includes('<div className="num text-xs text-ink-soft lg:flex lg:flex-col">'))
  assert.ok(PAGE.includes('<span>{formatDate(when.date, locale)}</span>'))
  assert.ok(PAGE.includes('<span>{formatTime(when.time, locale)}</span>'))
  assert.ok(PAGE.includes('<div className="flex flex-col lg:items-end lg:text-right">'))
  assert.ok(PAGE.includes('{t.more(entry.otherCount)}'), 'and the tail that says how much is not drawn')

  // No third cell at all when there is no figure, so the sentence gets the width rather
  // than a gap where a number would have been.
  assert.ok(
    PAGE.includes(
      'const hasFigures = entry.amountBdt !== null || entry.shift !== null || entry.otherCount > 0',
    ),
  )
  assert.ok(PAGE.includes('{hasFigures && ('))
})

test('the filter rides in the page bar and is not a screen-wide select', () => {
  // §20.1's bar, with the screen's one control as its action. It used to be a `xl:flex-row`
  // heading band of the page's own, which put the filter beside the title only from `xl`
  // and scrolled it away from the log it filters at every width.
  assert.ok(PAGE.includes('<PageHeader'))
  assert.equal(count('<PageHeader'), 1, 'one screen, one bar')
  assert.equal(count('<h1'), 0, 'the bar owns the heading')
  assert.ok(PAGE.includes("back={{ href: '/settings', label: d.settings.hub.title }}"))
  assert.ok(PAGE.includes('subtitle={t.subtitle}'))
  assert.ok(!PAGE.includes('xl:items-end xl:justify-between'), 'the old band is gone')

  // Label-less, because the bar is one line tall and a stacked label would make it two —
  // which would slide the bar over the first line of every sticky rail in the app. The
  // `aria-label` is what a screen reader arriving at the select alone reads.
  assert.ok(PAGE.includes('aria-label={t.filterLabel}'))
  assert.ok(!PAGE.includes('<label className="flex min-w-0 flex-1 flex-col gap-1.5'))

  // Capped so a table name cannot push the button off the line: 176px on a phone, 256px
  // once there is room. The button never shrinks.
  assert.ok(PAGE.includes('min-h-tap max-w-44 rounded-xl'))
  assert.ok(PAGE.includes('font-medium text-ink sm:max-w-64'))
  // The button never shrinks, and it is the shared primary now — asserted at the call
  // site so a later drift back to hand-written classes fails here.
  assert.ok(PAGE.includes("className={buttonClass('primary', false, 'shrink-0')}"))

  // Still a plain GET with a button, and still dropping the cursor when it is applied.
  assert.ok(PAGE.includes('<form method="get" className="flex items-center gap-2">'))
  assert.ok(PAGE.includes('<button\n              type="submit"'))
  assert.ok(PAGE.includes('{t.show}'))
})

test('the paragraphs are capped and the pager is not parked in a far corner', () => {
  // Three sentences of empty state, and two of "the database wrote this" — both are
  // paragraphs nobody can find the end of at 1,216px.
  assert.ok(PAGE.includes('<Card className="max-w-2xl">'))
  assert.ok(PAGE.includes('<p className="max-w-2xl text-xs text-ink-soft">{t.writtenBy}</p>'))
  assert.equal(count('max-w-2xl'), 2)

  assert.ok(
    PAGE.includes('<div className="flex items-center justify-between gap-3 lg:justify-start">'),
    'on the first page the only link is "older", and justify-between parks it alone',
  )
  assert.ok(PAGE.includes('{(hasOlder || before !== null) && ('))
})

/* -------------------------------------------------------------------------- */
/* §38: the gate, the two parameters, and the cursor                          */
/* -------------------------------------------------------------------------- */

test('owner only, matching the policy rather than relying on it', () => {
  assert.ok(PAGE.includes("const session = await pageRole('owner')"))

  // Both parameters arrive from a URL somebody may have edited: an entity that is not
  // audited would filter to nothing, and a cursor that is not a timestamp makes
  // PostgREST refuse the whole read.
  assert.ok(PAGE.includes('rawEntity !== undefined && isAuditedTable(rawEntity) ? rawEntity : null'))
  assert.ok(
    PAGE.includes("rawBefore !== undefined && !Number.isNaN(Date.parse(rawBefore)) ? rawBefore : null"),
  )
  assert.ok(PAGE.includes("if (entity !== null) filtered = filtered.eq('entity', entity)"))
  assert.ok(PAGE.includes("if (before !== null) filtered = filtered.lt('created_at', before)"))
})

test('the extra row is still what says there is an older page', () => {
  assert.ok(PAGE.includes('const PAGE = 50'))
  assert.ok(PAGE.includes('.limit(PAGE + 1)'))
  assert.ok(PAGE.includes('const hasOlder = rows.length > PAGE'))
  assert.ok(PAGE.includes('const entries = rows.slice(0, PAGE).map(describeAuditEntry)'))

  // Newest first, and the id as the tie-break under it.
  assert.ok(PAGE.includes(".order('created_at', { ascending: false })"))
  assert.ok(PAGE.includes(".order('id', { ascending: false })"))
  assert.equal(count('.order('), 2, 'and no third one added by a redesign')

  // One line, not a concatenation — see the fee board's COLUMNS for what splitting does.
  assert.ok(
    PAGE.includes(
      "const COLUMNS = 'id, entity, entity_id, operation, before, after, actor, actor_role, created_at'",
    ),
  )
})

/* -------------------------------------------------------------------------- */
/* §38: the eight reads that turn an id into a name                           */
/* -------------------------------------------------------------------------- */

test('every read is scoped to this centre where the gate can see it', () => {
  // RLS is the guarantee; the filter is the query plan — and for an owner of two centres
  // it is also the boundary, because the policy passes them for both.
  assert.equal(count(".eq('coaching_center_id', session.active.centerId)"), 8)
  assert.equal(count(".in('id',"), 6, 'only the rows this page names, never a whole table')

  // Spelled out one table at a time on purpose: a `.from` given a variable is a query
  // check-scoping cannot prove is centre-scoped, and it refuses one.
  for (const table of [
    'audit_log',
    'teachers',
    'fee_invoices',
    'fee_payments',
    'guardians',
    'attendance_records',
    'employees',
    'students',
  ]) {
    assert.ok(PAGE.includes(`.from('${table}')`), table)
  }

  // Skipped entirely when this page named none of them: five inside the round trip, and
  // the students read after it, which needs the ids the first four produced.
  assert.equal(count('      ? null\n      : supabase'), 5)
  assert.equal(count('      ? null\n      : await supabase'), 1)
})

test('a mark still reaches its student through the enrolment', () => {
  // The record holds an enrolment and the enrolment holds the child. This is the line §10
  // exists for, and until it named her it was a log entry about a day.
  assert.ok(PAGE.includes(".select('id, enrollments (student_id)')"))
  assert.ok(
    PAGE.includes(
      'const enrollment = Array.isArray(mark.enrollments) ? mark.enrollments[0] : mark.enrollments',
    ),
  )
  assert.ok(PAGE.includes('if (enrollment) linkedStudent.set(mark.id, enrollment.student_id)'))

  // And the three tables that carry the student as a column that never moves.
  assert.ok(PAGE.includes('for (const result of [invoiceLinks, paymentLinks, guardianLinks]) {'))
  assert.ok(PAGE.includes('linkedStudent.set(link.id, link.student_id)'))
  assert.ok(
    PAGE.includes(
      "const studentIds = [...new Set([...idsFor('students'), ...linkedStudent.values()])]",
    ),
  )
})

test('the teacher list is still the only way an actor gets a name', () => {
  // `profiles` is self-read, so an owner looking a colleague up there is handed nothing.
  assert.ok(PAGE.includes("supabase\n      .from('teachers')\n      .select('id, user_id, name')"))
  assert.ok(PAGE.includes('if (teacher.user_id !== null) actorNames.set(teacher.user_id, teacher.name)'))
  assert.ok(PAGE.includes('for (const teacher of teachers) names.set(`teachers:${teacher.id}`, teacher.name)'))
})

/* -------------------------------------------------------------------------- */
/* §38: the four answers to "who", and the eight to "what changed"            */
/* -------------------------------------------------------------------------- */

test('a nameless actor is still named honestly', () => {
  // The cron worker must not be given a name, because that names somebody asleep.
  assert.ok(
    PAGE.includes(
      "if (entry.actor === null) return entry.actorRole === 'service_role' ? t.platform : t.automatic",
    ),
  )
  assert.ok(PAGE.includes('if (entry.actor === readerId) return t.you'))
  assert.ok(PAGE.includes('return names.get(entry.actor) ?? t.someone'))
})

test('the subject falls back to the row own label and never to a uuid', () => {
  assert.ok(PAGE.includes('return names.get(`${entry.subject.table}:${entry.subject.id}`) ?? entry.label'))
  assert.ok(
    PAGE.includes(
      'const studentId = entry.entityId === null ? undefined : linked.get(entry.entityId)',
    ),
  )
  assert.ok(
    PAGE.includes("if (studentId !== undefined) return names.get(`students:${studentId}`) ?? entry.label"),
  )
})

test('a before-and-after is still read in the words of the screen it came from', () => {
  assert.equal(count('case '), 8, 'money, count, date, plan, three statuses and a role')
  assert.ok(PAGE.includes("if (value === null) return '—'"), 'an absent side is a dash, not a zero')
  assert.ok(PAGE.includes('return formatTaka(Number(value))'))
  assert.ok(PAGE.includes('return planName(planFor(String(value)), locale)'))
  assert.ok(PAGE.includes('return pick(d.founder.status, String(value))'))
  assert.ok(PAGE.includes('return pick(d.studentForm.status, String(value))'))
  assert.ok(PAGE.includes('return pick(d.audit.roles, String(value))'))
  assert.ok(PAGE.includes('return pick(d.attendance, String(value))'))
  assert.ok(PAGE.includes('return table[value] ?? value'))
})

test('a failed read says so instead of drawing an empty log', () => {
  assert.ok(PAGE.includes('{page.error !== null && <Alert>{t.unreadable}</Alert>}'))
  assert.ok(PAGE.includes('{page.error === null && entries.length === 0 && ('))
  assert.ok(PAGE.includes('{entity === null ? t.emptyBody : t.emptyFiltered}'))
  assert.ok(PAGE.includes('{t.writtenBy}'), 'and the line that says nobody can edit one')
})
