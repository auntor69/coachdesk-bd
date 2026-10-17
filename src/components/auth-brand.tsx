import type { Dictionary } from '@/lib/i18n'
import { Logo } from '@/components/ui'

/**
 * The left half of a desktop login and signup screen.
 *
 * WHY IT EXISTS. Every signed-in screen was given §20.1's two frames — a sidebar on a
 * laptop and a tab bar on a phone — and these two were left behind: a 384px card in the
 * middle of a 1,440px window, which is the phone layout drawn at every width, and the
 * first thing a prospective owner ever sees. It is also the only screen the product shows
 * to somebody who has not decided to buy it.
 *
 * HIDDEN BELOW `lg`, so the phone is exactly the screen it was: the switch, the wordmark,
 * the tagline and the card, in that order. Nothing here is loaded conditionally — the
 * markup is in the HTML a phone receives, `hidden` keeps it out of the layout and out of
 * the accessibility tree — because a media query cannot decide what a server renders and
 * this panel costs a few hundred bytes, not a round trip.
 *
 * THREE LINES AND NO MORE. A login form is not where anybody reads a specification, and
 * the three are the three jobs the product is for — the register, the money, and the
 * families — which is also how the app's own navigation is grouped. The copy is the
 * dictionary's, so the panel speaks the same language as the form beside it, including
 * when the reader switched it on this very screen.
 *
 * `bg-brand-700` with `brand-100` text rather than white: 8.9:1 rather than 17:1, which
 * matters less than the fact that a pure-white panel beside a white card is one wide
 * screen of nothing. `brand-700` is the same green the primary button uses, so the first
 * screen already shows the colour every action in the product wears.
 */
export function AuthBrandPanel({ t }: { t: Dictionary['auth']['brand'] }) {
  return (
    <aside
      className="hidden bg-brand-700 px-12 py-12 lg:flex lg:flex-col
        lg:justify-between print:hidden"
    >
      <Logo tone="inverse" className="text-xl" />

      <div className="max-w-md">
        <p className="text-2xl font-bold leading-snug text-white">{t.headline}</p>

        <ul className="mt-7 flex flex-col gap-4">
          {[t.attendance, t.money, t.families].map((line) => (
            <li key={line} className="flex gap-3 text-brand-100">
              {/* A dot and not a tick: a tick is a claim about something having been
                  done, and nothing has happened yet on a login screen. */}
              <span
                aria-hidden
                className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-brand-200">{t.note}</p>
    </aside>
  )
}
