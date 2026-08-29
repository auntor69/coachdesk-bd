/**
 * Which states a student can be in, in the order the edit form offers them.
 *
 * ITS OWN MODULE, AND NOT THE SERVER ACTION FILE IT WAS WRITTEN IN. A `"use server"`
 * file may export nothing but async functions: everything exported from one becomes a
 * callable HTTP endpoint, so Next refuses to build a module that exports an array.
 * It refuses during page-data collection rather than during typechecking, which is
 * why `tsc --noEmit` and the whole test gate passed over this for two commits while
 * `next build` did not get past /settings/subjects.
 *
 * Shared by the action that validates what was submitted and by the client component
 * that renders the select, which is the situation a plain module is for.
 */
import type { StudentStatus } from '../supabase/types.ts'

/**
 * `as const satisfies` catches a value that is not a status: a typo like 'droped'
 * fails here rather than at runtime, on the one screen that can set it.
 *
 * What it does not catch — despite what this comment claimed until 20260811000040 —
 * is the opposite direction. `satisfies` asks whether each element belongs to the
 * union, so widening the enum leaves this list perfectly valid and the new state
 * simply missing from the form. `Unlisted` below is the check that actually fails,
 * and it did: `suspended` and `transferred` are here because it refused to compile
 * without them, not because anybody remembered.
 *
 * ORDERED BY DISTANCE FROM THE CLASSROOM, which is 20260811000040's phrase and the
 * enum's own order: still here, barred but expected back, stopped coming, gone
 * elsewhere, finished, left. A select that offered them alphabetically would put
 * `dropped` above `graduated` and invite the wrong click on a good outcome.
 */
export const STUDENT_STATUSES = [
  'active',
  'suspended',
  'inactive',
  'transferred',
  'graduated',
  'dropped',
] as const satisfies readonly StudentStatus[]

/** Whatever the list above left out. `never` while it is complete. */
type Unlisted = Exclude<StudentStatus, (typeof STUDENT_STATUSES)[number]>

/**
 * Nothing at runtime, and a compile error the moment `Unlisted` stops being `never`.
 *
 * Exported rather than left as a floating `const`, so that it is not an unused
 * binding, and so the error names something greppable: a reader told that `true` is
 * not assignable to `'transferred'` needs the next line to be the list to add it to.
 */
export const ALL_STATUSES_LISTED: Unlisted extends never ? true : Unlisted = true
