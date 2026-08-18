import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { requireCenter, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { todayInDhaka, dhakaDayOfWeek } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'

/**
 * A page title has to read the session, and `export const metadata` cannot —
 * it is evaluated without a request. `generateMetadata` can, and costs nothing
 * extra: `getSession` is wrapped in React `cache()`, so the page below reuses
 * the same result rather than asking Supabase twice.
 *
 * `getSession` and not `requireCenter`: the require* helpers throw, and a throw
 * here would turn the layout's redirect-to-login into a 500. A title is not an
 * authorization boundary — the layout redirects, the page re-derives, and a
 * visitor who never gets to see this screen gets a default-language title.
 */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).teach.title} — CoachDesk` }
}

/**
 * A teacher's home: today's batches, each one tap from attendance.
 *
 * Ordered by whether attendance is already taken, then by start time. The point
 * is that a teacher arriving at 4pm sees the 4pm batch at the top without
 * reading anything — the screen answers "what do I do now" before it answers
 * "what does this app contain".
 */
export default async function TeachPage() {
  const session = await requireCenter()
  const supabase = await createClient()
  const today = todayInDhaka()
  const dow = dhakaDayOfWeek()
  const locale = session.locale
  const t = dict(locale).teach

  // RLS narrows this to batches this teacher actually teaches; an owner in
  // Teacher Mode sees all of their own center's batches, which is correct.
  const { data: batches } = await supabase
    .from('batches')
    .select(
      `id, name, slot, start_time, end_time,
       subjects (name, name_bn),
       batch_schedules (day_of_week, start_time, end_time),
       enrollments (id, status)`,
    )
    .eq('active', true)
    .order('start_time', { ascending: true, nullsFirst: false })

  const { data: sessions } = await supabase
    .from('attendance_sessions')
    .select('id, batch_id')
    .eq('session_date', today)

  const takenBatchIds = new Set((sessions ?? []).map((s) => s.batch_id))

  const rows = (batches ?? []).map((batch) => {
    const schedules = batch.batch_schedules ?? []
    // A batch with no schedule rows is treated as meeting every day. Centres
    // set schedules up late, and hiding their batches until they do would look
    // like data loss.
    const meetsToday =
      schedules.length === 0 || schedules.some((s) => s.day_of_week === dow)
    const todaySchedule = schedules.find((s) => s.day_of_week === dow)
    const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects

    return {
      id: batch.id,
      name: batch.name,
      subjectName: localName(subject, locale),
      slot: batch.slot,
      startTime: todaySchedule?.start_time ?? batch.start_time,
      endTime: todaySchedule?.end_time ?? batch.end_time,
      studentCount: (batch.enrollments ?? []).filter((e) => e.status === 'active')
        .length,
      taken: takenBatchIds.has(batch.id),
      meetsToday,
    }
  })

  const todayRows = rows.filter((r) => r.meetsToday)
  const otherRows = rows.filter((r) => !r.meetsToday)
  const pending = todayRows.filter((r) => !r.taken)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{greetingFor(session)}</h1>
        <p className="mt-1 text-ink-soft">
          {pending.length > 0
            ? t.pending(pending.length)
            : todayRows.length > 0
              ? t.allTaken
              : t.noClassToday}
        </p>
      </div>

      {rows.length === 0 && (
        <Card>
          <h2 className="font-semibold text-ink">{t.firstBatchTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.firstBatchBody}</p>
          <Link
            href="/settings/batches/new"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.addBatch}
          </Link>
        </Card>
      )}

      {todayRows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {todayRows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/teach/${row.id}`}
                className="flex items-center gap-4 rounded-2xl border border-line
                  bg-white p-4 shadow-sm transition-colors hover:border-brand-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{row.name}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-soft">
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
                  <p className="num mt-0.5 text-sm text-ink-faint">
                    {t.students(row.studentCount)}
                  </p>
                </div>

                {row.taken ? (
                  <span
                    className="shrink-0 rounded-lg bg-brand-50 px-3 py-1.5 text-sm
                      font-semibold text-brand-700"
                  >
                    ✓ {t.taken}
                  </span>
                ) : (
                  <span
                    className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 text-sm
                      font-semibold text-white"
                  >
                    {t.take}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {otherRows.length > 0 && (
        <details className="rounded-2xl border border-line bg-white p-4">
          <summary className="min-h-tap cursor-pointer font-medium text-ink-soft">
            {t.otherBatches} (<span className="num">{otherRows.length}</span>)
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {otherRows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/teach/${row.id}`}
                  className="flex min-h-tap items-center justify-between gap-3
                    rounded-xl px-3 hover:bg-surface-alt"
                >
                  <span className="truncate text-ink">{row.name}</span>
                  <span className="num shrink-0 text-sm text-ink-faint">
                    {t.studentsShort(row.studentCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
