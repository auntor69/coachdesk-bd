import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * THE BRANCH-PINNED MANAGER, who is the persona this product gets wrong most quietly.
 *
 * §20.9 asks every screen to be exercised against the real entitlement system — a
 * trialling teacher, a lapsed centre in read-only, a narrowed accountant, a branch-pinned
 * manager. The first three fail loudly: a refusal, a locked card, a button that is not
 * drawn. This one failed by printing a number.
 *
 * THE DEFECT, so it is written down once. A student place is a licence and licences pool
 * across the organisation (§3.6), so `session.ceiling` is one figure for the whole
 * institution. Since 20260811000053, `students_branch_scope` is RESTRICTIVE and narrows
 * every `select` on `students` to the reader's own branch — whatever the query asks for,
 * with no filter in the source to notice. Five screens paired the two. A manager pinned to
 * Mirpur with 40 of the organisation's 300 students read "260 of 300 places left", pasted
 * two hundred names, and `app.guard_student_capacity()` rolled the whole import back with
 * CD001 (§10 does not partially create students). Nothing in the source looked wrong,
 * which is exactly why this file exists: the bug is a query that is correct on its own
 * next to a ceiling that is correct on its own.
 *
 * THE FENCE WAS NEVER THE PROBLEM and this file does not test it. 20260811000036 counts
 * past RLS under an advisory lock and refuses at the true ceiling; test-rls.mjs proves
 * that. What is tested here is the half a browser sees, and it fails in one direction
 * only — a screen may never promise room the database will refuse.
 */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')
const src = (...parts: string[]) => read('src', ...parts).replaceAll('\r\n', '\n')

const HEADCOUNT = src('lib', 'students', 'headcount.ts')
const MIGRATION = read(
  'supabase',
  'migrations',
  '20260811000076_center_headcount.sql',
).replaceAll('\r\n', '\n')

const DASHBOARD = src('app', '(app)', 'dashboard', 'page.tsx')
const ROSTER = src('app', '(app)', 'settings', 'students', 'page.tsx')
const ADD = src('app', '(app)', 'settings', 'students', 'new', 'page.tsx')
const IMPORT = src('app', '(app)', 'settings', 'students', 'import', 'page.tsx')
const PLAN = src('app', '(app)', 'settings', 'plan', 'page.tsx')
const ACTIONS = src('app', '(app)', 'settings', 'actions.ts')
const HQ = src('app', '(app)', 'hq', 'page.tsx')

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

/* -------------------------------------------------------------------------- */
/* The sweep: nothing pairs the pooled ceiling with an unproven count          */
/* -------------------------------------------------------------------------- */

/** Every `.ts`/`.tsx` under src/app, so a screen written next year is swept too. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const APP_FILES = walk(path.join(ROOT, 'src', 'app'))

/**
 * The two functions that turn a headcount into a places figure, and the pooled ceiling
 * they are asked about. Anything matching this is a site where the defect can reappear.
 */
const PAIRING = /(?:capacityPressure|studentRoom)\(\s*session\.ceiling\s*,\s*([^)]+?)\s*\)/g

test('every places figure in the app is counted past the branch scope', () => {
  const offenders: string[] = []

  for (const file of APP_FILES) {
    const source = readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
    const sites = [...source.matchAll(PAIRING)]
    if (sites.length === 0) continue

    const rel = path.relative(ROOT, file).replaceAll('\\', '/')

    /*
     * The mechanism, not the variable name. An allow-list of identifiers would pass the
     * day somebody names a branch-scoped count `pooledStudents`, so what is asserted is
     * that the file gets its number from the RPC — or, for /hq, that it never serves a
     * pinned reader at all (it returns its own card above the query; the comment there
     * says their figures belong on their dashboard).
     */
    const pooled =
      source.includes('centerStudentCount(') ||
      source.includes('if (!isHqMember(session.active)) {')

    if (!pooled) {
      offenders.push(
        `${rel}: ${sites.length} places figure(s) built without centerStudentCount()`,
      )
      continue
    }

    /*
     * And where a branch-scoped count SURVIVES beside the pooled one, the screen has to
     * say so. The dashboard is the case: its student tile is deliberately this building's
     * — /hq refuses a pinned manager and tells them their own figures are on their
     * dashboard — so two scopes share one screen, and §9.1 says an unqualified pair
     * invites the reader to subtract them. The qualifier is a fork on the pin, which is
     * `isHqMember(session.active)` wherever it appears.
     */
    const scoped = /\.from\('students'\)[\s\S]{0,400}?count: 'exact'/.test(source)
    if (scoped && !source.includes('isHqMember(session.active)')) {
      offenders.push(
        `${rel}: a branch-scoped student count sits beside the pooled ceiling unqualified`,
      )
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Read the organisation\'s count with centerStudentCount() from @/lib/students/headcount '
      + '— see 20260811000076 and this file\'s header.',
  )
})

test('the sweep is looking at something, and at all six screens', () => {
  // A regex that silently stops matching is a gate that passes forever. The six files
  // named here are the ones that print or enforce a places figure today; the count is
  // deliberately exact, so a seventh site has to be added above with a reason.
  const holders = APP_FILES.filter((file) =>
    PAIRING.test(readFileSync(file, 'utf8').replaceAll('\r\n', '\n')),
  ).map((file) => path.relative(ROOT, file).replaceAll('\\', '/'))

  assert.deepEqual(holders.sort(), [
    'src/app/(app)/dashboard/page.tsx',
    'src/app/(app)/hq/page.tsx',
    'src/app/(app)/settings/actions.ts',
    'src/app/(app)/settings/students/import/page.tsx',
    'src/app/(app)/settings/students/new/page.tsx',
    'src/app/(app)/settings/students/page.tsx',
  ])
})

/* -------------------------------------------------------------------------- */
/* The RPC, and why a definer function that takes a centre id is safe here     */
/* -------------------------------------------------------------------------- */

test('the count refuses a caller who is not staff of that centre', () => {
  // check-scoping.mjs names this hazard in words: a definer function that accepts a
  // centre id and trusts it is the actual hole, because the call site looks correct. So
  // the first statement in the body is the membership test.
  assert.match(
    MIGRATION,
    /if not \(\s*\n?\s*app\.is_staff_admin\(p_center_id\) or app\.can_manage_students\(p_center_id\)\s*\n?\s*\) then/,
  )
  assert.ok(MIGRATION.includes("using errcode = '42501'"))

  // Standard SQLSTATE on purpose: check-sql.mjs requires every CD### raised in SQL to be
  // named in src/lib, and this is a refusal to read rather than one of the product's own
  // rules. CD001 is the full-centre code and means something else — named in the header
  // here, never raised.
  assert.doesNotMatch(MIGRATION, /errcode = 'CD/)
})

test('the function is pinned, and neither anon nor public keeps its grant', () => {
  assert.ok(MIGRATION.includes('security definer'))
  assert.ok(MIGRATION.includes("set search_path = ''"))

  // Both revokes. Postgres grants EXECUTE to PUBLIC and Supabase ships a default
  // privilege granting functions to anon, so either one alone leaves the endpoint open.
  assert.ok(
    MIGRATION.includes('revoke all on function public.center_student_count(uuid) from public;'),
  )
  assert.ok(
    MIGRATION.includes('revoke all on function public.center_student_count(uuid) from anon;'),
  )
  assert.ok(
    MIGRATION.includes(
      'grant execute on function public.center_student_count(uuid) to authenticated, service_role;',
    ),
  )
})

test('it counts through app.active_students and claims to be nothing more', () => {
  // The counting function is untouched: three triggers depend on its volatility, and a
  // `stable` copy would let row 200 of a 500-row import miss rows 1..199. The declaration
  // rather than the word — the header explains the choice in prose, so `includes` would
  // pass on a wrapper that had quietly become stable.
  assert.ok(MIGRATION.includes('return app.active_students(p_center_id);'))
  assert.match(MIGRATION, /\nvolatile\nsecurity definer\n/)
  assert.doesNotMatch(MIGRATION, /\nstable\n/)

  // And the comment says what it is not, because a figure on a screen reads like a fence.
  assert.match(MIGRATION, /Not enforcement: /)
  assert.ok(MIGRATION.includes('app.guard_student_capacity()'))
})

/* -------------------------------------------------------------------------- */
/* null is "could not tell", and never a centre with nobody in it             */
/* -------------------------------------------------------------------------- */

test('a failed count stays null, and a real zero survives', () => {
  assert.ok(HEADCOUNT.includes('Promise<number | null>'))
  assert.ok(HEADCOUNT.includes('if (error || data === null) return null'))

  // `!data` would turn a centre of nought students into a failed read, and `?? 0` would
  // turn a failed read into a centre with every place free — the flattering direction,
  // and the one that promises room the database will refuse.
  assert.doesNotMatch(HEADCOUNT, /if \(!data\)/)
  assert.doesNotMatch(HEADCOUNT, /\?\? 0/)
})

test('each screen answers a failed count the way that screen can afford to', () => {
  // The paste box is taken away: `importStudents` refuses a paste whole (§10), so a
  // wrong `room` costs an afternoon of typing rather than one rejected form.
  assert.ok(IMPORT.includes('if (batches === null || studentCount === null) {'))

  // Both actions refuse rather than read zero. One admitted row past the ceiling is one
  // thing; a failed count on a paste would admit eighty. Anchored between the read and
  // the arithmetic in each, because `batchRoomRefusal` next door has a line of identical
  // text and an `includes` would go on passing while this one was deleted.
  const limitRefusal = ACTIONS.indexOf('? await centerStudentCount(supabase, centerId)')
  const limitRoom = ACTIONS.indexOf('return studentRoom(session.ceiling, count) === 0')
  assert.ok(limitRefusal > 0 && limitRoom > limitRefusal)
  assert.equal(
    count(
      ACTIONS.slice(limitRefusal, limitRoom),
      'if (count === null) return { error: t.limitUnknown }',
    ),
    1,
  )

  const importCount = ACTIONS.indexOf('const count = await centerStudentCount(supabase, centerId)')
  const importRoom = ACTIONS.indexOf('const room = studentRoom(session.ceiling, count)')
  assert.ok(importCount > 0 && importRoom > importCount)
  assert.equal(
    count(
      ACTIONS.slice(importCount, importRoom),
      'if (count === null) return { error: t.errors.limitUnknown }',
    ),
    1,
  )

  // The two screens that fail OPEN, and both only ever hide a warning by doing so — the
  // form still saves through `createStudent`, which re-counts and refuses. Turning a
  // family away at the desk over a number nobody has is the worse trade.
  assert.ok(ADD.includes('studentRoom(session.ceiling, studentCount ?? 0)'))
  assert.ok(
    DASHBOARD.includes(
      'pooledStudents === null ? null : capacityPressure(session.ceiling, pooledStudents)',
    ),
  )
  assert.ok(
    ROSTER.includes(
      'pooledStudents === null ? null : capacityPressure(session.ceiling, pooledStudents)',
    ),
  )
})

/* -------------------------------------------------------------------------- */
/* §9.1: two scopes on one screen have to say so                               */
/* -------------------------------------------------------------------------- */

test('the dashboard tile stays this building, so the line under it says otherwise', () => {
  // The tile is deliberately the branch's count — /hq refuses a pinned manager and tells
  // them their own figures are on their dashboard, so their dashboard had better be
  // theirs. That makes two scopes on one screen, which §9.1 says must be spelled out.
  assert.ok(DASHBOARD.includes('const pooledPlaces = !isHqMember(session.active)'))
  assert.ok(
    DASHBOARD.includes(`{pooledPlaces
                    ? t.placesPooled(pressure.remaining, pressure.ceiling)`),
  )
  assert.ok(DASHBOARD.includes('note={pooledPlaces ? d.hq.poolNote : undefined}'))
})

test('the roster drops the ceiling rather than pairing it with one branch', () => {
  // "40/300 students" is two true halves making a false claim, and the subtitle has no
  // room to explain itself. So a pinned reader gets their branch named and no ceiling;
  // the organisation's pressure is in the rail beside the list, with the pool note.
  assert.ok(ROSTER.includes('const pooled = isHqMember(session.active)'))
  assert.ok(
    ROSTER.includes('subtitle={pooled ? t.used(activeCount, limit) : t.usedHere(activeCount)}'),
  )
  assert.ok(ROSTER.includes('note={pooled ? undefined : d.hq.poolNote}'))
})

test('both qualifiers exist in both languages', () => {
  for (const d of [en, bn]) {
    assert.equal(typeof d.dashboard.placesPooled, 'function')
    assert.equal(typeof d.settings.students.usedHere, 'function')
    // The note is reused rather than reworded: one sentence about the pool, so two
    // screens cannot end up describing it differently.
    assert.equal(typeof d.hq.poolNote, 'string')
  }

  // The English says which scope it means, and the Bangla keeps ASCII digits (house rule)
  // and no Latin letters.
  assert.match(en.dashboard.placesPooled(5, 300), /across the organisation/)
  assert.match(en.settings.students.usedHere(40), /at this branch/)
  assert.match(bn.dashboard.placesPooled(5, 300), /5|300/)
  assert.doesNotMatch(bn.dashboard.placesPooled(5, 300), /[A-Za-z]/)
  assert.doesNotMatch(bn.settings.students.usedHere(40), /[A-Za-z]/)
})

/* -------------------------------------------------------------------------- */
/* The bill, which is the one figure that is not only a display               */
/* -------------------------------------------------------------------------- */

test('the plan screen bills from the organisation, not from whoever is reading', () => {
  // `counts.students` is the basis of a subscription that becomes a receipt. It is
  // owner-gated and only manager rows are ever pinned — but that invariant is
  // `.eq('role','manager')` in application code, not a database constraint, and a bill
  // basis may not rest on it.
  assert.ok(PLAN.includes('centerStudentCount(supabase, session.active.centerId)'))
  assert.ok(PLAN.includes('{ label: t.students, used: studentCount, limit: session.ceiling.ceiling }'))
  assert.match(PLAN, /students: studentCount/)

  // The batch row keeps its own scoped count on purpose: §8.4 caps batches per branch, so
  // a narrowed count against a per-branch ceiling is the correct pair there.
  assert.ok(PLAN.includes("from('batches')"))
})

test('/hq needs none of this because it never serves a pinned reader', () => {
  const refusal = HQ.indexOf('if (!isHqMember(session.active)) {')
  assert.ok(refusal > 0)
  // Above the reads, so a manager of one building never pays for a comparison of five
  // and never sees one branch reported as the organisation.
  assert.ok(refusal < HQ.indexOf('await Promise.all(['))
  assert.ok(HQ.includes('capacityPressure(session.ceiling, totalHeads)'))
})
