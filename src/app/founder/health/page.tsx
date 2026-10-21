import Link from 'next/link'

import { Card } from '@/components/ui'
import { pagePlatformAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { founderQueue } from '@/lib/billing/claims'
import { dhakaMoment, digits, formatDate } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { customers, platformTotals } from '@/lib/platform/centers'
import { FounderNav } from '../nav'

/*
 * NO generateMetadata, like the rest of the panel — see the note at the top of ../page.tsx.
 */

/** The open purchases worth counting. A panel is not a queue processor; see the note below. */
const INTENT_LIMIT = 200

/**
 * Is anything quietly broken — §16.1's fourth question, and the only screen that is about *us*.
 *
 * WHY A FOUNDER NEEDS THIS AND NOT A DASHBOARD. Every failure this product has is silent by
 * construction, and each one is silent in the same way: the panel keeps drawing a plausible
 * screen. A recharge a customer says they sent sits in our bKash account with nothing
 * recorded, a purchase never confirmed leaves a centre on the plan it complained about, a
 * balance cache drifts one poisha from its chain — and the day somebody notices is the day the
 * customer rings. This page is the list of those, in one place, with the oldest at the top:
 * what is waiting on us, and what does not reconcile.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is check infrastructure. Uptime, queue depth and error
 * rates belong to whatever is watching the deployment, and a page in the product pretending to
 * be that is a page nobody looks at twice. Everything here is read from the database this
 * screen is already allowed to see, and every figure on it can be checked by hand against the
 * same tables — which is the property that makes it worth trusting.
 *
 * THE TWO THINGS IT CANNOT SEE are stated at the bottom rather than left to be assumed: the
 * SMS gateway is metered and switched off until a BTRC sender ID exists, and every count on
 * every screen covers thirty days. A health page that says nothing about what it is blind to
 * is worse than no health page.
 */
export default async function FounderHealthPage() {
  const session = await pagePlatformAdmin()
  const locale = session.locale
  const d = dict(locale)
  const t = d.founder

  const supabase = await createClient()

  const [roster, { data: findings }, claims, intents] = await Promise.all([
    // scoped-by: platform_centers() is a security definer RPC over all centres, gated on
    // app.is_platform_admin(). See 20260811000020_platform_panel.sql.
    supabase.rpc('platform_centers'),
    // §11.13's three questions over every ledger, which answer with the rows that are wrong —
    // so an empty answer is the all-clear rather than an empty screen.
    // scoped-by: platform_reconciliation() is gated on app.is_platform_admin() the same way
    // platform_centers is. See 20260811000081_settle_billing.sql.
    supabase.rpc('platform_reconciliation'),
    // Money customers say they have sent, oldest first — the same read the panel's queue makes,
    // for its count rather than for its cards.
    // scoped-by: every centre is the point — recharge_claims_owner_read answers
    // app.is_platform_admin() in 20260811000084.
    founderQueue(supabase),
    // Purchases started and not finished. Capped, and the cap is why the count is drawn as
    // "at least" when it is reached: a queue deeper than this is a screen of its own, and a
    // number that quietly stops at two hundred would be a lie about the worst day.
    // scoped-by: payment_intents_owner_read allows a platform admin every centre's rows, which
    // is what this list is. See 20260811000057_payment_intents.sql.
    supabase
      .from('payment_intents')
      .select('id, created_at')
      .in('state', ['pending', 'initiated'])
      .order('created_at', { ascending: true })
      .limit(INTENT_LIMIT),
  ])

  const list = customers(roster.data, t.unnamed)
  const totals = platformTotals(list)

  /** The oldest of a queue, as a Dhaka calendar day — null when the queue is empty. */
  const oldestOf = (rows: readonly { created_at?: string; submittedAt?: string }[]) => {
    const first = rows[0]
    const at = first === undefined ? undefined : (first.submittedAt ?? first.created_at)
    return at === undefined ? null : formatDate(dhakaMoment(at).date, locale)
  }

  const openClaims = claims ?? []
  const openIntents = intents.data ?? []
  const claimDay = oldestOf(openClaims.map((c) => ({ submittedAt: c.submittedAt })))
  const intentDay = oldestOf(openIntents)

  /** Nothing anywhere: the sentence a founder reads on a good morning. */
  const clear =
    openClaims.length === 0 &&
    openIntents.length === 0 &&
    totals.owing === 0 &&
    (!findings || findings.length === 0)

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
      <div>
        <Link
          href="/founder"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.health.title}</h1>
        <p className="mt-1 text-ink-soft">{t.health.lead}</p>
      </div>

      <FounderNav here="health" words={t.nav} />

      {clear ? (
        <Card>
          <p className="font-medium text-ink">{t.health.clear}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.health.clearHint}</p>
        </Card>
      ) : null}

      {/* What is waiting on us. Two queues and a call list, each with its own age — an age is
          what turns a count into a decision, because a queue of one from this morning and a
          queue of one from Tuesday are the same number and different problems. */}
      <Card>
        <h2 className="font-semibold text-ink">{t.health.waitingTitle}</h2>

        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {/* The read that failed is said out loud rather than drawn as a zero: "no recharges
              to confirm" and "we could not read the recharges" are opposite mornings. */}
          {claims === null ? (
            <li className="text-ink-soft">{t.health.claimsUnknown}</li>
          ) : (
            <li className="text-ink">
              {openClaims.length === 0
                ? t.health.claimsNone
                : t.health.claims(digits(openClaims.length, locale), claimDay ?? '')}
            </li>
          )}

          {intents.error ? (
            <li className="text-ink-soft">{t.health.purchasesUnknown}</li>
          ) : (
            <li className="text-ink">
              {openIntents.length === 0
                ? t.health.purchasesNone
                : t.health.purchases(
                    openIntents.length >= INTENT_LIMIT
                      ? t.health.atLeast(digits(openIntents.length, locale))
                      : digits(openIntents.length, locale),
                    intentDay ?? '',
                  )}
            </li>
          )}

          <li className="text-ink">
            {totals.owing === 0
              ? t.health.owingNone
              : t.health.owing(digits(totals.owing, locale), formatTaka(totals.owedBdt))}
          </li>
        </ul>
      </Card>

      {/* The books, from §11.13's own function. A finding is a sentence naming the centre, and
          an empty answer is the one that sells: the balance cache, the chain and the line all
          agree. */}
      <Card>
        <h2 className="font-semibold text-ink">{t.reconciliation.title}</h2>
        {!findings || findings.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t.reconciliation.holds}</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm font-medium text-ink">
              {t.reconciliation.findings(findings.length)}
            </p>
            <ul className="flex flex-col gap-1.5">
              {findings.map((f) => (
                <li
                  key={`${f.question}-${f.coaching_center_id}-${f.detail}`}
                  className="text-sm text-ink-soft"
                >
                  <span className="font-medium text-ink">
                    {t.reconciliation.question(f.question)}
                  </span>{' '}
                  — {f.coaching_center_name}: {f.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* What this page cannot see. Both are standing facts rather than faults, and both would
          otherwise be read as a figure that is wrong. */}
      <p className="max-w-3xl text-xs text-ink-soft">{t.health.blindSpots}</p>
      <p className="max-w-3xl text-xs text-ink-faint">{t.gatewayNote}</p>
    </main>
  )
}
