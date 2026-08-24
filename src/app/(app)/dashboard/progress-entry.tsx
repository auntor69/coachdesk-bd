import Link from 'next/link'

import type { Dictionary } from '@/lib/i18n'

/**
 * The way into the week's roster, on the owner's home screen.
 *
 * A link with a number on it rather than the list itself, for the reason
 * `ReminderEntry` gives about its own: nobody opens a screen to find out whether
 * they need to open it, and this errand is weekly rather than daily — an owner who
 * has to remember it will not do it. The count is what makes the door work, and it
 * comes from `progressToTell`, which is the same decision the page lists by, so this
 * cannot promise twelve families and deliver three.
 *
 * Shown at zero on purpose, unlike the at-risk card. "Everyone has been told" is the
 * answer an owner came for; an absent card would read as a feature that broke.
 *
 * `Dictionary['progress']` and not `T<'progress'>`: a server component, so it can
 * take the group as it is, functions and all.
 */
export function ProgressEntry({
  toTell,
  t,
}: {
  toTell: number
  t: Dictionary['progress']
}) {
  return (
    <Link
      href="/progress"
      className="flex min-h-tap items-center justify-between gap-3 rounded-xl
        border border-line bg-white px-4 py-3"
    >
      <span>
        <span className="font-medium text-ink">{t.title}</span>
        <span className="block text-sm text-ink-faint">
          {toTell > 0 ? (
            <>
              {/* Two nodes rather than one filled sentence: the number is bold and
                  the words are not, and a count that reads as ordinary text is one
                  an owner scrolling past does not see. Brand rather than the fee
                  worklist's red — this is an opportunity, not a debt. */}
              <span className="num font-medium text-brand-700">{toTell}</span>{' '}
              {t.entryDueSuffix}
            </>
          ) : (
            t.noneTitle
          )}
        </span>
      </span>
      <span className="shrink-0 text-ink-faint">→</span>
    </Link>
  )
}
