import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { pageCapability, getSession } from '@/lib/auth/session'
import { branchChoicesFor } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed, hasStaff, planName, PLANS } from '@/lib/plans'
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
