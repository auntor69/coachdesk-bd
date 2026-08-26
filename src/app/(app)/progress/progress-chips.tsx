'use client'

/**
 * The three ways to tell one family how their child's week went.
 *
 * The same shape as the fee chase's chips and deliberately not the same component.
 * They share every mechanic — a deep link that hands the message to the owner's own
 * phone, a fire-and-forget log, an opt-out that silences the two message channels
 * and never the call — and they differ in the one thing that matters: what the
 * message says, and which table remembers that it was sent. Merging them would mean
 * a component taking a message builder and a logger as props, which is two features
 * wearing one name.
 *
 * The message is built here rather than on the server for the reason ChaseChips
 * gives: the row already carries every input, and shipping two rendered strings per
 * student down to a phone on 3G to save two pure function calls is the wrong trade.
 *
 * The desktop shape is shared, though, because it is about the device and not about
 * the message: on a laptop the two dead links become the message and the number to
 * copy. See ../../../components/chase-chip.tsx and ../../../lib/pointer.ts.
 *
 * So is the order they come in, which is per family and the owner's to set — the
 * father who answers WhatsApp and never opens a text answers it about marks as well
 * as about money. See ../../../lib/students/channel.ts.
 */
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'

import { chipClass, CopyChip } from '@/components/chase-chip'
import type { T } from '@/lib/i18n'
import { useFinePointer } from '@/lib/pointer'
import {
  buildProgressSummarySms,
  buildProgressSummaryText,
} from '@/lib/sms/templates'
import { chaseOrder, CHASE_CHANNELS } from '@/lib/students/channel'
import type { OutreachChannel } from '@/lib/supabase/types'
import { logProgressUpdate } from './actions'

/** Everything one weekly note needs to know about a student, and nothing else. */
export type ProgressTarget = {
  studentId: string
  name: string
  /** The window the view counted over, carried so all four names agree. */
  weekFrom: string
  weekTo: string
  sessionsCounted: number
  sessionsPresent: number
  sessionsLate: number
  examTitle: string | null
  examObtained: number | null
  examTotal: number | null
  examsMissed: number
  /** E.164, or null when the centre has not recorded one. */
  guardianPhone: string | null
  smsOptOut: boolean
  /**
   * How this family is actually reachable, as the owner marked it on
   * /settings/sms. One column, read by both chase screens: a father who answers
   * WhatsApp and never opens a text does that about marks as well as about money.
   */
  preferredChannel: OutreachChannel | null
}

export function ProgressChips({
  target,
  centerName,
  onSent,
  t,
  channels,
}: {
  target: ProgressTarget
  centerName: string
  onSent?: (channel: OutreachChannel) => void
  /** `chase`, borrowed whole: the two screens fail to reach a family the same way. */
  t: T<'chase'>
  channels: T<'channels'>
}) {
  const input = {
    studentName: target.name,
    weekFrom: target.weekFrom,
    weekTo: target.weekTo,
    sessionsCounted: target.sessionsCounted,
    sessionsPresent: target.sessionsPresent,
    sessionsLate: target.sessionsLate,
    examTitle: target.examTitle,
    examObtained: target.examObtained,
    examTotal: target.examTotal,
    examsMissed: target.examsMissed,
    centerName,
  }

  // Empty when the week holds neither a counted session nor an exam. The screen
  // never lists such a row — it counts them in one line at the bottom instead — so
  // this is a guard against a stale page rather than an expected state, and the
  // answer to it is to offer the call and not a message with nothing in it.
  const smsBody = buildProgressSummarySms(input).body
  const chatBody = buildProgressSummaryText(input)
  const sayable = smsBody.length > 0
  const phone = target.guardianPhone

  // See the note on ChaseChips's own: a laptop opens neither `sms:` nor `tel:`, so
  // on one it is offered the message and the number to copy. Called before the early
  // return below only because hooks cannot be conditional.
  const finePointer = useFinePointer()

  function log(channel: OutreachChannel, body: string | null) {
    logProgressUpdate({
      studentId: target.studentId,
      channel,
      coversFrom: target.weekFrom,
      coversTo: target.weekTo,
      toPhone: phone,
      body,
    })
      .then((result) => {
        if (result.logged) onSent?.(channel)
      })
      .catch(() => {})
  }

  if (phone === null) {
    return (
      <p className="text-sm text-ink-soft">
        {t.noNumber}{' '}
        <Link href="/settings/students" className="font-medium text-brand-700">
          {t.addNumber}
        </Link>
      </p>
    )
  }

  // An opt-out is a preference about messages, so it silences both message
  // channels — and neither of them silences the call. A phone call is a person, not
  // a broadcast, and a family that asked not to be texted has not asked never to be
  // spoken to. An empty week silences the same two for a different reason: there is
  // nothing to write down, and a call is how you say "nothing happened this week".
  //
  // This list is the only thing that removes a chip. `preferredChannel` reorders
  // what survives it and colours one of them, so a preference naming a channel this
  // family is opted out of comes to nothing rather than overriding the opt-out.
  const { order, marked } = chaseOrder(
    target.preferredChannel,
    target.smsOptOut || !sayable ? ['call'] : CHASE_CHANNELS,
  )

  // An arrow bound to a const, not a `function` declaration: `phone` is a const
  // that the guard above narrowed to a string, and TypeScript keeps that narrowing
  // inside a closure created after it while widening it straight back to
  // `string | null` inside a hoisted declaration.
  const chip = (channel: OutreachChannel): ReactNode => {
    const className = chipClass(channel === marked)
    switch (channel) {
      case 'sms':
        // The week's note, either handed to the phone's messaging app or put on the
        // clipboard for the phone the owner is not holding. Same words, same
        // position, same row in progress_updates — and on the desktop side the row
        // is written only once the copy succeeded.
        return finePointer ? (
          <CopyChip
            text={smsBody}
            label={t.copySms}
            hint={t.copySmsHint}
            copied={t.copied}
            failed={t.copyFailed}
            lead={marked === 'sms'}
            onCopied={() => log('sms', smsBody)}
          />
        ) : (
          <a
            // "?&body=" rather than "?body=": iOS historically wanted the
            // separator to be "&" and Android wants "?", and this form is the
            // one both parse. The empty first parameter is ignored.
            href={`sms:${phone}?&body=${encodeURIComponent(smsBody)}`}
            onClick={() => log('sms', smsBody)}
            className={className}
          >
            {channels.sms}
          </a>
        )
      case 'whatsapp':
        return (
          <a
            // wa.me wants the number without the +. Unbranched on purpose: this
            // one already works on a laptop, because WhatsApp Web exists.
            href={`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(chatBody)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => log('whatsapp', chatBody)}
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
          <a href={`tel:${phone}`} onClick={() => log('call', null)} className={className}>
            {channels.call}
          </a>
        )
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {/* The key lives on a Fragment rather than on each element inside `chip`,
            so that there is one place to get it right instead of five. */}
        {order.map((channel) => (
          <Fragment key={channel}>{chip(channel)}</Fragment>
        ))}
      </div>

      {target.smsOptOut && <p className="mt-2 text-sm text-ink-faint">{t.optedOut}</p>}
    </>
  )
}
