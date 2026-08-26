'use client'

/**
 * The tap target both chase-chip families are made of, and the one that copies.
 *
 * ChaseChips and ProgressChips stay separate components for the reason each of them
 * gives: they differ in what the message says and which table remembers it, and a
 * component taking a message builder and a logger as props would be two features
 * wearing one name. What they do share is the surface — the same chip, in the same
 * order, doing the same thing to the same phone — and that is what lives here, so
 * that a change to how a chase looks cannot land on one screen and miss the other.
 *
 * WHY A COPY BUTTON IS A CHASE CHIP AT ALL. On a laptop `sms:` and `tel:` open
 * nothing, and the honest desktop version of "text this family" is to put the
 * message where the owner's phone can reach it. That is a different control rather
 * than a disabled one: removing the chips would give the product different features
 * at the desk and in the classroom, and a warning would interrupt the owner who has
 * a softphone and for whom `tel:` works perfectly. See ../lib/pointer.ts for who
 * gets which, and why the answer is a media query.
 */
import { useState } from 'react'

import { copyText } from '@/lib/clipboard'

/**
 * Everything every chip shares. `min-h-tap` and not a fixed height: these are
 * pressed with a thumb in a corridor between classes, and the row they sit in
 * already knows how much space it has.
 */
const BASE =
  'inline-flex min-h-tap items-center rounded-xl border-2 px-4 font-medium' +
  ' transition-colors'

/** The default. Three of these, or two of these beside one of the below. */
const CHIP = `${BASE} border-line text-ink-soft active:bg-brand-50`

/**
 * The one the owner marked as how this family is actually reachable.
 *
 * These used to be deliberately identical, on the grounds that which channel a
 * family reads is the centre's knowledge and not something for us to rank. That
 * still holds — and is exactly why one of them is now coloured, because the centre
 * has somewhere to write that knowledge down (students.preferred_channel) and this
 * is it being read back. Nothing here infers anything.
 *
 * It carries its weight twice. It says "this is the one that works for this family",
 * and it is the chip ../lib/students/channel.ts has moved to the front — so the
 * button in an unfamiliar position is also the button that looks different, which
 * is what keeps a thumb working down a long list from tapping the wrong one.
 */
const LEAD_CHIP =
  `${BASE} border-brand-500 bg-brand-50 text-brand-800 active:bg-brand-100`

/**
 * Which of the two. `chipClass` is exported and the two constants are not, so that
 * a screen rendering a chase chip has to answer "is this the marked one?" — passing
 * `false` is a decision, where reaching for a bare class name would have been a
 * chip that silently ignores the family's preference.
 */
export function chipClass(lead: boolean): string {
  return lead ? LEAD_CHIP : CHIP
}

/**
 * `hover:` and a hand cursor, added only for the copy chips. They render on exactly
 * the devices where both mean something — Tailwind v4's preflight gives a `<button>`
 * `cursor: default`, which on the one control a desktop owner has would read as
 * decoration.
 */
const COPY_CHIP = `${CHIP} cursor-pointer hover:bg-brand-50`
const LEAD_COPY_CHIP = `${LEAD_CHIP} cursor-pointer hover:bg-brand-100`

/** How long the chip says it copied before going back to offering to. */
const CONFIRM_MS = 2500

/**
 * A chip that puts `text` on the clipboard and tells the owner it did.
 *
 * `onCopied` fires only on a real copy, and that is the whole point of the boolean
 * coming back from `copyText`. Both callers use it to write a row saying this family
 * was chased, and a row written when nothing reached the clipboard is precisely the
 * false record the dead `sms:` link used to leave — the family would then drop off
 * the worklist for its cooldown on the strength of a message that never existed.
 *
 * `hint` is a `title`, which is a mouse-only tooltip and therefore exactly right: it
 * is the sentence explaining that the sending still happens on the phone, and this
 * chip only ever exists on a device with a pointer to hover.
 */
export function CopyChip({
  text,
  label,
  hint,
  copied,
  failed,
  lead = false,
  onCopied,
}: {
  text: string
  label: string
  hint: string
  copied: string
  failed: string
  /** True on the channel the owner marked — see LEAD_CHIP. */
  lead?: boolean
  onCopied: () => void
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function run() {
    const ok = await copyText(text)
    // Set from the click, not from an effect — `react-hooks/set-state-in-effect`
    // aside, this is a state change caused by an event, which is where it belongs.
    setState(ok ? 'copied' : 'failed')
    if (ok) onCopied()
    // Back to the offer, so a second row copied a minute later still reads as a
    // fresh action rather than as a tick left over from the first.
    window.setTimeout(() => setState('idle'), CONFIRM_MS)
  }

  return (
    <button
      type="button"
      onClick={() => {
        void run()
      }}
      title={hint}
      className={lead ? LEAD_COPY_CHIP : COPY_CHIP}
    >
      {state === 'copied' ? copied : state === 'failed' ? failed : label}
    </button>
  )
}
