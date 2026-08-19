import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/bd/time'
import { planName } from '@/lib/plans'
import { smsProviderConfigured } from '@/lib/sms/provider'
import { UCS2_SEGMENT } from '@/lib/sms/encoding'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { OptOutList, type OptOutStudent } from './opt-out-list'

/** getSession, not requireRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.sms.title} — CoachDesk` }
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
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.sms
  const supabase = await createClient()

  /*
   * All three scoped to the active centre as well as governed by RLS. An owner of
   * two centres passes the policy for both, so without this the tallies would mix
   * the two — and the opt-out list would hand the other centre's students, with
   * their guardians' mobile numbers, to a switch that writes to them.
   */
  const [{ data: dispatches }, { data: logs }, { data: students }] = await Promise.all([
    supabase
      .from('sms_dispatches')
      .select('id, kind, recipient_count, credit_cost, created_at')
      .eq('coaching_center_id', session.active.centerId)
      .order('created_at', { ascending: false })
      .limit(10),
    // Status counts come from the rows themselves; there are at most a few
    // hundred on a free plan, and a wrong count here is worse than a slow one.
    supabase
      .from('sms_logs')
      .select('status')
      .eq('coaching_center_id', session.active.centerId)
      .limit(1000),
    supabase
      .from('students')
      .select('id, name, guardian_phone, sms_opt_out')
      .eq('coaching_center_id', session.active.centerId)
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

  const off = optOutStudents.filter((s) => s.optOut).length

  const balance = session.active.smsCreditBalance
  const monthly = session.plan.monthlySmsCredits

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
      </div>

      <Card>
        <p className="text-sm text-ink-soft">{t.balance}</p>
        <p className="num mt-0.5 text-3xl font-bold text-ink">{t.credits(balance)}</p>
        {monthly > 0 && (
          <p className="num mt-1 text-sm text-ink-faint">
            {t.monthly(planName(session.plan, locale), monthly)}
          </p>
        )}
        {/* One Bangla SMS is 70 characters, not 160. Owners plan around the
            wrong number otherwise and think we are overcharging. */}
        <p className="mt-3 border-t border-line pt-3 text-sm text-ink-soft">
          {t.segmentNote(UCS2_SEGMENT)}
        </p>
      </Card>

      {!smsProviderConfigured() && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-semibold text-amber-900">{t.notLiveTitle}</p>
          <p className="mt-1 text-sm text-amber-900/90">{t.notLiveBody}</p>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink">{t.statusTitle}</h2>
        <dl className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line bg-white px-3 py-2">
            <dt className="text-xs text-ink-soft">{t.queued}</dt>
            <dd className="num text-xl font-bold text-ink">{counts.queued}</dd>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-2">
            <dt className="text-xs text-ink-soft">{t.sent}</dt>
            <dd className="num text-xl font-bold text-ink">
              {counts.sent + counts.delivered}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-2">
            <dt className="text-xs text-ink-soft">{t.failed}</dt>
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
        <h2 className="font-semibold text-ink">{t.recentTitle}</h2>
        {(dispatches ?? []).length === 0 ? (
          <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
            {t.noneYet}
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
                  <p className="font-medium text-ink">{d.smsKinds[dispatch.kind]}</p>
                  <p className="text-sm text-ink-faint">
                    {formatDate(dispatch.created_at.slice(0, 10), locale)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-sm font-semibold text-ink">
                    {t.people(dispatch.recipient_count)}
                  </p>
                  <p className="num text-xs text-ink-faint">
                    {t.credits(dispatch.credit_cost)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {optOutStudents.length > 0 && (
        <OptOutList
          students={optOutStudents}
          // Resolved here because English needs "1 student" and not "1 students",
          // and a function cannot cross into a client component.
          subtitle={off === 0 ? t.optOutNone : t.optOutSome(off)}
          t={d.optOutList}
        />
      )}
    </div>
  )
}
