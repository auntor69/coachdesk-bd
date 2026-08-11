import Link from 'next/link'

import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { createExamType } from '../actions'
import { QuickAdd } from '../quick-add'

export const metadata = { title: 'পরীক্ষার ধরন — CoachDesk' }

/**
 * Exam types, per centre.
 *
 * Every centre names its assessments differently — সাপ্তাহিক পরীক্ষা, মডেল টেস্ট,
 * ডেইলি ভাইভা — and the name ends up in the SMS parents read. No plan limit
 * here: it costs us nothing and constraining it would only make the app feel
 * like it belongs to us rather than to them.
 */
export default async function ExamTypesPage() {
  await requireRole('manager')
  const supabase = await createClient()

  const { data: examTypes } = await supabase
    .from('exam_types')
    .select('id, name, name_bn, exams (id)')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  const rows = examTypes ?? []

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← সেটিংস
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">পরীক্ষার ধরন</h1>
        <p className="mt-1 text-ink-soft">
          আপনার সেন্টার যে ধরনের পরীক্ষা নেয়, সেভাবেই লিখুন
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((type) => (
            <li
              key={type.id}
              className="flex items-center justify-between gap-3 rounded-xl
                border border-line bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {type.name_bn || type.name}
                </p>
                {type.name_bn && (
                  <p className="truncate text-sm text-ink-faint">{type.name}</p>
                )}
              </div>
              <span className="shrink-0 text-sm text-ink-soft">
                <span className="num">{(type.exams ?? []).length}</span> পরীক্ষা
              </span>
            </li>
          ))}
        </ul>
      )}

      <QuickAdd
        action={createExamType}
        label="ধরনের নাম"
        placeholder="Weekly Test"
        placeholderBn="সাপ্তাহিক পরীক্ষা"
      />
    </div>
  )
}
