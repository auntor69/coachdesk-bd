import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { currentPeriodMonth } from '@/lib/bd/time'
import { formatBdMobile } from '@/lib/bd/phone'
import { WALLET_LABEL_BN } from '@/lib/sms/templates'
import { CenterForm } from './center-form'

export const metadata = { title: 'নাম ও পেমেন্ট — CoachDesk' }

/**
 * The centre's name, and the wallet a parent sends fees to.
 *
 * One screen for both because they compete for the same 70 characters. The name
 * signs every reminder and cannot be dropped from one; the payment number is
 * what makes a reminder actionable without a phone call. A long name pushes the
 * number out, and the only way an owner can know that is to be shown it — so the
 * form previews the real message and says plainly which one won.
 *
 * Read by managers, written by owners. `centers_owner_update` has always drawn
 * that line, and it matters more now than when this row held a name and an
 * address: whoever edits the payment number decides where a month of fees goes.
 * A manager still sees the number, because they are the person a parent asks.
 */
export default async function CenterSettingsPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()
  const periodMonth = currentPeriodMonth()

  const [{ data: center }, { data: student }, { data: batch }] = await Promise.all([
    supabase
      .from('coaching_centers')
      .select('name, payment_wallet, payment_number')
      .eq('id', session.active.centerId)
      .maybeSingle(),
    // One real name for the preview, so what the owner reads is a message their
    // own centre would send rather than a mock-up of one.
    supabase
      .from('students')
      .select('name')
      .eq('status', 'active')
      .order('name')
      .limit(1)
      .maybeSingle(),
    // A representative amount. Not the worst case — a family three months behind
    // owes more than one month's fee — but the figure their reminders will
    // usually carry, and it is their own number rather than a guess.
    supabase
      .from('batches')
      .select('monthly_fee_bdt')
      .eq('active', true)
      .order('monthly_fee_bdt', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const canEdit = session.active.role === 'owner'
  const wallet = center?.payment_wallet ?? null
  const number = center?.payment_number ?? null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/settings" className="text-sm font-medium text-brand-700">
          ← সেটিংস
        </Link>
        <h1 className="mt-2 text-xl font-bold text-ink">নাম ও পেমেন্ট</h1>
        <p className="mt-1 text-ink-soft">
          অভিভাবকের কাছে যাওয়া বার্তায় এই নাম আর নম্বরটিই থাকবে
        </p>
      </div>

      {canEdit ? (
        <CenterForm
          name={center?.name ?? session.active.centerName}
          paymentWallet={wallet}
          paymentNumber={number}
          example={{
            studentName: student?.name ?? 'রাফিদ হাসান',
            amount: Number(batch?.monthly_fee_bdt ?? 0) || 1500,
            periodMonth,
          }}
        />
      ) : (
        <Card>
          <p className="font-medium text-ink">{center?.name ?? session.active.centerName}</p>
          {wallet && number ? (
            <p className="mt-1 text-ink-soft">
              {WALLET_LABEL_BN[wallet]}{' '}
              <span className="num font-medium text-ink">{formatBdMobile(number)}</span>
            </p>
          ) : (
            <p className="mt-1 text-ink-soft">পেমেন্ট নম্বর এখনো দেওয়া হয়নি।</p>
          )}
          <p className="mt-3 text-sm text-ink-faint">
            এগুলো শুধু কোচিংয়ের মালিক বদলাতে পারেন।
          </p>
        </Card>
      )}
    </div>
  )
}
