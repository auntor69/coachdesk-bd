import Link from 'next/link'
import type { Route } from 'next'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { pagePlatformAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { describeAuditEntry } from '@/lib/audit'
import { dhakaMoment, digits, formatDate, formatTime, todayInDhaka } from '@/lib/bd/time'
import { formatBdMobile } from '@/lib/bd/phone'
import { billingWords, type BillingWords } from '@/lib/i18n/billing'
import { dict, type Dictionary, type Locale } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { PLANS, isTeacherTier, planFor, planName, type PlanId } from '@/lib/plans'
import { MONTHS_COVERED } from '@/lib/platform/billing'
import { PLATFORM_ENTITIES } from '@/lib/platform/audit'
import { billLabel, customers, sizeLine, type Customer } from '@/lib/platform/centers'
import { leverLabels, leverSentences } from '@/lib/i18n/levers'
import { isAccountKind } from '@/lib/accounts/kind'
import { daysOf } from '@/lib/billing/history'
import type { BillingEntryKind } from '@/lib/supabase/types'
import { CenterBilling } from '../center-billing'
import { StaffReset } from '../staff-reset'
import { FounderNav } from '../nav'

/*
 * NO generateMetadata, like the rest of the panel — a tab, a history entry or a screenshot
 * should say "CoachDesk" rather than name a customer. See the note at the top of ../page.tsx.
 */

/** The order the plan dropdown offers, cheapest first. The same list the list's cards use. */
const PLAN_ORDER = Object.keys(PLANS) as PlanId[]

/** The same four the status dropdown offers, matching center_status. */
const STATUS_ORDER = ['trial', 'active', 'suspended', 'cancelled'] as const

/** A screenful of ledger: for a centre that recharges monthly, a month and a bit. */
const LEDGER_LIMIT = 30

/** The last lines of our own trail, and a link to the rest of it. */
const AUDIT_LIMIT = 8

/**
 * What a fact with no value in it reads as.
 *
 * A dash and not a word, and not in the dictionary: every other absence on this page is
 * spelled out — "No owner on record", "Never used it" — because those are *facts* a founder
 * acts on, and this one is the lack of a fact. A translation of "not read" would be a claim
 * about why it is missing on a screen where the reason is always the same.
 */
const NONE = '—'

/**
 * One customer, in full — the drill-down §16.1's founder panel asks for.
 *
 * WHY A SCREEN AND NOT A BIGGER CARD. The list answers "who is worth what", eleven rows at a
 * time, and it is good at it. Every question that follows a telephone call needs one
 * customer's whole record in one place: what they are, what they use, what their money has
 * done, who can get in, and what we have done to them. Those are five kinds of fact; a card
 * holding all five is the list's job done worse, and eleven of them is a page nobody can
 * scroll.
 *
 * THE ADDRESS IS THE ID, because a customer record is exactly what somebody pastes into a
 * chat. An id naming no centre is a 404 rather than an empty record: an empty record is a
 * page that lies, and a founder reading one would conclude the customer had been deleted.
 *
 * IT IS STILL NOT THEIR DATA. Every read below is answered by a policy or a definer function
 * that says `app.is_platform_admin()` — `centers_member_read`, `billing_ledger_owner_read`,
 * `payment_intents_owner_read`, `audit_log_owner_read` — and the entity list on the trail is
 * the same five tables lib/platform/audit.ts fences: no register, no fee board, no student.
 * The closest thing to a person here is a *staff* member's name and number, which the founder
 * already has from signing the account up, and which the lockout form needs to be usable.
 *
 * THE ACTIONS ARE THE LIST'S OWN COMPONENTS on the same centre id, so a founder who arrived
 * from a search result can move the line, change the plan or reset a login without going back.
 * Nothing here is a second implementation of anything.
 *
 * AN UNREADABLE RECORD IS ONE SENTENCE, NOT FIVE EMPTY CARDS. `platform_centers()` is the
 * panel's roster and the source of the bill, the size and the 30-day counts, so if it did not
 * answer there is no half of this page worth drawing — the founder is told to reload rather
 * than shown a customer with no usage.
 */
export default async function FounderCenterPage({
  params,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  params: Promise<{ centerId: string }>
}) {
  const session = await pagePlatformAdmin()
  const locale = session.locale
  const d = dict(locale)
  const t = d.founder
  const words = billingWords(locale)

  const { centerId } = await params
  const supabase = await createClient()

  const [roster, center, kinds, members, ledger, trail] = await Promise.all([
    // The panel's roster, read whole and picked here: `platform_centers()` is a definer
    // function over every centre and takes no id, and eleven rows against one screen is not
    // a query worth a migration.
    // scoped-by: platform_centers() is a security definer RPC over all centres, gated on
    // app.is_platform_admin(). See 20260811000020_platform_panel.sql.
    supabase.rpc('platform_centers'),
    // The centre's own row: the plan, the state, what it says it is, and the two money
    // columns §11.7's levers work from.
    // scoped-by: one customer, by primary key — centers_member_read in
    // 20260811000002_rls_policies.sql is what answers a platform admin.
    supabase
      .from('coaching_centers')
      .select(
        'id, name, phone, bd_area, status, plan, created_at, balance_poisha, charged_through, sms_credit_balance, trial_plan, trial_ends_at',
      )
      .eq('id', centerId)
      .maybeSingle(),
    /*
     * What the account says it is, in a read of its own — and the reason it is not in the select
     * above is a deployment order rather than tidiness.
     *
     * `account_kind` arrived in 20260811000091, and an app deploy can land before the migration
     * that adds a column. Named in the record's own select, a database one migration behind fails
     * *that read*, and this page draws "could not read this customer" for a customer it can read
     * perfectly well: it is one chip on a record of six sections. So the row is read with the
     * columns the panel has always had, and the kind is asked for separately — a failed read here
     * loses the chip and nothing else.
     */
    supabase.from('coaching_centers').select('id, account_kind').eq('id', centerId).maybeSingle(),
    // Who can get in. A login is an account and not a person, which is why the names are a
    // second read — and a member whose profile could not be read keeps their role and loses
    // their name rather than disappearing from the list.
    supabase
      .from('center_members')
      .select('id, user_id, role, active, created_at')
      .eq('coaching_center_id', centerId)
      .order('created_at'),
    // What the money has done, newest first, as the trigger chained it. The owner's history
    // screen collapses a day out of its rows; a founder checking one figure wants the rows.
    supabase
      .from('billing_ledger')
      .select(
        'id, kind, amount_poisha, balance_after, charge_date, description, metadata, created_at, top_up',
      )
      .eq('coaching_center_id', centerId)
      .order('created_at', { ascending: false })
      .limit(LEDGER_LIMIT),
    // Our own record of what we have done *to* this customer: the plan moved, the money
    // recorded, a login switched off. Never their register — see lib/platform/audit.ts.
    supabase
      .from('audit_log')
      .select('id, entity, entity_id, operation, before, after, actor, actor_role, created_at')
      .eq('coaching_center_id', centerId)
      .in('entity', [...PLATFORM_ENTITIES])
      .order('created_at', { ascending: false })
      .limit(AUDIT_LIMIT),
  ])

  const row = center.data

  // Two different failures, kept apart: the read broke, or the id names no centre. The first
  // is a reload, the second is a 404 — and merging them would tell a founder to reload a page
  // that can never work.
  if (center.error || row === null) {
    if (!center.error) notFound()
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
        <BackLink label={t.title} />
        {/* The nav is drawn on the failure path too. A founder who arrives here from a search
            result and finds no way to the other four sections has been sent back to the list to
            start again — and the failure is one customer's read, not the panel's. */}
        <FounderNav here="customers" words={t.nav} />
        <Card>
          <p className="font-medium text-ink">{t.record.unreadable}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.record.unreadableHint}</p>
        </Card>
      </main>
    )
  }

  // The one row this page is about, off the roster. Null means the roster answered without
  // this centre in it, which is the same dead end as an unreadable read: no bill, no size and
  // no 30-day counts, and a customer record missing all three is not a record.
  const account: Customer | null =
    roster.data === null
      ? null
      : (customers(roster.data, t.unnamed).find((c) => c.centerId === row.id) ?? null)

  if (account === null) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
        <BackLink label={t.title} />
        <FounderNav here="customers" words={t.nav} />
        <Card>
          <p className="font-medium text-ink">{t.record.unreadable}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.record.unreadableHint}</p>
        </Card>
      </main>
    )
  }

  const staffIds = [...new Set((members.data ?? []).map((m) => m.user_id))]
  const people =
    staffIds.length === 0
      ? []
      : ((
          await supabase
            .from('profiles')
            .select('id, full_name, phone, username')
            .in('id', staffIds)
        ).data ?? [])
  const names = new Map(people.map((p) => [p.id, p.full_name ?? p.phone ?? '']))

  const rowKind = kinds.data?.account_kind
  const kind = isAccountKind(rowKind) ? rowKind : null
  const plan = planFor(row.plan)
  const dhakaToday = todayInDhaka(new Date())

  // The dropdown contents, exactly as the list builds them — labels localised here so the
  // client component holds no dictionary.
  const months = MONTHS_COVERED.map((n) => ({ value: n, label: digits(n, locale) }))
  const plans = PLAN_ORDER.map((id) => ({ value: id, label: planName(PLANS[id], locale) }))
  const statuses = STATUS_ORDER.map((s) => ({ value: s, label: t.status[s] }))

  // The two figures the levers work from, both the centre's own columns. `charged_through`
  // is NOT NULL in the schema, so the line is always a date here — a centre whose row had
  // none could not have been read at all, which is the branch above.
  const held = { balancePoisha: row.balance_poisha }
  const line: string | null = row.charged_through || null

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-5">
      <div>
        <BackLink label={t.title} />
        <h1 className="mt-1 text-xl font-bold text-ink">{account.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-lg border border-line bg-surface-alt px-2 py-0.5 text-xs font-medium text-ink-soft">
            {t.status[account.status]}
          </span>
          <span className="rounded-lg border border-line bg-surface-alt px-2 py-0.5 text-xs font-medium text-ink-soft">
            {planName(plan, locale)}
          </span>
          {/* Only when the column says one of the three words. A fourth value would be a
              migration's mistake and the honest drawing of it is nothing rather than a
              blank chip. */}
          {kind !== null && (
            <span className="rounded-lg border border-line bg-surface-alt px-2 py-0.5 text-xs font-medium text-ink-soft">
              {t.filters.kinds[kind]}
            </span>
          )}
          {account.quiet && (
            <span className="rounded-lg border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              {account.daysQuiet === null ? t.neverActive : t.quiet(account.daysQuiet)}
            </span>
          )}
        </div>
      </div>

      <FounderNav here="customers" words={t.nav} />

      <Card>
        <h2 className="font-semibold text-ink">{t.record.accountTitle}</h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Fact
            label={t.record.owner}
            value={
              <>
                {account.ownerName ?? t.noOwner}
                {account.ownerPhone && (
                  <>
                    {' · '}
                    <Phone number={account.ownerPhone} />
                  </>
                )}
              </>
            }
          />
          <Fact
            label={t.record.phone}
            value={row.phone ? <Phone number={row.phone} /> : NONE}
          />
          <Fact label={t.record.area} value={row.bd_area ?? NONE} />
          <Fact label={t.record.signedUp} value={date(account.createdAt, locale)} />
          <Fact
            label={t.record.lastUsed}
            value={account.lastActiveAt ? date(account.lastActiveAt, locale) : t.neverActive}
          />
          <Fact
            label={t.record.trial}
            value={account.trialEndsOn ? date(account.trialEndsOn, locale) : NONE}
          />
          <Fact
            label={t.record.paidThrough}
            value={account.paidThrough ? date(account.paidThrough, locale) : NONE}
          />
          <Fact
            label={t.usage.credits}
            value={digits(row.sms_credit_balance, locale)}
          />
        </dl>

        <p className="mt-2 text-sm text-ink-soft">
          {sizeLine(account, locale, t.size)} · {billLabel(account)} {t.bill}
        </p>

        <dl
          className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-2 text-sm
            sm:grid-cols-3"
        >
          {/*
           * The same nine counts the list's cards draw, off the same roster row. They are
           * deliberately not summed into one "activity" figure: a centre chasing fees and a
           * teacher sending week notes are two different customers, and a drill-down is
           * where somebody is deciding which one this is.
           */}
          <Usage label={t.usage.attendance} value={account.attendance30d} />
          <Usage label={t.usage.exams} value={account.exams30d} />
          <Usage label={t.usage.payments} value={account.feePayments30d} />
          <Usage label={t.usage.collected} value={formatTaka(account.collected30d)} />
          <Usage label={t.usage.taps} value={account.taps30d} />
          <Usage label={t.usage.notes} value={account.notes30d} />
          <Usage label={t.usage.results} value={account.results30d} />
          <Usage label={t.usage.absences} value={account.absences30d} />
          <Usage label={t.usage.sms} value={account.sms30d} />
        </dl>
        <p className="mt-2 text-xs text-ink-faint">
          {t.window} ·{' '}
          {account.paidBdt > 0
            ? t.paidTotal(formatTaka(account.paidBdt))
            : t.paidNothing}
        </p>
      </Card>

      {/* The money, with the two levers and the three forms. Mounted here as well as on the
          list because a record opened from a phone call is exactly where somebody wants to
          take the payment they are discussing. */}
      <Card>
        <h2 className="font-semibold text-ink">{t.record.moneyTitle}</h2>
        <div className="mt-2">
          <CenterBilling
            centerId={account.centerId}
            plan={account.plan}
            status={account.status}
            suggestedAmount={account.billBdt}
            // A teacher buys months of Pro; a centre buys balance. Decided from the plan here
            // and decided again from the row by the function that writes the receipt.
            sellsMonths={isTeacherTier(plan)}
            months={months}
            plans={plans}
            statuses={statuses}
            words={t.money}
            // The fee board's own wallet names, not a second copy of them.
            methods={d.feeRow.methods}
            levers={leverLabels(locale)}
            holding={
              line !== null
                ? leverSentences(locale).holding(
                    formatTaka(held.balancePoisha / 100),
                    formatDate(line, locale),
                  )
                : null
            }
            line={line}
            today={dhakaToday}
            locale={locale}
          />
        </div>
      </Card>

      {/* The balance, entry by entry. The newest thirty, which is what a founder reads when a
          customer says "the money I sent is not there". */}
      <Card>
        <h2 className="font-semibold text-ink">{t.record.ledgerTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.record.ledgerLead}</p>
        {(ledger.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t.record.ledgerEmpty}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {(ledger.data ?? []).map((entry) => (
              <LedgerRow
                key={entry.id}
                entry={entry}
                locale={locale}
                words={words}
                record={t.record}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Who can get in, and the founder's end of "they cannot log in". */}
      <Card>
        <h2 className="font-semibold text-ink">{t.record.staffTitle}</h2>
        {(members.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t.record.staffEmpty}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {(members.data ?? []).map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-baseline gap-x-2 border-b border-line pb-1.5
                  text-sm last:border-0 last:pb-0"
              >
                <span className="font-medium text-ink">
                  {names.get(member.user_id) || d.audit.someone}
                </span>
                <span className="text-ink-soft">{d.audit.roles[member.role]}</span>
                {!member.active && (
                  <span className="rounded-lg border border-line bg-surface-alt px-2 py-0.5 text-xs text-ink-soft">
                    {t.record.staffStopped}
                  </span>
                )}
                <span className="num text-xs text-ink-soft">
                  {t.record.staffSince(formatDate(dhakaMoment(member.created_at).date, locale))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <StaffReset centerId={account.centerId} words={t.lockout} />
      </Card>

      {/* What we have done to this customer. Eight lines and a way to the whole log — the
          entity fence is lib/platform/audit.ts's, so this list is our own actions and never
          their register. */}
      <Card>
        <h2 className="font-semibold text-ink">{t.record.auditTitle}</h2>
        {trail.error ? (
          <p className="mt-2 text-sm text-ink-soft">{d.audit.unreadable}</p>
        ) : (trail.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t.record.auditEmpty}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {(trail.data ?? []).map((raw) => {
              const entry = describeAuditEntry(raw)
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-2 border-b border-line pb-1.5
                    text-sm last:border-0 last:pb-0"
                >
                  <span className="num text-xs text-ink-soft">
                    {formatDate(dhakaMoment(entry.at).date, locale)}{' '}
                    {formatTime(dhakaMoment(entry.at).time, locale)}
                  </span>
                  <span className="font-medium text-ink">{d.audit.actions[entry.action]}</span>
                  <span className="text-ink-soft">
                    {entry.actor === session.userId
                      ? d.audit.you
                      : entry.actor === null
                        ? d.audit.automatic
                        : d.audit.someone}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <Link
          href={auditHrefFor(account.centerId)}
          className="mt-3 inline-flex min-h-tap items-center text-sm font-medium text-brand-700"
        >
          {t.record.auditAll} →
        </Link>
      </Card>
    </main>
  )
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/founder"
      className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
    >
      ← {label}
    </Link>
  )
}

/** The link into the audit browser, narrowed to this customer. */
function auditHrefFor(centerId: string): Route {
  return `/founder/audit?center=${centerId}` as Route
}

/** A Dhaka calendar date from a timestamp, or a dash when there is none to show. */
function date(iso: string | null, locale: Locale): string {
  return iso === null ? '—' : formatDate(dhakaMoment(iso).date, locale)
}

/**
 * One ledger row.
 *
 * THE DAY COUNT COMES OUT OF `metadata.days` and not out of the row's own columns, because a
 * grant is stored as the *last day it reached* rather than as a number of days — the days are
 * in the jsonb the founder's lever wrote. `daysOf` in lib/billing/history.ts is the reader for
 * that key, lifted here rather than reimplemented so the customer's history and this record
 * cannot disagree about what a grant gave.
 *
 * A GRANT WITH NO READABLE DAYS PRINTS ITS AMOUNT, which is zero by constraint
 * (`billing_ledger_amount_sign`) — ৳0 on a line that says "days granted" is wrong in a way
 * somebody spots, where a fabricated number is wrong in a way nobody does.
 */
function LedgerRow({
  entry,
  locale,
  words,
  record,
}: {
  entry: {
    id: string
    kind: BillingEntryKind
    amount_poisha: number
    balance_after: number
    charge_date: string | null
    description: string | null
    metadata: unknown
    created_at: string
    top_up: boolean
  }
  locale: Locale
  words: BillingWords
  record: Dictionary['founder']['record']
}) {
  const granted =
    entry.kind === 'founder_grant_days' || entry.kind === 'signup_trial'
      ? daysOf(entry.metadata)
      : null

  return (
    <li
      className="flex flex-wrap items-baseline gap-x-2 border-b border-line pb-1.5 text-sm
        last:border-0 last:pb-0"
    >
      <span className="num text-xs text-ink-soft">
        {formatDate(dhakaMoment(entry.created_at).date, locale)}
      </span>
      <span className="font-medium text-ink">
        {kindLabel(entry.kind, entry.top_up, words, record)}
      </span>
      <span className="num font-semibold text-ink">
        {granted !== null
          ? record.daysGranted(digits(granted, locale))
          : formatTaka(entry.amount_poisha / 100)}
      </span>
      <span className="num text-xs text-ink-soft">
        {record.ledgerAfter(formatTaka(entry.balance_after / 100))}
      </span>
      {entry.description && (
        <span className="w-full text-xs text-ink-soft">{entry.description}</span>
      )}
    </li>
  )
}

/**
 * What a ledger row was, in the customer's own words.
 *
 * The money kinds come from `billingWords`, which is the dictionary the billing screen and
 * the recharge queue already speak — the same recharge is the same word on every screen. Only
 * two are this record's own: a day charged, and a day charged again when the roster grew at
 * noon (§11.7), because the customer's history says those with a count and a cost rather than
 * with a noun.
 *
 * `migration_opening_balance` HAS NO WORD AND IS FILTERED OUT ABOVE. It is the row a migrated
 * centre was handed, it carries no money, and the customer's own history ignores it for the
 * same reason; the arm exists because a switch over an enum has to be total, and returning the
 * empty string keeps that honest rather than giving it a sentence nobody reads.
 */
function kindLabel(
  kind: BillingEntryKind,
  topUp: boolean,
  w: BillingWords,
  r: Dictionary['founder']['record'],
): string {
  switch (kind) {
    case 'daily_charge':
      return topUp ? r.ledgerTopUp : r.ledgerCharge
    case 'recharge':
      return w.kindRecharge
    case 'promotion_bonus':
      return w.kindBonus
    case 'founder_money_adjustment':
      return w.kindAdjust
    case 'founder_grant_days':
      return w.kindGrant
    case 'signup_trial':
      return w.kindTrial
    case 'refund':
      return w.kindRefund
    case 'reversal':
      return w.kindReversal
    case 'correction':
      return w.kindCorrection
    case 'settlement_failure':
      return w.kindFailure
    case 'settlement_retry':
      return w.kindRetry
    case 'migration_opening_balance':
      return ''
  }
}

function Phone({ number }: { number: string }) {
  return (
    <a href={`tel:${number}`} className="num font-medium text-brand-700">
      {formatBdMobile(number)}
    </a>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="num text-right font-medium text-ink">{value}</dd>
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
