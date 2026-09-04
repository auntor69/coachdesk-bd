import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { pagePermission, getSession, isStaffAdmin } from '@/lib/auth/session'
import { openAsk } from '@/lib/billing/asks'
import { createClient } from '@/lib/supabase/server'
import { studentRoom, studentCeiling, planFor, planName } from '@/lib/plans'
import { rosterKey } from '@/lib/bd/roster'
import { centerStudentCount } from '@/lib/students/headcount'
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
       * what this reader can see.
       *
       * `room` below is the number of lines this screen will accept, and it is
       * `session.ceiling` minus this. The ceiling is one pooled figure for the whole
       * institution (§3.6) while a count through the reader's own client is their
       * branch's — `students_branch_scope` — so a manager pinned to Mirpur was told
       * 260 lines would fit when the organisation had five. `importStudents` does not
       * partially create students (§10), so the paste is refused whole: three hundred
       * typed lines, an afternoon, and nothing saved.
       */
      centerStudentCount(supabase, centerId),
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
   * screen's mistake, on the screen next to it. `?? 0` also read as the whole ceiling
   * being free, which is the flattering direction.
   *
   * Asked of every plan, where it used to be skipped when `maxStudents` was null. That
   * exempted the centre tiers, which are the ones that charge by the student: their
   * ceiling is the places they bought, so a failed count there is a paste refused for
   * a reason this screen never mentioned.
   *
   * Not the roster, which is a hint and says so. A failed read there means no hint, and
   * the form already has that state for a centre too large to send one — see
   * `existingKeys` below.
   */
  if (batches === null || studentCount === null) {
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

  // The ceiling, not the plan's `maxStudents`, which is null on the tiers that bill
  // per student — and null read as "no limit" here, on exactly the plans where the
  // number is the thing the centre paid for. `studentCount` is non-null past the
  // guard above, so this is the real figure rather than a count that failed.
  const room = studentRoom(session.ceiling, studentCount)

  /*
   * WHERE THE BANDS START FOR A PASTE THAT DOES NOT FIT, and it is the paid ceiling
   * rather than `session.ceiling`. ../../plan/actions.ts prices from `session.active`
   * for the reason written there: a trial moves the effective ceiling while
   * `settle_payment_intent` reads the paid row, so a quote off the trial is a number
   * the database refuses after the money has gone.
   *
   * Null when this plan grants its ceiling outright. A teacher tier has no places for
   * sale at any price — `priceIntent` returns an empty quote and the form falls back to
   * saying so in words.
   */
  const paid = studentCeiling(planFor(session.active.plan), session.active.studentCapacity)
  const forSale = paid.kind === 'purchased' ? paid.ceiling : null

  /*
   * §3.7's fork, resolved here because only the session knows which side of it this
   * reader is on. Read at all only for the manager of a centre that sells places: an
   * owner is offered the price, a teacher neither, and a plan with nothing for sale has
   * no ask to make.
   */
  const mayAsk = session.active.role === 'manager'
  const ask =
    mayAsk && forSale !== null
      ? await openAsk(supabase, centerId, session.active.branchId)
      : null

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/settings/students', label: d.settings.students.title }}
        subtitle={t.body}
      />

      {/*
       * FULL AND UNABLE TO BUY ITS WAY OUT is the only state that takes the paste box
       * away, and it used to be `room === 0` alone. That refused the case §3.5 is
       * actually about: a centre with no free places pasting two hundred names saw a
       * dead card and never learned what those places cost. Now the box is drawn, the
       * shortfall is priced from the bands, and the purchase is offered in place.
       */}
      {room === 0 && forSale === null ? (
        <Card className="max-w-2xl">
          {/*
           * One set of words now, where there used to be two. The other set —
           * settings.students.places, "every place you bought is in use" — belongs to a
           * centre that can buy another, and that centre is no longer sent here: it gets
           * the paste box and a price. What is left is the tier whose ceiling is written
           * in the plan, so the plan is what this says.
           */}
          <p className="font-medium text-ink">{d.settings.students.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {d.settings.students.cap(planName(session.plan, locale), session.ceiling.ceiling)}
          </p>
        </Card>
      ) : (
        <ImportForm
          t={d.importForm}
          common={d.common}
          room={room}
          forSale={forSale}
          // The two guards this screen cannot enforce itself, resolved where the session
          // is: `buyStudentPlaces` is requireRole('owner') and /settings/plan is
          // pageRole('manager'), while this page is `can_manage_students` — so a teacher
          // reaches it and must be offered neither the button nor the link.
          mayBuy={session.active.role === 'owner'}
          mayAsk={mayAsk}
          asked={ask?.places ?? null}
          mayReadPlan={isStaffAdmin(session)}
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
