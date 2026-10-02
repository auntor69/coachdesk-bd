import Link from 'next/link'

import { Card } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { digits, formatDate, todayInDhaka } from '@/lib/bd/time'
import { currentPriceVersion, livePromotion, ownClaims } from '@/lib/billing/claims'
import {
  reachedBonusBps,
  rechargeSuggestions,
  type BonusTier,
} from '@/lib/billing/recharge'
import { rechargeWords } from '@/lib/i18n/recharge'
import { acceptedVersions } from '@/lib/legal/acceptance'
import { copyFor, policyFor, policyHref, RECHARGE_POLICIES } from '@/lib/legal/policies'
import { pendingAcceptances } from '@/lib/legal/reask'
import { formatTaka } from '@/lib/money'
import { dailyRatePoisha, monthlyBillBdt, planFor } from '@/lib/plans'
import { centerStudentCount } from '@/lib/students/headcount'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  RechargeForm,
  type RechargeFormWords,
  type Suggestion,
} from './recharge-form'

/**
 * The recharge card — MASTERPLAN §11.6 and §11.9, build-order step 25's screen.
 *
 * WHAT IT ANSWERS, IN ORDER: what the balance holds, what a day costs, how many days that
 * is, and what to send to put more on it. That is §20.4's set of questions for a prepaid
 * product, and the order is the owner's own: the days-left figure is the one a person opens
 * this screen for, and it is the reason the rail in the shell warns at fourteen days.
 *
 * IT IS ITS OWN SERVER COMPONENT RATHER THAN MORE OF THE PLAN PAGE, and that is a
 * deliberate boundary. Every figure here is about the *balance*, which the plan page has
 * never read — and the reads are four, not one: three counts to price with, the card in
 * force, the promotion in force, and this centre's claims. Putting them in the page would
 * have meant a page that already assembles ten queries assembling fourteen, and a screen
 * whose recharge half cannot be tested or moved without it.
 *
 * THE RATE IS COMPUTED HERE AND NOT READ OFF THE SESSION. `session.billing` already carries
 * what the burn answered (`dailyRatePoisha`, `daysLeft`, `lapsed`) because the session
 * settles the day — so the *facts* below come from there and cost nothing. What does not
 * come from there is the size the price is quoted from: `monthlyBillBdt` needs the three
 * counts, and the session carries neither the teacher nor the branch count. Both are the
 * same arithmetic on the same inputs, so they agree by construction — and the assertion
 * that they do is `tests/daily-rate.test.ts` plus the RLS suite's own worked figures.
 *
 * WHAT IT DOES NOT DO YET: it does not replace the subscription cards below it. Retiring
 * the coverage-based buy flow is build-order step 28, and until then this card and that one
 * are both on the screen — one adding money to a balance, the other selling months of
 * coverage. Both are honest about what they do; the second stops being offered when §11.14's
 * cutover lands.
 */
export async function RechargePanel() {
  const session = await getSession()
  if (!session?.active) return null

  const { locale, active } = session
  const words = rechargeWords(locale)
  const plan = planFor(active.plan)

  // A free tier burns nothing (§11.6: the arithmetic returns zero), so there is no balance
  // to top up and no rate to show. The card is absent rather than explaining its own
  // irrelevance — the same rule the plan page follows for the teacher tiers' ceiling.
  if (plan.pricing === 'free') return null

  const supabase = await createClient()
  const admin = createAdminClient(session.userId)

  const [students, { count: teachers }, { count: branches }] = await Promise.all([
    centerStudentCount(supabase, active.centerId),
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', active.centerId)
      .eq('active', true),
    supabase
      .from('branches')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', active.centerId)
      .eq('active', true),
  ])

  const counts =
    students !== null && teachers !== null && branches !== null
      ? { students, teachers, branches: Math.max(1, branches) }
      : null

  /*
   * The card and the promotion, which is what makes this an offer rather than a price.
   *
   * Read on the server with the admin key because §11.11 keeps promotions unreachable from
   * a centre's own session — and read at all only when the counts arrived, since a quote
   * against an unknown size is a figure somebody sends money against.
   */
  const today = todayInDhaka(new Date())
  const card = counts ? await currentPriceVersion(supabase, today) : null
  const promotion = card ? await livePromotion(admin, card.id, new Date()) : null
  const tiers: BonusTier[] = promotion?.tiers ?? []

  const monthlyPoisha = counts
    ? monthlyBillBdt(plan, counts.students, counts.teachers, counts.branches) * 100
    : 0
  const daily = counts
    ? dailyRatePoisha(plan, counts.students, counts.teachers, counts.branches)
    : null

  /*
   * Every figure in these rungs is written here, on the server, and handed to the form as
   * text — see `Suggestion`. `rechargeSuggestions` prices them; what is added is the
   * wording, because the words module's helpers are functions and a function cannot cross
   * into a Client Component.
   */
  const suggestions: Suggestion[] = card
    ? rechargeSuggestions(monthlyPoisha, tiers, daily).map((s) => {
        // The centre's own monthly figure is what the ladder's months are counted
        // from (migration 20260811000088) — so "3 months · 5%" is true on every tier.
        const bps = reachedBonusBps(tiers, s.payPoisha, monthlyPoisha)
        return {
          months: s.months,
          value: String(s.payPoisha / 100),
          amount: `${words.offerMonths(s.months)} · ${formatTaka(s.payPoisha / 100)}`,
          bonus:
            s.bonusPoisha > 0
              ? words.offerBonus(formatTaka(s.bonusPoisha / 100), bps)
              : words.offerNoBonus,
          days: s.days === null ? null : words.daysAtSize(digits(s.days, locale)),
        }
      })
    : []

  /*
   * The tick's sentences and the two documents it names (§14.1).
   *
   * THE TITLES ARE THE PAGES' OWN, read out of `lib/legal/policies.ts` rather than typed
   * again here, so a document renamed in one place cannot be linked to under an old name in
   * the other. The form receives them as strings, because it is a Client Component and the
   * seven documents are most of a megabyte of prose it must not carry.
   */
  const terms = policyFor('prepaid_billing')
  const refunds = policyFor('refunds')
  const formWords: RechargeFormWords = {
    offerTitle: words.offerTitle,
    typedLabel: words.typedLabel,
    typedHint: words.typedHint,
    trxLabel: words.trxLabel,
    trxHint: words.trxHint,
    senderLabel: words.senderLabel,
    senderHint: words.senderHint,
    confirm: words.confirm,
    confirming: words.confirming,
    agreeLead: words.agreeLead,
    agreeJoin: words.agreeJoin,
    agreeTail: words.agreeTail,
    agreeChanged: words.agreeChanged,
    termsLabel: copyFor(terms, locale).title,
    refundsLabel: copyFor(refunds, locale).title,
  }

  /*
   * Has either document changed since this centre last agreed? (§14.1's re-ask rule.)
   *
   * `pendingAcceptances` answers `[]` both when everything is current and when the record
   * could not be read, and that is deliberate: a dropped read must not make a long-standing
   * customer look like somebody who never agreed to anything. So the only thing this changes
   * is one line of amber on the form, and never a refusal.
   */
  const accepted = await acceptedVersions(supabase, session.userId)
  const askAgain = pendingAcceptances(RECHARGE_POLICIES, accepted).length > 0

  const claims = await ownClaims(supabase, active.centerId)

  /*
   * WHERE THE MONEY GOES. `NEXT_PUBLIC_SALES_PHONE` is the founder's own number, empty in
   * every deployment because it is not in the repository — and on this card that is worse
   * than on the WhatsApp chip it was introduced for, because a recharge without a number to
   * send to is not a smaller recharge, it is a form that cannot be completed. So the send
   * block and the form are drawn only when there is a number, and the card says so plainly
   * otherwise rather than offering a button whose instruction is missing.
   */
  const paymentPhone = normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')
  const canRecharge = Boolean(paymentPhone) && card !== null && suggestions.length > 0
  const isOwner = active.role === 'owner'

  return (
    <Card>
      <h2 className="font-semibold text-ink">{words.title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{words.body}</p>

      {/*
        THE THREE FIGURES, ruled rather than boxed, the same shape the plan page uses for
        its own strip — one container with dividers and not three cards (§20.7).
      */}
      <dl
        className="mt-3 grid divide-y divide-line rounded-xl border border-line
          bg-surface-alt sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        <div className="p-3">
          <dt className="text-sm text-ink-soft">{words.factBalance}</dt>
          <dd className="num text-lg font-bold text-ink">
            {formatTaka(session.billing.balancePoisha === null ? 0 : session.billing.balancePoisha / 100)}
          </dd>
        </div>
        <div className="p-3">
          <dt className="text-sm text-ink-soft">{words.factDaily}</dt>
          <dd className="num text-lg font-bold text-ink">
            {daily === null ? '—' : formatTaka(daily / 100)}
          </dd>
        </div>
        <div className="p-3">
          <dt className="text-sm text-ink-soft">{words.factDays}</dt>
          <dd className="num text-lg font-bold text-ink">
            {session.billing.daysLeft === null
              ? '—'
              : digits(session.billing.daysLeft, locale)}
          </dd>
        </div>
      </dl>

      {counts && daily !== null && monthlyPoisha > 0 && (
        <p className="mt-2 text-xs text-ink-faint">
          {words.sizedBy(digits(counts.students, locale), digits(counts.teachers, locale))} ·{' '}
          {formatTaka(monthlyPoisha / 100)}
        </p>
      )}

      {/*
        THE ONE STATUS A CUSTOMER MUST SEE WITHOUT ASKING: a dry balance is why the product
        has gone read-only, and "nothing is lost while it is pending" is §11.9's own promise
        about the window between sending money and a human checking it. Said here rather
        than only in the shell's banner, because this is the screen the banner sends them to.
      */}
      {session.billing.lapsed && (
        <p className="mt-3 rounded-xl border border-late/40 bg-late/5 p-3 text-sm text-ink">
          {words.unreadable}
        </p>
      )}

      {canRecharge && (
        <>
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="font-medium text-ink">{words.sendTitle}</h3>
            <p className="mt-1 text-sm text-ink-soft">
              {words.sendBody(formatBdMobile(paymentPhone as string))}
            </p>
            {/* §11.6 commits to saying this before the tap, and §14.1 commits to it leading
                somewhere: the sentence used to be a dead end, so the words that make the
                promise now link to the page that keeps it. */}
            <p className="mt-1 text-xs text-ink-faint">
              {words.nonRefundable}{' '}
              <Link
                href={policyHref(terms.slug)}
                target="_blank"
                className="font-medium text-brand-700 underline"
              >
                {formWords.termsLabel}
              </Link>
            </p>
          </div>

          {isOwner ? (
            <RechargeForm
              suggestions={suggestions}
              words={formWords}
              termsHref={policyHref(terms.slug)}
              refundsHref={policyHref(refunds.slug)}
              askAgain={askAgain}
            />
          ) : (
            <p className="mt-3 text-sm text-ink-soft">{words.ownerOnly}</p>
          )}
        </>
      )}

      {!canRecharge && <p className="mt-3 text-sm text-ink-soft">{words.unreadable}</p>}

      {/*
        WHAT HAS BEEN SENT, newest first, including the closed ones. §11.9's "nothing is lost
        while it is pending" is only credible if the row is still on the screen after a
        rejection — with the reason, because a refusal without one becomes a phone call.
      */}
      {claims.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="font-medium text-ink">{words.waitingTitle}</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {claims.map((claim) => (
              <li key={claim.id} className="rounded-xl border border-line bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="num font-semibold text-ink">
                    {formatTaka(claim.quotedPoisha / 100)}
                  </span>
                  <span className="text-sm font-medium text-ink-soft">
                    {claim.state === 'submitted'
                      ? words.stateSubmitted
                      : claim.state === 'approved'
                        ? words.stateApproved
                        : claim.state === 'rejected'
                          ? words.stateRejected
                          : words.stateExpired}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {claim.referenceCode} · TrxID {claim.trxId} ·{' '}
                  {formatDate(todayInDhaka(new Date(claim.submittedAt)), locale)}
                </p>
                {claim.state === 'approved' && claim.grantedPoisha !== null && (
                  <p className="mt-1 text-sm text-present">
                    {words.creditedLine(
                      formatTaka(claim.grantedPoisha / 100),
                      claim.grantedBonusPoisha !== null && claim.grantedBonusPoisha > 0
                        ? formatTaka(claim.grantedBonusPoisha / 100)
                        : '',
                    )}
                  </p>
                )}
                {claim.state === 'rejected' && claim.rejectReason !== null && (
                  <p className="mt-1 text-sm text-absent">
                    {words.reason[claim.rejectReason as keyof typeof words.reason]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {claims.length === 0 && canRecharge && (
        <p className="mt-3 text-xs text-ink-faint">{words.noneSent}</p>
      )}
    </Card>
  )
}
