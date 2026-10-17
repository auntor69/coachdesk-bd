import Link from 'next/link'

import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { ReadOnlyNote } from '@/components/read-only-note'
import { pagePermission, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { roomFor } from '@/lib/plans'
import { rosterKey } from '@/lib/bd/roster'
import { centerStudentCount } from '@/lib/students/headcount'
import { rosterDoor } from '@/lib/students/roster-door'
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

  /*
   * A lapsed centre gets no paste box, and this is the arm that costs the most to have
   * been missing: §10 forbids a partial import, so `importStudents` refuses the paste
   * whole — three hundred typed lines and an afternoon, saved nowhere. Before the three
   * reads below, none of which have anything to tell this reader.
   *
   * It used to be written above a second card as well — full, and on a plan that sells
   * no places — for the same one-ask-per-screen reason the add-student screen gives.
   * That card went with capacity (§16.1 step 28): a per-student tier has no ceiling to
   * be full of, so the only paste this screen refuses is the one a lapsed centre cannot
   * make at all.
   */
  if (session.access !== 'full') {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.title}
          back={{ href: '/settings/students', label: d.settings.students.title }}
        />
        <ReadOnlyNote t={d.readOnly} className="max-w-2xl" />
      </div>
    )
  }

  const [{ data: batches }, studentCount, { data: roster }] =
    await Promise.all([
      supabase
        .from('batches')
        .select('id, name, slot, subjects (name, name_bn)')
        .eq('coaching_center_id', centerId)
        .eq('active', true)
        .order('start_time', { ascending: true, nullsFirst: false }),
      /*
       * How full the ORGANISATION is, through 20260811000076 rather than a count of
       * what this reader can see — and only where the tier has a student cap at all.
       *
       * `room` below is the number of lines this screen will accept, the plan's own
       * `maxStudents` minus this. A count through the reader's own client is their
       * branch's (`students_branch_scope`), and `importStudents` does not partially
       * create students (§10), so the paste is refused whole: three hundred typed
       * lines, an afternoon, and nothing saved.
       *
       * SKIPPED ON BOTH PER-STUDENT TIERS (§16.1 step 28), where `maxStudents` is null
       * and the balance — not a ceiling — is what carries the roster. There is nothing
       * to compare against, so the read is not made and a failed one cannot refuse a
       * paste that was never going to be refused.
       */
      session.plan.maxStudents === null
        ? null
        : centerStudentCount(supabase, centerId),
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
   * The count, because the paste is refused anyway without it. `importStudents`
   * returns `limitUnknown` the moment its own count comes back null, so a form built on
   * this one would take three hundred typed lines and save none of them — the arrears
   * screen's mistake, on the screen next to it. `?? 0` also read as the whole cap being
   * free, which is the flattering direction.
   *
   * Only where a count was asked for, which is where the tier has a student cap: a
   * per-student tier reads nothing, has no `room` to compare against, and must not be
   * refused a paste over a count it never needed.
   *
   * Not the roster, which is a hint and says so. A failed read there means no hint, and
   * the form already has that state for a centre too large to send one — see
   * `existingKeys` below.
   */
  if (batches === null || (session.plan.maxStudents !== null && studentCount === null)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.title}
          back={{ href: '/settings/students', label: d.settings.students.title }}
        />
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  /*
   * ROOM, OR NO LIMIT AT ALL (§16.1 step 28). `roomFor` answers null where
   * `maxStudents` is null, which is both per-student tiers, and the form reads null as
   * "this tier caps nothing" — the paste box is drawn on every plan and the sentence
   * about the plan having room is a teacher tier's alone.
   *
   * The priced shortfall that used to live here is gone with it: there was never a
   * purchase behind this screen that did not start at `studentCeiling`, and a
   * per-student tier has no ceiling to start the bands at.
   */
  const room =
    studentCount === null ? null : roomFor(session.plan, 'maxStudents', studentCount)

  /*
   * AND THE TRIAL'S BOUND, WHICH IS THE THIRD REFUSAL THIS SCREEN HAS (20260811000098). It is
   * the dearest of the three to have been missing, for the reason the lapsed arm above gives
   * and one more of its own: `importStudents` refuses the paste whole (§10), so an owner who
   * pasted three hundred names into a trial whose roster is full has an afternoon to type
   * again and nowhere it will land. Asked here — after the three reads the screen already made
   * — and it costs nothing on the ordinary path, because a tier with a student cap and an
   * organisation with money on its balance both answer before any query at all.
   */
  const door = await rosterDoor(supabase, session)
  if (!door.open) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.title}
          back={{ href: '/settings/students', label: d.settings.students.title }}
        />
        <Card className="max-w-2xl">
          <p className="font-medium text-ink">{door.title}</p>
          <p className="mt-1 text-sm text-ink-soft">{door.body}</p>
          <Link
            href={door.to}
            className="mt-3 inline-flex min-h-tap items-center font-medium text-brand-800
              underline underline-offset-4 hover:text-brand-900"
          >
            {door.link}
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/settings/students', label: d.settings.students.title }}
        subtitle={t.body}
      />

      {/*
       * THE FULL-AND-CANNOT-BUY CARD IS GONE (§16.1 step 28), and the paste box that
       * replaced it is now unconditional. The card drew for a plan whose ceiling was
       * written in the plan table — a teacher tier past its own allowance — and it was
       * the one state that took the box away. A per-student tier has no ceiling, so the
       * only cap left is that same plan allowance, and the form says so in one sentence
       * above the button rather than replacing the screen.
       */}
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
    </div>
  )
}
