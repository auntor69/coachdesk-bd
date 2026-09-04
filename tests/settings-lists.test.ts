/**
 * The two list-and-form settings screens — subjects and exam kinds — and the two
 * components they share.
 *
 * WHAT THIS FILE IS GUARDING. Both screens were one column at every width: a row
 * 1,216px wide carrying a name and a count, and the add form below however many rows
 * the centre had typed. They are the branches shape now — the list at 7 of 12 and the
 * form in a 386px rail from `xl` — because they are the same errand as branches.
 *
 * AND ONE REAL DEFECT. `Field` falls back to the input's name for its id
 * (components/ui.tsx:49), and both name fields in `list-row.tsx` were bare. Every panel
 * open on the screen, plus the add form, rendered `id="name"`, so every label on the
 * page pointed at the first of them: a screen reader announced the wrong field and a
 * click on a label focused another row's input. The row keys its ids off the row now.
 *
 * §38: the redesign moved every gate, read, verdict and refusal on both screens, and
 * the `count: null` decisions in all three files. None of it may have changed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const SUBJECTS = read('src', 'app', '(app)', 'settings', 'subjects', 'page.tsx')
const KINDS = read('src', 'app', '(app)', 'settings', 'exam-types', 'page.tsx')
const ADD = read('src', 'app', '(app)', 'settings', 'quick-add.tsx')
const ROW = read('src', 'app', '(app)', 'settings', 'list-row.tsx')

/** The two screens, for the assertions that are true of both. */
const PAGES: [string, string][] = [
  ['subjects', SUBJECTS],
  ['exam kinds', KINDS],
]

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('both screens are a list and a rail from xl and one column below it', () => {
  for (const [name, page] of PAGES) {
    // The grid is nested under the page bar now, not the page's own root: a sticky box
    // only travels inside its containing block, so a bar dropped into the grid as a
    // twelfth-column cell would stick for one grid row and leave with it.
    assert.ok(
      page.includes(`    <div className="flex flex-col gap-5">
      <PageHeader`),
      `${name}: the bar is the first child of the page's own column`,
    )
    assert.ok(
      page.includes(
        '<div className="flex flex-col gap-5 xl:grid xl:grid-cols-12' +
          ' xl:items-start xl:gap-6">',
      ),
      `${name}: a stack on a phone, a grid from xl, and the rail not stretched`,
    )
    assert.ok(page.includes('<ul className="flex flex-col gap-2 xl:col-span-7">'), name)
    // 56px of bar and 8px of air. The bar paints over the rail, so a rail at `top-8`
    // would have its first line covered — page-header.test.ts holds the repo-wide half
    // of that, across every rail in the app at once.
    assert.ok(page.includes('<div className="xl:sticky xl:top-16 xl:col-span-5">'), name)

    // 5 of 12 at `lg` is 279px — narrower than the same form on a phone.
    assert.doesNotMatch(page, /lg:grid-cols/, name)
    // Source order is reading order: band, list, form. On a phone that puts the form
    // under the names already there, which is the only order that reads.
    assert.doesNotMatch(page, /(?<=["\s`])order-\d/, name)
  }
})

test('every shape of both screens is titled by the bar and nothing else', () => {
  for (const [name, page] of PAGES) {
    // Two returns each — the list, and the read that did not arrive — and the heading
    // in the second was the one that kept being forgotten. Both are the bar's now, so
    // neither screen writes an `<h1>` or its desktop size at all.
    assert.equal(count(page, '<PageHeader'), 2, `${name}: including the refusal's`)
    assert.equal(count(page, '<h1'), 0, `${name}: the bar owns the heading`)
    assert.doesNotMatch(page, /lg:text-2xl/, name)
    assert.equal(
      count(page, "back={{ href: '/settings', label: d.settings.hub.title }}"),
      2,
      `${name}: and the way out is on both`,
    )

    // The column is uncapped so the bar reaches the workspace edges; the sentence is
    // capped instead, because one line in a card 1,216px wide has no findable end.
    assert.doesNotMatch(page, /max-w-2xl flex-col/, name)
    assert.ok(
      page.includes('<Card className="max-w-2xl border-late/30 bg-late/5">'),
      name,
    )
    assert.ok(page.includes('{d.settings.listUnreadable}'), name)
  }
})

/* -------------------------------------------------------------------------- */
/* The add form, which now has two homes                                      */
/* -------------------------------------------------------------------------- */

test('the add form is two columns where it is wide and one where it is a rail', () => {
  assert.ok(
    ADD.includes(
      '<div className="grid gap-3 sm:grid-cols-2 sm:items-end xl:grid-cols-1">',
    ),
    'and bottom-aligned, because only the first of the two fields carries a hint',
  )

  // The button follows the fields: full width on a phone, its own size where the form
  // is 670px wide, full width again in the 386px rail.
  assert.ok(
    ADD.includes(`        full
        className="sm:w-auto sm:self-start xl:w-full"`),
  )

  // Bare names here on purpose: one add form per screen, so `Field`'s fallback is
  // unambiguous — and these two names are what the action reads off the FormData.
  assert.doesNotMatch(ADD, /\bid=/, 'no id at all, so the fallback is what is used')
  assert.ok(ADD.includes('name="name"'))
  assert.ok(ADD.includes('name="nameBn"'))
  assert.equal(count(ADD, 'maxLength={MAX_NAME}'), 2, 'both fields, not just the second')
  assert.ok(ADD.includes('required'))

  // It still stays on screen and clears itself, which is why an owner can type six
  // subjects in a row without going back for the form each time.
  assert.ok(ADD.includes('if (state?.ok) formRef.current?.reset()'))
  assert.ok(ADD.includes('{children}'), 'the slot a caller can put its own note in')
})

/* -------------------------------------------------------------------------- */
/* The row, and the label that pointed at the wrong field                     */
/* -------------------------------------------------------------------------- */

test('each open panel keys its field ids off its own row', () => {
  // The whole defect in two lines: `Field` uses the input's name when no id is given,
  // so twelve subject rows and the add form all claimed id="name".
  assert.ok(ROW.includes('id={`${idField}-name-${id}`}'))
  assert.ok(ROW.includes('id={`${idField}-nameBn-${id}`}'))

  // `idField` is 'subjectId' or 'examTypeId' — already a prop, because all three
  // actions read the row's id under that name.
  assert.ok(ROW.includes("idField: string"))
  assert.equal(count(ROW, '<input type="hidden" name={idField} value={id} />'), 4)

  // The names the actions read are untouched by the ids.
  assert.ok(ROW.includes('name="name"'))
  assert.ok(ROW.includes('name="nameBn"'))
})

test('the panel pairs the two names and the save button is not 670px wide', () => {
  assert.ok(ROW.includes('<div className="grid gap-3 sm:grid-cols-2">'))
  assert.ok(
    ROW.includes(`              full
              className="sm:w-auto sm:self-start"`),
  )

  // And the destroying button is the narrow one, which is what the note above it has
  // always said: a flex column stretches its children, so before this the two were
  // the same width and Remove read as the button to press.
  assert.ok(
    ROW.includes(`                    variant="danger"
                    disabled={removing}
                    className="self-start"`),
  )
  assert.ok(ROW.includes('onClick={() => setAsking(false)}\n                    full'))
})

test('the row is still shut until asked, and every refusal still has its branch', () => {
  assert.ok(ROW.includes('const [open, setOpen] = useState(false)'))
  assert.ok(ROW.includes('const [asking, setAsking] = useState(false)'))
  assert.ok(ROW.includes('{open && ('))

  // A failed count draws no number, and the three refusals still arrive as finished
  // sentences from the server rather than being decided here.
  assert.ok(ROW.includes('{count !== null && ('))
  assert.ok(ROW.includes('{offBlockedReason}'))
  assert.ok(ROW.includes('{onBlockedReason}'))
  assert.ok(ROW.includes('{blockedReason}'))
  assert.equal(count(ROW, 'useActionState<ActionState, FormData>'), 3)
})

/* -------------------------------------------------------------------------- */
/* §38: nothing the screens decide has moved                                  */
/* -------------------------------------------------------------------------- */

test('the guard, the reads and the fail-closed return are unchanged on both', () => {
  for (const [name, page] of PAGES) {
    assert.ok(page.includes("const session = await pageRole('manager')"), name)
    assert.equal(count(page, ".eq('coaching_center_id', session.active.centerId)"), 1, name)
    assert.ok(page.includes('{d.settings.listUnreadable}'), name)
    // The add form goes with the failed read: a form over a list that did not load is
    // how a second সাপ্তাহিক পরীক্ষা gets typed.
    assert.equal(count(page, '<QuickAdd'), 1, name)
    assert.ok(page.includes('const use = uses ? '), `${name}: null when no count ran`)
  }

  assert.ok(SUBJECTS.includes('if (subjects === null) {'))
  assert.ok(SUBJECTS.includes('readSubjectUses(supabase, session.active.centerId)'))
  assert.ok(KINDS.includes('if (examTypes === null) {'))
  assert.ok(KINDS.includes('readExamTypeUses(supabase, session.active.centerId)'))
})

test('the subject cap, its two verdicts and its quota line are unchanged', () => {
  assert.ok(SUBJECTS.includes('const limit = session.plan.maxSubjects'))
  assert.ok(SUBJECTS.includes('const atCap = limit !== null && activeCount >= limit'))
  assert.ok(SUBJECTS.includes("capIsQuota(session.plan, 'maxSubjects') ? limit : null"))
  assert.ok(SUBJECTS.includes('t.cap(planName(session.plan, locale), limit)'))
  assert.ok(SUBJECTS.includes('const onReason = atCap ? capSentence : null'))
  assert.ok(SUBJECTS.includes('{quota === null ? t.count(activeCount) : t.used(activeCount, quota)}'))

  // The cap card takes the rail's place rather than sitting under the list, and the
  // form is gone while it is there.
  assert.ok(SUBJECTS.includes('{atCap ? ('))
  assert.ok(SUBJECTS.includes('{t.capTitle}'))

  for (const verdict of ['subjectDeleteVerdict(use)', 'subjectOffVerdict(use)']) {
    assert.ok(SUBJECTS.includes(`switch (${verdict}) {`), verdict)
  }
  assert.equal(count(SUBJECTS, 'if (!use) return e.checkFailed'), 2)
  assert.ok(SUBJECTS.includes('count={use ? use.batchCount : null}'))
})

test('exam kinds still have no cap and refuse only the removal', () => {
  assert.ok(KINDS.includes('switch (examTypeDeleteVerdict(use)) {'))
  assert.ok(KINDS.includes('if (!use) return e.checkFailed'))
  assert.ok(KINDS.includes('count={use ? use.examCount : null}'))

  // Nothing counts exam kinds, so nothing is refused either way — and the sort the
  // picker reads them in is still the one the list is drawn in.
  assert.ok(KINDS.includes('offBlockedReason={null}'))
  assert.ok(KINDS.includes('onBlockedReason={null}'))
  assert.ok(KINDS.includes(".order('sort_order', { ascending: true })"))
  assert.doesNotMatch(KINDS, /atCap|capIsQuota|maxSubjects/)
})
