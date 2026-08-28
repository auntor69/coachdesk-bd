import Link from 'next/link'

import { Card } from '@/components/ui'
import { pagePermission, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { roomFor, planName } from '@/lib/plans'
import { rosterKey } from '@/lib/bd/roster'
import { slotLabel } from '@/lib/bd/schedule'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { ImportForm } from './import-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
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
  const session = await pagePermission('can_manage_students')
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

  /*
   * WHEN THIS SCREEN REFUSES TO DRAW THE PASTE BOX, and why two of the three reads
   * above are allowed to take it away.
   *
   * The batch list, because of what an empty one does here. `batches.length === 0` in
   * the form is a live sentence — “you have no batches yet”, with a link to make one —
   * shown to an owner with twelve, who then pastes three hundred names that join
   * nothing. The note on those tick-boxes says what that costs: no enrolment is no
   * invoice, so the fee board stays at ₹0 on the afternoon it is being shown to the
   * owner deciding whether to pay.
   *
   * The count, because on a capped plan the paste is refused anyway. `importStudents`
   * returns `limitUnknown` the moment its own count comes back null, so a form built on
   * this one would take three hundred typed lines and save none of them — the arrears
   * screen's mistake, on the screen next to it. `?? 0` also read as the whole cap being
   * free, which is the flattering direction.
   *
   * Not the roster, which is a hint and says so. A failed read there means no hint, and
   * the form already has that state for a centre too large to send one — see
   * `existingKeys` below.
   */
  if (batches === null || (session.plan.maxStudents !== null && studentCount === null)) {
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
        </div>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  const room = roomFor(session.plan, 'maxStudents', studentCount ?? 0)

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
          // Null both for a centre too large to hint and for a roster that did not
          // arrive, because the form treats null as “no hint” and counts every pasted
          // line as new — which is the truthful answer to both. An empty array instead
          // would have said the opposite: that we looked, and nobody on this list is
          // already on the roster.
          existingKeys={
            roster === null || roster.length > HINT_CEILING
              ? null
              : roster.map((s) => rosterKey(s.name, s.guardian_phone ?? ''))
          }
          batches={batches.map((batch) => {
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
