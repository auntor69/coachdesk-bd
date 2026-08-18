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
 */
import Link from 'next/link'

import { digits } from '@/lib/bd/time'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { buildFeeReminderSms, buildFeeReminderText } from '@/lib/sms/templates'
import type { FeeReminderChannel, PayoutWallet } from '@/lib/supabase/types'
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
}

/** One tap target. Deliberately identical for all three — which channel a family
 *  actually reads is the centre's knowledge, not something to rank for them. */
const CHIP =
  'inline-flex min-h-tap items-center rounded-xl border-2 border-line px-4' +
  ' font-medium text-ink-soft transition-colors active:bg-brand-50'

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
  onSent?: (channel: FeeReminderChannel) => void
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

  function log(channel: FeeReminderChannel, body: string | null) {
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

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {/* An opt-out is a preference about messages, so it silences both message
            channels — and neither of them silences the call. A phone call is a
            person, not a broadcast, and a family that asked not to be texted has
            not asked never to be spoken to. */}
        {!target.smsOptOut && (
          <>
            <a
              // "?&body=" rather than "?body=": iOS historically wanted the
              // separator to be "&" and Android wants "?", and this form is the
              // one both parse. The empty first parameter is ignored.
              href={`sms:${phone}?&body=${encodeURIComponent(smsBody)}`}
              onClick={() => log('sms', smsBody)}
              className={CHIP}
            >
              {channels.sms}
            </a>
            <a
              // wa.me wants the number without the +.
              href={`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(chatBody)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => log('whatsapp', chatBody)}
              className={CHIP}
            >
              {channels.whatsapp}
            </a>
          </>
        )}
        <a href={`tel:${phone}`} onClick={() => log('call', null)} className={CHIP}>
          {channels.call}
        </a>
      </div>

      {target.smsOptOut && (
        <p className="mt-2 text-sm text-ink-faint">{t.optedOut}</p>
      )}
    </>
  )
}
