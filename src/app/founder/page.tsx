import Link from 'next/link'
import type { Route } from 'next'

import { Card } from '@/components/ui'
import { pagePlatformAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { founderQueue } from '@/lib/billing/claims'
import { transferReference } from '@/lib/billing/receipt'
import { rechargeWords } from '@/lib/i18n/recharge'
import { formatBdMobile } from '@/lib/bd/phone'
import { digits, formatDate, hasPassed, todayInDhaka } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { PLANS, isTeacherTier, planFor, planName, type PlanId } from '@/lib/plans'
import { ACCOUNT_KINDS, type AccountKind } from '@/lib/accounts/kind'
import { MONTHS_COVERED } from '@/lib/platform/billing'
import { readPlatformSettings } from '@/lib/platform/settings'
import {
  billLabel,
  customers,
  platformTotals,
  sizeLine,
  type CenterStatus,
  type Customer,
} from '@/lib/platform/centers'
import { leverLabels, leverSentences } from '@/lib/i18n/levers'
import { CenterBilling } from './center-billing'
import { CenterPurchases, type OpenPurchase } from './center-purchases'
import { AskedToUpgrade } from './asked-to-upgrade'
import { StaffReset } from './staff-reset'
import { RechargeQueue, type QueueClaim, type QueueWords } from './recharge-queue'
import { PlatformSettings } from './platform-settings'
import { FounderNav } from './nav'

/*
 * NO generateMetadata, on purpose.
 *
 * Every other screen exports one. This page inherits the root layout's title
 * instead, so a browser tab, a history entry or a shared screenshot says
 * "CoachDesk" rather than naming an admin panel. Same reasoning as the 404 in
 * pagePlatformAdmin: there is nothing secret here that the database is not already
 * protecting, but the panel lists every customer by name and it should not
 * introduce itself to anyone who has not been told about it.
 */

/**
 * Badge colours per center_status. Cancelled is grey — it is over, not urgent.
 *
 * From the semantic tokens and not from Tailwind's own red and amber, which is the rule
 * everywhere else in the app: `absent` and `late` are the two colours this product has one
 * meaning for each, the same pair the register uses for a missing child and a late one. A
 * chip in `text-red-700` is a second red beside them, a shade off, and the founder panel is
 * where it was found — see the note in ./money/page.tsx.
 */
const STATUS_STYLE: Record<CenterStatus, string> = {
  active: 'border-brand-200 bg-brand-50 text-brand-800',
  trial: 'border-late/40 bg-late/5 text-late',
  suspended: 'border-absent/30 bg-absent/5 text-absent',
  cancelled: 'border-line bg-surface-alt text-ink-soft',
}

/** The order the plan dropdown offers, cheapest first — an upgrade path read down. */
const PLAN_ORDER = Object.keys(PLANS) as PlanId[]

/** The order the status dropdown offers, matching center_status. */
const STATUS_ORDER: CenterStatus[] = ['trial', 'active', 'suspended', 'cancelled']

/**
 * The orders the list can be read in, and the one the page opens on.
 *
 * FOUR, AND EACH ANSWERS A DIFFERENT MORNING. `bill` is the default and not a
 * preference: this panel exists to say who is worth what, and a founder who has not
 * chosen an order has asked the only question the screen was built for. `quiet` is the
 * churn list — a centre that stopped using the product last week is the one worth a
 * phone call, and by the time it is on the money screens it has already decided.
 *
 * A CLOSED LIST, like STATUS_ORDER, because the key arrives in a URL: anything not in
 * it is ignored rather than passed to a comparator.
 */
const SORTS = ['bill', 'quiet', 'newest', 'name'] as const

type SortKey = (typeof SORTS)[number]

/**
 * The four comparators, always biggest-and-first.
 *
 * A RECORD RATHER THAN A SWITCH so the compiler counts them: a fifth key added to
 * SORTS without a comparator is a type error rather than a dropdown entry that leaves
 * the list in whatever order it arrived in.
 *
 * `quiet` puts the gone-quiet ahead and orders them by how long, and a centre that has
 * never been used sorts at the end of that group rather than the start — it is the
 * loudest call to make, but `daysQuiet` is null for it and a screen sorted by a number
 * it does not have would be inventing one. `newest` reads the ISO strings, which sort
 * as dates without parsing them: a `timestamptz` from PostgREST is fixed-width UTC.
 */
const ORDER: Record<SortKey, (a: Customer, b: Customer) => number> = {
  bill: (a, b) => b.billBdt - a.billBdt,
  quiet: (a, b) =>
    Number(b.quiet) - Number(a.quiet) || (b.daysQuiet ?? 0) - (a.daysQuiet ?? 0),
  newest: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  name: (a, b) => a.name.localeCompare(b.name),
}

/**
 * The founder's own screen: every centre, what it costs them, and whether they
 * are still using it.
 *
 * OUTSIDE THE (app) GROUP, and that is structural rather than tidiness. `(app)`'s
 * layout redirects anyone without an active membership to /onboarding — correct for
 * every screen in the product and wrong for this one, because `is_platform_admin`
 * is a property of a person and not of a centre. A founder whose own demo centre is
 * suspended must still be able to read the panel that says so.
 *
 * It also means there is no AppShell: no bottom nav, no centre switcher, no
 * language toggle. Those all belong to somebody running a coaching centre, and the
 * one thing this page needs from a shell is the way back, which is the link at the
 * top.
 *
 * TWO QUERIES, and the first is an RPC rather than a table read.
 * `platform_centers()` is security definer and computes the counts on the far side of
 * the RLS line the founder is deliberately not allowed to cross — see the migration for
 * why that is the privacy-preserving option rather than the lazy one. Nothing on this
 * screen touches a student row, because nothing here can. The second is the open
 * purchases, which is a plain read: `payment_intents_owner_read` already answers
 * `app.is_platform_admin()`, so there is nothing for a function to do.
 *
 * WHAT IT HAS NOW: a search, a kind filter, a standing filter and four orders — see
 * SORTS and the note on `matched`. They narrow what is already on the page and nothing
 * else: the search reads names, areas, and every way the panel holds to reach somebody —
 * the owner's address, the owner's number and the centre's own — so a founder can find
 * the customer who is on the line with them without scrolling eleven cards, and the kind
 * filter answers the one question the panel could not before (§16.1: a solo teacher and a
 * coaching centre were the same row here, and they are two different conversations).
 *
 * AND ONE THING BEHIND A CUSTOMER: their name opens `./[centerId]/page.tsx`, the record —
 * what they are, what they use, what their money has done, who can get in, and what we have
 * done to them. That is *our* side of one customer, and it is the reason this list can stay a
 * list: the questions that need five kinds of fact in one place have somewhere to go.
 *
 * WHAT IT STILL DOES NOT HAVE is a link into any centre's *data*. The record behind a
 * customer holds none of their students, their register or their fees, and there will never
 * be a screen that does: a founder reading a child's marks is the failure this whole
 * arrangement — a definer function that returns counts and nothing else — is built to prevent.
 * The CSV button covers the one thing a page cannot: taking the numbers somewhere they can be
 * added up.
 */
export default async function FounderPage({
  searchParams,
}: {
  /**
   * The list's own controls, read from the URL.
   *
   * A GET form and not client state, and that is the whole design: the founder's list is
   * read, telephoned from and returned to, and a filter that lives in memory is lost the
   * moment they open a customer in another tab. It also means the screen keeps working with
   * no JavaScript at all, and a filtered view is a URL somebody can send themselves.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await pagePlatformAdmin()
  const locale = session.locale
  const d = dict(locale)
  const t = d.founder

  // The recharge card's words, which are a fragment of their own: see
  // lib/i18n/recharge.ts for why the two dictionaries cannot carry them yet.
  const words = rechargeWords(locale)

  const supabase = await createClient()

  // Not scoped by coaching_center_id, and neither can be: the whole point is every
  // centre. The gate on the first is app.is_platform_admin() inside the function, and on
  // the second it is the same call inside the policy. The third is §11.13's
  // reconciliation — three questions over every centre's ledger, returning only the
  // rows that are wrong, so no rows is the all-clear rather than an empty answer.
  const [
    { data, error },
    { data: intents },
    { data: findings },
    queue,
    { data: moneyRows },
    { data: kindRows, error: kindsError },
  ] = await Promise.all([
    // scoped-by: platform_centers() is a security definer RPC over all centres,
    // gated on app.is_platform_admin(). See 20260811000020_platform_panel.sql.
    supabase.rpc('platform_centers'),
    // Everything a customer has started paying for and not finished. Capped, because a
    // panel is not a queue processor: if this ever runs long the answer is a screen of
    // its own, not a longer card.
    // scoped-by: payment_intents_owner_read allows a platform admin every centre's
    // rows, which is what this list is. See 20260811000057_payment_intents.sql.
    supabase
      .from('payment_intents')
      .select(
        'id, coaching_center_id, purpose, quantity, amount_bdt, state, provider, created_at, expires_at, target_plan',
      )
      .in('state', ['pending', 'initiated'])
      .order('created_at', { ascending: false })
      .limit(60),
    // scoped-by: platform_reconciliation() is gated on app.is_platform_admin() the
    // same way platform_centers is. See 20260811000081_settle_billing.sql.
    supabase.rpc('platform_reconciliation'),
    // The recharges customers say they have sent, oldest first, and the one read here
    // that is deliberately every centre at once — see lib/billing/claims.ts, where
    // `recharge_claims_owner_read` answering app.is_platform_admin() is written down.
    founderQueue(supabase),
    // The prepaid balance and the line it pays for, for every centre — §11.7's two levers
    // work from both, and neither is on `platform_centers()`, whose shape is the panel's
    // roster of usage rather than its money. A plain read because nothing has to be
    // computed: `centers_member_read` already answers `app.is_platform_admin()`, so there
    // is no definer function to write.
    // scoped-by: every centre is the point of this panel; centers_member_read in
    // 20260811000002_rls_policies.sql is what authorises it.
    supabase
      .from('coaching_centers')
      .select('id, balance_poisha, charged_through'),
    /*
     * What each account says it is — in a read of its own, and the reason is a deployment order
     * rather than tidiness.
     *
     * `account_kind` arrived in 20260811000091, and an app deploy can land before the migration
     * that adds it. Named in the read above, a database one migration behind would fail *that*
     * read — and the two levers on every card are drawn from it, so the whole panel would refuse
     * to move a balance over one decorative column. So the money is read with the columns the
     * panel has always had, and the kind is asked for separately; a failed read here costs the
     * kind filter and nothing else.
     */
    supabase.from('coaching_centers').select('id, account_kind'),
  ])

  const list = customers(data, t.unnamed)
  const totals = platformTotals(list)

  /*
   * The money, per centre, for the card's two levers.
   *
   * A MISSING ROW IS NULL AND NOT A ZERO, which is the distinction every screen in this
   * product draws: a centre whose balance could not be read is not a centre holding
   * nothing, and a grant worked out from an assumed line would be a date nobody can
   * predict. `./center-billing.tsx` says what the card does with the null.
   */
  const money = new Map((moneyRows ?? []).map((row) => [row.id, row]))

  /**
   * What each account said it was (20260811000091).
   *
   * A MISSING ROW IS READ AS A TEACHER — the column's own default, and the safe direction: a
   * teacher and a centre are two different conversations, and hiding a customer from a founder
   * who is looking for them is the worse failure of the two.
   *
   * A FAILED READ IS NOT THE SAME THING, and that is what `kindsReadable` is for. If the column
   * does not exist yet — an app deploy ahead of its migration — every row would read as a teacher
   * and the filter would answer "here are the teachers" with the whole book. So the filter is not
   * drawn at all in that case: a control we cannot evaluate is a control that lies, and this page
   * already has one shape for "we could not read that": say so.
   */
  const kinds = new Map((kindRows ?? []).map((row) => [row.id, row.account_kind]))
  const kindsReadable = !kindsError

  /*
   * The list's controls: a search, two filters and an order.
   *
   * NARROWING IS DONE HERE, ON THE SERVER, over the rows the page has already read. There is
   * no second query and no query builder in the client: eleven customers fit in memory and a
   * thousand would fit in the RPC's own page — the day this needs SQL paging is the day it
   * needs a screen of its own, which the header already says.
   *
   * EVERY VALUE IS VALIDATED AGAINST A CLOSED LIST and a bad one is ignored rather than
   * refused: these arrive from a URL, so a typo in a bookmark must draw the whole book rather
   * than an error page.
   */
  const params = await searchParams
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? ''

  // Capped, because it is only ever compared against a name and a number: a 60-character
  // search is already wider than anything in the table.
  const query = one(params.q).trim().slice(0, 60).toLowerCase()
  const askedKind = one(params.kind)
  const askedStatus = one(params.standing)
  const askedSort = one(params.order)

  const kindFilter =
    kindsReadable && ACCOUNT_KINDS.includes(askedKind as AccountKind)
      ? (askedKind as AccountKind)
      : null
  const statusFilter = STATUS_ORDER.includes(askedStatus as CenterStatus)
    ? (askedStatus as CenterStatus)
    : null
  const sort: SortKey = SORTS.includes(askedSort as SortKey)
    ? (askedSort as SortKey)
    : 'bill'

  const searching = query !== '' || kindFilter !== null || statusFilter !== null

  const matched = list
    .filter((c) => {
      if (kindFilter && (kinds.get(c.centerId) ?? 'teacher') !== kindFilter) return false
      if (statusFilter && c.status !== statusFilter) return false
      if (!query) return true
      // Name, area, and whoever the founder would ring — the three things they have in
      // front of them when they are looking somebody up.
      const haystack = [c.name, c.area, c.ownerName, c.ownerEmail, c.ownerPhone, c.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
    .sort(ORDER[sort])

  /** Dhaka's calendar day, the one every line and every grant is counted in (§11.7). */
  const dhakaToday = todayInDhaka(new Date())

  // A Dhaka calendar date from a UTC timestamp. A centre that signed up at 1am
  // local is stamped the previous day in UTC, and a founder checking "who joined
  // yesterday" against their own memory should not have to allow for six hours.
  const dhakaDay = (iso: string | null) =>
    iso ? formatDate(todayInDhaka(new Date(iso)), locale) : null

  /*
   * The open purchases, per centre, with every sentence composed here.
   *
   * `lapsed` is computed rather than stored: nothing sweeps for an expired quote — the
   * migration says why — so `state` alone would have the founder confirming a purchase
   * `settle_payment_intent` is about to refuse.
   *
   * `target_plan` is in the line and not the meta, because it is not detail about the
   * purchase — it is the other half of what confirming it does. The settlement moves the
   * plan, and a founder checking a bKash transfer against an amount needs to know they
   * are also putting this centre on Institution.
   *
   * `transferReference` is read as a pure function, not asked of the provider:
   * `createPayment` is what hands a customer their reference and it writes a state
   * transition, which a page rendering a list must not do.
   */
  const purchases = new Map<string, OpenPurchase[]>()

  for (const intent of intents ?? []) {
    const lapsed = hasPassed(intent.expires_at)
    const quoted = dhakaDay(intent.created_at)
    const until = dhakaDay(intent.expires_at)
    const moves = intent.target_plan
      ? ` ${t.boughtMovesTo(planName(planFor(intent.target_plan), locale))}`
      : ''

    const open = purchases.get(intent.coaching_center_id) ?? []
    open.push({
      id: intent.id,
      line: `${t.bought[intent.purpose](intent.quantity)}${moves} — ${formatTaka(intent.amount_bdt)}`,
      meta: [
        quoted && t.quotedOn(quoted),
        until && (lapsed ? t.quoteLapsed(until) : t.quoteGood(until)),
        intent.provider === 'manual' && transferReference(intent.id),
      ]
        .filter(Boolean)
        .join(' · '),
      told: intent.state === 'initiated',
      lapsed,
    })
    purchases.set(intent.coaching_center_id, open)
  }

  /*
   * The queue, with every sentence composed here.
   *
   * THE SIZE IS THE CLAIM'S OWN SNAPSHOT — the three counts the quote was priced from —
   * and not the centre's live roster, because the question this line answers is "what was
   * this priced at". It is also the only size there is: the claim is read without a join,
   * so the centre's name comes from the list this page already has.
   *
   * `t.unnamed` is the fallback for a centre missing from that list, which cannot happen
   * while the list read succeeded — a claim's centre is a foreign key — and it is the same
   * word `customers` uses for the same absence. The sender's number has no such word and
   * gets a dash: it is required on the form that files a claim, so a missing one is an old
   * row rather than a centre we could not name.
   */
  const byCenter = new Map(list.map((c) => [c.centerId, c]))

  const queueClaims: QueueClaim[] = (queue ?? []).map((claim) => {
    const customer = byCenter.get(claim.centerId)
    const usage = claim.usage

    const size =
      usage === null
        ? null
        : [
            `${digits(usage.students, locale)} ${t.size.students}`,
            `${digits(usage.teachers, locale)} ${t.size.teachers}`,
            // Only past the first, the rule `sizeLine` follows: a centre is one building.
            ...(usage.branches > 1
              ? [`${digits(usage.branches, locale)} ${t.size.branches}`]
              : []),
          ].join(' · ')

    const sentOn = dhakaDay(claim.submittedAt)
    const name = customer?.name ?? t.unnamed

    return {
      id: claim.id,
      centre: size === null ? name : words.queueCentre(name, size),
      sent: words.queueSent(formatTaka(claim.quotedPoisha / 100), sentOn ?? ''),
      quoted: words.queueQuoted(
        formatTaka(claim.quotedPoisha / 100),
        formatTaka(claim.quotedBonusPoisha / 100),
      ),
      trx: words.queueTrx(
        claim.trxId,
        claim.senderMsisdn === null ? '—' : formatBdMobile(claim.senderMsisdn),
      ),
      quotedTaka: String(claim.quotedPoisha / 100),
    }
  })

  /*
   * The card's own words, handed over field by field.
   *
   * `RechargeWords` carries functions — `queueCentre`, `queueSent`, the four sentences
   * above are the ones this page just called — and a group with a function in it cannot
   * cross into a client component at all. So the finished sentences travel on the claims
   * and only the labels and the four reasons travel here.
   */
  const queueWords: QueueWords = {
    queueTitle: words.queueTitle,
    queueBody: words.queueBody,
    queueEmpty: words.queueEmpty,
    queueUnreadable: words.queueUnreadable,
    arrivedLabel: words.arrivedLabel,
    arrivedHint: words.arrivedHint,
    approve: words.approve,
    approving: words.approving,
    reject: words.reject,
    reasonLabel: words.reasonLabel,
    noteLabel: words.noteLabel,
    reasons: words.reason,
  }

  /*
   * The dropdown contents, built once for the whole list rather than per card.
   *
   * Localised here and travelled as `{ value, label }`, so the client component that renders
   * them holds no dictionary and no formatter — see the note at the top of
   * ./center-billing.tsx. The months are re-derived inside the action from the same list,
   * which is what makes the `<select>` unnecessary to trust.
   *
   * THERE ARE NO PAYMENT PERIODS ANY MORE (20260811000092). The form used to offer the
   * months a receipt covered, and nothing in the product reads `covers_period_*`: the money
   * goes onto the balance and the burn turns it into days. A teacher's card offers months,
   * because that is what a subscription is; a centre's offers an amount.
   */
  const months = MONTHS_COVERED.map((n) => ({ value: n, label: digits(n, locale) }))

  const plans = PLAN_ORDER.map((id) => ({
    value: id,
    label: planName(PLANS[id], locale),
  }))

  /**
   * The trial lengths, from the row `bootstrap_center` reads at signup.
   *
   * Read on the server and handed down as three numbers, so the panel's own form and the
   * onboarding screen's promise cannot disagree about what a signup is given.
   */
  const settings = await readPlatformSettings(supabase)

  const statuses = STATUS_ORDER.map((s) => ({ value: s, label: t.status[s] }))

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
      <div>
        {/* The only way back, since this page has no shell around it. */}
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.lead}</p>
      </div>

      {/* The panel's other four questions. A row of links rather than tabs — this panel has
          no client state at all. */}
      <FounderNav here="customers" words={t.nav} />

      {/* The error branch says so rather than rendering an empty list. A founder
          who reads "no centres yet" on a day they have eleven would go looking for
          the customers rather than for the bug. */}
      {error ? (
        <Card>
          <p className="font-medium text-ink">{t.unreadable}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.unreadableHint}</p>
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <p className="font-medium text-ink">{t.empty}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyHint}</p>
        </Card>
      ) : (
        <>
          {/*
           * The business in one strip. Money figures are ASCII through formatTaka
           * and counts are bare numerals, the same split every other screen uses:
           * a taka figure gets checked against a bKash statement, a tally gets
           * read off at a glance.
           */}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label={t.totals.centers} value={String(totals.centers)} />
            <Stat label={t.totals.active} value={String(totals.active)} />
            <Stat label={t.totals.trial} value={String(totals.trial)} />
            <Stat label={t.totals.quiet} value={String(totals.quiet)} />
            {/* The only tile that is a to-do rather than a measurement, and the
                only one whose useful reading is zero. First row on purpose: a
                customer waiting to be sold to outranks every figure below it. */}
            <Stat label={t.totals.asking} value={String(totals.asking)} />
            {/* The third of the same kind, and the one nobody has to answer for
                the customer: an owner buys places themselves. It is up here
                because a branch at the ceiling is a centre that is growing. */}
            <Stat label={t.totals.outOfPlaces} value={String(totals.outOfPlaces)} />
            {/* The other to-do, kept beside it: both tiles mean "ring somebody",
                and this is the one with a date on it. Trials in their last week
                and trials already over are counted together on purpose — see the
                note on TRIAL_ENDING_SOON_DAYS. */}
            <Stat label={t.totals.ending} value={String(totals.ending)} />
            <Stat label={t.totals.mrr} value={formatTaka(totals.mrrBdt)} />
            <Stat label={t.totals.pipeline} value={formatTaka(totals.pipelineBdt)} />
            <Stat label={t.totals.paid} value={formatTaka(totals.paidBdt)} />
            {/* The call list, and what it is worth. Beside "we have received"
                rather than beside the billing figure on purpose: monthly billing
                is what the customers are worth, these two are what is missing. */}
            <Stat label={t.totals.owing} value={String(totals.owing)} />
            <Stat label={t.totals.owed} value={formatTaka(totals.owedBdt)} />
            <Stat
              label={t.totals.collected}
              value={formatTaka(totals.collected30d)}
            />
            <Stat label={t.totals.students} value={String(totals.students)} />
            <Stat label={t.totals.teachers} value={String(totals.teachers)} />
            <Stat label={t.totals.taps} value={String(totals.taps30d)} />
            <Stat label={t.totals.notes} value={String(totals.notes30d)} />
            {/* All four tap-to-send counts, never a sum. The absence figure is the
                one to watch: it is the only message that happens every day, so it
                is the closest thing this panel has to "have they adopted it". */}
            <Stat label={t.totals.results} value={String(totals.results30d)} />
            <Stat label={t.totals.absences} value={String(totals.absences30d)} />
          </dl>

          <p>
            {/* A plain anchor, like the centre exports: a download is a navigation
                the browser handles, not a route the app renders. */}
            <a
              href="/api/founder"
              className="inline-flex min-h-tap items-center rounded-xl bg-brand-600
                px-5 font-semibold text-white"
            >
              {t.download}
            </a>
          </p>

          {/* Money a customer says they have already sent us, sitting in our own bKash
              account with nothing recorded against it. The first block under the figures,
              because it is the only thing on this screen that somebody else is waiting on
              — see ./recharge-queue.tsx. */}
          <RechargeQueue claims={queue === null ? null : queueClaims} words={queueWords} />

          {/* The controls. A GET form: the URL is the state, so a filtered list can be
              bookmarked, reloaded or sent to somebody else, and the screen works with no
              JavaScript at all. */}
          <form method="get" className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="text-xs text-ink-soft">{t.filters.search}</span>
                <input
                  type="search"
                  name="q"
                  defaultValue={one(params.q)}
                  placeholder={t.filters.searchHint}
                  maxLength={60}
                  className="min-h-tap rounded-xl border border-line px-3 text-ink"
                />
              </label>

              {/* Only when the column behind it could be read. See `kindsReadable`. */}
              {kindsReadable && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-soft">{t.filters.kind}</span>
                  <select
                    name="kind"
                    defaultValue={kindFilter ?? ''}
                    className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
                  >
                    <option value="">{t.filters.kinds.any}</option>
                    {ACCOUNT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t.filters.kinds[k]}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-soft">{t.filters.standing}</span>
                <select
                  name="standing"
                  defaultValue={statusFilter ?? ''}
                  className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
                >
                  <option value="">{t.filters.any}</option>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {t.status[s]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-soft">{t.filters.order}</span>
                <select
                  name="order"
                  defaultValue={sort}
                  className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
                >
                  {SORTS.map((key) => (
                    <option key={key} value={key}>
                      {t.filters.orders[key]}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                className="min-h-tap rounded-xl bg-brand-600 px-5 font-semibold text-white"
              >
                {t.filters.apply}
              </button>

              {/* Only once something is narrowed — a Clear on a list that is not filtered
                  is a button that does nothing. */}
              {searching && (
                <Link
                  href="/founder"
                  className="inline-flex min-h-tap items-center px-3 text-sm font-medium text-ink-soft hover:text-ink"
                >
                  {t.filters.clear}
                </Link>
              )}
            </div>

            {/* Always said, and it is the line that makes the filters trustworthy: a list
                of four customers from a book of eleven must not look like a book of four. */}
            <p className="text-xs text-ink-faint">
              {t.filters.showing(digits(matched.length, locale), digits(list.length, locale))}
            </p>
          </form>

          {matched.length === 0 && (
            <Card>
              <p className="font-medium text-ink">{t.filters.none}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.filters.noneHint}</p>
            </Card>
          )}

          <ul className="flex flex-col gap-3">
            {matched.map((c) => {
              const signedUp = dhakaDay(c.createdAt)
              const lastActive = dhakaDay(c.lastActiveAt)
              const waitingSince = dhakaDay(c.asksSince)
              const open = purchases.get(c.centerId)
              // The card's two levers work from these, and both are null together when the
              // money read did not answer — see the note on the map above.
              const held = money.get(c.centerId)
              const line = held ? held.charged_through : null

              return (
                <li key={c.centerId}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {/* The customer's name is the way into their record: it is what a
                            founder is already looking at when they decide to open one, and
                            a separate "Details" button would be a second thing to aim at. */}
                        <h2 className="truncate font-semibold text-ink">
                          <Link
                            href={`/founder/${c.centerId}` as Route}
                            className="hover:text-brand-700"
                          >
                            {c.name}
                          </Link>
                        </h2>
                        <p className="truncate text-sm text-ink-soft">
                          {[c.area, planName(planFor(c.plan), locale)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      {/* The bill, right-aligned and the largest thing on the row
                          after the name. It is the reason this screen exists. */}
                      <div className="shrink-0 text-right">
                        <p className="num text-lg font-bold text-ink">
                          {billLabel(c)}
                        </p>
                        <p className="text-xs text-ink-soft">{t.bill}</p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-medium
                          ${STATUS_STYLE[c.status]}`}
                      >
                        {t.status[c.status]}
                      </span>
                      {/*
                       * The trial clock, right beside the word "trial" because it
                       * qualifies it. Null on everything that is not a trial, so
                       * there is no status check here — see `trialDaysLeft`.
                       *
                       * TWO TREATMENTS, BOTH ALREADY IN USE HERE. A running trial
                       * gets the same amber tint as the status chip it follows, so
                       * the pair reads as one fact. An overrun gets the filled red
                       * of the money chip, which is free on a trial card: `owes` is
                       * deliberately narrow to `active` centres, so the two filled
                       * chips can never appear together. It is also why an overrun
                       * is NOT tinted red — `quiet` owns that, a dead trial is
                       * usually quiet too, and the two side by side would read as
                       * one vague alarm rather than a deadline and a silence.
                       */}
                      {c.trialDaysLeft !== null && (
                        <span
                          className={`rounded-lg border px-2 py-0.5 text-xs
                            ${
                              c.trialDaysLeft < 0
                                ? 'border-absent bg-absent font-semibold text-white'
                                : 'border-late/40 bg-late/5 font-medium text-late'
                            }`}
                        >
                          {c.trialDaysLeft < 0
                            ? t.trialOver(-c.trialDaysLeft)
                            : c.trialDaysLeft === 0
                              ? t.trialToday
                              : t.trialLeft(c.trialDaysLeft)}
                        </span>
                      )}
                      {/* The one chip on this screen that is filled rather than
                          tinted, because it is the only one about money. Two
                          red-on-pink chips side by side — this and "gone quiet" —
                          would read as one vague alarm, and they are different
                          problems: a centre can be paid up and idle, or busy and
                          three weeks late. */}
                      {c.owes && (
                        <span
                          className="rounded-lg border border-absent bg-absent
                            px-2 py-0.5 text-xs font-semibold text-white"
                        >
                          {t.owed.badge}
                        </span>
                      )}
                      {/* Marked, not moved — see the note on `customers`. */}
                      {c.quiet && (
                        <span
                          className="rounded-lg border border-absent/30 bg-absent/5 px-2
                            py-0.5 text-xs font-medium text-absent"
                        >
                          {c.daysQuiet === null
                            ? t.neverActive
                            : t.quiet(c.daysQuiet)}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-sm text-ink-soft">
                      {sizeLine(c, locale, t.size)}
                    </p>

                    {/* Under the size line because that is what it is about: this
                        centre is bigger than what it pays for. A sentence and not a
                        chip with a button — the owner answers it on their own plan
                        screen, and there is nothing here for the founder to press. */}
                    {c.asksOpen > 0 && (
                      <p className="num mt-1 text-sm font-medium text-late">
                        {[
                          t.outOfPlaces(c.asksOpen, c.asksPlaces),
                          waitingSince && t.outOfPlacesSince(waitingSince),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}

                    {/* Above a plan request, because money already sent outranks money
                        somebody is thinking about. Both are the customer waiting on us;
                        only one of them has a transfer in our own bKash app with nothing
                        recorded against it. */}
                    {open && (
                      <CenterPurchases
                        centerId={c.centerId}
                        items={open}
                        words={t.purchases}
                        methods={d.feeRow.methods}
                      />
                    )}

                    {/* Above the phone number, because the two are read together:
                        they asked for this, ring that. Only when there is an open
                        request — a handled one is history and this panel is a
                        working list. */}
                    {c.wantsPlan && (
                      <AskedToUpgrade
                        centerId={c.centerId}
                        // Composed here, not in the component: `askedFor` is a
                        // function and `t.asked` crosses into a client component
                        // whole, so the two cannot live in the same group.
                        line={[
                          t.askedFor(planName(planFor(c.wantsPlan), locale)),
                          c.wantsSince && dhakaDay(c.wantsSince),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        note={c.wantsNote}
                        words={t.asked}
                      />
                    )}

                    {/* Who to reach, as the link that works on the screen the founder
                        is holding: an address opens their mail app, a number dials.
                        Exactly one of the two is set — a staff login is keyed on a
                        number, a self-serve signup on an address (§5.4) — so this draws
                        one link rather than offering a choice, and the centre that
                        signs up through the app is the one with no number at all. */}
                    <p className="mt-1 text-sm text-ink-soft">
                      {c.ownerName ?? t.noOwner}
                      {c.ownerEmail && (
                        <>
                          {' — '}
                          {/* `break-all`, because an address is twice the width of a
                              number and this card is a column on a phone. */}
                          <a
                            href={`mailto:${c.ownerEmail}`}
                            className="break-all font-medium text-brand-700"
                          >
                            {c.ownerEmail}
                          </a>
                        </>
                      )}
                      {c.ownerPhone && (
                        <>
                          {' — '}
                          <a
                            href={`tel:${c.ownerPhone}`}
                            className="num font-medium text-brand-700"
                          >
                            {formatBdMobile(c.ownerPhone)}
                          </a>
                        </>
                      )}
                    </p>

                    <dl
                      className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t
                        border-line pt-2 text-sm sm:grid-cols-3"
                    >
                      <Usage label={t.usage.attendance} value={c.attendance30d} />
                      <Usage label={t.usage.exams} value={c.exams30d} />
                      <Usage label={t.usage.payments} value={c.feePayments30d} />
                      <Usage
                        label={t.usage.collected}
                        value={formatTaka(c.collected30d)}
                      />
                      <Usage label={t.usage.taps} value={c.taps30d} />
                      {/* All four taps, separately. A centre chasing fees, a
                          teacher keeping parents, a marks message after a test
                          and a same-evening absence are four different
                          customers, and one "messages" figure would hide which
                          of them this is. */}
                      <Usage label={t.usage.notes} value={c.notes30d} />
                      <Usage label={t.usage.results} value={c.results30d} />
                      <Usage label={t.usage.absences} value={c.absences30d} />
                      {/* Kept beside the taps rather than added to them: one is
                          free and one costs us money. See the migration. */}
                      <Usage label={t.usage.sms} value={c.sms30d} />
                    </dl>

                    <p className="mt-2 text-xs text-ink-faint">
                      {[
                        signedUp && t.signedUp(signedUp),
                        lastActive ? t.lastActive(lastActive) : t.neverActive,
                        c.paidBdt > 0
                          ? t.paidTotal(formatTaka(c.paidBdt))
                          : t.paidNothing,
                        // What the money bought, which is the fact the badge above
                        // is derived from. Shown even when the date is past, so a
                        // founder on the phone can say "you are covered to the end
                        // of June" instead of only "you owe".
                        c.paidThrough &&
                          t.paidThrough(formatDate(c.paidThrough, locale)),
                        // And the same fact for somebody who has not paid at all:
                        // the chip above is the nudge, this is the date to say out
                        // loud. Last, so a trial card reads as a sentence — joined
                        // then, last seen then, no money yet, and this is when the
                        // conversation has to happen.
                        c.trialEndsOn &&
                          t.trialEnds(formatDate(c.trialEndsOn, locale)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>

                    <CenterBilling
                      centerId={c.centerId}
                      plan={c.plan}
                      status={c.status}
                      suggestedAmount={c.billBdt}
                      // A teacher buys months of Pro; a centre buys balance. Decided from
                      // the plan here, and decided again from the row by the function that
                      // writes the receipt — so a card drawn for the wrong shape cannot
                      // record the wrong thing.
                      sellsMonths={isTeacherTier(planFor(c.plan))}
                      months={months}
                      plans={plans}
                      statuses={statuses}
                      words={t.money}
                      // The fee board's own wallet names, not a second copy.
                      methods={d.feeRow.methods}
                      // The two levers' words, and the two figures they work from.
                      // Both sentences are composed here, where the locale is: the
                      // client component fills nothing but the days preview.
                      levers={leverLabels(locale)}
                      holding={
                        held && line
                          ? leverSentences(locale).holding(
                              formatTaka(Number(held.balance_poisha) / 100),
                              formatDate(line, locale),
                            )
                          : null
                      }
                      line={line}
                      today={dhakaToday}
                      locale={locale}
                    />

                    {/* Below the money, because that is the order of the calls: most
                        are about a bill and a few are about somebody locked out of
                        their own centre. Nothing here is scoped by what the founder
                        can see — the number is typed in and checked against this
                        centre's staff on the server. See ./staff-reset.tsx. */}
                    <StaffReset centerId={c.centerId} words={t.lockout} />
                  </Card>
                </li>
              )
            })}
          </ul>

          {/* §11.13's reconciliation, drawn after the customers because it is about
              all of them at once. No rows is the answer that sells: the balance
              cache, the chain and the line all agree, and the founder reads that
              once and moves on. A finding is a sentence naming the centre, never
              a bare count — the detail column is composed by the function, from
              the two figures that disagree. */}
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

          {/*
           * §4.3's trial lengths, which are the founder's own policy rather than any single
           * customer's business — so they sit with the reconciliation and the window notes
           * instead of inside a card.
           */}
          <PlatformSettings
            days={{
              teacher: settings.teacherTrialDays,
              center: settings.centerTrialDays,
              institution: settings.institutionTrialDays,
            }}
            words={t.settings}
          />

          {/* The two things easiest to misread, stated once at the bottom. */}
          <p className="text-xs text-ink-faint">{t.window}</p>
          <p className="text-xs text-ink-faint">{t.gatewayNote}</p>
        </>
      )}
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

function Usage({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="num font-medium text-ink">{value}</dd>
    </div>
  )
}
