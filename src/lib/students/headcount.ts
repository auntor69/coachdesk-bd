/**
 * How many students the organisation has, as opposed to how many this reader can see.
 *
 * THE TWO NUMBERS ARE DIFFERENT AND ONE OF THEM IS THE ANSWER. A place is a licence and
 * licences pool across the whole institution (§3.6), so `session.ceiling` is one figure
 * for every building. A `select … count` through the reader's own client is not: since
 * 20260811000053 `students_branch_scope` narrows it to their branch. Pairing the two
 * told a manager pinned to Mirpur that an organisation with five places left had 260,
 * which is the per-branch quota this product deliberately does not have — and
 * `capacityPressure` says so in its own docblock, having had no way to insist on it.
 *
 * So every screen that prints a place count asks this instead. Head office gets the same
 * number it always did; a pinned manager gets their organisation's rather than their
 * building's.
 *
 * NOT A FENCE, and nothing here is protecting anything. `app.guard_student_capacity()`
 * has counted past RLS under an advisory lock since 20260811000036 and raises CD001; this
 * is what a screen says beforehand so nobody meets that refusal by surprise.
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
