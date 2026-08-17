import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/bd/time'
import { smsProviderConfigured } from '@/lib/sms/provider'
import { OptOutList, type OptOutStudent } from './opt-out-list'

export const metadata = { title: 'SMS — CoachDesk' }

const KIND_LABELS: Record<string, string> = {
  exam_result: 'ফলাফল',
  attendance_alert: 'হাজিরা',
  fee_reminder: 'ফি',
  notice: 'নোটিশ',
  custom: 'অন্য',
}

/**
 * The SMS ledger, in the owner's language: what is left, what went out, and who
 * is excluded.
 *
 * Credits are money, so this page never rounds, never estimates, and never
 * claims delivery it cannot prove. Messages sit at 'queued' until a real gateway
 * moves them, and the banner below says so — an owner who thinks 40 messages
 * were delivered will not check again for weeks.
 */
export default async function SmsSettingsPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()

  const [{ data: dispatches }, { data: logs }, { data: students }] = await Promise.all([
    supabase
      .from('sms_dispatches')
      .select('id, kind, recipient_count, credit_cost, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    // Status counts come from the rows themselves; there are at most a few
    // hundred on a free plan, and a wrong count here is worse than a slow one.
    supabase.from('sms_logs').select('status').limit(1000),
    supabase
      .from('students')
      .select('id, name, guardian_phone, sms_opt_out')
      .eq('status', 'active')
      .order('name', { ascending: true }),
  ])

  const counts = { queued: 0, sent: 0, delivered: 0, failed: 0 }
  for (const log of logs ?? []) {
    if (log.status === 'queued') counts.queued++
    else if (log.status === 'sent') counts.sent++
    else if (log.status === 'delivered') counts.delivered++
    else if (log.status === 'failed') counts.failed++
  }

  const optOutStudents: OptOutStudent[] = (students ?? []).map((student) => ({
    id: student.id,
    name: student.name,
    guardianPhone: student.guardian_phone,
    optOut: student.sms_opt_out,
  }))

  const balance = session.active.smsCreditBalance
  const monthly = session.plan.monthlySmsCredits

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← সেটিংস
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">SMS</h1>
      </div>

      <Card>
        <p className="text-sm text-ink-soft">এখন আছে</p>
        <p className="num mt-0.5 text-3xl font-bold text-ink">{balance} ক্রেডিট</p>
        {monthly > 0 && (
          <p className="num mt-1 text-sm text-ink-faint">
            {session.plan.nameBn} প্ল্যানে প্রতি মাসে {monthly} ক্রেডিট
          </p>
        )}
        {/* One Bangla SMS is 70 characters, not 160. Owners plan around the
            wrong number otherwise and think we are overcharging. */}
        <p className="mt-3 border-t border-line pt-3 text-sm text-ink-soft">
          বাংলায় এক SMS = <span className="num">৭০</span> অক্ষর। এক জন
          অভিভাবককে একটি বার্তা পাঠালে <span className="num">১</span> ক্রেডিট
          খরচ হয়।
        </p>
      </Card>

      {!smsProviderConfigured() && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-semibold text-amber-900">
            পাঠানো এখনও চালু হয়নি
          </p>
          <p className="mt-1 text-sm text-amber-900/90">
            আপনার কোচিংয়ের নামে sender ID অনুমোদনের কাজ চলছে। ততক্ষণ পর্যন্ত
            যা পাঠাবেন তা লাইনে জমা থাকবে, অনুমোদন হলেই একসাথে চলে যাবে —
            কোনো বার্তা হারাবে না।
          </p>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink">অবস্থা</h2>
        <dl className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line bg-white px-3 py-2">
            <dt className="text-xs text-ink-soft">লাইনে</dt>
            <dd className="num text-xl font-bold text-ink">{counts.queued}</dd>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-2">
            <dt className="text-xs text-ink-soft">গেছে</dt>
            <dd className="num text-xl font-bold text-ink">
              {counts.sent + counts.delivered}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-2">
            <dt className="text-xs text-ink-soft">যায়নি</dt>
            <dd
              className={`num text-xl font-bold ${
                counts.failed > 0 ? 'text-absent' : 'text-ink'
              }`}
            >
              {counts.failed}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink">সাম্প্রতিক পাঠানো</h2>
        {(dispatches ?? []).length === 0 ? (
          <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
            এখনও কোনো SMS পাঠানো হয়নি। পরীক্ষার নম্বর সেভ করার পর অভিভাবকদের
            জানানোর সুযোগ আসবে।
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(dispatches ?? []).map((dispatch) => (
              <li
                key={dispatch.id}
                className="flex items-center gap-3 rounded-xl border border-line
                  bg-white px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {KIND_LABELS[dispatch.kind] ?? dispatch.kind}
                  </p>
                  <p className="text-sm text-ink-faint">
                    {formatDate(dispatch.created_at.slice(0, 10))}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-sm font-semibold text-ink">
                    {dispatch.recipient_count} জন
                  </p>
                  <p className="num text-xs text-ink-faint">
                    {dispatch.credit_cost} ক্রেডিট
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {optOutStudents.length > 0 && <OptOutList students={optOutStudents} />}
    </div>
  )
}
