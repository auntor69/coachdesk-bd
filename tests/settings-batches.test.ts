/**
 * The timetable, and the two forms that write it.
 *
 * WHAT THIS FILE IS GUARDING. A batch row is a name, a subject, a time, the days, a
 * teacher and a price; at 1,216px it put the price a screen from the name. The row is
 * capped at the width it is legible at now, and where 1,216px has room for two such
 * columns the list becomes two — at `2xl` and not sooner, because 468px wraps
 * "Sat, Mon, Wed · Rahim Uddin" and turns every row into five lines to save a scroll.
 * Both forms were nine fields down the middle of a desktop: two columns from `xl` now,
 * what the batch is on the left and when it meets on the right, same order as the phone.
 *
 * §38 IS WHY THE READS ARE PINNED HARDER THAN THE CLASSES. A batch is what today's class
 * list, the register, the marks and every invoice hang off, so the three screens here
 * carry three different gates on purpose — `can_manage_batches` opens one and may not
 * reprice one — plus the four arms of the create screen, the two unshifts that keep a
 * switched-off subject correctable, and the hidden input that stops a save clearing the
 * teacher a one-teacher plan never asked about.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const DIR = ['src', 'app', '(app)', 'settings', 'batches']
const LIST = read(...DIR, 'page.tsx')
const NEW = read(...DIR, 'new', 'page.tsx')
const FORM = read(...DIR, 'new', 'batch-form.tsx')
const EDIT = read(...DIR, '[batchId]', 'page.tsx')
const EDIT_FORM = read(...DIR, '[batchId]', 'edit-form.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** The one thing both forms must agree on, field for field. */
const FORMS: [string, string][] = [
  ['new', FORM],
  ['edit', EDIT_FORM],
]

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('the list keeps a row legible and splits in two at 2xl', () => {
  // The cap is on the list and not on the page, or the bar's `lg:-mx-8` background would
  // stop 672px into a 1,216px workspace. It lifts at `2xl`, which is where the list
  // becomes two columns.
  assert.ok(LIST.includes('<div className="flex flex-col gap-5">'))
  assert.doesNotMatch(LIST, /flex max-w-2xl flex-col gap-5/)
  assert.ok(
    LIST.includes(`          className="flex max-w-2xl flex-col gap-2 2xl:grid 2xl:max-w-none
            2xl:grid-cols-2 2xl:gap-3"`),
    'the cap and the split both live on the <ul> now',
  )
  assert.equal(count(LIST, '2xl:h-full'), 2, 'both arms, or the pair in a row step apart')
  assert.equal(count(LIST, 'max-w-2xl'), 3, 'the list, the empty state and the failed read')
  assert.ok(LIST.includes('<Card className="max-w-2xl">'))

  // Not at `xl`: 960px of content makes two 468px columns, and the days-and-teacher
  // line wraps in that. The lookbehind is the point — `2xl:` contains `xl:`.
  assert.doesNotMatch(LIST, /(?<!2)xl:grid-cols-2/)
  assert.doesNotMatch(LIST, /(?<=["\s`])order-\d/)

  // Both arms draw the bar, and it owns the h1 — so the empty state's own title is an h2.
  assert.equal(count(LIST, '<PageHeader'), 2, 'the unreadable arm has its own')
  assert.equal(count(LIST, '<h1'), 0)
  assert.doesNotMatch(LIST, /text-xl font-bold text-ink lg:text-2xl/)
})

test('both forms are two columns from xl and capped below it', () => {
  for (const [which, src] of FORMS) {
    assert.ok(
      src.includes(
        '<form action={formAction} className="flex max-w-xl flex-col gap-4 xl:max-w-none">',
      ),
      which,
    )
    assert.ok(
      src.includes(`        className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-start
          xl:gap-x-6 xl:gap-y-4"`),
      which,
    )
    assert.equal(count(src, 'xl:col-span-6'), 2, which)

    // Two columns of fields, not a rail: neither half of this is commentary on the other.
    assert.doesNotMatch(src, /xl:col-span-[57]/)
    assert.doesNotMatch(src, /xl:sticky/)
    assert.doesNotMatch(src, /(?<=["\s`])order-\d/)

    // A refusal is a sentence, and Alert takes no className of its own.
    assert.ok(
      src.includes(`        <div className="max-w-2xl">
          <Alert>{state.error}</Alert>
        </div>`),
      which,
    )
    assert.equal(count(src, 'max-w-2xl'), 1, which)

    // Under both columns, and its own size from `sm` — a 1,216px button is a banner.
    assert.ok(src.includes('className="sm:w-auto sm:self-start"'), which)
    assert.ok(src.includes('<div className="grid grid-cols-2 gap-3">'), which)
    assert.equal(count(src, 'grid-cols-2'), 1, `${which}: only the start and end pair`)
  }
})

test('the two forms ask for the same things in the same order', () => {
  // The promise the edit form's docblock makes, and the reason a phone loses nothing:
  // the columns split a list that was already in this order.
  const ORDER = [
    'name="name"',
    'name="subjectId"',
    'name="teacherId"',
    '<BranchPicker',
    'name="slot"',
    'name="startTime"',
    'name="endTime"',
    'name="days"',
    'name="monthlyFee"',
  ]
  for (const [which, src] of FORMS) {
    for (let i = 1; i < ORDER.length; i++) {
      const before = src.indexOf(ORDER[i - 1])
      const after = src.indexOf(ORDER[i])
      assert.ok(before !== -1, `${which}: ${ORDER[i - 1]}`)
      assert.ok(before < after, `${which}: ${ORDER[i - 1]} before ${ORDER[i]}`)
    }
  }

  // The switch that closes a batch is last in its column, above the save button.
  assert.ok(EDIT_FORM.indexOf('name="monthlyFee"') < EDIT_FORM.indexOf('name="active"'))
  assert.ok(EDIT_FORM.indexOf('name="active"') < EDIT_FORM.indexOf('type="submit"'))
  // And the id of the row being written is above the grid, not a cell inside it.
  assert.ok(EDIT_FORM.includes('name="batchId"'))
  assert.ok(EDIT_FORM.indexOf('name="batchId"') < EDIT_FORM.indexOf('xl:grid-cols-12'))
})

test('the furniture is the one the other settings screens use', () => {
  // The bar on every arm of all three screens, each with the crumb that belongs to it,
  // and the h1 is the bar's on all of them. A hand-rolled letterhead on one of the six
  // would be a heading that scrolls away on that one screen only.
  for (const [which, src, bars] of [
    ['list', LIST, 2],
    ['new', NEW, 1],
    ['edit', EDIT, 3],
  ] as [string, string, number][]) {
    assert.equal(count(src, '<PageHeader'), bars, which)
    assert.equal(count(src, 'back='), bars, `${which}: every arm offers the way back`)
    assert.equal(count(src, '<h1'), 0, which)
    assert.doesNotMatch(src, /text-xl font-bold text-ink lg:text-2xl/, which)
    assert.doesNotMatch(src, /inline-flex min-h-tap items-center text-ink-soft/, which)
  }

  // The crumb points one level up, not to the hub, on the two screens under the list.
  assert.ok(NEW.includes("back={{ href: '/settings/batches', label: t.title }}"))
  assert.ok(EDIT.includes("const back = { href: '/settings/batches' as const, label: t.title }"))

  // And the edit screen leads with the batch's own name, with what the screen is for
  // under it: a reader who came from a list of fourteen wants to know which row opened.
  assert.ok(EDIT.includes('<PageHeader title={batch.name} back={back} subtitle={t.editTitle} />'))
})

/* -------------------------------------------------------------------------- */
/* §38: three screens, three different gates                                  */
/* -------------------------------------------------------------------------- */

test('the list is drawn from the boxes the reader actually holds', () => {
  assert.ok(LIST.includes("const session = await pagePermission('can_manage_batches')"))

  // The headcount is only drawn when it is a count. A teacher holding only
  // can_manage_batches reads enrollments through app.teaches_batch, so the embed comes
  // back empty for everyone else's batches — "0 জন" down a page of full classes.
  assert.ok(LIST.includes('const showCounts = await canManageStudents()'))
  assert.ok(LIST.includes('{showCounts && ('))

  // And a row is a link only for the roles that may change one: 20260811000019 grants
  // that box INSERT and no UPDATE.
  assert.ok(LIST.includes('const mayEdit = isStaffAdmin(session)'))
  assert.ok(LIST.includes('{mayEdit ? ('))
  assert.ok(LIST.includes('{mayEdit && rows.length > 0 && ('), 'and the hint follows it')

  assert.equal(count(LIST, ".eq('coaching_center_id', session.active.centerId)"), 1)
  assert.ok(LIST.includes(".order('start_time', { ascending: true, nullsFirst: false })"))
  assert.equal(count(LIST, '.order('), 1, 'one read, one order')
})

test('the list still withholds what it cannot prove', () => {
  // `null` is the dropped read: an owner who believes "no batches yet" builds the
  // timetable again on top of the one that is still there.
  assert.ok(LIST.includes('if (batches === null) {'))
  assert.ok(LIST.includes('{d.settings.listUnreadable}'))

  // Same test as lib/fees/billable.ts makes, because `numeric` arrives as a string.
  assert.ok(LIST.includes('unpriced: !(Number(batch.monthly_fee_bdt ?? 0) > 0)'))
  assert.ok(LIST.includes('{row.unpriced ? ('))
  assert.ok(LIST.includes("(batch.enrollments ?? []).filter((e) => e.status === 'active')"))

  // A guardrail is not a quota: "4 of 100 batches" invites managing a number nobody sold.
  assert.ok(
    LIST.includes(
      "const limit = capIsQuota(session.plan, 'maxBatches') ? session.plan.maxBatches : null",
    ),
  )
  assert.ok(LIST.includes('{limit === null ? t.count(activeCount) : t.used(activeCount, limit)}'))
})

test('the create screen keeps its four arms in that order', () => {
  assert.ok(NEW.includes("const session = await pagePermission('can_manage_batches')"))
  assert.equal(count(NEW, ".eq('coaching_center_id', session.active.centerId)"), 3)
  assert.ok(NEW.includes(".select('id', { count: 'exact', head: true })"))
  assert.ok(NEW.includes('branchChoicesFor(supabase, session)'))

  // Not drawn for a reader about to choose a building: §8.4 caps batches per branch, so
  // the count is the wrong number and `t.cap` the wrong claim.
  assert.ok(
    NEW.includes(
      "!mayChooseBranch(session) && wouldExceed(session.plan, 'maxBatches', batchCount ?? 0)",
    ),
  )

  // "Add a subject first" is a claim about the centre, so a failed read may not make it —
  // the duplicate Physics it invites splits a class across the whole product.
  assert.ok(NEW.includes('{atLimit ? ('))
  assert.ok(NEW.includes(') : subjects === null ? ('))
  assert.ok(NEW.includes(') : subjects.length === 0 ? ('))
  assert.ok(NEW.includes('{t.capTitle}'))
  assert.ok(NEW.indexOf('{t.capTitle}') < NEW.indexOf('{t.subjectsUnreadable}'))
  assert.ok(NEW.indexOf('{t.subjectsUnreadable}') < NEW.indexOf('{t.needSubjectTitle}'))
  assert.ok(NEW.indexOf('{t.needSubjectTitle}') < NEW.indexOf('<BatchForm'))
  assert.equal(count(NEW, 'max-w-2xl'), 3, 'each arm is a sentence, the form is not')

  // The teacher list fails open, because the field is genuinely optional.
  assert.ok(NEW.includes('hasStaff(session.plan)'))
  assert.ok(NEW.includes('(teachers ?? []).map((teacher) => ({'))
})

test('the edit screen is manager-only and reads its own batch', () => {
  // Not `can_manage_batches`: that box says "open a new batch", and repricing the class
  // an owner already sells is not that.
  assert.ok(EDIT.includes("const session = await pageRole('manager')"))
  assert.equal(count(EDIT, ".eq('coaching_center_id', session.active.centerId)"), 3)
  assert.ok(EDIT.includes(".eq('id', batchId)"))
  assert.ok(EDIT.includes('.maybeSingle()'))

  // The failed read ahead of the row that is not there: `errors.notFound` was answering
  // a dropped read about a batch with forty students enrolled on it.
  assert.ok(EDIT.includes('const { data: batch, error: batchError } = batchRow'))
  assert.ok(EDIT.includes('if (batchError) {'))
  assert.ok(EDIT.includes('if (!batch) {'))
  assert.ok(EDIT.indexOf('if (batchError) {') < EDIT.indexOf('if (!batch) {'))
  assert.ok(EDIT.includes('{t.batchUnreadable}'))
  assert.equal(count(EDIT, 'max-w-2xl'), 2, 'both are one sentence')

  // An option missing from the picker is a field that can never be corrected.
  assert.ok(
    EDIT.includes(
      'subjectOptions.unshift({ id: ownSubject.id, label: localName(ownSubject, locale) })',
    ),
  )
  assert.ok(EDIT.includes('teacherOptions.unshift({ id: ownTeacher.id, label: ownTeacher.name })'))
  assert.ok(EDIT.includes('hasStaff(session.plan)'))

  // `time` arrives as "07:00:00" and an <input type="time"> takes five characters.
  assert.ok(EDIT.includes("startTime: (batch.start_time ?? '').slice(0, 5)"))
  assert.ok(EDIT.includes("endTime: (batch.end_time ?? '').slice(0, 5)"))
})

test('a save still navigates instead of redirecting inside the action', () => {
  for (const [which, src] of FORMS) {
    // The action's error path has to be able to return a message to the form, and a
    // redirect throws.
    assert.ok(src.includes("if (result?.ok) router.push('/settings/batches')"), which)
    assert.equal(count(src, 'useActionState<ActionState, FormData>('), 1, which)
  }
  assert.ok(FORM.includes('await createBatch(prev, formData)'))
  assert.ok(EDIT_FORM.includes('await updateBatch(prev, formData)'))
  assert.ok(FORM.includes('disabled={pending || subjects.length === 0}'))
  assert.ok(FORM.includes('{subjects.length === 0 && ('), 'and says why it refuses')

  // No picker on a one-teacher plan, and therefore no answer to submit — the current
  // value rides along, because a save that cleared teacher_id would take the batch off
  // its own teacher's list. Same shape as the branch field's hidden input.
  assert.ok(
    EDIT_FORM.includes('<input type="hidden" name="teacherId" value={batch.teacherId} />'),
  )
  assert.ok(EDIT_FORM.includes('{teachers.length > 0 ? ('))
  assert.ok(EDIT_FORM.includes('defaultChecked={batch.active}'))
  assert.ok(EDIT_FORM.includes('current={batch.branchId}'))
  assert.ok(FORM.includes('current={null}'))
})
