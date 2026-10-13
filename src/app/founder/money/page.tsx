import Link from 'next/link'

import { Card } from '@/components/ui'
import { pagePlatformAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { currentPeriodMonth, digits, formatMonth } from '@/lib/bd/time'
import { growthByMonth, monthKeys } from '@/lib/platform/growth'
import { dict } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { customers, platformTotals } from '@/lib/platform/centers'
import { FounderNav } from '../nav'

/*
 * NO generateMetadata, like the rest of the panel — see the note at the top of ../page.tsx.
 */

/** How many months the growth table draws, this one included. */
const MONTHS = 6

/**
 * How much ledger history is read for the monthly figures.
 *
 * Six months of eleven centres is under two thousand rows, and the cap is here rather than
 * absent so that the first customer with two hundred branches cannot turn this page into a
 * query that times out. The screen says when the cap was reached, because a monthly total
 * computed from a truncated read is a wrong number that looks like a right one.
 */
const LEDGER_LIMIT = 6000

/**
 * Money and growth — MASTERPLAN §16.1's third question, and the only screen in the panel that
 * looks backwards.
 *
 * WHY THE PANEL NEEDED IT. Everything else here answers "what is true now": who is worth what,
 * what is waiting on us, who can get in. None of it can answer the two questions a founder
 * actually asks on a Friday — is the money coming in growing, and is it covering what we burn
 * — because a snapshot has no direction in it. This screen is six months of the same two
 * numbers, and the arithmetic is deliberately boring: recharged in, burned out, net.
 *
 * RECHARGED AND NOT "REVENUE", which is §9.1's rule and it matters most on this screen. The
 * prepaid model means money arriving is a *liability* until the days are burned, so the figure
 * beside "burned" is what customers put in, and the balance we are holding is drawn on its own
 * because that is the part we owe back in days. A founder who reads the first as revenue will
 * make a bad decision about a salary, and no screen in this product uses that word.
 *
 * WHERE THE NUMBERS COME FROM, and why there is no new function. Per customer, from
 * `platform_centers()` — the same roster the list reads, so the bill, the size and the totals
 * strip cannot disagree with the other screen. Over time, from `billing_ledger`: one read of
 * the last six months, grouped by Dhaka month in JavaScript. The ledger is the table that
 * already holds every taka both ways (§11.6), which is exactly what makes it the honest source
 * — a payment recorded against a centre and a promotion bonus that gave credit are both rows
 * in it, and nothing else in the schema has that property.
 *
 * SIX MONTHS AND NOT TWELVE. A year of daily charges is the same read twice as large for a
 * table where the last six rows are the ones anybody acts on. The month list is built from
 * `addMonths` on the current Dhaka month, not from the rows, so a month with no money in it
 * is drawn as a row of zeros rather than skipped — a gap in a growth table is a month that
 * looks like it was never billed.
 */
export default async function FounderMoneyPage() {
  const session = await pagePlatformAdmin()
  const locale = session.locale
  const d = dict(locale)
  const t = d.founder

  const supabase = await createClient()

  /*
   * Six months back, as period months — YYYY-MM-01, the shape `period_month` uses and the
   * shape `formatMonth` renders.
   *
   * TWO DIFFERENT KEYS, and mixing them is a silent zero. The ledger's `created_at` is a
   * timestamptz, so the month a row belongs to is a *Dhaka* month — the burn is charged on
   * Dhaka days and a charge at 1am on the first of the month is the previous month in UTC. The
   * rows are therefore grouped by `todayInDhaka(...).slice(0, 7)`, and the read starts at the
   * earliest Dhaka month's first instant rather than at midnight UTC, which would sweep six
   * hours of the wrong month in.
   */
  const months = monthKeys(currentPeriodMonth(), MONTHS)
  const earliest = months[0] ?? currentPeriodMonth()
  const since = new Date(`${earliest}T00:00:00+06:00`).toISOString()

  const [roster, ledger, balances] = await Promise.all([
    // scoped-by: platform_centers() is a security definer RPC over all centres, gated on
    // app.is_platform_admin(). See 20260811000020_platform_panel.sql.
    supabase.rpc('platform_centers'),
    // Every taka in and out, six months of it. One read, grouped below.
    // scoped-by: every centre is the point of this panel; billing_ledger_owner_read in
    // 20260811000078 answers app.is_platform_admin().
    supabase
      .from('billing_ledger')
      .select('id, kind, amount_poisha, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(LEDGER_LIMIT),
    // What we are holding. The sum is worked out here rather than by a function because the
    // number of rows is the number of customers, which is what a panel is for.
    // scoped-by: every centre is the point of this panel; centers_member_read in
    // 20260811000002_rls_policies.sql answers app.is_platform_admin().
    supabase.from('coaching_centers').select('id, balance_poisha'),
  ])

  const list = customers(roster.data, t.unnamed)
  const totals = platformTotals(list)
  const heldPoisha = (balances.data ?? []).reduce(
    (sum, row) => sum + (Number(row.balance_poisha) || 0),
    0,
  )

  /*
   * The six months, each with its three figures — all of the arithmetic in
   * lib/platform/growth.ts, where it is tested against the Dhaka month boundary and the four
   * ledger kinds that are deliberately in neither money column.
   *
   * The signups come off the roster's own `created_at`, which is the only place a subscription
   * date lives, and the money comes out of the ledger. Nothing is computed here, so the page's
   * only job is to draw what it is given.
   */
  const rows = growthByMonth({
    months,
    signedUpAt: list.map((c) => c.createdAt),
    entries: ledger.data ?? [],
  })

  const truncated = (ledger.data ?? []).length >= LEDGER_LIMIT

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
      <div>
        <Link
          href="/founder"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.growth.title}</h1>
        <p className="mt-1 text-ink-soft">{t.growth.lead}</p>
      </div>

      <FounderNav here="money" words={t.nav} />

      {/* What is true today, in the panel's own labels — the same words the list's strip uses,
          so a figure moved from one screen to the other keeps its name. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label={t.totals.centers} value={digits(totals.centers, locale)} />
        <Stat label={t.totals.active} value={digits(totals.active, locale)} />
        <Stat label={t.totals.trial} value={digits(totals.trial, locale)} />
        <Stat label={t.totals.quiet} value={digits(totals.quiet, locale)} />
        <Stat label={t.totals.mrr} value={formatTaka(totals.mrrBdt)} />
        <Stat label={t.totals.pipeline} value={formatTaka(totals.pipelineBdt)} />
        <Stat label={t.totals.paid} value={formatTaka(totals.paidBdt)} />
        {/* The liability, on its own rather than beside the money in: this is what we owe back
            in days, and it is the one figure here that is not ours. */}
        <Stat label={t.growth.held} value={formatTaka(heldPoisha / 100)} />
      </dl>

      <Card>
        <h2 className="font-semibold text-ink">{t.growth.monthsTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.growth.monthsLead}</p>

        {ledger.error ? (
          <p className="mt-2 text-sm text-ink-soft">{t.growth.unreadable}</p>
        ) : (
          <>
            {/*
              * Five columns want columns rather than squeezed ones: a Bangla month name and
              * four figures do not fit a 320px phone, and a wrapped month above a wrapped
              * number is a row nobody can read across. So this is the same bleed-and-scroll
              * every other wide table in the product uses — `-mx-4 overflow-x-auto px-4`,
              * which lets the sheet run edge to edge instead of stopping inside the page's
              * own gutter — with a minimum width so the columns keep their natural size. The
              * two money columns are right-aligned so a bad month is visible down the page.
              *
              * And the headers carry `scope="col"`, which is the one thing the hand-rolled
              * `<table>` here had that the five shared-cell tables did not: a screen reader
              * reading a cell needs the column it belongs to, and this is a sheet of figures
              * where which figure it is is half of what the number means.
              */}
            <div className="mt-3 -mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[26rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-soft">
                    <th scope="col" className="py-1 font-medium">{t.growth.month}</th>
                    <th scope="col" className="py-1 text-right font-medium">{t.growth.signups}</th>
                    <th scope="col" className="py-1 text-right font-medium">{t.growth.recharged}</th>
                    <th scope="col" className="py-1 text-right font-medium">{t.growth.burned}</th>
                    <th scope="col" className="py-1 text-right font-medium">{t.growth.net}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.month} className="border-b border-line last:border-0">
                      <td className="py-1.5 text-ink">{formatMonth(row.month, locale)}</td>
                      <td className="num py-1.5 text-right text-ink">
                        {digits(row.signups, locale)}
                      </td>
                      <td className="num py-1.5 text-right text-ink">
                        {formatTaka(row.rechargedPoisha / 100)}
                      </td>
                      <td className="num py-1.5 text-right text-ink">
                        {formatTaka(row.burnedPoisha / 100)}
                      </td>
                      {/*
                        * Signed, and a loss is drawn as one: netting a bad month into an
                        * absolute figure would make every month look like a good one.
                        *
                        * `text-absent` and not `text-red-700`, which is a different red from
                        * the one every other figure in the product uses to mean "this is bad"
                        * — `absent` is what a missed day, an unpaid invoice and a failed
                        * action are all in, and the panel's own chips should follow it too.
                        */}
                      <td
                        className={`num py-1.5 text-right font-semibold ${
                          row.rechargedPoisha - row.burnedPoisha < 0 ? 'text-absent' : 'text-ink'
                        }`}
                      >
                        {formatTaka((row.rechargedPoisha - row.burnedPoisha) / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {truncated && <p className="mt-2 text-xs text-ink-faint">{t.growth.truncated}</p>}
          </>
        )}
      </Card>

      {/* Why the two money columns add up the way they do, said once, because a grant or a
          refund landing in neither of them looks like a bug to somebody who remembers it. */}
      <p className="max-w-3xl text-xs text-ink-soft">{t.growth.whatCounts}</p>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="num mt-0.5 text-lg font-bold text-ink">{value}</dd>
    </div>
  )
}
