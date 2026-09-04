import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { ReadOnlyNote } from '@/components/read-only-note'
import { pagePermission, getSession, isStaffAdmin } from '@/lib/auth/session'
import { branchChoicesFor, mayChooseBranch } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed, planName, hasStaff } from '@/lib/plans'
import { SLOT_ORDER, slotLabel } from '@/lib/bd/schedule'
import { WEEK_ORDER, dayNameShort } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { BatchForm } from './batch-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.batches.newTitle} — CoachDesk` }
}

export default async function NewBatchPage() {
  const session = await pagePermission('can_manage_batches')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.batches

  /*
   * A lapsed centre gets no form, above all four reads below. `createBatch` runs
   * requireWritable, so the name, the subject, the teacher, the slot and the week's
   * days would all be filled in and refused on save.
   */
  if (session.access !== 'full') {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t.newTitle} back={{ href: '/settings/batches', label: t.title }} />
        <ReadOnlyNote t={d.readOnly} className="max-w-2xl" />
      </div>
    )
  }

  const [{ data: subjects }, { data: teachers }, { count: batchCount }, branches] =
    await Promise.all([
      supabase
        .from('subjects')
        .select('id, name, name_bn')
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('teachers')
        .select('id, name')
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('batches')
        .select('id', { count: 'exact', head: true })
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true),
      /*
       * Which building this class meets in, for the head office of an organisation
       * that has more than one. §8.4 is the reason this is the least optional of the
       * four branch pickers: "Rooms and timetables are physical and do not pool" — a
       * batch is a room at a time of day, so it is in a building whether or not
       * anybody wrote which. Attendance and marks then reach that building through
       * `app.batch_branch` and carry no column of their own.
       */
      branchChoicesFor(supabase, session),
    ])

  /*
   * The action re-checks this; showing it here saves a teacher filling in a long form
   * only to be refused at the end. `?? 0` is deliberate on a plan gate: an unread count
   * opens the form, and the action refuses honestly if it must.
   *
   * NOT DRAWN FOR A READER WHO IS ABOUT TO CHOOSE A BUILDING, because for them this
   * count is the wrong number and the card's sentence is the wrong claim. §8.4 caps
   * batches per branch, so the head office of an institution has as much room as its
   * emptiest building — and `t.cap` would tell an owner with four buildings that their
   * plan holds a hundred batches full stop. Which branch they will pick is not known
   * until they pick it, so the refusal is left to the action, where the building is.
   *
   * Everybody else still gets the card, and they are the readers it was written for:
   * the teacher tiers hold one batch and five, caps a solo teacher meets in the first
   * week, and neither tier has branches at all. A pinned manager keeps it too — their
   * read of `batches` is already narrowed to their own building by
   * `batches_branch_scope`, so the count above is their branch's count.
   */
  const atLimit =
    !mayChooseBranch(session) && wouldExceed(session.plan, 'maxBatches', batchCount ?? 0)

  /*
   * FOUR ARMS BELOW, AND THE THIRD IS WHY: “ADD A SUBJECT FIRST” IS A CLAIM ABOUT
   * THE CENTRE, SO A FAILED READ MAY NOT MAKE IT.
   *
   * `(subjects ?? []).length === 0` made that claim out of a dropped read, over the
   * button that adds a subject — so a centre with eight subjects would be told it
   * has none and handed the one control that creates a ninth. The duplicate is the
   * part that lasts: batches hang off a subject, and marks and fees hang off the
   * batch, so a second Physics splits a class in two across the whole product.
   * There is nothing to draw instead, because the subject is required and cannot be
   * typed — a form with an empty picker submits nothing whatever the reader does.
   *
   * The teacher list is left failing open, which is the opposite call and rests on
   * the field being genuinely optional: its empty option is `teacherLater`, and a
   * batch created without a teacher says so on the batch list and takes one on its
   * own edit screen — which carries the value through a hidden input rather than
   * clearing it, for the reason that screen explains. Refusing the whole form over
   * an optional picker would stop the batch being made at all.
   */

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.newTitle} back={{ href: '/settings/batches', label: t.title }} />

      {atLimit ? (
        <Card className="max-w-2xl">
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* maxBatches is non-null here: wouldExceed only says yes when it is. */}
            {t.cap(planName(session.plan, locale), session.plan.maxBatches ?? 0)}
          </p>
        </Card>
      ) : subjects === null ? (
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.subjectsUnreadable}</p>
        </Card>
      ) : subjects.length === 0 ? (
        <Card className="max-w-2xl">
          <p className="font-medium text-ink">{t.needSubjectTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {isStaffAdmin(session) ? t.needSubjectBody : t.needSubjectAsk}
          </p>
          {/* And the button only for the reader who can use it. /settings/subjects is
              pageRole('manager'), while this screen's floor is a teacher holding
              can_manage_batches — 20260811000019 grants that box INSERT on batches and
              nothing on subjects. So the teacher who is most likely to meet this arm, at
              a centre whose owner opened the batch box before writing the subjects down,
              was handed the one control that answers with a 403. They get the sentence
              instead, which names the person who can. */}
          {isStaffAdmin(session) && (
            <Link
              href="/settings/subjects"
              className="mt-4 inline-flex min-h-tap items-center justify-center
                rounded-xl bg-brand-600 px-5 font-semibold text-white"
            >
              {t.addSubject}
            </Link>
          )}
        </Card>
      ) : (
        <BatchForm
          t={d.batchForm}
          common={d.common}
          branchPick={d.branchPick}
          branches={branches}
          subjects={subjects.map((s) => ({
            id: s.id,
            label: localName(s, locale),
          }))}
          /*
           * Empty on a one-teacher plan, which hides the picker: the only name
           * in it would be the reader's own, and "who teaches this batch" is not
           * a question a solo teacher has. See hasStaff in lib/plans.
           */
          teachers={
            hasStaff(session.plan)
              ? (teachers ?? []).map((teacher) => ({
                  id: teacher.id,
                  label: teacher.name,
                }))
              : []
          }
          /*
           * Labelled here rather than in the form: both lists are `lib/bd`
           * vocabulary, and looking them up on the server keeps the day-name and
           * month-name tables out of the phone's bundle. Twelve short strings of
           * RSC payload against about two kilobytes of JavaScript.
           */
          slots={SLOT_ORDER.map((slot) => ({
            value: slot,
            label: slotLabel(slot, locale),
          }))}
          days={WEEK_ORDER.map((day) => ({
            value: day,
            label: dayNameShort(day, locale),
          }))}
        />
      )}
    </div>
  )
}
