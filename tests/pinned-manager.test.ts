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
 *
 * AND THE DEFECT IS NOW STRUCTURALLY IMPOSSIBLE rather than merely asserted (§16.1 step
 * 28). The ceiling went, so there is no second half to pair a count with, and the sweep
 * below is over the whole app: it fails on the vocabulary itself, which is the one form
 * of this gate that cannot pass by drifting. What survives of the original lesson is the
 * headcount read — 20260811000076, which still exists — and the two places that need a
 * figure about the whole organisation rather than one branch's.
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
const BILL = src('app', '(app)', 'settings', 'billing', 'page.tsx')
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
 * Source with its comments removed.
 *
 * THE SWEEP BELOW IS ABOUT CODE, and half of this cut's evidentiary value is in prose:
 * every place that used to hold a ceiling now carries a sentence saying what went and
 * why (§18). Those sentences name the retired vocabulary, which is the point of them —
 * so they are taken out before the scan, and a name surviving in a *statement* is what
 * fails. The `:` guard keeps the `//` of a `https://` inside a string from eating a line.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\w])\/\/[^\n]*/g, '$1')
}

/**
 * The vocabulary that could build a places figure, named once. Every one of these was a
 * way to turn a headcount into a number on a screen, and every one of them is gone from
 * `src/` (§16.1 step 28).
 *
 * LISTED RATHER THAN MATCHED. The sweep this file used to run was a regex for the *call*
 * — `capacityPressure(session.ceiling, …)` — which is the right shape for a defect that
 * is a pairing and the wrong one now that both halves are gone: a regex that stops
 * matching passes forever, and the names below cannot stop matching without a name being
 * written back into the source.
 */
const RETIRED = [
  'session.ceiling',
  'studentCeiling',
  'studentRoom',
  'capacityPressure',
  'capacityBands',
  'capacityCostBdt',
  'nextSeatCostBdt',
  'quoteSeats',
  'ASK_PLACES',
  'CapacityPressure',
  'StudentCeiling',
  'SeatBand',
  'SeatQuote',
] as const

test('no screen can build a places figure, because the vocabulary is gone', () => {
  const offenders: string[] = []

  for (const file of APP_FILES) {
    const source = code(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
    const rel = path.relative(ROOT, file).replaceAll('\\', '/')

    for (const name of RETIRED) {
      if (source.includes(name)) offenders.push(`${rel}: ${name}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Capacity is retired (§18): there is no ceiling left to count against, so a screen '
      + 'reading one has brought the whole defect back with it.',
  )
})

test('and the exported half of it left the plan table too', () => {
  // The screens are the consumers; this is the source. An export is an invitation, and the
  // two halves this cut deliberately kept are the ones that were never about capacity: the
  // per-student bands, and the room a plan's own student cap leaves.
  const plans = code(src('lib', 'plans.ts'))

  for (const name of RETIRED) {
    const escaped = name.replace('.', '\\.')
    assert.doesNotMatch(
      plans,
      new RegExp(`export (?:const|function|type) ${escaped}\\b`),
      `${name} is exported again`,
    )
  }

  for (const kept of ['STUDENT_BANDS', 'studentChargeBdt', 'roomFor', 'includedStudents']) {
    assert.ok(plans.includes(`export const ${kept}`) || plans.includes(`export function ${kept}`),
      `${kept} left the plan table`)
  }
})

test('the sweep is looking at something, and the headcount is still the RPC', () => {
  // A list that silently stops mattering is a gate that passes forever. Two halves: the
  // retired names really are absent (asserted above, over every file), and the one read
  // this file was written for — the organisation's headcount, past
  // `students_branch_scope` — is still the one the places that need it use.
  assert.ok(
    APP_FILES.some((file) => readFileSync(file, 'utf8').includes('centerStudentCount(')),
    'nothing in the app counts the organisation any more',
  )
  assert.ok(BILL.includes('centerStudentCount(supabase, session.active.centerId)'))
  assert.ok(ACTIONS.includes('? await centerStudentCount(supabase, centerId)'))
  assert.ok(ACTIONS.includes('roomFor(session.plan'))
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
  assert.ok(
    IMPORT.includes(
      'if (batches === null || (session.plan.maxStudents !== null && studentCount === null)) {',
    ),
  )

  // Both actions refuse rather than read zero. One admitted row past a cap is one thing;
  // a failed count on a paste would admit eighty. Anchored between the read and the
  // arithmetic in each, because `batchRoomRefusal` next door has a line of identical text
  // and an `includes` would go on passing while this one was deleted.
  const limitRefusal = ACTIONS.indexOf('? await centerStudentCount(supabase, centerId)')
  const limitRoom = ACTIONS.indexOf('return wouldExceed(session.plan, key, count)')
  assert.ok(limitRefusal > 0 && limitRoom > limitRefusal)
  assert.equal(
    count(
      ACTIONS.slice(limitRefusal, limitRoom),
      'if (count === null) return { error: t.limitUnknown }',
    ),
    1,
  )

  const importCount = ACTIONS.indexOf(
    'const count = cap === null ? null : await centerStudentCount(supabase, centerId)',
  )
  const importRoom = ACTIONS.indexOf(
    "const room = count === null ? null : roomFor(session.plan, 'maxStudents', count)",
  )
  assert.ok(importCount > 0 && importRoom > importCount)
  assert.equal(
    count(
      ACTIONS.slice(importCount, importRoom),
      'if (cap !== null && count === null) return { error: t.errors.limitUnknown }',
    ),
    1,
  )

  // `limitRefusal` answers the same way, and a null cap is taken before the read — the
  // rule this cut adds, and the reason a per-student tier can no longer have an
  // admission refused because a count it does not need failed.
  const refusal = ACTIONS.indexOf('async function limitRefusal(')
  const nullCap = ACTIONS.indexOf('if (session.plan[key] === null) return null', refusal)
  const counted = ACTIONS.indexOf('? await centerStudentCount(supabase, centerId)', refusal)
  assert.ok(refusal > 0 && nullCap > refusal && counted > nullCap, 'a null cap is read first')

  // The screens that used to fail OPEN no longer count at all, which is the strongest
  // form of failing open: the add-student form draws, and `createStudent` refuses on the
  // write if a teacher tier is genuinely full. Turning a family away at the desk over a
  // number nobody has is the worse trade.
  assert.doesNotMatch(ADD, /studentCount|centerStudentCount/)
  assert.doesNotMatch(DASHBOARD, /pooledStudents|centerStudentCount/)
  assert.doesNotMatch(ROSTER, /pooledStudents|centerStudentCount/)
})

/* -------------------------------------------------------------------------- */
/* §9.1: two scopes on one screen have to say so                               */
/* -------------------------------------------------------------------------- */

test('the dashboard reads one scope now, so nothing needs a qualifier', () => {
  // The tile was deliberately the branch's count while a line under it was the
  // organisation's, and §9.1 says an unqualified pair invites the reader to subtract
  // them. The line is gone (§16.1 step 28) and the organisation's headcount went with it:
  // one scope on one screen needs no sentence about scopes.
  assert.doesNotMatch(DASHBOARD, /pooledPlaces|placesPooled|centerStudentCount|poolNote/)

  // The pin still decides something here — the branch comparison is head office's alone —
  // which is why the fork is qualified rather than simply deleted.
  assert.ok(DASHBOARD.includes('isHqMember(session.active)'))
})

test('the roster drops the whole line rather than pairing it with one branch', () => {
  // "40/300 students" was two true halves making a false claim, and the subtitle has no
  // room to explain itself. There is no 300 any more — a per-student tier has no student
  // limit — so every reader gets their own list's count and the fork is gone with the
  // figure that made it necessary.
  assert.ok(ROSTER.includes('subtitle={t.usedHere(activeCount)}'))
  assert.doesNotMatch(
    code(ROSTER),
    /pooledStudents|pooledPlaces|warnPlaces|PlacesWarning|centerStudentCount|poolNote/,
  )
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

test('the money screen bills from the organisation, not from whoever is reading', () => {
  // `counts.students` is the basis of a subscription that becomes a receipt. It is
  // owner-gated and only manager rows are ever pinned — but that invariant is
  // `.eq('role','manager')` in application code, not a database constraint, and a bill
  // basis may not rest on it. Since §16.1 step 28 removed the cards that outlived the plan
  // screen, the billing page itself is the reader: its third question prices the rate from
  // this count, so the rule is asserted there now.
  assert.ok(BILL.includes('centerStudentCount(supabase, session.active.centerId)'))
  assert.match(
    BILL,
    /dailyRatePoisha\(plan, counts\.students, counts\.teachers, counts\.branches\)/,
  )

  // The usage table and its batch row left with the plan screen (§16.1 step 27, §20.4):
  // there is no ceiling bar to draw on a per-student tier, and the tier is a line in the
  // billing screen's third question instead. Asserted as an absence so the scoped batch
  // count cannot come back with the table.
  assert.ok(!BILL.includes("from('batches')"), 'the usage table is back')
})

test('/hq needs none of this because it never serves a pinned reader', () => {
  const refusal = HQ.indexOf('if (!isHqMember(session.active)) {')
  assert.ok(refusal > 0)
  // Above the reads, so a manager of one building never pays for a comparison of five
  // and never sees one branch reported as the organisation.
  assert.ok(refusal < HQ.indexOf('await Promise.all(['))

  // And what this screen used to build for the owner above the table — the pool card, the
  // threshold warning past a fifth and the growth box below it — went with the ceiling
  // (§16.1 step 28). The refusal above is what is left of the same rule: a pinned manager
  // still never sees an organisation-wide figure they could subtract their own from.
  assert.doesNotMatch(HQ, /capacityPressure|PlacesWarning|recentIntake|growingBranches/)
  assert.ok(HQ.includes('const totalHeads = centerHeads.error ? null : centerHeads.count'))
})
