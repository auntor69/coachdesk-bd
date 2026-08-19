import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { dayNameShort } from '@/lib/bd/time'
import { formatTaka } from '@/lib/money'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not requireRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.batches.title} — CoachDesk` }
}

export default async function BatchesPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.batches

  const { data: batches } = await supabase
    .from('batches')
    .select(
      `id, name, slot, start_time, end_time, monthly_fee_bdt, active,
       subjects (name, name_bn), teachers (name),
       batch_schedules (day_of_week), enrollments (id, status)`,
    )
    .eq('coaching_center_id', session.active.centerId)
    .order('start_time', { ascending: true, nullsFirst: false })

  const rows = (batches ?? []).map((batch) => {
    const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects
    const teacher = Array.isArray(batch.teachers) ? batch.teachers[0] : batch.teachers
    const days = (batch.batch_schedules ?? [])
      .map((s) => s.day_of_week)
      .sort((a, b) => a - b)
    return {
      id: batch.id,
      name: batch.name,
      slot: batch.slot,
      startTime: batch.start_time,
      endTime: batch.end_time,
      fee: batch.monthly_fee_bdt,
      active: batch.active,
      subjectName: localName(subject, locale),
      teacherName: teacher?.name ?? '',
      days,
      studentCount: (batch.enrollments ?? []).filter((e) => e.status === 'active')
        .length,
    }
  })

  const activeCount = rows.filter((r) => r.active).length
  const limit = session.plan.maxBatches

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">{t.title}</h1>
            <p className="mt-1 text-ink-soft">
              {limit === null ? t.count(activeCount) : t.used(activeCount, limit)}
            </p>
          </div>
          <Link
            href="/settings/batches/new"
            className="inline-flex min-h-tap shrink-0 items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.new}
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
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
                  <p className="truncate font-medium text-ink">{row.name}</p>
                  <p className="truncate text-sm text-ink-soft">
                    {[
                      row.subjectName,
                      <BatchSlot
                        key="slot"
                        slot={row.slot}
                        start={row.startTime}
                        end={row.endTime}
                        locale={locale}
                      />,
                    ]
                      .filter(Boolean)
                      .map((part, i) => (
                        <span key={i}>
                          {i > 0 && ' · '}
                          {part}
                        </span>
                      ))}
                  </p>
                  <p className="text-sm text-ink-faint">
                    {/* Short day names: five spelled-out ones run past the width of
                        a phone and truncate mid-week. */}
                    {row.days.length > 0
                      ? row.days.map((day) => dayNameShort(day, locale)).join(', ')
                      : t.everyDay}
                    {row.teacherName && ` · ${row.teacherName}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-sm font-semibold text-ink">
                    {formatTaka(row.fee)}
                  </p>
                  <p className="text-xs text-ink-faint">{t.monthly}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    <span className="num">{row.studentCount}</span>{' '}
                    {t.people(row.studentCount)}
                  </p>
                </div>
              </div>
              {!row.active && (
                <p className="mt-2 text-sm text-ink-faint">{t.inactive}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
