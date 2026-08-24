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
 * `as const satisfies` so widening the enum breaks here rather than quietly leaving
 * a state out of the only screen that can reach it.
 */
export const STUDENT_STATUSES = [
  'active',
  'inactive',
  'graduated',
  'dropped',
] as const satisfies readonly StudentStatus[]
