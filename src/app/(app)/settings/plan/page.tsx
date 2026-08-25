import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import {
  PLANS,
  CENTER_MONTHLY_FLOOR_BDT,
  has,
  hasStaff,
  planName,
  type FeatureKey,
  type PlanLimits,
} from '@/lib/plans'
import { PriceCalculator } from './calculator'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.plan.title} — CoachDesk` }
}

/**
 * WHICH FEATURES ARE LISTED, AND WHY IT IS SEVEN AND NOT TWELVE.
 *
 * `PlanFeatures` carries twelve flags. Two of them — the weekly guardian summary,
 * multiple branches — describe screens nobody has built yet, and two more
 * (`automatedSms`, `buySmsCredits`) wait on a BTRC sender ID that does not exist.
 * A tick beside any of those on a paid tier would be selling something that cannot
 * be delivered, on the one screen in the app where that is unrecoverable.
 *
 * So the list is the shipped set, and the note under it says so. A feature moves
 * into this array on the day it works, not on the day it is decided — and because
 * the array is `as const`, adding one here will not compile until it has a name in
 * `labels` below. `exportReports` arrived by that rule: it had been priced into Pro
 * since the plan engine was written and stayed off this list until the three sheets
 * behind /api/export were built and covered by tests.
 */
const SHIPPED = [
  'attendance',
  'exams',
  'feeTracking',
  'manualMessaging',
  'printedReceipts',
  'exportReports',
  'staffManagement',
] as const satisfies readonly FeatureKey[]

/** The ladder, cheapest first — the order somebody reads a price list in. */
const LADDER: PlanLimits[] = [
  PLANS.teacher_free,
  PLANS.teacher_plus,
  PLANS.center,
  PLANS.institution,
]

/**
 * What this centre is paying for, what that includes, and what the next tier costs.
 *
 * The screen exists because the paywall arrived before the price list did. Half a
 * dozen places now say a feature "comes with শিক্ষক প্রো", and until this page
 * there was nowhere in the product that said what শিক্ষক প্রো costs or how to get
 * onto it. A locked feature pointing at a plan the reader cannot look up is a dead
 * end, and a dead end is where a trial stops.
 *
 * THE USAGE BLOCK IS THE UPGRADE PROMPT. Not a banner and not a nag: an owner at
 * 28 of 30 students needs to find that out before the thirty-first student is
 * standing in front of them, and a plain count against the cap does that without
 * anybody being sold to.
 *
 * NOTHING HERE CHARGES ANYBODY. There is no payment rail yet — centres are signed
 * up in person, by the founder, from their own laptop — so the call to action is a
 * prefilled WhatsApp message and a phone number. That is honest about how the
 * business currently works, and it is also the highest-converting thing available:
 * the founder answers.
 */
export default async function PlanPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).settings.plan
  const plan = session.plan

  const [
    { count: batchCount },
    { count: studentCount },
    { count: subjectCount },
    { count: teacherCount },
  ] = await Promise.all([
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
    supabase
      .from('subjects')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
  ])

  const usage: { label: string; used: number; limit: number | null }[] = [
    { label: t.batches, used: batchCount ?? 0, limit: plan.maxBatches },
    { label: t.students, used: studentCount ?? 0, limit: plan.maxStudents },
    { label: t.subjects, used: subjectCount ?? 0, limit: plan.maxSubjects },
    // Only where there are colleagues to count. On a one-teacher plan "1 / 1" is a
    // row that tells the reader nothing they did not know when they signed up.
    ...(hasStaff(plan)
      ? [{ label: t.teachers, used: teacherCount ?? 0, limit: plan.maxTeachers }]
      : []),
  ]

  // Only the six. A map covering all twelve flags would need a name for export and
  // for the guardian summary, and the only names available would describe screens
  // that do not exist — which is exactly what this screen must not put on paper.
  const labels: Record<(typeof SHIPPED)[number], string> = {
    attendance: t.attendance,
    exams: t.exams,
    feeTracking: t.fees,
    manualMessaging: t.messaging,
    printedReceipts: t.receipts,
    exportReports: t.export,
    staffManagement: t.staff,
  }

  const have = SHIPPED.filter((key) => has(plan, key))
  const lack = SHIPPED.filter((key) => !has(plan, key))

  // Blank in every deployment until the founder puts their own number in. Absent
  // rather than a dead chip: a WhatsApp button that opens a chat with nobody is
  // worse than no button, and this is the screen where trust is being built.
  const salesPhone = normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')
  const salesMessage = t.contactMessage(
    session.active.centerName,
    planName(plan, locale),
  )

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/settings"
        className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
      >
        ← {dict(locale).settings.hub.title}
      </Link>

      <div>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 font-medium text-ink-soft">
          {t.onNow(planName(plan, locale))} · {priceLine(plan, t)}
        </p>
      </div>

      <Card>
        <h2 className="font-semibold text-ink">{t.usageTitle}</h2>
        <dl className="mt-2 flex flex-col gap-1.5">
          {usage.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4"
            >
              <dt className="text-ink-soft">{row.label}</dt>
              {/*
                The count is always shown, cap or no cap. It used to be replaced by
                the words "no limit" on the centre tiers, which meant the block
                titled "what is being used now" showed an owner nothing they were
                using — and on those tiers the student count is the figure their
                bill is worked out from, so it is the one number they came for.
              */}
              <dd className="num font-semibold text-ink">
                {row.used}
                {row.limit === null ? (
                  <span className="ml-1 font-medium text-ink-soft">
                    · {t.noCap}
                  </span>
                ) : (
                  `/${row.limit}`
                )}
              </dd>
            </div>
          ))}
        </dl>
        {plan.maxStudentsPerBatch !== null && (
          <p className="mt-2 text-sm text-ink-faint">
            {t.perBatchCap(plan.maxStudentsPerBatch)}
          </p>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-ink">{t.haveTitle}</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {have.map((key) => (
            <li key={key} className="flex gap-2 text-ink">
              <span aria-hidden className="text-present">
                ✓
              </span>
              {labels[key]}
            </li>
          ))}
        </ul>

        {/* Named, not hidden. A feature an owner cannot see they are missing is a
            feature they cannot decide to pay for — and one they discover by
            tapping is a feature they experience as broken. */}
        {lack.length > 0 && (
          <>
            <h2 className="mt-4 font-semibold text-ink">{t.lackTitle}</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {lack.map((key) => (
                <li key={key} className="flex gap-2 text-ink-soft">
                  <span aria-hidden className="text-ink-faint">
                    ✕
                  </span>
                  {labels[key]}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-3 text-xs text-ink-faint">{t.onlyBuilt}</p>
      </Card>

      <div>
        <h2 className="font-semibold text-ink">{t.ladderTitle}</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {LADDER.map((tier) => {
            const isCurrent = tier.id === plan.id
            return (
              <li
                key={tier.id}
                className={`rounded-xl border bg-white p-4 ${
                  isCurrent ? 'border-brand-500' : 'border-line'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-ink">
                    {planName(tier, locale)}
                  </p>
                  <p className="num shrink-0 text-sm font-medium text-brand-800">
                    {priceLine(tier, t)}
                  </p>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{ladderLine(tier, t)}</p>
                {isCurrent && (
                  <p className="mt-1 text-xs font-medium text-brand-700">
                    {t.current}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <PriceCalculator t={dict(locale).planCalc} locale={locale} />

      {salesPhone && (
        <Card>
          <h2 className="font-semibold text-ink">{t.contactTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.contactBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              // wa.me wants the number without the +, exactly as the fee chips do.
              href={`https://wa.me/${salesPhone.slice(1)}?text=${encodeURIComponent(salesMessage)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-tap items-center rounded-xl border-2
                border-brand-500 bg-brand-50 px-4 font-medium text-brand-800"
            >
              {t.contactWhatsapp}
            </a>
            <a
              // The number is printed rather than hidden behind "Call", because
              // `tel:` opens nothing on a laptop and this is the one control on the
              // one screen where a centre decides to start paying us. A dead button
              // here is a lost sale; the digits work on any device. ASCII in both
              // languages — it is dialled, not read as prose.
              href={`tel:${salesPhone}`}
              className="inline-flex min-h-tap items-center rounded-xl border-2
                border-line px-4 font-medium text-ink-soft"
            >
              {t.contactCall}
              {/* `ml-1` and not a JSX space. This anchor is an inline-flex, and a
                  space there is worth exactly zero pixels — measured: 152.03px wide
                  with the space, 152.03px without, 156.03px with this margin. The
                  at-risk row spaces the same two parts with a plain JSX space and is
                  right to, because that anchor is an inline-block, where the space
                  is 3.27px of real layout. */}
              <span className="num ml-1">{formatBdMobile(salesPhone)}</span>
            </a>
          </div>
        </Card>
      )}
    </div>
  )
}

/**
 * The price, in as few words as a list will hold.
 *
 * Driven off `pricing` rather than off the id, so a tier added to plans.ts gets a
 * sensible line without this file being touched — and a tier whose pricing shape
 * changes cannot keep showing the old wording.
 */
function priceLine(
  plan: PlanLimits,
  t: ReturnType<typeof dict>['settings']['plan'],
): string {
  if (plan.pricing === 'free') return t.freePrice
  if (plan.pricing === 'flat') return t.monthly(formatTaka(plan.priceBdt))
  // Both per-student tiers are quoted, but only one of them has a published floor
  // to quote from; the institution tier is genuinely bespoke.
  return plan.id === 'center'
    ? t.from(formatTaka(CENTER_MONTHLY_FLOOR_BDT))
    : t.sized
}

/** One sentence on what a tier is for. Hand-written per tier; there are four. */
function ladderLine(
  plan: PlanLimits,
  t: ReturnType<typeof dict>['settings']['plan'],
): string {
  switch (plan.id) {
    case 'teacher_free':
      return t.addsFree
    case 'teacher_plus':
      return t.addsPro
    case 'center':
      return t.addsCenter
    case 'institution':
      return t.addsInstitution
  }
}
