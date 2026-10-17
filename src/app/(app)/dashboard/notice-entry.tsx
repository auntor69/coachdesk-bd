import Link from 'next/link'

import type { Dictionary } from '@/lib/i18n'

/**
 * The way into the noticeboard, on the owner's home screen.
 *
 * No number on it, unlike `ProgressEntry` and `ReminderEntry` beside it, and that is
 * the honest difference between the three errands rather than an omission. Those two
 * are worklists: the product knows how many families are owed a message and the count
 * is what gets the owner to open them. Nothing tells anybody that the room will be shut
 * on Thursday — only the owner knows that — so a count here would either be the number
 * of notices already sent, which is not a reason to open anything, or a zero that reads
 * as a feature with nothing in it.
 *
 * So it is a door with a sentence, and the sentence is doing the work a count does
 * elsewhere: an owner who has never thought to use the app for this has to be told what
 * it is for, once, where they already are.
 *
 * `Dictionary['notices']` and not `T<'notices'>`: a server component, so it can take
 * the group as it is.
 */
export function NoticeEntry({ t }: { t: Dictionary['notices'] }) {
  return (
    <Link
      href="/notices"
      // `hover:` only ever fires where there is a pointer, so this costs the phone
      // nothing and tells a desktop reader that the card is the link it looks like.
      className="flex min-h-tap items-center justify-between gap-3 rounded-xl
        border border-line bg-white px-4 py-3 transition-colors
        hover:border-brand-300 hover:bg-brand-50/40"
    >
      <span>
        <span className="font-medium text-ink">{t.title}</span>
        <span className="block text-sm text-ink-faint">{t.lead}</span>
      </span>
      <span className="shrink-0 text-ink-faint">→</span>
    </Link>
  )
}
