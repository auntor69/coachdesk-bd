/**
 * What a taka can have been spent on, in the order the form offers them.
 *
 * ITS OWN MODULE, for the reason `../students/status.ts` gives about its own list: a
 * `"use server"` file may export nothing but async functions, so an array shared
 * between the action that validates a submission and the client component that renders
 * the picker cannot live in either.
 *
 * THE LIST IS THE MASTERPLAN'S, UNEDITED, and 20260811000045 is where it was first
 * written down: "Categories are a fixed list plus a free-text note, not free-text alone
 * — a category somebody types is a category no report can group." Reordering it is
 * cheap and safe; adding to it is a migration, because the enum is in the database.
 */
import type { ExpenseCategory } from '../supabase/types.ts'

/**
 * `as const satisfies` catches a value that is not a category — a typo like
 * 'electicity' fails here rather than on the one screen that writes it.
 *
 * What it does not catch is the other direction: `satisfies` asks whether each element
 * belongs to the union, so widening the enum in a migration leaves this list perfectly
 * valid and the new category simply missing from the form. `Unlisted` below is the
 * check that fails, and it is the whole reason both halves of this file exist — see
 * what happened to the payment method list when `card` was added to the enum and three
 * runtime lists did not notice.
 *
 * ORDERED AS THE ENUM ORDERS IT, which is §9.6's own order and is roughly what a centre
 * spends most on first. Not alphabetised: `electricity` and `equipment` would sit next
 * to each other at the top of the picker, one of them monthly and one of them rare, and
 * a mis-tap between those two is a rent-sized figure in the wrong row.
 */
export const EXPENSE_CATEGORIES = [
  'rent',
  'electricity',
  'internet',
  'marketing',
  'printing',
  'stationery',
  'equipment',
  'maintenance',
  'transport',
  'software',
  'salary',
  'miscellaneous',
] as const satisfies readonly ExpenseCategory[]

/** Whatever the list above left out. `never` while it is complete. */
type Unlisted = Exclude<ExpenseCategory, (typeof EXPENSE_CATEGORIES)[number]>

/**
 * Nothing at runtime, and a compile error the moment `Unlisted` stops being `never`.
 *
 * Exported rather than left a floating `const` so it is not an unused binding, and so
 * the error names something greppable — a reader told that `true` is not assignable to
 * some category name needs the next line to be the list to add it to.
 */
export const ALL_CATEGORIES_LISTED: Unlisted extends never ? true : Unlisted = true

/**
 * The one category that is counted somewhere else.
 *
 * §9.8's profit line is `collected − expenses − payroll`, and `center_profit_month`
 * defines its expense side as `sum(amount_bdt) where category <> 'salary'` — because a
 * centre that pays through the payroll screen and also writes the same money down here
 * would have it subtracted twice. 20260811000045's header argues at length for keeping
 * the category anyway: a centre that has not set up terms per person still knows it paid
 * the staff ৳40,000 last month, and refusing to let them write that down sends the
 * figure to `miscellaneous`, where it is invisible rather than merely awkward.
 *
 * Named here, once, so the screen that lists a month's spending can say out loud which
 * of its own rows the profit line will not be reading. A constant and not a literal in
 * the page, because the day this rule changes it changes in the view and in exactly one
 * other place.
 */
export const PAYROLL_CATEGORY = 'salary' satisfies ExpenseCategory

/**
 * The dictionary's twelve labels, keyed by the enum rather than by a loose string.
 *
 * Here rather than in the form or the page because both render a category name and both
 * are handed the same object — the page out of its own dictionary group, the form as a
 * prop from the page. Keyed by the enum, so a category added in a migration cannot ship
 * without a word for it and a word cannot outlive the value it names. Same shape and the
 * same argument as `MethodLabels` beside the method picker.
 */
export type CategoryLabels = Record<ExpenseCategory, string>
