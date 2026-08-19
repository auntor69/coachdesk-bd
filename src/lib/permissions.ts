/**
 * What a teacher is allowed to do, and in what order it is asked.
 *
 * Five booleans, one table, and three places that have to agree about them: the
 * add form ticks them, the list edits them, and the Server Action writes them.
 * They were three copies of the same array until this file existed, which is a
 * worse bug than it sounds — an unchecked checkbox is simply absent from a
 * FormData, so the action has to read "missing" as false. A form rendering four
 * of the five therefore revokes the fifth, silently, from a screen that never
 * mentioned it. One list means that cannot drift.
 *
 * The order is the order the screens show them, and it is deliberate: what a
 * teacher does every day first (marks, then the SMS that carries them), then the
 * roster, then the two an owner thinks twice about. Nobody scrolls past the
 * bottom of a fieldset on a phone, so the dangerous ones are where a thumb has
 * to travel to reach them.
 *
 * No imports, for the reason given at the top of `./limits.ts`: both forms are
 * client components, so anything this file pulls in ships to a phone on 3G. The
 * labels live in the dictionary, keyed by these same names, so a permission
 * added here without a sentence for it fails `tsc`.
 */

/** The five switches, in the order the settings screens show them. */
export const PERMISSION_KEYS = [
  'can_manage_exams',
  'can_send_sms',
  'can_manage_students',
  'can_manage_batches',
  'can_view_fees',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

/**
 * What the table itself defaults to — see teacher_permissions in the init
 * migration. Repeated here because two screens need to know it before a row
 * exists: the add form pre-ticks the boxes, and the list falls back to these
 * when a teacher has no permissions row at all.
 *
 * That fallback is why marks and SMS are true. `bootstrap_center` gives the
 * owner's own teacher row no permissions, because they made the centre; reading
 * that absence as "may do nothing" would lock an owner out of their own marks
 * sheet. Everything an owner would think twice about handing over — the roster,
 * the batches, who has paid — stays false until they tick it themselves.
 */
export const PERMISSION_DEFAULTS: Record<PermissionKey, boolean> = {
  can_manage_exams: true,
  can_send_sms: true,
  can_manage_students: false,
  can_manage_batches: false,
  can_view_fees: false,
}
