/**
 * The language switch.
 *
 * One button, and it is labelled with the language it switches *to* — "English"
 * while the app is in Bangla, "বাংলা" while it is in English. Wikipedia's
 * convention, and the only one that works: a control labelled in a language the
 * reader cannot read is the one control they most need to find.
 *
 * A form and a Server Action rather than a `<select onChange>`, for the same
 * reason the centre switcher is a `<details>`: this renders before any JavaScript
 * arrives, which on a 3G connection is most of the first ten seconds. It is also
 * the only sensible answer for the login screen, where the whole point is that
 * somebody who cannot read the form can still change it.
 *
 * No dropdown, because there are two languages. `otherLocale` is total, so there
 * is nothing to choose between.
 */
import { setLocale } from '@/lib/i18n/actions'
import { dict, LOCALE_NAME, otherLocale, type Locale } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const next = otherLocale(locale)

  return (
    <form action={setLocale}>
      <input type="hidden" name="locale" value={next} />
      {/* The visible label is a bare endonym, so the accessible name has to carry
          the verb — "English" alone tells a screen-reader user the name of a
          language, not that pressing it changes theirs. */}
      <button
        type="submit"
        aria-label={fill(dict(locale).shell.switchTo, { lang: LOCALE_NAME[next] })}
        className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft
          hover:bg-surface-alt hover:text-ink"
      >
        {LOCALE_NAME[next]}
      </button>
    </form>
  )
}
