'use client'

/**
 * One salary agreement, with the way to stop it behind a tap.
 *
 * A CARD AND NOT A TABLE ROW, which /payroll's own note argues at length: seven facts and
 * a verb, and the verb needs a sentence beside it before it is pressed. This is where the
 * sentence lives.
 *
 * STOPPING IS THE ONLY VERB HERE. There is no edit, because a rise is a new agreement and
 * the trigger retires the old one — see ./terms-form.tsx — and no delete, because a
 * browser session has never had DELETE on this table: what was agreed and when is the
 * record that makes last April's salary explicable, and every payment already made hangs
 * off this row.
 *
 * THE CONFIRMATION IS THE ROW LEAVING, not a message, exactly as CancelBill has it. The
 * page reads live agreements only, so this component unmounts with its `useActionState`
 * inside it the moment the revalidation lands, and there is nowhere for a "done" line to
 * live. An error is different — it means nothing moved — so a refusal keeps the panel open
 * and shows why.
 */
import { useActionState, useState } from 'react'

import { Alert, Button } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { stopSalaryTerms, type PayrollState } from './actions'

export function TermsRow({
  termsId,
  name,
  job,
  gone,
  offLabel,
  figure,
  meta,
  note,
  canWrite,
  t,
}: {
  termsId: string
  /** Already coalesced by the page: `common.unknown` where no name could be put to it. */
  name: string
  /** The centre's own word for the job, or `payroll.teacherJob`. Decided by the page. */
  job: string
  /** Their staff row is switched off and this agreement is not. See the page. */
  gone: boolean
  offLabel: string
  /**
   * What the row prints as the money: a month's net, or a rate with the words "per class"
   * in it. Built by the page, because both shapes of it take an argument and `T` maps a
   * function leaf to `never` — and because a bare ৳350 beside a ৳13,000 is a teacher who
   * looks very cheap.
   */
  figure: string
  /** How the salary is worked out and the day it began, joined with ' · ' by the page. */
  meta: string
  note: string | null
  /**
   * False on a centre whose subscription has lapsed, which keeps the bill and loses every
   * verb on it. `requireWritable` is in front of the action either way; this is so the
   * owner does not learn the state of their subscription from a refused confirm dialog.
   */
  canWrite: boolean
  t: T<'salaryRow'>
}) {
  const [state, action, pending] = useActionState<PayrollState, FormData>(
    stopSalaryTerms,
    null,
  )
  const [asking, setAsking] = useState(false)

  return (
    <li className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className="truncate">{name}</span>
            {/* The warning colour and not the staff list's grey. There, somebody switched
                off is history; here their agreement is still live and still in the total
                the rail prints, which makes the badge a fault rather than a fact. */}
            {gone && (
              <span
                className="shrink-0 rounded-full bg-late/5 px-2 py-0.5 text-xs
                  font-semibold text-late"
              >
                {offLabel}
              </span>
            )}
          </p>
          <p className="truncate text-sm text-ink-soft">{job}</p>
          <p className="text-sm text-ink-faint">{meta}</p>
        </div>

        {/* On the right and bold, because a wage bill is read down that column: twenty
            names get scanned for the one figure that looks wrong. `shrink-0` so it is the
            name that truncates on a narrow phone and never the money. */}
        <p className="num shrink-0 font-bold text-ink">{figure}</p>
      </div>

      {/* Only when they wrote one. A blank line under a row reads as a rendering fault
          rather than as "there was nothing to say". */}
      {note && <p className="mt-2 text-sm text-ink-soft">{note}</p>}

      {/* On the row as well as in the rail, and deliberately not the same sentence. The
          count beside the bill says how many there are; this says what this one is, next to
          the verb that answers it. */}
      {gone && (
        <p
          className="mt-2 rounded-lg border border-late/30 bg-late/5 px-3 py-2 text-sm
            text-ink"
        >
          {t.goneHint}
        </p>
      )}

      {canWrite &&
        (!asking ? (
          <div className="mt-3 border-t border-line pt-3">
            {/* An error survives here because nothing moved: the agreement is still live,
                so the row is still on the page to show it. */}
            {state?.error && <Alert>{state.error}</Alert>}
            {/* A plain underlined word and not a button, for CancelBill's reason: the wide
                buttons in this app do the thing the screen is for, and this screen is for
                reading a wage bill. */}
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="inline-flex min-h-tap items-center text-sm text-ink-faint
                underline"
            >
              {t.open}
            </button>
          </div>
        ) : (
          <form
            action={action}
            className="mt-3 flex flex-col gap-3 border-t border-line pt-3"
          >
            <input type="hidden" name="termsId" value={termsId} />

            <div>
              <p className="font-medium text-ink">{t.heading}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.warning}</p>
            </div>

            {state?.error && <Alert>{state.error}</Alert>}

            {/* Keep-it first and full width, stop second and narrow — CancelBill's note:
                the habit this app builds is "the wide button at the bottom is the one you
                press", and a confirm step is the worst place to break it. So the wide one
                here is the one that changes nothing. */}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAsking(false)}
                full
              >
                {t.keep}
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? t.stopping : t.confirm}
              </Button>
            </div>
          </form>
        ))}
    </li>
  )
}
