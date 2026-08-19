import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { roomFor, planName } from '@/lib/plans'
import { rosterKey } from '@/lib/bd/roster'
import { slotLabel } from '@/lib/bd/schedule'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { ImportForm } from './import-form'

/** getSession, not requireRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.import.title} — CoachDesk` }
}

/**
 * Above this many students the roster stops being sent to the browser for the
 * "already on the roster" hint. It is a hint, not a check — the import itself
 * decides inside one transaction — and a centre this size can wait for the
 * summary rather than have a phone parse 40kB of names on every keystroke.
 */
const HINT_CEILING = 1000

export default async function ImportStudentsPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()
  const centerId = session.active.centerId
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.import

  const [{ data: batches }, { count: studentCount }, { data: roster }] =
    await Promise.all([
      supabase
        .from('batches')
        .select('id, name, slot, subjects (name, name_bn)')
        .eq('coaching_center_id', centerId)
        .eq('active', true)
        .order('start_time', { ascending: true, nullsFirst: false }),
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', centerId)
        .eq('status', 'active'),
      // No status filter, deliberately, and unlike the count above: a student who
      // left is still on the roster as far as "do we have this name already" is
      // concerned, which is exactly what the import's own check does. Re-importing
      // a leaver therefore skips rather than duplicating them.
      supabase
        .from('students')
        .select('name, guardian_phone')
        .eq('coaching_center_id', centerId)
        .limit(HINT_CEILING + 1),
    ])

  const room = roomFor(session.plan, 'maxStudents', studentCount ?? 0)
  const existing = roster ?? []

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/students"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.students.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.body}</p>
      </div>

      {room === 0 ? (
        <Card>
          {/* The same refusal the one-at-a-time form gives, in the same words. */}
          <p className="font-medium text-ink">{d.settings.students.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* maxStudents is non-null here: roomFor only counts down from a cap. */}
            {d.settings.students.cap(
              planName(session.plan, locale),
              session.plan.maxStudents ?? 0,
            )}
          </p>
        </Card>
      ) : (
        <ImportForm
          t={d.importForm}
          common={d.common}
          room={room}
          existingKeys={
            existing.length > HINT_CEILING
              ? null
              : existing.map((s) => rosterKey(s.name, s.guardian_phone ?? ''))
          }
          batches={(batches ?? []).map((batch) => {
            const subject = Array.isArray(batch.subjects)
              ? batch.subjects[0]
              : batch.subjects
            const parts = [
              batch.name,
              subject ? localName(subject, locale) : '',
              slotLabel(batch.slot, locale),
            ].filter(Boolean)
            return { id: batch.id, label: parts.join(' · ') }
          })}
        />
      )}
    </div>
  )
}
