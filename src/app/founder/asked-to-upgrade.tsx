'use client'

/**
 * "This centre asked to be put on Centre" — the one thing on the founder panel that
 * came from a customer rather than from counting.
 *
 * ON THE CARD AND NOT BEHIND THE DISCLOSURE. `CenterBilling` hides two forms behind a
 * summary because they are things the founder does to a customer they have already
 * decided to act on; this is the fact that decides which customer that is. A tick-off
 * button buried under "Money and plan" would be one tap past the point of noticing.
 *
 * ITS OWN BUTTON, NOT PART OF THE PLAN FORM. Half of these calls do not end in an
 * upgrade — "next term", "we are shrinking" — and the queue has to empty for those
 * too. See the note on markUpgradeHandled.
 *
 * Every dynamic sentence arrives pre-composed, the same rule the billing forms follow:
 * `words` is string leaves only, and the line naming a plan and a date is built by the
 * page on the server.
 */

import { useActionState } from 'react'

import { Alert, Button } from '@/components/ui'
import { markUpgradeHandled, type FounderState } from './actions'

/** String leaves only — this group is handed to a client component. */
export type AskedWords = {
  markHandled: string
  marking: string
  handled: string
  failed: string
}

export function AskedToUpgrade({
  centerId,
  line,
  note,
  words,
}: {
  centerId: string
  /** "Asked for Centre · 26 August", composed on the server. */
  line: string
  /** What the owner typed with the request, if anything. */
  note: string | null
  words: AskedWords
}) {
  const [state, act, saving] = useActionState<FounderState, FormData>(
    markUpgradeHandled,
    null,
  )

  return (
    <div className="mt-2 rounded-xl border-2 border-brand-500 bg-brand-50 p-3">
      <p className="font-semibold text-brand-800">{line}</p>

      {/* The owner's own words, quoted. Usually empty; when it is not, it is the
          deal — how many students they expect, when they want to start — and it is
          the difference between a cold call and a conversation. */}
      {note && <p className="mt-1 text-sm text-brand-800">“{note}”</p>}

      {state?.error && (
        <div className="mt-2">
          <Alert>{state.error}</Alert>
        </div>
      )}
      {/* Shown until the re-render lands, so a tap on a slow connection is never
          silent. `revalidatePath` removes this block entirely once it arrives. */}
      {state?.ok && (
        <p role="status" className="mt-1 text-sm font-medium text-brand-800">
          {state.ok}
        </p>
      )}

      <form action={act} className="mt-2">
        <input type="hidden" name="centerId" value={centerId} />
        <Button type="submit" variant="secondary" disabled={saving}>
          {saving ? words.marking : words.markHandled}
        </Button>
      </form>
    </div>
  )
}
