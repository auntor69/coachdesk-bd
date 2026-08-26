'use client'

/**
 * The three ways to chase one unpaid invoice, and the record that it happened.
 *
 * No gateway is involved in any of them. Each chip is a link that hands the
 * message to the owner's own phone with the text already written, so it goes from
 * their number, at their own operator's rate, and needs no registered sender ID —
 * none of which exists yet. The alternative available tonight is what the paper
 * register offered: read the number off a different screen and retype the amount
 * from memory.
 *
 * Shared by the fee board's row and the daily reminder worklist, because the two
 * screens must produce byte-identical messages. They ask different questions —
 * "this family, now" versus "everyone due today" — and a family that gets a
 * differently worded reminder depending on which screen the owner happened to be
 * on is a product that looks like two products.
 *
 * The message is built here rather than on the server because the caller already
 * carries every input it needs, and shipping three rendered strings per invoice
 * down to a phone on 3G to save two pure function calls is the wrong trade. It is
 * the same function the cron worker will call when there is a gateway.
 *
 * ON A LAPTOP two of the three links open nothing, so on one the owner is offered
 * the message and the number to copy instead — same words, same order, same table.
 * See ../../../lib/pointer.ts for why the question is a media query, and
 * ../../../components/chase-chip.tsx for why a copy is a chase.
 *
 * WHICH CHIP COMES FIRST is the owner's call, per family, and the only thing that
 * changes it is `students.preferred_channel`. All three still render; one moves to
 * the front and is coloured. See ../../../lib/students/channel.ts.
 */
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'

import { chipClass, CopyChip } from '@/components/chase-chip'
import { digits } from '@/lib/bd/time'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { useFinePointer } from '@/lib/pointer'
import { buildFeeReminderSms, buildFeeReminderText } from '@/lib/sms/templates'
import { chaseOrder, CHASE_CHANNELS } from '@/lib/students/channel'
import type { OutreachChannel, PayoutWallet } from '@/lib/supabase/types'
import { logFeeReminder } from './actions'

/**
 * The centre-level facts every reminder needs: who is asking, and where the money
 * should go. One object rather than three props because they are fetched
 * together, they change together on one settings screen, and they are all inputs
 * to the same sentence.
 */
export type ReminderCenter = {
  name: string
  paymentWallet: PayoutWallet | null
  /** E.164, as coaching_centers stores it. Null until the owner sets one. */
  paymentNumber: string | null
}

/** Everything a chase needs to know about one invoice, and nothing else. */
export type ChaseTarget = {
  id: string
  name: string
  /** YYYY-MM-01 — which month's fee this is, for the reminder text. */
  periodMonth: string
  /** Taka still owed, as the board computed it. */
  remaining: number
  dueDate: string
  /** Negative before the due date, positive after; sets the tense used. */
  daysLate: number
  /** E.164, or null when the centre has not recorded one. */
  guardianPhone: string | null
  smsOptOut: boolean
  /**
   * How this family is actually reachable, as the owner marked it on
   * /settings/sms. Null — the default — means nobody has said, and the chips keep
   * the order they have always had.
   */
  preferredChannel: OutreachChannel | null
}

/**
 * "9 days late", in the reader's language and numerals.
 *
 * Here rather than in either row component because both of them show it, about the
 * same invoice, and a family that is nine days late on the board must not be eight
 * on the worklist. This module is already the one thing the two screens share.
 *
 * The singular is a separate string rather than a plural rule: English needs one
 * ("1 days late" is the first thing a teacher notices), Bangla does not, and a
 * `{n}` template — which is what a client component can use, see lib/i18n/fill —
 * cannot branch on its own value.
 */
export function lateLabel(
  daysLate: number,
  locale: Locale,
  t: T<'common'>,
): string {
  if (daysLate === 1) return t.dayLate
  return fill(t.daysLate, { n: digits(daysLate, locale) })
}

/**
 * Tapping does not wait for the log. The link navigates, the phone switches to
 * its messaging app, and the write lands in the background — an owner should
 * never watch a spinner between deciding to chase someone and being able to.
 *
 * `onSent` fires only once the row is actually in the database, never
 * optimistically. Both callers use it to stop asking for the same message twice,
 * and a badge that appeared when the write had failed would do the opposite of
 * that. The delay is invisible on a phone, which has already switched apps.
 *
 * The words come from whichever parent rendered this, in that reader's language.
 * The *message* does not: it is built in Bangla for a guardian who has no account
 * here and so no language on file. See lib/sms/templates.ts.
 */
export function ChaseChips({
  target,
  center,
  onSent,
  t,
  channels,
}: {
  target: ChaseTarget
  center: ReminderCenter
  onSent?: (channel: OutreachChannel) => void
  t: T<'chase'>
  channels: T<'channels'>
}) {
  const input = {
    studentName: target.name,
    periodMonth: target.periodMonth,
    amount: target.remaining,
    dueDate: target.dueDate,
    daysLate: target.daysLate,
    centerName: center.name,
    // Passed to both builders and dropped by whichever cannot afford it. The SMS
    // gives it up when 70 characters will not stretch; WhatsApp always carries it.
    paymentWallet: center.paymentWallet,
    paymentNumber: center.paymentNumber,
  }
  const smsBody = buildFeeReminderSms(input).body
  const chatBody = buildFeeReminderText(input)
  const phone = target.guardianPhone

  // A laptop cannot open `sms:` or `tel:`, so on one it is offered the message and
  // the number instead. Asked before the early return below only because hooks
  // cannot be called conditionally; the answer is unused when there is no phone.
  const finePointer = useFinePointer()

  function log(channel: OutreachChannel, body: string | null) {
    logFeeReminder({
      invoiceId: target.id,
      channel,
      amount: target.remaining,
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
  // channels — and neither of them silences the call. A phone call is a person,
  // not a broadcast, and a family that asked not to be texted has not asked never
  // to be spoken to.
  //
  // That list is the only thing that removes a chip. `preferredChannel` cannot:
  // it reorders what survives this line and colours one of it, so a preference
  // for a channel this family is opted out of quietly comes to nothing rather
  // than overriding the opt-out.
  const { order, marked } = chaseOrder(
    target.preferredChannel,
    target.smsOptOut ? ['call'] : CHASE_CHANNELS,
  )

  // An arrow bound to a const, not a `function` declaration: `phone` is a const
  // that the guard above narrowed to a string, and TypeScript keeps that narrowing
  // inside a closure created after it while widening it straight back to
  // `string | null` inside a hoisted declaration.
  const chip = (channel: OutreachChannel): ReactNode => {
    const className = chipClass(channel === marked)
    switch (channel) {
      case 'sms':
        // The message, either handed to the phone's own messaging app or put on
        // the clipboard for the phone the owner is not holding. Same position,
        // same message, same row in fee_reminders — and on the desktop side the
        // row is written only once the copy succeeded.
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

      {target.smsOptOut && (
        <p className="mt-2 text-sm text-ink-faint">{t.optedOut}</p>
      )}
    </>
  )
}
