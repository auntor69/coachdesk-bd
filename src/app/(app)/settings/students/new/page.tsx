import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { PlacesWarning } from '@/components/places-warning'
import { Card } from '@/components/ui'
import { pagePermission, getSession, isStaffAdmin } from '@/lib/auth/session'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { MAX_IMPORT_ROWS } from '@/lib/bd/roster'
import { slotLabel } from '@/lib/bd/schedule'
import { openAsk } from '@/lib/billing/asks'
import { branchChoicesFor } from '@/lib/branches'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { centerStudentCount } from '@/lib/students/headcount'
import {
  capacityPressure,
  studentRoom,
  studentCeiling,
  nextSeatCostBdt,
  planFor,
  planName,
  ASK_PLACES,
} from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import { BuyPlaces } from '../../plan/buy-places'
import { OpenPurchase } from '../../plan/open-purchase'
import { AskPlaces } from './ask-places'
import { StudentForm } from './student-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.students.newTitle} — CoachDesk` }
}

/**
 * Admitting one student — the most-used write path in the product.
 *
 * TWO SHAPES, NOT ONE. With places left this is a form and a rail of context: what the
 * form is about to do, and the way in to the paste box for somebody who is about to type
 * two hundred names one at a time. With no places left there is no form to draw, so the
 * screen is one column and the whole of it is the way out.
 *
 * THE CEILING IS NOT A DEAD END ANY MORE (§3.4). What used to happen here is what the
 * masterplan opens by forbidding: an owner was refused, told the places were gone, and
 * sent to /settings/plan to work out for themselves how many to buy. The price of one
 * more place and the control that buys it are on this screen now, and the reference the
 * founder needs to match the transfer is printed here too — because this is where the
 * purchase happened, and an owner who leaves for bKash comes back to this URL.
 *
 * WHAT IT STILL DOES NOT DO IS PRETEND (§22). Nothing here adds a place: the money is
 * sent by hand and the founder settles it, so the words say so and the student is not
 * admitted on the strength of a form submission. The alternative — showing the student
 * created and the capacity raised the moment somebody claims to have paid — is the one
 * thing the billing side of this product must never do.
 */
export default async function NewStudentPage() {
  const session = await pagePermission('can_manage_students')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.students

  const [{ data: batches }, studentCount, branches] = await Promise.all([
    supabase
      .from('batches')
      .select('id, name, slot, subjects (name, name_bn)')
      // Scoped as well as governed by RLS: an owner of two centres passes
      // is_staff_admin for both, so the policy alone would offer this centre's
      // student a batch belonging to the other one.
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('start_time', { ascending: true, nullsFirst: false }),
    /*
     * The ORGANISATION's headcount, through 20260811000076 rather than a count of the
     * rows this reader can see. A place is a licence and licences pool (§3.6), so
     * `session.ceiling` below is one figure for the whole institution; a count through
     * this client is `students_branch_scope`'s, i.e. one building's. Pairing them told
     * a manager pinned to Mirpur with 40 students that 260 places were free while the
     * organisation was full, and this is the screen where that costs the most: the
     * family is at the desk, the form is drawn, and `createStudent` refuses with CD001
     * on save.
     */
    centerStudentCount(supabase, session.active.centerId),
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
   * teacher tier over a paid centre subscription would otherwise hide the way out on
   * the one centre that could have had the places by the evening.
   *
   * On a plan whose ceiling is written in the plan table there is nothing to buy, and
   * the way out is a different plan — hence `sells` gating both routes below.
   */
  const paid = studentCeiling(planFor(session.active.plan), session.active.studentCapacity)
  const sells = paid.kind === 'purchased'
  // An owner pays; `buyStudentPlaces` is planOwner() and would refuse anybody else.
  const mayBuy = atLimit && sells && session.active.role === 'owner'
  // A manager asks, because `capacity_requests_manager_insert` is the only write they
  // have here — §3.7. Exactly one of these two is ever true.
  const mayAsk = atLimit && sells && session.active.role === 'manager'

  const [ask, buys] = await Promise.all([
    mayAsk ? openAsk(supabase, session.active.centerId, session.active.branchId) : null,
    /*
     * Purchases opened and not yet paid for, read the same way /settings/plan reads them
     * so the two screens cannot disagree about what is waiting. The reference has to
     * survive a reload — the owner leaves for bKash and comes back — so it is read off
     * the row rather than carried in the action's return, and a lapsed one is read too:
     * an owner who sent the money a day late needs telling the price expired, not shown
     * a screen that has forgotten the purchase happened.
     */
    mayBuy
      ? supabase
          .from('payment_intents')
          .select('id, quantity, amount_bdt, expires_at')
          .eq('coaching_center_id', session.active.centerId)
          .eq('purpose', 'student_capacity')
          .in('state', ['pending', 'initiated'])
          .order('created_at', { ascending: false })
          .limit(5)
      : { data: null, error: null },
  ])

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

  /** The same bar on both shapes of the screen. */
  const head = (
    <PageHeader title={t.newTitle} back={{ href: '/settings/students', label: t.title }} />
  )

  if (atLimit) {
    return (
      // One column, and the cap on the card rather than the column: there is one thing to
      // read, and a 7/5 split with an empty rail beside it would be a third of the screen
      // saying nothing.
      <div className="flex flex-col gap-5">
        {head}

        <Card className="max-w-2xl">
          {/*
           * Two openings, because the two tiers have different ways out: a teacher plan
           * is full and wants changing, a centre has used the places it bought and wants
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
           * §3.4 and §20.5, the half that was missing: the way out is on the screen the
           * refusal happened on, and the refusal names the price rather than the
           * constraint. "You have used all 120 places, one more costs ৳25" is the
           * masterplan's own sentence; "capacity exceeded" is our word for our problem.
           *
           * One figure and not the bands — §33 — from the same `nextSeatCostBdt` the
           * control below quotes with, off `paid.ceiling` because that is where the bands
           * start for `settle_payment_intent`. BuyPlaces prints it again in its own hint
           * until a digit is typed, and then that line becomes the whole bill: the price
           * belongs in the refusal, and it belongs beside the field as it changes.
           *
           * What the note adds is the thing no price says — §22. Buying is a transfer
           * somebody checks, so it does not admit the student standing here.
           */}
          {mayBuy && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="num font-semibold text-ink">
                {t.placesNext(formatTaka(nextSeatCostBdt(paid.ceiling)))}
              </p>
              <p className="mt-1 text-sm text-ink-soft">{t.placesBuyNote}</p>

              <BuyPlaces
                ceiling={paid.ceiling}
                locale={locale}
                words={d.settings.plan.places}
              />

              {buys.error && (
                <p className="mt-3 text-sm text-ink-soft">
                  {d.settings.plan.places.unreadable}
                </p>
              )}

              {/* Below the control on purpose: `places.opened` says to send the money as
                  shown below, and after the action's revalidate this is what is below. */}
              {buys.data && buys.data.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <h3 className="font-medium text-ink">
                    {d.settings.plan.places.waitingTitle}
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {buys.data.map((buy) => (
                      <OpenPurchase
                        key={buy.id}
                        id={buy.id}
                        line={d.settings.plan.placesLine(
                          buy.quantity,
                          formatTaka(Number(buy.amount_bdt)),
                        )}
                        note={null}
                        expiresAt={buy.expires_at}
                        salesPhone={normalizeBdMobile(
                          process.env.NEXT_PUBLIC_SALES_PHONE ?? '',
                        )}
                        locale={locale}
                        t={d.settings.plan}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/*
           * The manager's only write here — §3.7. Finished sentences, not `t`:
           * placesAsk and placesAsked count places, and a count-dependent string is a
           * function that cannot be serialised into a client component. See `T`.
           */}
          {mayAsk && (
            <AskPlaces
              ask={t.placesAsk(ASK_PLACES)}
              asking={t.placesAsking}
              asked={ask ? t.placesAsked(ask.places) : null}
              withdraw={t.placesAskWithdraw}
            />
          )}

          {/* The way out that costs nothing and works on every tier: a student who has
              left is still on the roster taking up a place. */}
          <Link
            href="/settings/students"
            className="mt-4 flex min-h-tap items-center font-medium text-brand-700"
          >
            {t.placesFreeLink} →
          </Link>

          {/* And the plan itself, which is the only way out on a tier that does not sell
              places. /settings/plan is pageRole('manager'), so a teacher is not sent to
              it. Last, because for a centre it is no longer the errand. */}
          {isStaffAdmin(session) && (
            <Link
              href="/settings/plan"
              className="flex min-h-tap items-center text-ink-soft hover:text-ink"
            >
              {t.placesPlanLink} →
            </Link>
          )}
        </Card>
      </div>
    )
  }

  /*
   * The dashboard's arrangement, for its reasons (see /dashboard/page.tsx): one DOM, two
   * layouts. Below `lg` the two wrappers are `display: contents`, so every block is a
   * direct child of the single column and its order number puts it in reading order; from
   * `lg` the wrappers become the columns themselves and each block's number applies
   * inside its own.
   *
   * The warning sits above the form, and that is the whole reason the numbers are not in
   * source order: eighteen students short of the ceiling is something to read before
   * typing a name, not after submitting one.
   */
  return (
    <div className="flex flex-col gap-5">
      {head}

      {/* The grid is nested under the bar rather than holding it as a twelfth-column
          cell: a sticky box only travels inside its containing block, and a grid cell's
          block is one grid row. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="contents lg:order-2 lg:col-span-7 lg:flex lg:flex-col lg:gap-5">
          <div className="order-3">
            <StudentForm
              t={d.studentForm}
              common={d.common}
              batches={batchOptions}
              branchPick={d.branchPick}
              branches={branches}
            />
          </div>
        </div>

        <div className="contents lg:order-3 lg:col-span-5 lg:flex lg:flex-col lg:gap-5">
          {/*
           * Null while there is room, so nothing is drawn and nothing costs a gap. Staff
           * admins only, and the reason is the door rather than the news: it ends in a
           * link to /settings/plan, which a teacher on `can_manage_students` would be
           * refused at. Their version of this warning is the form saying no.
           */}
          {isStaffAdmin(session) && (
            <PlacesWarning
              className="order-2"
              pressure={capacityPressure(session.ceiling, studentCount ?? 0)}
              t={d.dashboard}
            />
          )}

          {/* The same tile as the roster's, word for word: 200 students typed one at a
              time is an evening nobody spends, and this form is where somebody finds
              that out on student four. */}
          <Link
            href="/settings/students/import"
            className="order-4 flex min-h-tap items-center justify-between gap-3
              rounded-xl border-2 border-dashed border-line bg-white px-4 py-3
              hover:border-brand-300"
          >
            <span>
              <span className="block font-medium text-ink">{t.importTitle}</span>
              <span className="block text-sm text-ink-soft">
                {t.importBody(MAX_IMPORT_ROWS)}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-lg text-brand-700">
              →
            </span>
          </Link>

          {/*
           * What saving this actually does, in two sentences — both of which exist on
           * the roster as a problem to fix afterwards. A guardian's number that reaches
           * nobody and a student in no batch are the two ways a record looks finished
           * and is not, and this is the one moment where saying so costs nobody an
           * afternoon.
           */}
          <Card className="order-5">
            <h2 className="font-semibold text-ink">{t.savesTitle}</h2>
            <p className="mt-2 text-sm text-ink-soft">{t.savesPhone}</p>
            <p className="mt-2 text-sm text-ink-soft">{t.savesBatch}</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
