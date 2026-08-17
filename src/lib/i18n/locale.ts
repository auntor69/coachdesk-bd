/**
 * Which language a reader gets, and nothing else.
 *
 * Deliberately its own file with no imports. The dictionaries in this directory
 * are a few thousand strings and `src/lib/bd/time.ts` needs none of them — it
 * needs only to know which of two ways to render a date. Putting `Locale` in
 * index.ts would make every unit-tested module that touches a date pull the
 * whole English and Bangla surface in behind it.
 *
 * Two locales, not a general i18n framework. A coaching centre in Dhaka runs in
 * Bangla and its English-medium teachers run in English; there is no third
 * reader, and every abstraction built for a third one would be untested.
 */

export type Locale = 'bn' | 'en'

/** Both locales, for tests that must assert something holds in each. */
export const LOCALES = ['bn', 'en'] as const satisfies readonly Locale[]

/**
 * Bangla, because the centre owner and the guardians read Bangla and the
 * teachers can read both. An English default would put the burden on the larger
 * group of readers to change a setting before the app is usable.
 */
export const DEFAULT_LOCALE: Locale = 'bn'

/**
 * Narrows whatever came out of the database or a form.
 *
 * `profiles.locale` is a text column with a check constraint, and user_metadata
 * is unvalidated JSON that a client could put anything in. Both reach the app as
 * `string`, and a locale that is neither 'bn' nor 'en' must land on the default
 * rather than index a dictionary with a key it does not have.
 */
export function asLocale(value: unknown): Locale {
  return value === 'en' || value === 'bn' ? value : DEFAULT_LOCALE
}
