import Link from 'next/link'
import { forbidden } from 'next/navigation'
import type { Route } from 'next'

import { Card } from '@/components/ui'
import {
  pageCenter,
  isStaffAdmin,
  canManageStudents,
  canManageBatches,
  getSession,
} from '@/lib/auth/session'
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
 * Everything on this page that only an owner or a manager may read.
 *
 * Split out so it can be skipped rather than fetched and then not rendered. Four
 * of the six queries feed rows a permitted teacher does not get — and one of them
 * is the centre's payment number, which is the figure every fee reminder points at.
 * Reading it for somebody who cannot be shown it would be a needless second copy of
 * it in a server response.
 *
 * Returned as one promise so the caller keeps a single round of parallelism: an
 * owner is the common reader here and must not pay a second round trip for a check
 * that was added for somebody else.
 */
async function staffCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  centerId: string,
) {
  const [
    { count: teacherCount },
    { count: subjectCount },
    { count: examTypeCount },
    { data: center },
  ] = await Promise.all([
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('active', true),
    supabase
      .from('subjects')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('active', true),
    supabase
      .from('exam_types')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('active', true),
    supabase
      .from('coaching_centers')
      .select('payment_wallet, payment_number')
      .eq('id', centerId)
      .maybeSingle(),
  ])

  return {
    teacherCount: teacherCount ?? 0,
    subjectCount: subjectCount ?? 0,
    examTypeCount: examTypeCount ?? 0,
    center,
  }
}

/**
 * The customization hub.
 *
 * Everything a centre needs to shape the app to how it actually runs — its own
 * subjects, its own batches and slots, its own exam types, its own teachers and
 * what each may do. Counts are shown next to each entry so an owner can see at
 * a glance what is set up and what is still empty, which is the question they
 * have in their first week.
 *
 * NOT A RANK ANY MORE, and that is the point of this commit. `pageRole('manager')`
 * is what made `can_manage_students` and `can_manage_batches` decorative: a teacher
 * with either box ticked could not reach the hub, so they could not reach the two
 * screens the boxes were about. Now the guard is the union — staff-admin, or one of
 * the two permissions — and the list is built from what the reader actually holds.
 * A teacher handed admissions sees one row, and the plan, the credits, the payment
 * number and their colleagues' names are not among them.
 */
export default async function SettingsPage() {
  const session = await pageCenter()
  const staff = isStaffAdmin(session)
  const [mayStudents, mayBatches] = await Promise.all([
    canManageStudents(),
    canManageBatches(),
  ])

  // Nothing to show rather than an empty page. Both helpers already return true for
  // a staff-admin, so `staff` here is only carrying the owner who holds neither
  // permission row — which is every owner.
  if (!staff && !mayStudents && !mayBatches) forbidden()

  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).settings.hub

  const [{ count: batchCount }, { count: studentCount }, staffOnly] =
    await Promise.all([
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
      staff ? staffCounts(supabase, session.active.centerId) : null,
    ])

  // A count would say nothing here, so the hint carries the answer: either the
  // number a parent will be told to pay, or the fact that there isn't one. An
  // owner who has not set this is losing fees to a question they answer by hand.
  const payHint = staffOnly?.center?.payment_number
    ? t.feesGoTo(formatBdMobile(staffOnly.center.payment_number))
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
  }[] = [
    ...(staff
      ? [
          {
            href: '/settings/center' as Route,
            label: t.center,
            hint: payHint,
            count: null,
          },
        ]
      : []),
    /*
     * The two rows a teacher can be given. In the same places they have always
     * been, because for an owner both flags are true and nothing about this list
     * moved — the only reader who sees a shorter page is the one who was previously
     * refused the whole of it.
     */
    ...(mayStudents
      ? [
          {
            href: '/settings/students' as Route,
            label: t.students,
            hint: t.studentsHint,
            count: studentCount ?? 0,
          },
        ]
      : []),
    ...(mayBatches
      ? [
          {
            href: '/settings/batches' as Route,
            label: t.batches,
            hint: t.batchesHint,
            count: batchCount ?? 0,
          },
        ]
      : []),
    ...(staffOnly
      ? [
          {
            href: '/settings/subjects' as Route,
            label: t.subjects,
            hint: t.subjectsHint,
            count: staffOnly.subjectCount,
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
                  count: staffOnly.teacherCount,
                },
              ]
            : []),
          {
            href: '/settings/exam-types' as Route,
            label: t.examTypes,
            hint: t.examTypesHint,
            count: staffOnly.examTypeCount,
          },
          {
            href: '/settings/sms' as Route,
            label: t.sms,
            hint: t.smsHint,
            count: null,
          },
          /*
           * The plan, last, and now a row rather than the grey line this page used
           * to end with. The sentence is unchanged — it is still the plan and its
           * batch cap — but it has somewhere to lead. An owner who reads "৫টি ব্যাচ"
           * and wants a sixth had no next step from a paragraph.
           */
          {
            href: '/settings/plan' as Route,
            label: t.plans,
            hint: planLine,
            count: null,
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{session.active.centerName}</p>
      </div>

      {/* Whose credits they are. A teacher cannot top them up, cannot open the
          ledger the "details" link points at, and does not need to know what the
          centre has left — the send screen tells them the cost of the message in
          front of them, which is the only balance question they have. */}
      {staff && (
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-sm text-ink-soft">{t.smsCredits}</p>
              <p className="num mt-0.5 text-2xl font-bold text-ink">
                {session.active.smsCreditBalance}
              </p>
            </div>
            <Link
              href="/settings/sms"
              className="text-sm font-medium text-brand-700"
            >
              {t.details}
            </Link>
          </div>
        </Card>
      )}

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
