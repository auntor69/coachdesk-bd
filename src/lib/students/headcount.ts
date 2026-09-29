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

import type { Database } from '../supabase/types.ts'

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
