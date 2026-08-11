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
import {
  declineResultSms,
  sendResultSms,
  type SmsGateState,
} from '../actions'

export type GatePreview = {
  studentName: string
  phone: string
  body: string
  segments: number
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
  anyMultiSegment,
  alreadySentAt,
  declinedAt,
  providerLive,
  canSend,
}: {
  examId: string
  recipientCount: number
  creditCost: number
  balance: number
  preview: GatePreview | null
  skippedOptedOut: number
  skippedNoPhone: number
  withoutMarks: number
  anyMultiSegment: boolean
  alreadySentAt: string | null
  declinedAt: string | null
  providerLive: boolean
  canSend: boolean
}) {
  const [sendState, sendAction, sending] = useActionState<SmsGateState, FormData>(
    sendResultSms,
    null,
  )
  const [declineState, declineAction, declining] = useActionState<
    SmsGateState,
    FormData
  >(declineResultSms, null)

  const justSent = sendState?.ok === true && 'sent' in sendState
  const justDeclined = declineState?.ok === true && 'declined' in declineState
  const error =
    sendState?.ok === false
      ? sendState.error
      : declineState?.ok === false
        ? declineState.error
        : null

  // Already delivered, this visit or a previous one. Nothing left to decide.
  if (alreadySentAt || justSent) {
    return (
      <section
        className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-5"
        aria-labelledby="sms-sent-heading"
      >
        <h2 id="sms-sent-heading" className="font-bold text-brand-800">
          অভিভাবকদের কাছে পাঠানো হয়েছে
        </h2>
        {justSent && 'sent' in sendState! && (
          <p className="mt-1 text-sm text-brand-800">
            <span className="num font-semibold">{sendState.sent}</span> জন
            অভিভাবক · <span className="num font-semibold">{sendState.charged}</span>{' '}
            ক্রেডিট খরচ হয়েছে
          </p>
        )}
        {!providerLive && (
          <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm text-ink-soft">
            SMS গুলো লাইনে আছে। আপনার কোচিংয়ের নামে sender ID অনুমোদন হলেই
            অভিভাবকের ফোনে পৌঁছাতে শুরু করবে — তখন এগুলো নিজে থেকেই চলে যাবে।
          </p>
        )}
      </section>
    )
  }

  if (!canSend) {
    return (
      <section className="rounded-2xl border border-line bg-surface-alt p-5">
        <h2 className="font-semibold text-ink">ফলাফল SMS</h2>
        <p className="mt-1 text-sm text-ink-soft">
          আপনার SMS পাঠানোর অনুমতি নেই। কোচিংয়ের মালিক চাইলে সেটিংস থেকে অনুমতি
          দিতে পারেন।
        </p>
      </section>
    )
  }

  if (recipientCount === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface-alt p-5">
        <h2 className="font-semibold text-ink">ফলাফল SMS</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {withoutMarks > 0
            ? 'নম্বর সেভ করার পর অভিভাবকদের কাছে SMS পাঠানোর সুযোগ আসবে।'
            : 'পাঠানোর মতো কোনো অভিভাবকের নম্বর নেই।'}
        </p>
        {skippedNoPhone > 0 && (
          <p className="num mt-2 text-sm text-ink-faint">
            {skippedNoPhone} জনের অভিভাবকের ফোন নম্বর নেই
          </p>
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
        অভিভাবকদের ফলাফল জানাবেন?
      </h2>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-alt px-3 py-2">
          <dt className="text-xs text-ink-soft">যাবে</dt>
          <dd className="num text-xl font-bold text-ink">{recipientCount} জনের কাছে</dd>
        </div>
        <div className="rounded-xl bg-surface-alt px-3 py-2">
          <dt className="text-xs text-ink-soft">খরচ</dt>
          <dd className="num text-xl font-bold text-ink">{creditCost} ক্রেডিট</dd>
        </div>
      </dl>

      <p className="num mt-2 text-sm text-ink-soft">
        এখন আছে {balance} ক্রেডিট
        {shortfall > 0 && (
          <span className="font-semibold text-absent"> · {shortfall} কম পড়ছে</span>
        )}
      </p>

      {/* A real message with a real name. An owner approving "a result SMS" in
          the abstract has not actually seen what a parent will read. */}
      {preview && (
        <div className="mt-4">
          <p className="text-sm font-medium text-ink">
            {preview.studentName}-এর অভিভাবক যা পাবেন
          </p>
          <blockquote
            className="mt-1.5 rounded-xl rounded-bl-sm border border-line
              bg-surface-alt px-3 py-2 text-[15px] leading-relaxed text-ink"
          >
            {preview.body}
          </blockquote>
          <p className="num mt-1 text-xs text-ink-faint">
            {preview.segments} SMS · প্রত্যেকের নাম ও নম্বর আলাদা করে বসানো হবে
          </p>
        </div>
      )}

      {anyMultiSegment && (
        <p className="mt-3 rounded-xl bg-surface-alt px-3 py-2 text-sm text-ink-soft">
          কিছু মন্তব্য লম্বা হওয়ায় সেগুলো ২টি SMS হিসেব হবে। মন্তব্য ছোট করলে
          খরচ কমবে।
        </p>
      )}

      {(skippedOptedOut > 0 || skippedNoPhone > 0 || withoutMarks > 0) && (
        <ul className="num mt-3 flex flex-col gap-1 text-sm text-ink-faint">
          {withoutMarks > 0 && <li>{withoutMarks} জনের নম্বর এখনও দেওয়া হয়নি</li>}
          {skippedNoPhone > 0 && <li>{skippedNoPhone} জনের অভিভাবকের নম্বর নেই</li>}
          {skippedOptedOut > 0 && <li>{skippedOptedOut} জনের SMS বন্ধ আছে</li>}
        </ul>
      )}

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {(declinedAt || justDeclined) && (
        <p className="mt-4 rounded-xl bg-surface-alt px-3 py-2 text-sm text-ink-soft">
          এই পরীক্ষার SMS পাঠানো হয়নি। চাইলে পরে পাঠাতে পারবেন।
        </p>
      )}

      {/* Two forms rather than one, so each button posts to its own action and
          neither can be triggered by the browser's default-submit behaviour. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <form action={sendAction}>
          <input type="hidden" name="examId" value={examId} />
          <Button type="submit" full disabled={sending || declining || shortfall > 0}>
            {sending ? 'পাঠানো হচ্ছে…' : 'অভিভাবককে পাঠান'}
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
            {declining ? 'সেভ হচ্ছে…' : 'এখন পাঠাবেন না'}
          </Button>
        </form>
      </div>

      <p className="mt-3 text-center text-xs text-ink-faint">
        পাঠানোর পর আর ফেরানো যায় না
      </p>
    </section>
  )
}
