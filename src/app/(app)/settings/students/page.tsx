import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile } from '@/lib/bd/phone'
import { MAX_IMPORT_ROWS } from '@/lib/bd/roster'

export const metadata = { title: 'শিক্ষার্থী — CoachDesk' }

/**
 * The roster.
 *
 * Shows the guardian's number on every row on purpose: it is the field most
 * likely to be wrong, and an owner scanning the list is the only realistic way
 * a wrong one gets caught before a parent complains.
 */
export default async function StudentsPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()

  const { data: students } = await supabase
    .from('students')
    .select(
      `id, name, student_code, guardian_phone, class_level, institution,
       status, sms_opt_out, enrollments (id, status, batches (name))`,
    )
    // Scoped as well as governed by RLS: an owner of two centres passes
    // is_staff_admin for both, so the policy alone would mix two rosters.
    .eq('coaching_center_id', session.active.centerId)
    .order('name', { ascending: true })

  const rows = (students ?? []).map((student) => ({
    id: student.id,
    name: student.name,
    code: student.student_code,
    guardianPhone: student.guardian_phone,
    classLevel: student.class_level,
    institution: student.institution,
    active: student.status === 'active',
    smsOptOut: student.sms_opt_out,
    batchNames: (student.enrollments ?? [])
      .filter((e) => e.status === 'active')
      .map((e) => {
        const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches
        return batch?.name ?? ''
      })
      .filter(Boolean),
  }))

  const activeCount = rows.filter((r) => r.active).length
  const limit = session.plan.maxStudents
  const missingPhone = rows.filter((r) => r.active && !r.guardianPhone).length

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← সেটিংস
        </Link>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">শিক্ষার্থী</h1>
            <p className="mt-1 text-ink-soft">
              {limit === null ? (
                <>
                  <span className="num">{activeCount}</span> জন
                </>
              ) : (
                <>
                  <span className="num">{activeCount}</span>/
                  <span className="num">{limit}</span> জন
                </>
              )}
            </p>
          </div>
          <Link
            href="/settings/students/new"
            className="inline-flex min-h-tap shrink-0 items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            নতুন
          </Link>
        </div>
      </div>

      {/*
        The way a centre actually gets its students in: somebody sits down with
        the register and pastes it. Kept in front of the owner rather than hidden
        behind the one-at-a-time form, because 200 students typed one by one is
        an evening nobody spends.
      */}
      <Link
        href="/settings/students/import"
        className="flex min-h-tap items-center justify-between gap-3 rounded-xl
          border-2 border-dashed border-line bg-white px-4 py-3
          hover:border-brand-300"
      >
        <span>
          <span className="block font-medium text-ink">
            রেজিস্টার থেকে একসাথে যোগ করুন
          </span>
          <span className="block text-sm text-ink-soft">
            নামের তালিকা বসিয়ে দিন — একবারে{' '}
            <span className="num">{MAX_IMPORT_ROWS}</span> জন পর্যন্ত
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-lg text-brand-700">
          →
        </span>
      </Link>

      {missingPhone > 0 && (
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">
            <span className="num">{missingPhone}</span> জনের অভিভাবকের নম্বর নেই
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            নম্বর ছাড়া ফলাফল বা ফির SMS যাবে না।
          </p>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">এখনও কোনো শিক্ষার্থী নেই</h2>
          <p className="mt-1 text-sm text-ink-soft">
            শিক্ষার্থী যোগ করলে হাজিরা, পরীক্ষার নম্বর আর ফি — সব এখানে আসবে।
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-line bg-white px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {row.name}
                    {!row.active && (
                      <span className="ml-2 text-sm text-ink-faint">বন্ধ</span>
                    )}
                  </p>
                  {row.batchNames.length > 0 && (
                    <p className="truncate text-sm text-ink-soft">
                      {row.batchNames.join(' · ')}
                    </p>
                  )}
                  <p className="truncate text-sm text-ink-faint">
                    {[row.classLevel, row.institution].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-sm text-ink-soft">
                    {row.guardianPhone ? (
                      formatBdMobile(row.guardianPhone)
                    ) : (
                      <span className="font-medium text-absent">নম্বর নেই</span>
                    )}
                  </p>
                  {row.smsOptOut && (
                    <p className="text-xs text-ink-faint">SMS বন্ধ</p>
                  )}
                  {row.code && (
                    <p className="num text-xs text-ink-faint">{row.code}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
