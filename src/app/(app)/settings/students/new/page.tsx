import Link from 'next/link'

import { Card } from '@/components/ui'
import { pagePermission, getSession, isStaffAdmin } from '@/lib/auth/session'
import { openAsk } from '@/lib/billing/asks'
import { branchChoicesFor } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { studentRoom, studentCeiling, planFor, planName, ASK_PLACES } from '@/lib/plans'
import { slotLabel } from '@/lib/bd/schedule'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { AskPlaces } from './ask-places'
import { StudentForm } from './student-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.students.newTitle} — CoachDesk` }
}

export default async function NewStudentPage() {
  const session = await pagePermission('can_manage_students')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.students

  const [{ data: batches }, { count: studentCount }, branches] = await Promise.all([
    supabase
      .from('batches')
      .select('id, name, slot, subjects (name, name_bn)')
      // Scoped as well as governed by RLS: an owner of two centres passes
      // is_staff_admin for both, so the policy alone would offer this centre's
      // student a batch belonging to the other one.
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('start_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
    // Which building this child attends, for the head office of an organisation that
    // has more than one. `null` for everybody else, and no query for them either —
    // see branchChoicesFor.
    branchChoicesFor(supabase, session),
  ])

  /*
   * The ceiling rather than `plan.maxStudents`, which is null on the tiers that bill
   * per student — and this screen read that null as "no limit", so the one plan whose
   * students are metered was the one plan that never saw this card.
   *
   * `?? 0` stays, and it fails open on purpose: a count that did not arrive draws the
   * form, and `createStudent` refuses with `limitUnknown` if it is still failing when
   * the family is at the desk. Showing "no places left" off a failed read would turn
   * somebody away over a number nobody has.
   */
  const atLimit = studentRoom(session.ceiling, studentCount ?? 0) === 0

  /*
   * §3.7's fork, and it is asked of the PAID plan rather than of `session.ceiling`
   * above. The card is drawn off the effective ceiling, because that is the number
   * this reader is actually up against; whether places can be bought at all is a
   * question about the plan whose money `settle_payment_intent` reads. A trial of a
   * teacher tier over a paid centre subscription would otherwise hide the ask on the
   * one centre that could have had the places by the evening.
   *
   * Only a manager, exactly — an owner is offered the price on /settings/plan and
   * `capacity_requests_manager_insert` refuses them anyway. Only when something is
   * for sale: on a plan whose ceiling is written in the plan table there is nothing
   * for HQ to buy, and the way out is a different plan.
   */
  const sells =
    studentCeiling(planFor(session.active.plan), session.active.studentCapacity).kind ===
    'purchased'
  const mayAsk = atLimit && sells && session.active.role === 'manager'
  const ask = mayAsk
    ? await openAsk(supabase, session.active.centerId, session.active.branchId)
    : null

  /*
   * `null` is passed down as `null`, because the form has something to say about a
   * list that did not arrive and nothing to say about an empty one.
   *
   * Failing open here, unlike the batch form next door and unlike this student's own
   * edit screen. The ticks are optional even when they are drawn; nothing can be
   * overwritten, because the row does not exist yet; and a student admitted into no
   * batch is a state the roster already counts and has a filter for. Refusing would
   * mean turning a family away from the desk over a read that will probably work on
   * the next tap. What the form must not do is stay silent — no batch is no
   * attendance and no fee bill, so the aside there names the way to put it right.
   */
  const batchOptions =
    batches &&
    batches.map((batch) => {
      const subject = Array.isArray(batch.subjects)
        ? batch.subjects[0]
        : batch.subjects
      const parts = [
        batch.name,
        // The reader's own language, not always Bangla: this label is how an owner
        // tells two batches of the same subject apart.
        subject ? localName(subject, locale) : '',
        slotLabel(batch.slot, locale),
      ].filter(Boolean)
      return { id: batch.id, label: parts.join(' · ') }
    })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/students"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.newTitle}</h1>
      </div>

      {atLimit ? (
        <Card>
          {/*
           * Two cards, because the two tiers have different ways out: a teacher plan is
           * full and wants changing, a centre has used the places it bought and wants
           * more. See settings.errors.placesFull.
           */}
          {session.ceiling.kind === 'purchased' ? (
            <>
              <p className="font-medium text-ink">{t.placesTitle}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {t.places(session.ceiling.ceiling)}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-ink">{t.capTitle}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {t.cap(planName(session.plan, locale), session.ceiling.ceiling)}
              </p>
            </>
          )}

          {/*
           * §3.4's dead end, closed from both sides. What was above it is true and
           * useless on its own: the manager reading it cannot pay and the owner reading
           * it was being told to go and find the screen themselves.
           *
           * Finished sentences, not `t` — placesAsk and placesAsked count places, and a
           * count-dependent string is a function that cannot be serialised into a client
           * component. See `T` in lib/i18n.
           */}
          {mayAsk && (
            <AskPlaces
              ask={t.placesAsk(ASK_PLACES)}
              asking={t.placesAsking}
              asked={ask ? t.placesAsked(ask.places) : null}
              withdraw={t.placesAskWithdraw}
            />
          )}

          {/* /settings/plan is pageRole('manager'), so a teacher is not sent to it. */}
          {isStaffAdmin(session) && (
            <Link
              href="/settings/plan"
              className="mt-3 inline-flex min-h-tap items-center font-medium text-brand-700"
            >
              {t.placesPlanLink} →
            </Link>
          )}
        </Card>
      ) : (
        <StudentForm
          t={d.studentForm}
          common={d.common}
          batches={batchOptions}
          branchPick={d.branchPick}
          branches={branches}
        />
      )}
    </div>
  )
}
