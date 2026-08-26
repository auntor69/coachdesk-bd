/**
 * The search box, once, for every list in the product that has one.
 *
 * A CENTRE WITH THREE HUNDRED STUDENTS HAS NO USE FOR A LIST OF THREE HUNDRED
 * STUDENTS. Every screen here was built to be read top to bottom by an owner who
 * already knew what they were looking at, which is true of a demo and false of
 * August. This is the box that fixes it, and it is one component rather than six
 * because a box that behaves differently on the fee board and on the roster is a
 * box an owner stops trusting the second time it finds nothing.
 *
 * NO JAVASCRIPT, DELIBERATELY. A plain `<form method="get">` with a named input
 * and a real submit button. The query lands in the URL, which means it survives a
 * reload, can be bookmarked, can be shared, and — the reason that matters on this
 * product — is still there when a page comes back from the offline cache. A
 * client component with `useState` would have to re-fetch to filter, and the one
 * thing an owner on 3G between classes cannot afford is a round trip per
 * keystroke.
 *
 * THE BUTTON IS NOT DECORATION. Android Chrome will submit a single-input form on
 * Enter, but the soft keyboard's Enter is a newline on some Bangla IMEs and a
 * "next field" on others; a visible button is the only control that works on
 * every handset in a coaching centre's staff room. Same reasoning as the
 * register's month selector, written up there.
 *
 * CLEARING IS A SECOND FORM, not a link. A `<Link>` would need to know the page's
 * own path, and `typedRoutes` makes an arbitrary href prop a type error rather
 * than a convenience; an empty GET form submits to the current URL with only the
 * inputs it carries, which is exactly "the same page without `q`". It also keeps
 * whatever else was in the URL — the register's month, a batch id — because a
 * clear that silently threw the reader back to the current month would be a
 * second surprise on top of the one they asked for.
 *
 * SERVER-RENDERED ONLY. `t` is the whole `search` group and `showing` is a
 * function, which React cannot serialise across the client boundary — see `T` in
 * lib/i18n/index.ts. There is nothing interactive here, so there is no reason to
 * ever want to; the constraint is written down rather than enforced because the
 * enforcement is the failure it would cause.
 */
import type { Dictionary } from '@/lib/i18n'
import { MAX_QUERY } from '@/lib/search'

type SearchBoxProps = {
  /** The query as it arrived in the URL, so the box still holds what was typed. */
  q: string
  t: Dictionary['search']
  /**
   * What the box says it searches, when the page's fields are not the usual three.
   *
   * Defaults to `t.placeholder` — a name, a code, a guardian's number. The
   * collection register passes `t.placeholderPayments` because it has no phone
   * column and does have a transaction ID, and a box that offered to find a phone
   * number on that sheet would be promising something the fields cannot answer.
   */
  placeholder?: string
  /**
   * Other search params this page uses, preserved through both forms.
   *
   * Undefined and empty values are dropped rather than written as blanks, so a
   * search on the fee board does not append `?q=আলী&month=` and teach the next
   * screen that an empty month was chosen on purpose.
   */
  keep?: Record<string, string | number | undefined | null>
  /**
   * How many rows survived the filter, and how many there were. Rendered only
   * when something was actually searched for — the count is what stops a filtered
   * list from reading as a short one, and on an unfiltered list it is noise.
   */
  count?: { shown: number; total: number }
}

export function SearchBox({ q, t, placeholder, keep, count }: SearchBoxProps) {
  const hidden = Object.entries(keep ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  const searching = q.trim() !== ''

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2 print:hidden">
        <form method="get" className="flex min-w-0 flex-1 items-end gap-2">
          {hidden.map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={String(value)} />
          ))}
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="font-medium text-ink">{t.label}</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={placeholder ?? t.placeholder}
              maxLength={MAX_QUERY}
              // A phone keyboard that autocapitalises and autocorrects a student
              // code turns "s01" into "S01. " and a Bangla name into whatever the
              // dictionary preferred. `search` on enterKeyHint puts a magnifier on
              // the soft keyboard's action key, which is the affordance the button
              // beside it duplicates for the handsets that ignore it.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className="min-h-tap w-full rounded-xl border-2 border-line bg-white px-3
                text-base text-ink placeholder:text-ink-faint focus:border-brand-400
                focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-tap shrink-0 items-center rounded-xl border-2
              border-brand-500 bg-brand-50 px-4 font-medium text-brand-800"
          >
            {t.go}
          </button>
        </form>

        {/* Only once there is something to clear. An always-present "show all"
            beside an empty box is a control that does nothing, and on a 375px
            phone it costs the search button its width. */}
        {searching && (
          <form method="get" className="shrink-0">
            {hidden.map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={String(value)} />
            ))}
            <button
              type="submit"
              className="inline-flex min-h-tap items-center rounded-xl px-3 font-medium
                text-brand-700 underline"
            >
              {t.clear}
            </button>
          </form>
        )}
      </div>

      {/* The one part of this that is NOT print:hidden, and the reason is the
          collection register. Filter that sheet to one family, tap print, and
          without this line the paper carries five rows under a total for a hundred
          and twenty with nothing to say why — which is precisely the kind of sheet
          an accountant queries a year later and nobody can explain. The controls
          above are hidden because a printed search box is furniture; the sentence
          saying the list is a part of itself is the sheet's own caveat. */}
      {searching && count && (
        <p className="text-sm text-ink-soft" aria-live="polite">
          {t.showing(count.shown, count.total)}
        </p>
      )}
    </div>
  )
}

/**
 * What a list says when the search matched nothing.
 *
 * Its own export so the two sentences cannot drift apart across the screens that
 * need them, and so no screen is tempted to reuse its own empty state here —
 * "কোনো ফি বাকি নেই" under a filtered list is the app telling an owner the centre
 * is settled up because they typed a name wrong.
 */
export function SearchEmpty({ t }: { t: Pick<Dictionary['search'], 'none' | 'noneHint'> }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="font-medium text-ink">{t.none}</p>
      <p className="mt-1 text-sm text-ink-soft">{t.noneHint}</p>
    </div>
  )
}
