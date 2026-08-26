'use client'

/**
 * The three ways to tell one family how their child did in one exam.
 *
 * The third copy of this shape, after the fee chase and the weekly note, and
 * separate from both for the reason ProgressChips gives about ChaseChips: they
 * share every mechanic and differ in the two things that matter — what the message
 * says, and which table remembers it was sent. A component taking a message
 * builder and a logger as props would be three features wearing one name.
 *
 * The message is NOT built here, which is the one place this diverges from its two
 * siblings, and deliberately: their rows already carry every input, so rendering in
 * the browser costs nothing. This one would need the raw marks, the exam's pass
 * mark and a three-level guardian embed shipped down to re-derive a string the
 * server already had. See the note on ResultRecipient.chatBody.
 *
 * The desktop shape and the per-family order are shared, because both are about the
 * device and the family rather than the message. See ../../../../components/chase-chip.tsx
 * and ../../../../lib/students/channel.ts.
 */
import { Fragment, type ReactNode } from 'react'

import { chipClass, CopyChip } from '@/components/chase-chip'
import type { T } from '@/lib/i18n'
import { useFinePointer } from '@/lib/pointer'
import { chaseOrder, CHASE_CHANNELS } from '@/lib/students/channel'
import type { OutreachChannel } from '@/lib/supabase/types'
import { logResultNotice } from '../actions'

/**
 * One family the centre can reach about this exam.
 *
 * A local type rather than `ResultRecipient` itself: that module is `server-only`,
 * and this carries less anyway — the guardian id and the segment count are the
 * metered queue's business and have no reason to reach a browser.
 *
 * `phone` is a string and not `string | null` because `planResultSms` counts the
 * families with no number and leaves them off the list, so a target without one
 * cannot exist. The section says how many were left out instead.
 */
export type ResultTarget = {
  studentId: string
  name: string
  /** E.164, as `normalizeBdMobile` wrote it. */
  phone: string
  /** The metered body: one segment, the teacher's note dropped if it did not fit. */
  smsBody: string
  /** The same result written out in full, for the channel that meters nothing. */
  chatBody: string
  preferredChannel: OutreachChannel | null
}

export function ResultChips({
  examId,
  target,
  onSent,
  t,
  channels,
}: {
  examId: string
  target: ResultTarget
  onSent?: (channel: OutreachChannel) => void
  /** `chase`, borrowed whole: all three screens copy a message the same way. */
  t: T<'chase'>
  channels: T<'channels'>
}) {
  // A laptop opens neither `sms:` nor `tel:`, so on one those two chips become the
  // message and the number to copy. See the note on ChaseChips's own.
  const finePointer = useFinePointer()

  const phone = target.phone

  function log(channel: OutreachChannel, body: string | null) {
    logResultNotice({
      examId,
      studentId: target.studentId,
      channel,
      toPhone: phone,
      body,
    })
      .then((result) => {
        if (result.logged) onSent?.(channel)
      })
      .catch(() => {})
  }

  // All three, always. Nobody on this list is opted out — `planResultSms` drops
  // those families before the page sees them — so the only thing left to decide is
  // the order, which is the owner's per-family setting.
  const { order, marked } = chaseOrder(target.preferredChannel, CHASE_CHANNELS)

  const chip = (channel: OutreachChannel): ReactNode => {
    const className = chipClass(channel === marked)
    switch (channel) {
      case 'sms':
        return finePointer ? (
          <CopyChip
            text={target.smsBody}
            label={t.copySms}
            hint={t.copySmsHint}
            copied={t.copied}
            failed={t.copyFailed}
            lead={marked === 'sms'}
            onCopied={() => log('sms', target.smsBody)}
          />
        ) : (
          <a
            // "?&body=" rather than "?body=": iOS historically wanted the
            // separator to be "&" and Android wants "?", and this form is the one
            // both parse. The empty first parameter is ignored.
            href={`sms:${phone}?&body=${encodeURIComponent(target.smsBody)}`}
            onClick={() => log('sms', target.smsBody)}
            className={className}
          >
            {channels.sms}
          </a>
        )
      case 'whatsapp':
        return (
          <a
            // wa.me wants the number without the +. Unbranched, because this one
            // already works on a laptop — WhatsApp Web exists.
            href={`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(
              target.chatBody,
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => log('whatsapp', target.chatBody)}
            className={className}
          >
            {channels.whatsapp}
          </a>
        )
      case 'call':
        return finePointer ? (
          <CopyChip
            text={phone}
            label={t.copyNumber}
            hint={t.copyNumberHint}
            copied={t.copied}
            failed={t.copyFailed}
            lead={marked === 'call'}
            onCopied={() => log('call', null)}
          />
        ) : (
          <a
            href={`tel:${phone}`}
            onClick={() => log('call', null)}
            className={className}
          >
            {channels.call}
          </a>
        )
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {/* The key on a Fragment rather than on each element inside `chip`, so
          there is one place to get it right instead of five. */}
      {order.map((channel) => (
        <Fragment key={channel}>{chip(channel)}</Fragment>
      ))}
    </div>
  )
}
