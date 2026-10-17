/**
 * How many students the organisation has, as opposed to how many this reader can see.
 *
 * THE TWO NUMBERS ARE DIFFERENT, AND THE FIRST ONE IS STILL ASKED FOR. A `select … count`
 * through the reader's own client is their branch's, because 20260811000053 made
 * `students_branch_scope` RESTRICTIVE: it narrows the read whatever the query asks for,
 * and there is no filter in the source to notice. A head count for the whole institution
 * therefore has to come from somewhere that counts past it, which is 20260811000076's RPC
 * and this file.
 *
 * WHAT IT IS NO LONGER PAIRED WITH is a ceiling. It used to be the numerator against
 * `session.ceiling` — one pooled licence count for every building (§3.6) — and the two
 * together told a manager pinned to Mirpur that an organisation with five places left had
 * 260. Capacity is retired (§16.1 step 28) and there is no second half to this figure:
 * what is left is the rates the balance charges from. The billing screen prices the day
 * from the organisation's headcount for exactly that reason, and `limitRefusal` and the
 * import still use it where a plan's own student cap is real.
 *
 * NOT A FENCE, and nothing here is protecting anything. `app.guard_student_capacity()`
 * has counted past RLS under an advisory lock since 20260811000036 and raises CD001 when
 * a plan's own allowance is full; this is a courtesy — a sentence a screen can say. What
 * capacity's retirement took was the bought half of the ceiling, not the guard: §18 keeps
 * the engineering caps on the teacher tiers, and the per-student tiers have none left to
 * reach (§3.3).
 *
 * `null` IS "COULD NOT TELL", never zero, which is the same convention `limitRefusal`
 * keeps and for the same reason: a dropped read rendered as zero is a full centre being
 * told it has every place free. The RPC refuses with 42501 for a caller who is neither a
 * staff admin nor a teacher holding can_manage_students, and that arrives here as null
 * too — every call site stands behind one of those gates, so in practice it means the
 * read failed.
 *
 * Takes the client as an argument rather than importing one, like `branchChoicesFor`:
 * this module is imported by `node --test`, which has no `next/headers` to give it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { trialRosterRefusal, type PlanLimits } from '../plans.ts'
import type { Database } from '../supabase/types.ts'

/**
 * Whether this organisation may put `adding` more students on its roster.
 *
 * THE THIRD FENCE'S READING HALF (20260811000098), and it lives here because this module
 * already owns the only honest way to count a roster: `centerStudentCount` above, which counts
 * the organisation rather than the reader's branch. Three surfaces ask the question — the two
 * Server Actions (`createStudent`, `importStudents`) and the three roster screens that must not
 * draw a door the action would refuse — and the rule itself is `trialRosterRefusal` in plans.ts,
 * so what is left here is the count and the order the questions are asked in.
 *
 * THE SHORT-CIRCUITS COME FIRST, SO A PAYING ORGANISATION PAYS FOR NOTHING. A teacher tier is
 * bounded by its own ceiling (`limitRefusal` and `CD001`) and never reaches the bound below;
 * and money on the balance lifts the bound entirely, so the two reads this function would make
 * — the organisation's count and the policy row, which the caller loads — are not made at all.
 * `trialRosterRefusal`'s own last line is what that early return restates, and
 * tests/plans.test.ts asserts the equivalence rather than trusting it: money on the balance is
 * null at every count and every ceiling.
 *
 * `ceiling` IS THE POLICY ROW as the caller read it (lib/platform/settings.ts), and null there
 * is a read that failed — a refusal, not a bound of nothing, which is the distinction the type
 * in that file exists to carry.
 *
 * `adding` is how many new students the write puts on the roster: one for an admission, the
 * size of the paste for an import, and nothing at all for a register re-pasted to fix three
 * names. The arithmetic is the trigger's — see `rosterFence` in settings/actions.ts — because
 * the guard counts the rows already there and refuses on `in_use < allowed`.
 *
 * `unreadable` IS ITS OWN ANSWER and is not folded into `full`: a count that did not come back
 * is "we cannot tell just now", which is a different sentence from "the trial is full", and the
 * one place that confusion would be expensive is the import, where the wrong sentence sends an
 * owner to buy money they may not need.
 */
export type RosterVerdict =
  | { state: 'ok' }
  | { state: 'unreadable' }
  | { state: 'full'; ceiling: number | null }

export async function trialRosterVerdict(
  supabase: SupabaseClient<Database>,
  input: {
    centerId: string
    plan: PlanLimits
    balancePoisha: number | null
    ceiling: number | null
    adding?: number
  },
): Promise<RosterVerdict> {
  if (input.plan.maxStudents !== null) return { state: 'ok' }
  if (input.balancePoisha !== null && input.balancePoisha > 0) return { state: 'ok' }

  const count = await centerStudentCount(supabase, input.centerId)
  if (count === null) return { state: 'unreadable' }

  const refusal = trialRosterRefusal(input.plan, {
    activeStudents: count + Math.max(1, input.adding ?? 1) - 1,
    balancePoisha: input.balancePoisha,
    ceiling: input.ceiling,
  })

  return refusal === null ? { state: 'ok' } : { state: 'full', ceiling: input.ceiling }
}

export async function centerStudentCount(
  supabase: SupabaseClient<Database>,
  centerId: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('center_student_count', {
    p_center_id: centerId,
  })

  // `data` is typed `number` and comes back null on any failure, so both halves are
  // checked: a zero is a real answer and must survive, and `!data` would lose it.
  if (error || data === null) return null
  return data
}
