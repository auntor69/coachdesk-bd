'use client'

/**
 * The founder's recharge queue — MASTERPLAN §11.9 step 7, build-order step 25's second
 * half: the human who opens their own bKash, checks the transfer, and credits what
 * actually arrived.
 *
 * WHY IT IS THE FIRST BLOCK UNDER THE FIGURES. Every other card on /founder is
 * orientation — the bill, the usage, whether a centre has gone quiet. This one is money a
 * customer says they have already sent us, sitting in the founder's own account with
 * nothing recorded against it, and the centre's balance is not moving while it waits. A
 * claim is also the only thing here that a customer is actively waiting on rather than a
 * figure the founder is reading, which is the same reason `CenterPurchases` is above the
 * phone number.
 *
 * TWO FORMS PER CLAIM, and that is not tidiness. Approving names an amount and rejecting
 * names a reason: one form would mean the reason `<select>` rides along on the credit, so a
 * founder typing what arrived would also be filing whichever reason the dropdown happened
 * to be showing — precisely the mistake `center-billing.tsx` separates its three forms for.
 * Two sibling forms, two `useActionState`s, two independent messages.
 *
 * EVERY DYNAMIC SENTENCE IS COMPOSED ON THE SERVER. `words` is strings only and every line
 * above the fields — the centre and its size, what was sent and when, the TrxID and the
 * sender, the quote and its bonus — arrives finished, because `RechargeWords` carries
 * functions and a group with a function in it cannot cross this boundary at all. So this
 * file has no dictionary import, no `formatTaka` and no date formatting: there is nothing
 * here to interpolate.
 *
 * THE REJECT BUTTON HAS NO PROGRESS WORD and does not get one invented. §11.9's vocabulary
 * has `approving` for the credit and nothing for the refusal, so that button greys out
 * while it is in flight instead of relabelling — which is the honest treatment of a second
 * tap anyway, since a rejection in flight is the one thing here that must not be sent
 * twice.
 */

import { useActionState } from 'react'

import { Alert, Button, Card, Field } from '@/components/ui'
import { REJECT_REASONS } from '@/lib/i18n/recharge'
import { MAX_LABEL, MAX_TEXT } from '@/lib/limits'
import { Select } from './center-billing'
import {
  approveRechargeClaim,
  rejectRechargeClaim,
  type FounderState,
} from './actions'

/**
 * The labels, and the one group of sentences this card owns.
 *
 * String leaves only, for the reason `BillingWords` gives: a group carrying a function
 * cannot be handed to a client component at all, so the page passes these by hand and the
 * four reasons travel as a record rather than as the dictionary's `reason` function-shaped
 * neighbours.
 */
export type QueueWords = {
  queueTitle: string
  queueBody: string
  queueEmpty: string
  queueUnreadable: string
  arrivedLabel: string
  arrivedHint: string
  approve: string
  approving: string
  reject: string
  reasonLabel: string
  noteLabel: string
  /** The four reasons as the `<select>` prints them, keyed by the value it posts. */
  reasons: Record<(typeof REJECT_REASONS)[number], string>
}

/** One waiting claim, with every sentence in it composed by the page. */
export type QueueClaim = {
  id: string
  /** "Mirpur Coaching · 180 students · 8 teachers" — the size it was quoted at. */
  centre: string
  /** "৳7,800 sent 3 September". */
  sent: string
  /** "Quoted ৳7,800, bonus ৳390". */
  quoted: string
  /** "TrxID 9H7K2M from 01712345678". */
  trx: string
  /** What they said they sent, in whole taka, as the arrived field's only hint. */
  quotedTaka: string
}

export function RechargeQueue({
  claims,
  words,
}: {
  /** Null is the failed read; `[]` is the honest empty queue. See `founderQueue`. */
  claims: QueueClaim[] | null
  words: QueueWords
}) {
  return (
    <Card className="border-2 border-late/40 bg-late/5">
      <h2 className="font-semibold text-ink">{words.queueTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{words.queueBody}</p>

      {claims === null ? (
        // Not "nothing is waiting". A queue nobody could read and an empty queue are
        // opposite pieces of advice, and the founder acts on this one today.
        <p className="mt-2 text-sm font-medium text-absent">{words.queueUnreadable}</p>
      ) : claims.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{words.queueEmpty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {claims.map((claim) => (
            <li
              key={claim.id}
              className="border-t border-late/30 pt-3 first:border-0 first:pt-0"
            >
              <Claim claim={claim} words={words} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Claim({ claim, words }: { claim: QueueClaim; words: QueueWords }) {
  const [credited, approve, approving] = useActionState<FounderState, FormData>(
    approveRechargeClaim,
    null,
  )
  const [closed, reject, rejecting] = useActionState<FounderState, FormData>(
    rejectRechargeClaim,
    null,
  )

  // Unique across the page and not only across this form: eleven claims holding an input
  // named `arrived` would otherwise share one `id`, and eleven `<label for>`s would all
  // point at the first one. Same reason as `fid` in ./center-billing.tsx.
  const fid = (name: string) => `${name}-${claim.id}`

  // Both buttons are held down while either call is in flight: the two decisions are
  // mutually exclusive, and the one that must not race the other is a rejection landing on
  // a claim this same card has just credited.
  const busy = approving || rejecting

  return (
    <>
      <p className="font-semibold text-ink">{claim.centre}</p>
      <p className="mt-0.5 text-sm text-ink-soft">{claim.sent}</p>
      <p className="text-sm text-ink-soft">{claim.quoted}</p>
      <p className="num mt-0.5 text-xs text-ink-faint">{claim.trx}</p>

      {credited?.error && (
        <div className="mt-2">
          <Alert>{credited.error}</Alert>
        </div>
      )}
      {/* Shown until the re-render lands, so a tap on a slow connection is never silent.
          `revalidatePath` takes the whole claim out of the queue once it arrives. */}
      {credited?.ok && (
        <p role="status" className="mt-1 text-sm font-medium text-brand-700">
          {credited.ok}
        </p>
      )}
      {closed?.error && (
        <div className="mt-2">
          <Alert>{closed.error}</Alert>
        </div>
      )}
      {closed?.ok && (
        <p role="status" className="mt-1 text-sm font-medium text-ink-soft">
          {closed.ok}
        </p>
      )}

      <form action={approve} className="mt-2 flex flex-col gap-3">
        <input type="hidden" name="claimId" value={claim.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Blank credits the quote, so the placeholder is that figure and the value is
              nothing: what arrives is read off a bKash statement, and a box the founder
              does not have to clear is one they do not have to notice is wrong. */}
          <Field
            label={words.arrivedLabel}
            hint={words.arrivedHint}
            id={fid('arrived')}
            name="arrived"
            inputMode="numeric"
            autoComplete="off"
            placeholder={claim.quotedTaka}
            maxLength={MAX_LABEL}
            className="num"
          />

          <Field
            label={words.noteLabel}
            id={fid('note')}
            name="note"
            maxLength={MAX_TEXT}
            autoComplete="off"
          />
        </div>

        <Button type="submit" disabled={busy}>
          {approving ? words.approving : words.approve}
        </Button>
      </form>

      <form action={reject} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="claimId" value={claim.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          {/* The first reason rather than a blank: a founder who rejects without reading
              the dropdown at least files the one that means "we could not find it", which
              is the commonest answer and the one the customer can act on. */}
          <Select
            label={words.reasonLabel}
            id={fid('reason')}
            name="reason"
            defaultValue={REJECT_REASONS[0]}
          >
            {REJECT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {words.reasons[reason]}
              </option>
            ))}
          </Select>

          {/* Beside the reason and not only on the approval, because `other` is the value
              that means nothing on its own — "ring us and we will explain" is the sentence
              the customer reads, and the note is where the founder writes down what was
              actually agreed. */}
          <Field
            label={words.noteLabel}
            id={fid('reason-note')}
            name="note"
            maxLength={MAX_TEXT}
            autoComplete="off"
          />
        </div>

        <Button type="submit" variant="secondary" disabled={busy}>
          {words.reject}
        </Button>
      </form>
    </>
  )
}
