import type { Dictionary } from '@/lib/i18n'

/**
 * What a lapsed centre gets where a form would have been.
 *
 * §4.4 makes read-only a discomfort rather than a locked door: every register, mark and
 * fee still reads, and what stops is saving. `requireWritable` is the fence and the
 * shell's banner is the explanation — but between them sat a gap nobody had closed. A
 * manager opening Add Student got the whole form, twelve fields wide, and learned the
 * subscription had lapsed by filling it in and pressing save. That is the same defect as
 * a crumb to a screen the reader cannot open, and it is worse here, because the family
 * is at the desk while it happens.
 *
 * WHY THE FORM GOES RATHER THAN GREYING OUT. A disabled form is still a form: it invites
 * the reader to try, and on a phone a `disabled` fieldset looks like a slow page. And
 * disabling client-side is not the check either — `requireWritable` is, in front of every
 * action in the module. This draws what is true instead.
 *
 * ONE SENTENCE, NOT THE WHOLE STORY. The banner at the top of the same screen already
 * says which of the two states this is, when the coverage ran out and what to do — with
 * the buttons. Repeating that in a card next to it would be two asks competing, and the
 * banner is the one with the door in it. So this says the fact the reader is standing on
 * and points up.
 *
 * Neither tinted nor `role="alert"`: the banner above is the alert, and a second red box
 * for the same fact reads as two separate things going wrong.
 */
export function ReadOnlyNote({
  t,
  className = '',
}: {
  /** `Dictionary['readOnly']`, so a caller passes `d.readOnly` and nothing else. */
  t: Dictionary['readOnly']
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-line bg-surface-alt p-5 ${className}`}>
      <p className="font-medium text-ink">{t.noFormTitle}</p>
      <p className="mt-1 text-sm text-ink-soft">{t.noFormBody}</p>
    </div>
  )
}
