import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { requireCenter } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { todayInDhaka, dhakaDayOfWeek } from '@/lib/bd/time'

export const metadata = { title: 'আজকের ক্লাস — CoachDesk' }

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
      subjectName: subject?.name_bn || subject?.name || '',
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
            ? `আজ ${pending.length}টি ব্যাচের হাজিরা বাকি`
            : todayRows.length > 0
              ? 'আজকের সব হাজিরা নেওয়া হয়েছে'
              : 'আজ কোনো ক্লাস নেই'}
        </p>
      </div>

      {rows.length === 0 && (
        <Card>
          <h2 className="font-semibold text-ink">শুরু করতে একটি ব্যাচ বানান</h2>
          <p className="mt-1 text-sm text-ink-soft">
            ব্যাচ মানে একটি নির্দিষ্ট সময়ের ক্লাস — যেমন &ldquo;সকাল ৭টা গণিত&rdquo;।
            ব্যাচ বানালে শিক্ষার্থী যোগ করা যাবে।
          </p>
          <Link
            href="/settings/batches/new"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            ব্যাচ যোগ করুন
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
                      <BatchSlot key="slot" slot={row.slot} start={row.startTime} end={row.endTime} />,
                    ]
                      .filter(Boolean)
                      .map((part, i) => (
                        <span key={i}>
                          {i > 0 && ' · '}
                          {part}
                        </span>
                      ))}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-faint">
                    <span className="num">{row.studentCount}</span> জন শিক্ষার্থী
                  </p>
                </div>

                {row.taken ? (
                  <span
                    className="shrink-0 rounded-lg bg-brand-50 px-3 py-1.5 text-sm
                      font-semibold text-brand-700"
                  >
                    ✓ নেওয়া হয়েছে
                  </span>
                ) : (
                  <span
                    className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 text-sm
                      font-semibold text-white"
                  >
                    হাজিরা নিন
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
            আজ ক্লাস নেই এমন ব্যাচ (<span className="num">{otherRows.length}</span>)
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
                  <span className="shrink-0 text-sm text-ink-faint">
                    <span className="num">{row.studentCount}</span> জন
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
