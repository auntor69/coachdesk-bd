'use client'

/**
 * The gate. Two buttons, neither of them pre-selected.
 *
 * This is the only screen in the product where a tap spends the centre's money
 * and reaches forty families at once, so it is built to be read before it is
 * tapped: the recipient count, the exact credit cost, and one real message with
 * a real student's name in it, all visible above the buttons.
 *
 * Both buttons are the same size and weight on purpose. A big green "send" next
 * to a grey "not now" is a nudge, and nudging someone into spending credits on a
 * test the whole batch failed is not our call to make. Declining is recorded so
 * the question is asked once, not every time the exam is opened, and it stays
 * reversible — the send stays available afterwards.
 */
import { useActionState } from 'react'

import { Alert, Button } from '@/components/ui'
import type { T } from '@/lib/i18n'
import {
  declineResultSms,
  sendResultSms,
  type SmsGateState,
} from '../actions'

/**
 * The one real message, written by the page.
 *
 * `heading` and `segmentNote` arrive finished rather than as a name and a number,
 * for the same reason `lines` below does — and because the page has the student's
 * name to hand anyway.
 */
export type GatePreview = {
  heading: string
  body: string
  segmentNote: string
}

/**
 * Every sentence on this screen with a figure in it, resolved by the page.
 *
 * "40 guardians" and "1 guardian", "12 credits" and "1 credit": English inflects
 * on every count here, and a client component may not be handed a dictionary
 * function (see `T` in lib/i18n). Templates filled in the browser would work for
 * Bangla and produce "1 guardians" in English, so these are written on the server
 * where the plural can branch.
 *
 * Written unconditionally, including the ones this render will not show. Eight
 * short strings cost less than the confusion of a nullable line whose emptiness
 * means two different things.
 */
export type GateLines = {
  recipients: string
  cost: string
  balance: string
  shortfall: string
  withoutMarks: string
  noPhone: string
  optedOut: string
  notesTrimmed: string
}

export function SmsGate({
  examId,
  recipientCount,
  creditCost,
  balance,
  preview,
  skippedOptedOut,
  skippedNoPhone,
  withoutMarks,
  notesTrimmed,
  anyMultiSegment,
  alreadySentAt,
  declinedAt,
  providerLive,
  canSend,
  t,
  common,
  lines,
}: {
  examId: string
  recipientCount: number
  creditCost: number
  balance: number
  preview: GatePreview | null
  skippedOptedOut: number
  skippedNoPhone: number
  withoutMarks: number
  /** How many teachers' notes were dropped to keep a message to one segment. */
  notesTrimmed: number
  anyMultiSegment: boolean
  alreadySentAt: string | null
  declinedAt: string | null
  providerLive: boolean
  canSend: boolean
  t: T<'smsGate'>
  common: T<'common'>
  lines: GateLines
}) {
  const [sendState, sendAction, sending] = useActionState<SmsGateState, FormData>(
    sendResultSms,
    null,
  )
  const [declineState, declineAction, declining] = useActionState<
    SmsGateState,
    FormData
  >(declineResultSms, null)

  // The success shape carries the finished sentence, so its presence *is* "sent".
  // Kept as one derived value rather than a boolean plus a second narrowing at
  // the point of use, which needed a non-null assertion to convince tsc.
  const sentMessage =
    sendState?.ok === true && 'message' in sendState ? sendState.message : null
  const justDeclined = declineState?.ok === true && 'declined' in declineState
  const error =
    sendState?.ok === false
      ? sendState.error
      : declineState?.ok === false
        ? declineState.error
        : null

  // Already delivered, this visit or a previous one. Nothing left to decide.
  if (alreadySentAt || sentMessage) {
    return (
      <section
        className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-5"
        aria-labelledby="sms-sent-heading"
      >
        <h2 id="sms-sent-heading" className="font-bold text-brand-800">
          {t.sentTitle}
        </h2>
        {sentMessage && (
          <p className="num mt-1 text-sm font-semibold text-brand-800">
            {sentMessage}
          </p>
        )}
        {!providerLive && (
          <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm text-ink-soft">
            {t.queuedNote}
          </p>
        )}
      </section>
    )
  }

  if (!canSend) {
    return (
      <section className="rounded-2xl border border-line bg-surface-alt p-5">
        <h2 className="font-semibold text-ink">{t.resultSms}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.noPermission}</p>
      </section>
    )
  }

  if (recipientCount === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface-alt p-5">
        <h2 className="font-semibold text-ink">{t.resultSms}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {withoutMarks > 0 ? t.saveMarksFirst : t.noNumbers}
        </p>
        {skippedNoPhone > 0 && (
          <p className="num mt-2 text-sm text-ink-faint">{lines.noPhone}</p>
        )}
      </section>
    )
  }

  const shortfall = creditCost - balance

  return (
    <section
      className="rounded-2xl border-2 border-brand-300 bg-white p-5"
      aria-labelledby="sms-gate-heading"
    >
      <h2 id="sms-gate-heading" className="text-lg font-bold text-ink">
        {t.askTitle}
      </h2>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-alt px-3 py-2">
          <dt className="text-xs text-ink-soft">{t.willGoTo}</dt>
          <dd className="num text-xl font-bold text-ink">{lines.recipients}</dd>
        </div>
        <div className="rounded-xl bg-surface-alt px-3 py-2">
          <dt className="text-xs text-ink-soft">{t.cost}</dt>
          <dd className="num text-xl font-bold text-ink">{lines.cost}</dd>
        </div>
      </dl>

      <p className="num mt-2 text-sm text-ink-soft">
        {lines.balance}
        {shortfall > 0 && (
          <span className="font-semibold text-absent"> · {lines.shortfall}</span>
        )}
      </p>

      {/* A real message with a real name. An owner approving "a result SMS" in
          the abstract has not actually seen what a parent will read. */}
      {preview && (
        <div className="mt-4">
          <p className="text-sm font-medium text-ink">{preview.heading}</p>
          <blockquote
            className="mt-1.5 rounded-xl rounded-bl-sm border border-line
              bg-surface-alt px-3 py-2 text-[15px] leading-relaxed text-ink"
          >
            {preview.body}
          </blockquote>
          <p className="num mt-1 text-xs text-ink-faint">{preview.segmentNote}</p>
        </div>
      )}

      {anyMultiSegment && (
        <p className="mt-3 rounded-xl bg-surface-alt px-3 py-2 text-sm text-ink-soft">
          {t.longNote}
        </p>
      )}

      {(skippedOptedOut > 0 ||
        skippedNoPhone > 0 ||
        withoutMarks > 0 ||
        notesTrimmed > 0) && (
        <ul className="num mt-3 flex flex-col gap-1 text-sm text-ink-faint">
          {/* First, because it is the only one of these the owner can still act
              on before tapping send — the marks sheet is directly above. */}
          {notesTrimmed > 0 && <li>{lines.notesTrimmed}</li>}
          {withoutMarks > 0 && <li>{lines.withoutMarks}</li>}
          {skippedNoPhone > 0 && <li>{lines.noPhone}</li>}
          {skippedOptedOut > 0 && <li>{lines.optedOut}</li>}
        </ul>
      )}

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {(declinedAt || justDeclined) && (
        <p className="mt-4 rounded-xl bg-surface-alt px-3 py-2 text-sm text-ink-soft">
          {t.declined}
        </p>
      )}

      {/* Two forms rather than one, so each button posts to its own action and
          neither can be triggered by the browser's default-submit behaviour. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <form action={sendAction}>
          <input type="hidden" name="examId" value={examId} />
          <Button type="submit" full disabled={sending || declining || shortfall > 0}>
            {sending ? t.sending : t.send}
          </Button>
        </form>

        <form action={declineAction}>
          <input type="hidden" name="examId" value={examId} />
          <Button
            type="submit"
            variant="secondary"
            full
            disabled={sending || declining}
          >
            {declining ? common.saving : t.decline}
          </Button>
        </form>
      </div>

      <p className="mt-3 text-center text-xs text-ink-faint">{t.noUndo}</p>
    </section>
  )
}
