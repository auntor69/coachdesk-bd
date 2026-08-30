/**
 * What a centre employs somebody as, in the order the picker offers them.
 *
 * ITS OWN MODULE, for the reason `../expenses/categories.ts` gives about its own list: a
 * `"use server"` file may export nothing but async functions, so a list shared between
 * the action that validates a submission and the client component that renders the
 * picker cannot live in either.
 *
 * THE LIST IS THE ENUM'S, UNEDITED, and 20260811000043 is where it was written down and
 * argued for. Office roles first, support roles after, `other` last — which is the order
 * `order by role` gives a report and roughly the order a coaching centre fills the jobs.
 * Reordering it is cheap and safe; adding to it is a migration, because the enum is in
 * the database.
 *
 * `employee_role` IS NOT `member_role`, and the shared word "manager" is the reason to
 * repeat it here. `member_role` says what a person may do in the app and is what every
 * RLS policy resolves through; this says what the centre pays them to do. Nothing in this
 * file grants anything.
 */
import type { EmployeeRole } from '../supabase/types.ts'

/**
 * `as const satisfies` catches a value that is not a role — a typo like 'libarian' fails
 * here rather than on the one screen that writes it.
 *
 * What it does not catch is the other direction: `satisfies` asks whether each element
 * belongs to the union, so widening the enum in a migration leaves this list perfectly
 * valid and the new role simply missing from the form. `Unlisted` below is the check that
 * fails, and it is the whole reason both halves of this file exist — see what happened to
 * the payment method list when `card` was added to the enum and three runtime lists did
 * not notice.
 */
export const EMPLOYEE_ROLES = [
  'manager',
  'accountant',
  'receptionist',
  'coordinator',
  'office_assistant',
  'librarian',
  'lab_assistant',
  'it_support',
  'marketing',
  'driver',
  'cook',
  'cleaner',
  'security_guard',
  'other',
] as const satisfies readonly EmployeeRole[]

/** Whatever the list above left out. `never` while it is complete. */
type Unlisted = Exclude<EmployeeRole, (typeof EMPLOYEE_ROLES)[number]>

/**
 * Nothing at runtime, and a compile error the moment `Unlisted` stops being `never`.
 *
 * Exported rather than left a floating `const` so it is not an unused binding, and so the
 * error names something greppable — a reader told that `true` is not assignable to some
 * role name needs the next line to be the list to add it to.
 */
export const ALL_ROLES_LISTED: Unlisted extends never ? true : Unlisted = true

/**
 * The dictionary's fourteen labels, keyed by the enum rather than by a loose string.
 *
 * Here rather than in the form or the page because both render a role name and both are
 * handed the same object. Keyed by the enum, so a role added in a migration cannot ship
 * without a word for it and a word cannot outlive the value it names. Same shape and the
 * same argument as `CategoryLabels` beside the expense categories.
 */
export type RoleLabels = Record<EmployeeRole, string>

/**
 * What prints beside the name: the centre's own word for the job, or the role's.
 *
 * `designation` exists because a centre that calls its receptionist "Front Desk Officer"
 * should see that on the screen and on the payslip — but `role` is what a report groups
 * by, so both are stored and this is the one place that decides which is shown. Trimmed
 * to nothing counts as absent: an owner who cleared the box meant to stop overriding.
 */
export function jobTitle(
  role: EmployeeRole,
  designation: string | null,
  labels: RoleLabels,
): string {
  const own = designation?.trim()
  return own ? own : labels[role]
}
