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

/** The other one. Two locales, so a toggle is total and needs no menu. */
export function otherLocale(locale: Locale): Locale {
  return locale === 'bn' ? 'en' : 'bn'
}

/**
 * Each language's name in itself.
 *
 * Endonyms, and deliberately not in either dictionary. A picker that offers
 * "Bengali" to somebody who cannot read English has failed at the one job it has,
 * so both entries have to read the same in both files — and a string that must be
 * identical in bn.ts and en.ts does not belong in either of them.
 */
export const LOCALE_NAME: Record<Locale, string> = {
  bn: 'বাংলা',
  en: 'English',
}

/**
 * Where the choice is kept for a reader who has no account yet.
 *
 * Signed in, the answer is `profiles.locale` and this is only a copy of it, so
 * that signing out does not throw an English reader back to a Bangla login form.
 * Client-writable, like every cookie — `asLocale` is what makes that harmless.
 *
 * Accept-Language is deliberately not consulted. Bangladeshi Android phones ship
 * configured as en-US and are handed to people who read Bangla; honouring the
 * header would give the majority of this app's users the wrong language and no
 * obvious way to understand why.
 */
export const LOCALE_COOKIE = 'cd_lang'

/**
 * A year, like the active-centre cookie and for the same reason: this is a
 * preference and not a credential, so nothing is gained by making somebody choose
 * their own language again next week.
 */
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365
