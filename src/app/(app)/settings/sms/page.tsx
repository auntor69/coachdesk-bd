import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageAll, worstFailure } from '@/lib/supabase/page'
import { dhakaMoment, formatDate } from '@/lib/bd/time'
import { planName } from '@/lib/plans'
import { smsProviderConfigured } from '@/lib/sms/provider'
import { UCS2_SEGMENT } from '@/lib/sms/encoding'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import type { SmsStatus } from '@/lib/supabase/types'
import { OptOutList, type OptOutStudent } from './opt-out-list'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
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
 *
 * THE FIGURES AND WHAT THEY WERE SPENT ON, SIDE BY SIDE FROM `xl` (§20.8.11). Four
 * numbers stacked down a 1,216px column, each in a card the width of the screen, and
 * the ten dispatches that explain them a scroll below. The figures are a 386px column
 * now and the dispatch list the 550px beside it. The "not live yet" banner goes above
 * both, because it is the caveat on every figure under it.
 */
export default async function SmsSettingsPage() {
  const session = await pageRole('manager')
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
  const [{ data: dispatches }, logs, students] = await Promise.all([
    supabase
      .from('sms_dispatches')
      .select('id, kind, recipient_count, credit_cost, created_at')
      .eq('coaching_center_id', session.active.centerId)
      .order('created_at', { ascending: false })
      .limit(10),
    // Status counts come from the rows themselves rather than six `count` queries,
    // and paged rather than capped at a thousand, because of what that cap quietly did
    // the day a centre passed its thousandth message: the three tallies became the
    // tallies of a thousand rows in no particular order, under a heading that reads as
    // the whole of it. The one an owner acts on is "not sent". A wrong count here is
    // worse than a slow one, and this read is one enum column wide.
    pageAll((from, to) =>
      supabase
        .from('sms_logs')
        .select('status')
        .eq('coaching_center_id', session.active.centerId)
        .order('id')
        .range(from, to),
    ),
    // Paged for a reason the one above does not have: this list is a consent control.
    // Every row is a switch recording whether a guardian asked not to be messaged, and
    // PostgREST's silent thousand would drop the tail of a large centre's roster off a
    // screen with no pager and no note — so a family who asked to be left alone could
    // not be marked, and one already marked would be invisible to the owner checking.
    // `.order('id')` last so two students with the same name cannot make the offset
    // walk repeat one and skip the other.
    pageAll((from, to) =>
      supabase
        .from('students')
        .select('id, name, guardian_phone, sms_opt_out, preferred_channel')
        .eq('coaching_center_id', session.active.centerId)
        .eq('status', 'active')
        .order('name', { ascending: true })
        .order('id')
        .range(from, to),
    ),
  ])

  /**
   * Every status the enum has, not the four this screen draws.
   *
   * An exhaustive Record means adding a value to sms_status breaks this build
   * instead of quietly deleting rows from the screen — which is not a hypothetical
   * worry, it is what the if/else chain here did the day 'sending' was added. An
   * owner would have watched forty in line become twelve in line, nothing gone and
   * nothing failed, with twenty-eight messages nowhere at all.
   */
  const counts: Record<SmsStatus, number> = {
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    cancelled: 0,
  }
  for (const log of 'rows' in logs ? logs.rows : []) counts[log.status]++

  /*
   * And nought of each is what an unread tally used to look like: nothing waiting,
   * nothing gone, nothing failed. On the one screen in the product that spends the
   * owner's money, and always in the flattering direction — the count they came here
   * to check is "not sent", and a zero under it is the answer they were hoping for.
   *
   * So the three figures are withheld instead, as a dash, exactly as the dashboard's
   * own tiles do it. The `counts` Record is still filled and still exhaustive: that is
   * what makes a new `sms_status` a build error rather than a missing row, and it is
   * not the part that was lying.
   */
  const statusProblem = worstFailure(logs)
  const tally = (n: number) => (statusProblem === null ? String(n) : '—')

  /**
   * 'sending' belongs with 'queued', not with 'sent'.
   *
   * It means the worker has taken the message and is waiting on the gateway — a few
   * seconds normally, up to ten minutes if that run was killed mid-batch and the
   * reaper has yet to put it back. Either way the honest word for it is "in line":
   * nobody has heard anything yet, and it may still come back to be tried again.
   */
  const waiting = counts.queued + counts.sending

  /*
   * The roster, and a failed read takes the whole switch panel off the screen — which
   * on a consent control is not the harmless absence it is on the at-risk card. A
   * guardian who has asked not to be messaged cannot be marked, and one already marked
   * cannot be seen by the owner checking; `optOutStudents.length > 0` is true of every
   * centre with a single active student, so an empty list here is not a state a real
   * centre reaches. The panel still goes, because there is nothing honest to draw in
   * it, and the sentence below says which of the two happened.
   */
  const rosterProblem = worstFailure(students)

  const optOutStudents: OptOutStudent[] = ('rows' in students ? students.rows : []).map(
    (student) => ({
      id: student.id,
      name: student.name,
      guardianPhone: student.guardian_phone,
      optOut: student.sms_opt_out,
      preferredChannel: student.preferred_channel,
    }),
  )

  const off = optOutStudents.filter((s) => s.optOut).length

  const balance = session.active.smsCreditBalance
  const monthly = session.plan.monthlySmsCredits

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} back={{ href: '/settings', label: d.settings.hub.title }} />

      {/* Above the figures rather than between two of them: it is the caveat on
          every number below it, and a reader who meets it after the tallies has
          already believed them. */}
      {!smsProviderConfigured() && (
        <div className="max-w-4xl rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-semibold text-amber-900">{t.notLiveTitle}</p>
          <p className="mt-1 text-sm text-amber-900/90">{t.notLiveBody}</p>
        </div>
      )}

      {/*
        The four figures in a 386px column and the ten dispatches that spent the
        credits in the 550px beside them. `items-start` so the dispatch list keeps
        its own height, and no `order-N`: the balance is read first at both widths
        because it is what an owner opened this screen for.
      */}
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">
        <div className="flex flex-col gap-5 xl:col-span-5">
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

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold text-ink">{t.statusTitle}</h2>
            <dl className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-line bg-white px-3 py-2">
                <dt className="text-xs text-ink-soft">{t.queued}</dt>
                <dd className="num text-xl font-bold text-ink">{tally(waiting)}</dd>
              </div>
              <div className="rounded-xl border border-line bg-white px-3 py-2">
                <dt className="text-xs text-ink-soft">{t.sent}</dt>
                <dd className="num text-xl font-bold text-ink">
                  {tally(counts.sent + counts.delivered)}
                </dd>
              </div>
              <div className="rounded-xl border border-line bg-white px-3 py-2">
                <dt className="text-xs text-ink-soft">{t.failed}</dt>
                <dd
                  className={`num text-xl font-bold ${
                    statusProblem === null && counts.failed > 0 ? 'text-absent' : 'text-ink'
                  }`}
                >
                  {tally(counts.failed)}
                </dd>
              </div>
            </dl>
            {counts.cancelled > 0 && (
              <p className="num text-sm text-ink-faint">{t.cancelledNote(counts.cancelled)}</p>
            )}
            {/* Under the dashes, saying which of the two happened. Not a warning card:
                nothing is wrong with the centre, and the credit balance above this — which
                is the figure they came for — is off the session and was never in doubt. */}
            {statusProblem !== null && (
              <p className="text-sm text-ink-soft">
                {statusProblem === 'tooLarge' ? t.statusTooLarge : t.statusUnknown}
              </p>
            )}
          </section>
        </div>

        <section className="flex flex-col gap-3 xl:col-span-7">
          <h2 className="font-semibold text-ink">{t.recentTitle}</h2>
          {/* `null` is the failed read and `[]` is the honest empty one — a non-head
              select answers `[]` when it found nothing and `null` only on error, which is
              the whole reason these are two arms and not `?? []`. `noneYet` does not just
              report nothing: it tells the owner where the chance to send one comes up,
              which is a wrong errand to send them on after a dropped read. */}
          {dispatches === null ? (
            <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
              {t.recentUnreadable}
            </p>
          ) : dispatches.length === 0 ? (
            <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
              {t.noneYet}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dispatches.map((dispatch) => (
                <li
                  key={dispatch.id}
                  className="flex items-center gap-3 rounded-xl border border-line
                    bg-white px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{d.smsKinds[dispatch.kind]}</p>
                    <p className="text-sm text-ink-faint">
                      {/*
                        `dhakaMoment` and never ten characters off the timestamp: `created_at`
                        is a timestamptz that Postgres returns in UTC, so a message queued at
                        1am Dhaka would be dated the day before on the one screen that records
                        what the centre spent its credits on. The same conversion the fee board's
                        chase history makes, and the register's date beside it.
                      */}
                      {formatDate(dhakaMoment(dispatch.created_at).date, locale)}
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
      </div>

      {rosterProblem !== null && (
        <Card className="max-w-2xl">
          <p className="text-sm text-ink-soft">
            {rosterProblem === 'tooLarge' ? t.rosterTooLarge : t.rosterUnreadable}
          </p>
        </Card>
      )}

      {optOutStudents.length > 0 && (
        <OptOutList
          students={optOutStudents}
          // Resolved here because English needs "1 student" and not "1 students",
          // and a function cannot cross into a client component.
          subtitle={off === 0 ? t.optOutNone : t.optOutSome(off)}
          t={d.optOutList}
          channels={d.channels}
        />
      )}
    </div>
  )
}
