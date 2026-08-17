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
export { LOCALES, DEFAULT_LOCALE, asLocale } from './locale.ts'

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
 */
export type T<K extends keyof Dictionary> = Dictionary[K]
