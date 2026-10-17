import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { ReadOnlyNote } from '@/components/read-only-note'
import { pageCapability, getSession } from '@/lib/auth/session'
import { branchChoicesFor } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { formatTaka } from '@/lib/money'
import {
  CENTER_FREE_TEACHER_SEATS,
  CENTER_TEACHER_SEAT_BDT,
  wouldExceed,
  hasStaff,
  planName,
  teacherSeatOpeningRefusal,
  PLANS,
} from '@/lib/plans'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { TeacherForm } from './teacher-form'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.teachers.newTitle} — CoachDesk` }
}

/**
 * `staff` (§6.2), like the list behind it — this is the write that word is about.
 *
 * THE FORM IS TWO COLUMNS FROM `lg` (§20.8.7), which teacher-form.tsx does rather than
 * this page: one `<form>` has to hold both halves. What this page owns is the letterhead —
 * the seat count the list screen also carries, so the two agree — and the two refusals,
 * both capped, both now carrying the heading this screen never had.
 */
export default async function NewTeacherPage() {
  const session = await pageCapability('staff')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.teachers

  /*
   * A lapsed centre gets no form, and is answered before the solo card below is.
   * `createTeacher` runs requireWritable, so every field here would be refused on save
   * — and above the solo card for the reason the add-student screen orders its own two
   * arms that way: both of these want to talk about the plan, and a tier upsell to a
   * centre whose subscription has lapsed is the wrong one of the two asks.
   */
  if (session.access !== 'full') {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.newTitle}
          back={{ href: '/settings/teachers', label: t.title }}
        />
        <ReadOnlyNote t={d.readOnly} className="max-w-2xl" />
      </div>
    )
  }

  // Same card as the list behind it, for the same reason: on a one-teacher plan
  // there is nobody to add. Reached by a bookmark or a back button, never by a
  // link this build still renders.
  if (!hasStaff(session.plan)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.newTitle}
          back={{ href: '/settings', label: d.settings.hub.title }}
        />
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.soloTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.soloBody(
              planName(session.plan, locale),
              planName(PLANS.center, locale),
            )}
          </p>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()

  const [{ data: subjects }, { count: teacherCount }, branches] = await Promise.all([
    supabase
      .from('subjects')
      .select('id, name, name_bn')
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('name'),
    // Scoped, like the list: an owner of two centres passes is_staff_admin for
    // both, so an unscoped count would spend one centre's headroom on the other's
    // staff and refuse a teacher this centre has room for.
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
    // Which building they teach in — the staff list they appear on and the branch
    // their salary is billed to, not what they are allowed to read. See the form.
    branchChoicesFor(supabase, session),
  ])

  const active = teacherCount ?? 0
  const limit = session.plan.maxTeachers
  const atLimit = wouldExceed(session.plan, 'maxTeachers', active)

  /*
   * The second refusal this page has, and the newer one: a tier that charges per seat
   * cannot take a third colleague while there is nothing on the balance to carry the
   * ৳100 a month it adds (§11.6). `undefined` from a failed count is not a yes — the
   * seat guard reads `active` as the count it could not get, so a dropped read takes the
   * same branch a determined one would (`createTeacher` asks the same question again and
   * fails closed there too).
   */
  const seatRefusal = teacherSeatOpeningRefusal(session.plan, {
    activeTeachers: active,
    balancePoisha: session.billing.balancePoisha,
  })

  /*
   * `null` goes down as `null`, so the form can say the ticks are missing rather
   * than let a dropped read look like a centre with no subjects on its books.
   *
   * Failing open, on the same grounds as the new-student form: the ticks are
   * optional, nothing is overwritten because the teacher does not exist yet, and a
   * teacher with no subject against their name still teaches whatever batches they
   * are put on — the teacher list is where the ticks get added afterwards. An owner
   * standing next to the new teacher should not be sent away over a failed read.
   */
  const subjectOptions =
    subjects &&
    subjects.map((subject) => ({ id: subject.id, label: localName(subject, locale) }))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.newTitle}
        back={{ href: '/settings/teachers', label: t.title }}
        /* The same line the list carries, in the same words: how many teachers there are,
           and out of how many where a tier caps them. An owner adding somebody is the
           reader most likely to want it. */
        subtitle={limit === null ? t.count(active) : t.used(active, limit)}
      />

      {atLimit ? (
        <Card className="max-w-3xl">
          {/* The same refusal the list gives, in the same words. */}
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* maxTeachers is non-null here: wouldExceed is false when uncapped. */}
            {t.cap(
              planName(session.plan, locale),
              limit ?? 0,
              planName(PLANS.center, locale),
            )}
          </p>
        </Card>
      ) : seatRefusal === 'needs_money' ? (
        <Card className="max-w-3xl">
          {/* The list's own card, in the same words: a form that could only be refused is
              the one thing this screen must not draw. */}
          <p className="font-medium text-ink">{t.seatTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {t.errors.seatNotFunded(
              CENTER_FREE_TEACHER_SEATS,
              formatTaka(CENTER_TEACHER_SEAT_BDT),
            )}
          </p>
          <Link
            href="/settings/billing"
            className="mt-3 inline-flex min-h-tap items-center font-medium text-brand-800
              underline underline-offset-4 hover:text-brand-900"
          >
            {t.seatLink}
          </Link>
        </Card>
      ) : (
        <TeacherForm
          t={d.teacherForm}
          permissions={d.teacherPermissions}
          common={d.common}
          subjects={subjectOptions}
          branchPick={d.branchPick}
          branches={branches}
        />
      )}
    </div>
  )
}
