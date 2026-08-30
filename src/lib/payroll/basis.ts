/**
 * How a salary is worked out: a flat month, or a rate per class.
 *
 * ITS OWN MODULE for the reason ../expenses/categories.ts gives about its own list: a
 * `"use server"` file may export nothing but async functions, so a list shared between
 * the action that validates a submission and the client component that renders the
 * picker cannot live in either of them.
 *
 * TWO VALUES AND NOT THREE. 20260811000044 argues it where the enum is created — nobody
 * in this market is paid by the hour, and an unused enum value is a picker option
 * somebody eventually selects by accident. Adding a third is a migration, because the
 * enum is in the database.
 */
import type { SalaryBasis } from '../supabase/types.ts'

/**
 * The two bases, monthly first because it is how almost every centre pays.
 *
 * `as const satisfies` catches a value that is not a basis; `Unlisted` below catches the
 * other direction, which `satisfies` cannot see — an enum widened by a migration leaves
 * this list perfectly valid and the new basis simply missing from every picker. See what
 * happened to the payment method list when `card` was added and three runtime lists did
 * not notice.
 */
export const SALARY_BASES = ['monthly', 'per_class'] as const satisfies readonly SalaryBasis[]

/** Whatever the list above left out. `never` while it is complete. */
type Unlisted = Exclude<SalaryBasis, (typeof SALARY_BASES)[number]>

/**
 * Nothing at runtime, and a compile error the moment `Unlisted` stops being `never`.
 *
 * Exported rather than left a floating `const` so it is not an unused binding, and so the
 * error names something greppable — a reader told that `true` is not assignable to some
 * basis name needs the next line to be the list to add it to.
 */
export const ALL_BASES_LISTED: Unlisted extends never ? true : Unlisted = true

/**
 * The dictionary's two labels, keyed by the enum rather than by a loose string.
 *
 * Here rather than in the page or the form because both render a basis and both are
 * handed the same object — the page out of its own dictionary group, the form as a prop
 * from the page. Same shape and the same argument as `CategoryLabels`.
 */
export type BasisLabels = Record<SalaryBasis, string>

/** The basis that carries a monthly figure, named once so no screen compares a string. */
export const MONTHLY_BASIS = 'monthly' satisfies SalaryBasis

/**
 * The basis whose monthly cost is not a stored number.
 *
 * What a per-class teacher earns in a month is a count of classes times a rate, which
 * 20260811000044 refuses to store: "storing it would be a number that goes stale the next
 * time they teach." So the wage bill can total the monthly agreements and cannot total
 * these, and every screen that adds up a bill has to say which of the two it is showing.
 * Named here so that rule lives in one place.
 */
export const PER_CLASS_BASIS = 'per_class' satisfies SalaryBasis
