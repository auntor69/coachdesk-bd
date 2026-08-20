import Link from 'next/link'

import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { createExamType } from '../actions'
import { QuickAdd } from '../quick-add'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.examTypes.title} — CoachDesk` }
}

/**
 * Exam types, per centre.
 *
 * Every centre names its assessments differently — সাপ্তাহিক পরীক্ষা, মডেল টেস্ট,
 * ডেইলি ভাইভা — and the name ends up in the SMS parents read. No plan limit
 * here: it costs us nothing and constraining it would only make the app feel
 * like it belongs to us rather than to them.
 */
export default async function ExamTypesPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.examTypes

  const { data: examTypes } = await supabase
    .from('exam_types')
    .select('id, name, name_bn, exams (id)')
    .eq('coaching_center_id', session.active.centerId)
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
          ← {d.settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.subtitle}</p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((type) => {
            const primary = localName(type, locale)
            const other = locale === 'en' ? type.name_bn : type.name
            const examCount = (type.exams ?? []).length
            return (
              <li
                key={type.id}
                className="flex items-center justify-between gap-3 rounded-xl
                  border border-line bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{primary}</p>
                  {other && other !== primary && (
                    <p className="truncate text-sm text-ink-faint">{other}</p>
                  )}
                </div>
                <span className="shrink-0 text-sm text-ink-soft">
                  <span className="num">{examCount}</span> {t.exams(examCount)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <QuickAdd
        action={createExamType}
        common={d.common}
        label={t.nameLabel}
        placeholder="Weekly Test"
        placeholderBn="সাপ্তাহিক পরীক্ষা"
      />
    </div>
  )
}
