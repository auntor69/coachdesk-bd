import Link from 'next/link'
import type { Route } from 'next'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile } from '@/lib/bd/phone'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { planName, hasStaff } from '@/lib/plans'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.hub.title} — CoachDesk` }
}

/**
 * The customization hub.
 *
 * Everything a centre needs to shape the app to how it actually runs — its own
 * subjects, its own batches and slots, its own exam types, its own teachers and
 * what each may do. Counts are shown next to each entry so an owner can see at
 * a glance what is set up and what is still empty, which is the question they
 * have in their first week.
 */
export default async function SettingsPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).settings.hub

  const [
    { count: teacherCount },
    { count: subjectCount },
    { count: batchCount },
    { count: studentCount },
    { count: examTypeCount },
    { data: center },
  ] = await Promise.all([
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    supabase
      .from('subjects')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
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
      .from('exam_types')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    supabase
      .from('coaching_centers')
      .select('payment_wallet, payment_number')
      .eq('id', session.active.centerId)
      .maybeSingle(),
  ])

  // A count would say nothing here, so the hint carries the answer: either the
  // number a parent will be told to pay, or the fact that there isn't one. An
  // owner who has not set this is losing fees to a question they answer by hand.
  const payHint = center?.payment_number
    ? t.feesGoTo(formatBdMobile(center.payment_number))
    : t.noPaymentNumber

  // The centre's own plan, not the free one. Every tier below `center` has caps,
  // so this line is read by paying owners too.
  const maxBatches = session.plan.maxBatches
  const planLine =
    maxBatches === null
      ? t.planUnlimited(planName(session.plan, locale))
      : t.plan(planName(session.plan, locale), maxBatches)

  const items: {
    href: Route
    label: string
    hint: string
    count: number | null
  }[] = [    {
      href: '/settings/center',
      label: t.center,
      hint: payHint,
      count: null,
    },
    {
      href: '/settings/students',
      label: t.students,
      hint: t.studentsHint,
      count: studentCount ?? 0,
    },
    {
      href: '/settings/batches',
      label: t.batches,
      hint: t.batchesHint,
      count: batchCount ?? 0,
    },
    {
      href: '/settings/subjects',
      label: t.subjects,
      hint: t.subjectsHint,
      count: subjectCount ?? 0,
    },
    /*
     * Staff appears only where there is staff. On a one-teacher plan this row
     * led to a list containing the owner and an add button the action refuses,
     * which reads as a feature withheld rather than a plan that does not have
     * colleagues in it.
     */
    ...(hasStaff(session.plan)
      ? [
          {
            href: '/settings/teachers' as Route,
            label: t.teachers,
            hint: t.teachersHint,
            count: teacherCount ?? 0,
          },
        ]
      : []),
    {
      href: '/settings/exam-types',
      label: t.examTypes,
      hint: t.examTypesHint,
      count: examTypeCount ?? 0,
    },
    {
      href: '/settings/sms',
      label: t.sms,
      hint: t.smsHint,
      count: null,
    },
    /*
     * The plan, last, and now a row rather than the grey line this page used to
     * end with. The sentence is unchanged — it is still the plan and its batch
     * cap — but it has somewhere to lead. An owner who reads "৫টি ব্যাচ" and
     * wants a sixth had no next step from a paragraph.
     */
    {
      href: '/settings/plan',
      label: t.plans,
      hint: planLine,
      count: null,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{session.active.centerName}</p>
      </div>

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">{t.smsCredits}</p>
            <p className="num mt-0.5 text-2xl font-bold text-ink">
              {session.active.smsCreditBalance}
            </p>
          </div>
          <Link href="/settings/sms" className="text-sm font-medium text-brand-700">
            {t.details}
          </Link>
        </div>
      </Card>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-3 rounded-xl border border-line
                bg-white px-4 py-3 transition-colors hover:border-brand-300"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{item.label}</p>
                <p className="truncate text-sm text-ink-soft">{item.hint}</p>
              </div>
              {item.count !== null && (
                <span className="num shrink-0 text-sm font-semibold text-ink-soft">
                  {item.count}
                </span>
              )}
              <span aria-hidden className="shrink-0 text-ink-faint">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
