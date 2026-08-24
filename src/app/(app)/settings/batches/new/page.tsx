import Link from 'next/link'

import { Card } from '@/components/ui'
import { pagePermission, getSession } from '@/lib/auth/session'
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

  const [{ data: subjects }, { data: teachers }, { count: batchCount }] =
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
    ])

  // The action re-checks this; showing it here saves a teacher filling in a
  // long form only to be refused at the end.
  const atLimit = wouldExceed(session.plan, 'maxBatches', batchCount ?? 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/batches"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.newTitle}</h1>
      </div>

      {atLimit ? (
        <Card>
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* maxBatches is non-null here: wouldExceed only says yes when it is. */}
            {t.cap(planName(session.plan, locale), session.plan.maxBatches ?? 0)}
          </p>
        </Card>
      ) : (subjects ?? []).length === 0 ? (
        <Card>
          <p className="font-medium text-ink">{t.needSubjectTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.needSubjectBody}</p>
          <Link
            href="/settings/subjects"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.addSubject}
          </Link>
        </Card>
      ) : (
        <BatchForm
          t={d.batchForm}
          common={d.common}
          subjects={(subjects ?? []).map((s) => ({
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
