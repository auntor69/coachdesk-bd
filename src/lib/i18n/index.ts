/**
 * How a screen gets its words.
 *
 * Server components call `dict(session.locale)` and read strings off the result.
 * Client components are handed the group they need as a prop by their server
 * parent — there is deliberately no context provider and no `useT()` hook.
 *
 * That is a bandwidth decision, not a style one. A provider has to carry either
 * the whole dictionary in the RSC payload of every navigation, or both languages
 * in the client bundle; this app is used on 3G by teachers between classes. A
 * client form that needs eight labels takes eight labels, typed as
 * `T<'studentForm'>`, so the compiler still catches a missing key and the wire
 * carries nothing else. Most of the app is server components and pays nothing at
 * all.
 *
 * If a deep client tree ever makes threading genuinely painful, a provider for
 * that subtree is the fix — not a provider at the root for everything.
 */
import { bn, type Dictionary } from './bn.ts'
import { en } from './en.ts'
import type { Locale } from './locale.ts'

export type { Dictionary } from './bn.ts'
export type { Locale } from './locale.ts'
export {
  LOCALES,
  DEFAULT_LOCALE,
  asLocale,
  otherLocale,
  LOCALE_NAME,
} from './locale.ts'

const DICTS: Record<Locale, Dictionary> = { bn, en }

/** The strings for one reader. Total, not a lookup that can miss. */
export function dict(locale: Locale): Dictionary {
  return DICTS[locale]
}

/**
 * One group's worth, for typing a client component's prop:
 * `{ t }: { t: T<'shell'> }`.
 *
 * Naming the group rather than the whole dictionary is what keeps the payload
 * honest — a component asking for `T<'shell'>` cannot be handed everything by
 * accident, and a reader of the component's signature can see exactly which
 * strings cross the wire for it.
 *
 * Count-dependent strings are functions, and a function cannot cross into a
 * client component: React refuses to serialise it. So `T` maps them to `never`,
 * which makes `t={d.roster}` fail at the JSX attribute and names the offending
 * key. Without that, the failure is a runtime error on the first render of the
 * screen — `tsc`, `npm test` and `next build` all pass, and the register 500s on
 * a teacher's phone with a class waiting. Ask a plural of the server instead:
 * resolve it in the page, or return the finished sentence from the action.
 */
export type T<K extends keyof Dictionary> = Wire<Dictionary[K]>

/** A group with every function leaf poisoned. See `T`. */
type Wire<G> = {
  [K in keyof G]: G[K] extends (...args: never[]) => unknown
    ? never
    : G[K] extends object
      ? Wire<G[K]>
      : G[K]
}

/**
 * The right name for a row the centre typed themselves.
 *
 * Subjects and exam types carry two names: `name`, which is required, and
 * `name_bn`, which is optional — the settings form asks for "নাম" and then
 * "বাংলা নাম (ঐচ্ছিক)". So a Bangla reader wants `name_bn` and falls back to
 * `name`, and an English reader wants the reverse. Neither direction may return
 * empty when the other column has something in it: a batch row reading
 * "Class 9 · " with a missing subject looks like a bug in the app rather than a
 * blank the owner left.
 *
 * Not part of the dictionary. The dictionary is what the app says; this is what
 * the centre said, and no amount of translation work will fill in a Bangla name
 * the owner never typed.
 */
export function localName(
  row: { name?: string | null; name_bn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!row) return ''
  return (locale === 'en'
    ? row.name || row.name_bn
    : row.name_bn || row.name) ?? ''
}
