'use client'

/**
 * The founder's two levers, on one customer's card — MASTERPLAN §11.7, step 26.
 *
 * TWO FORMS AND NOT ONE, for the reason ./center-billing.tsx gives about the credit: money
 * and days are different facts, and a shared submit means the days field rides along on an
 * adjustment. A founder moving ৳3,000 onto a balance must not grant eleven days in the same
 * tap because the other field happened to hold a number.
 *
 * THE DAYS FORM SHOWS THE DATE BEFORE THE TAP, which is the one thing on this screen that
 * could not be composed on the server: it changes as the founder types. `lib/i18n/fill.ts`
 * fills `{date}`, `lib/billing/levers.ts` works the date out, and the Server Action's answer
 * — composed from what the database actually wrote — replaces it a moment later. Two engines
 * and one arithmetic: `tests/founder-levers.test.ts` holds them together, the way
 * `tests/recharge-quote.test.ts` holds the bonus ladder to its SQL.
 *
 * `line` AND `today` COME FROM THE SERVER, not from the browser: the line is a column on the
 * customer's own row and the day is Dhaka's, and a preview built from the founder's laptop
 * clock would be wrong for whoever is six time zones away.
 */

import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { grantReach, parseDays } from '@/lib/billing/levers'
import { formatDate } from '@/lib/bd/time'
import { fill } from '@/lib/i18n/fill'
import type { Locale } from '@/lib/i18n/locale'
import type { LeverLabels } from '@/lib/i18n/levers'
import { MAX_TEXT } from '@/lib/limits'
import { adjustCenterBalance, grantCenterDays, type FounderState } from './actions'

export function CenterLevers({
  centerId,
  line,
  today,
  locale,
  labels,
}: {
  centerId: string
  /** The centre's `charged_through`: the last day that is paid for (§11.7). */
  line: string
  /** The Dhaka calendar day, as the server resolved it. Never the browser's clock. */
  today: string
  locale: Locale
  labels: LeverLabels
}) {
  const [grantState, grantAction, granting] = useActionState<FounderState, FormData>(
    grantCenterDays,
    null,
  )
  const [adjustState, adjustAction, adjusting] = useActionState<FounderState, FormData>(
    adjustCenterBalance,
    null,
  )

  // The days box is controlled, and it is the only controlled field on this screen: what is
  // typed here changes another sentence on the page, so the value has to be readable during
  // render. Money stays uncontrolled — nothing under it moves as it is typed.
  //
  // The number is kept WITH the answer it was typed under, which is what makes the clearing
  // below a comparison rather than an effect: `answered` is true exactly when the action has
  // come back since the last keystroke.
  const [draft, setDraft] = useState<{ text: string; under: FounderState }>({
    text: '',
    under: null,
  })

  /*
   * The days box clears itself once a grant has landed, and only then.
   *
   * IT USED TO CLEAR ON SUBMIT, WHICH IS THE WRONG MOMENT TWICE OVER. A refusal — a number
   * `parseDays` will not take, a reason left blank — emptied the box before the action had
   * answered, so the founder retyped a figure the screen had just thrown away; and a tap
   * whose only visible effect is the field going blank is how the same thirty days gets
   * granted a second time. That is not hypothetical: this centre's line carries two
   * identical thirty-day grants made thirty-six minutes apart. Same rule
   * `./settings/billing/recharge-form.tsx` follows — a refusal leaves what was typed alone.
   *
   * `days` IS DERIVED, not stored and then cleared from an effect. Two states that disagree
   * for one render are how a cleared box flickers back for a frame, and a `setState` inside
   * an effect is a second render this screen does not need: the value is a question with the
   * answer it belongs to, and "this text was typed after the last answer" is the whole rule.
   * A success is a new question, so the box is empty; a refusal is the same question, so the
   * text is still there. Typing re-pairs the text with the answer on screen, which is what
   * keeps a refusal from clearing what is being retyped.
   */
  const answered = draft.under !== grantState
  const days = answered && grantState?.ok ? '' : draft.text
  const parsed = parseDays(days)

  /*
   * The preview, and it says nothing at all when the box holds something unreadable. A blank
   * where a date would be is the honest answer to "3.5 days" — a date computed from a number
   * we refused would be a promise the write then declines to keep.
   */
  const reach =
    parsed === null
      ? null
      : fill(labels.reaches, { date: formatDate(grantReach(line, parsed, today), locale) })

  // Unique DOM ids, because eleven customer cards each hold a field named `amount` — the same
  // reason `fid()` exists next door.
  const fid = (name: string) => `${name}-levers-${centerId}`

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4">
      {/* -------------------------------------------------------------------- */}
      {/* The days                                                             */}
      {/* -------------------------------------------------------------------- */}
      <form action={grantAction} className="flex flex-col gap-3">
        <input type="hidden" name="centerId" value={centerId} />
        <p className="font-semibold text-ink">{labels.grantTitle}</p>
        <p className="text-sm text-ink-soft">{labels.grantHint}</p>

        {grantState?.error && <Alert>{grantState.error}</Alert>}
        {grantState?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {grantState.ok}
          </p>
        )}

        <Field
          label={labels.days}
          hint={labels.daysHint}
          id={fid('days')}
          name="days"
          type="text"
          inputMode="numeric"
          value={days}
          onChange={(event) => setDraft({ text: event.target.value, under: grantState })}
          required
          maxLength={4}
          className="num"
        />

        {/* The date it reaches, redrawn as the number moves. `role="status"` so a screen
            reader hears it change rather than finding it later, and it is drawn above the
            button because it is what the button is about to do. */}
        {reach !== null && (
          <p role="status" className="num text-sm font-medium text-ink">
            {reach}
          </p>
        )}

        <Field
          label={labels.reason}
          hint={labels.reasonHint}
          id={fid('grantReason')}
          name="reason"
          required
          maxLength={MAX_TEXT}
        />

        <Button type="submit" disabled={granting} full>
          {granting ? labels.granting : labels.grant}
        </Button>
      </form>

      {/* -------------------------------------------------------------------- */}
      {/* The balance                                                          */}
      {/* -------------------------------------------------------------------- */}
      <form action={adjustAction} className="flex flex-col gap-3 border-t border-line pt-4">
        <input type="hidden" name="centerId" value={centerId} />
        <p className="font-semibold text-ink">{labels.adjustTitle}</p>
        <p className="text-sm text-ink-soft">{labels.adjustHint}</p>

        {adjustState?.error && <Alert>{adjustState.error}</Alert>}
        {adjustState?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {adjustState.ok}
          </p>
        )}

        <Field
          label={labels.adjustAmount}
          hint={labels.adjustAmountHint}
          id={fid('adjustAmount')}
          name="amount"
          // Not type="number": it refuses Bangla digits and a leading minus reads as a
          // spinner state rather than as a sign. `parseTaka` reads both.
          type="text"
          inputMode="decimal"
          required
          maxLength={12}
          className="num"
        />

        <Field
          label={labels.reason}
          hint={labels.reasonHint}
          id={fid('adjustReason')}
          name="reason"
          required
          maxLength={MAX_TEXT}
        />

        <Button type="submit" variant="secondary" disabled={adjusting} full>
          {adjusting ? labels.adjusting : labels.adjust}
        </Button>
      </form>
    </div>
  )
}
