import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { ReadOnlyNote } from '@/components/read-only-note'
import { Card } from '@/components/ui'
import { pagePermission, getSession } from '@/lib/auth/session'
import { MAX_IMPORT_ROWS } from '@/lib/bd/roster'
import { slotLabel } from '@/lib/bd/schedule'
import { branchChoicesFor } from '@/lib/branches'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { rosterDoor } from '@/lib/students/roster-door'
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
 * TWO SHAPES, AND THEY ARE THE TWO THE PRODUCT HAS LEFT (§16.1 step 28). A centre that
 * may write gets the form and a rail of context: what saving it is about to do, and the
 * way in to the paste box for somebody about to type two hundred names one at a time. A
 * lapsed one gets no form at all — see the arm below, which is written first because it
 * answers before the other can.
 *
 * THE THIRD SHAPE IS GONE, and it was capacity's. This screen used to fork a second time
 * on `atLimit`: no places left meant one column whose whole content was the way out — the
 * price of the next place, the control that buys it, the reference for the transfer to
 * bKash, and the manager's ask. A per-student tier has no ceiling, so there is no wall to
 * hit and no purchase to make from the admission desk; the balance is the conversation
 * and it lives on /settings/billing. Nothing here adds a student's place, and nothing
 * here ever did on the strength of a claim to have paid (§22).
 */
export default async function NewStudentPage() {
  const session = await pagePermission('can_manage_students')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.students

  /** The same bar on both shapes of the screen. */
  const head = (
    <PageHeader title={t.newTitle} back={{ href: '/settings/students', label: t.title }} />
  )

  /*
   * THE LAPSED CENTRE, WRITTEN FIRST BECAUSE IT ANSWERS BEFORE THE FORM CAN.
   *
   * `createStudent` runs `requireWritable`, so a lapsed centre cannot admit anybody —
   * and this screen was drawing the whole form anyway, twelve fields wide, with a family
   * at the desk. See components/read-only-note.tsx.
   *
   * It used to be written above the at-limit wall as well, because a full lapsed centre
   * was both things at once and only one ask fits on a screen — the bill won. That fork
   * went with capacity (§16.1 step 28), and the rule it served is now the whole of this
   * arm: nothing is drawn here that cannot be used.
   *
   * Before every query, and that is still worth doing: nothing here reads a batch list or
   * a branch, so a read-only centre costs two round trips fewer rather than two wasted
   * ones.
   */
  if (session.access !== 'full') {
    return (
      <div className="flex flex-col gap-5">
        {head}
        <ReadOnlyNote t={d.readOnly} className="max-w-2xl" />
      </div>
    )
  }

  /*
   * THE TRIAL'S BOUND, BEFORE THE FORM AND AFTER THE LAPSED ARM (20260811000098). Second and
   * not first because the arm above answers without a single query while this one has to ask
   * for the policy row and the organisation's headcount — and asks for neither on a paid tier
   * or a funded balance, which is every ordinary visit (`rosterDoor`). A form that could only
   * be refused is the one thing this screen must not draw: the reader here has a family at the
   * desk, and twelve fields of a child's details are an expensive way to find out.
   */
  const door = await rosterDoor(supabase, session)
  if (!door.open) {
    return (
      <div className="flex flex-col gap-5">
        {head}
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

  const [{ data: batches }, branches] = await Promise.all([
    supabase
      .from('batches')
      .select('id, name, slot, subjects (name, name_bn)')
      // Scoped as well as governed by RLS: an owner of two centres passes
      // is_staff_admin for both, so the policy alone would offer this centre's
      // student a batch belonging to the other one.
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('start_time', { ascending: true, nullsFirst: false }),
    // Which building this child attends, for the head office of an organisation that
    // has more than one. `null` for everybody else, and no query for them either —
    // see branchChoicesFor.
    branchChoicesFor(supabase, session),
  ])

  /*
   * NO CEILING, NO WALL, NO PURCHASE (§16.1 step 28). This is where the at-limit fork
   * used to be, and every part of it is gone: `studentRoom(session.ceiling, count)` and
   * the headcount it was fed, `studentCeiling` over the paid plan and the paid capacity,
   * the two roles that decided who may buy and who may ask, and the two reads behind the
   * wall — the branch manager's open ask and the owner's unpaid place purchases, both of
   * them keyed to the `student_capacity` purchase kind the column went with. A per-student
   * tier has no student limit, so nothing here can be full and there is nothing to sell
   * from the desk. The manager's ask and its row on /hq survive one cut longer, for the
   * rows already in the table.
   */

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

  /*
   * The dashboard's arrangement, for its reasons (see /dashboard/page.tsx): one DOM, two
   * layouts. Below `lg` the two wrappers are `display: contents`, so every block is a
   * direct child of the single column and its order number puts it in reading order; from
   * `lg` the wrappers become the columns themselves and each block's number applies
   * inside its own.
   *
   * The numbers are 3 to 5 rather than 2 to 4, and they are left where they were rather
   * than shifted down: only their relative order matters, and renumbering three blocks
   * to save a 1 is three chances to swap two of them. The places warning that used to
   * carry `order-2` went with the ceiling (§16.1 step 28).
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
          {/* §3.7's places warning — staff admins only, above the form on a phone, and
              gone with the ceiling it counted against (§16.1 step 28). Nothing on this
              screen has a figure to warn about: the form admits whoever there is room in
              the batch for. */}

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
