import Link from 'next/link'
import type { Route } from 'next'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile } from '@/lib/bd/phone'

export const metadata = { title: 'সেটিংস — CoachDesk' }

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
  const session = await requireRole('manager')
  const supabase = await createClient()

  const [
    { count: teacherCount },
    { count: subjectCount },
    { count: batchCount },
    { count: studentCount },
    { count: examTypeCount },
  ] = await Promise.all([
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('subjects')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('exam_types')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
  ])

  const items: {
    href: Route
    label: string
    hint: string
    count: number | null
  }[] = [
    {
      href: '/settings/students',
      label: 'শিক্ষার্থী',
      hint: 'নাম, অভিভাবকের নম্বর, ব্যাচ',
      count: studentCount ?? 0,
    },
    {
      href: '/settings/batches',
      label: 'ব্যাচ ও সময়',
      hint: 'সকাল / দুপুর / বিকাল / সন্ধ্যা, কোন দিন ক্লাস',
      count: batchCount ?? 0,
    },
    {
      href: '/settings/subjects',
      label: 'বিষয়',
      hint: 'গণিত, পদার্থ, ইংরেজি — আপনার নিজের তালিকা',
      count: subjectCount ?? 0,
    },
    {
      href: '/settings/teachers',
      label: 'শিক্ষক ও অনুমতি',
      hint: 'কে কী করতে পারবে',
      count: teacherCount ?? 0,
    },
    {
      href: '/settings/exam-types',
      label: 'পরীক্ষার ধরন',
      hint: 'সাপ্তাহিক, মডেল টেস্ট, মাসিক — যা আপনি নেন',
      count: examTypeCount ?? 0,
    },
    {
      href: '/settings/sms',
      label: 'SMS',
      hint: 'ক্রেডিট, কে SMS পাবে না',
      count: null,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">সেটিংস</h1>
        <p className="mt-1 text-ink-soft">{session.active.centerName}</p>
      </div>

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">SMS ক্রেডিট</p>
            <p className="num mt-0.5 text-2xl font-bold text-ink">
              {session.active.smsCreditBalance}
            </p>
          </div>
          <Link href="/settings/sms" className="text-sm font-medium text-brand-700">
            বিস্তারিত
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

      <p className="text-sm text-ink-faint">
        ফ্রি প্ল্যান: ১টি ব্যাচ, সব ফিচার খোলা, SMS সীমিত।
      </p>
    </div>
  )
}
