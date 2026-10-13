/**
 * What an account says it is — the one question the signup screen asks, and the thing
 * the trial a customer gets is chosen from (MASTERPLAN.md §4.3, §2.1).
 *
 * THREE AND NOT TWO. The old form offered "I teach alone" and "I have a coaching centre",
 * and the database stored neither: `teacher_mode` was a boolean that decided whether the
 * owner also got a `teachers` row, so the answer was consumed by the signup and forgotten
 * afterwards. A fortnight of Teacher Pro went to every account that was made, including
 * the coaching centres, and then they landed on Teacher Free (§16.1's signup audit).
 *
 * WHERE THIS LIVES AND WHY. `coaching_centers.account_kind` is the column and this is its
 * vocabulary, in TypeScript, next to the plan table it is not: a *plan* answers what a
 * customer may do and comes from plans.ts; this answers who the customer is, and the two
 * meet in exactly one place — the trial a signup is given. Keeping the list here rather
 * than in the Server Action file is not tidiness: a `'use server'` module may export
 * nothing but async functions, so a constant there is a build error rather than a shared
 * value.
 *
 * IT IS NOT A PERMISSION AND NOT A PLAN. Nothing gates a feature on it. A teacher is a
 * teacher on Teacher Free or Teacher Pro; a centre is a centre on any tier.
 *
 * The database holds the same three strings in `coaching_centers_account_kind_check`, and
 * `public.bootstrap_center` refuses a fourth — so a form that invented one would fail at
 * the database rather than sign somebody up as something the product has no shape for.
 */
export const ACCOUNT_KINDS = ['teacher', 'center', 'institution'] as const

export type AccountKind = (typeof ACCOUNT_KINDS)[number]

/** Whether a posted value is one of them. Used by the signup action and the founder form. */
export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(value)
}

/**
 * Whether this kind is one person or an organisation.
 *
 * The same line §2.1 draws between the teacher tiers and the centre tiers, asked of the
 * kind rather than of the plan — and the only thing that reads it is the founder panel's
 * own copy, where a solo teacher and a coaching centre are two different conversations.
 */
export function isSoloKind(kind: AccountKind): boolean {
  return kind === 'teacher'
}
