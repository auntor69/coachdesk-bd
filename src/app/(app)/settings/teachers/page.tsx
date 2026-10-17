import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { pageCapability, getSession } from '@/lib/auth/session'
import { usernamesFor } from '@/lib/auth/username-login'
import { branchChoicesFor } from '@/lib/branches'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { formatTaka } from '@/lib/money'
import {
  CENTER_FREE_TEACHER_SEATS,
  CENTER_TEACHER_SEAT_BDT,
  wouldExceed,
  hasStaff,
  overStaffSeats,
  planName,
  teacherSeatOpeningRefusal,
  PLANS,
} from '@/lib/plans'
import { PERMISSION_DEFAULTS } from '@/lib/permissions'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { TeacherList, type TeacherRow } from './teacher-list'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.teachers.title} — CoachDesk` }
}

/**
 * Who teaches here and what each of them may do.
 *
 * The permission defaults matter more than they look: a teacher row with no
 * permissions row at all reads as unrestricted downstream, because the SMS gate
 * only closes on an explicit `can_send_sms === false`. bootstrap_center creates
 * the owner's own teacher row that way on purpose — they made the centre — but
 * every teacher added through the form gets a real row.
 *
 * `staff` GATES IT (§6.2), and this is the screen that word was written for.
 * `teacher_permissions` is narrowed by 20260811000063 for the reason its own comment gives:
 * without that, a manager who may not read the fee book could tick `can_view_fees` on a
 * teacher and read it through them. Every control on this page — the boxes, the login
 * buttons, the password reset — is that write. Reads stay open, so the guard is here.
 *
 * ONE COLUMN AND NO RAIL, which is a decision rather than the old default: the roster is
 * the whole screen and the only other thing on it is one button, so the width is spent
 * inside the list instead — see the note on the return, and TeacherList for what it buys.
 */
export default async function TeachersPage() {
  const session = await pageCapability('staff')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.teachers

  /*
   * A one-teacher plan has no staff to manage and normally gets a card saying so
   * rather than a list of one row under a button that would refuse it.
   *
   * "Normally", because the assumption underneath that used to be stated as fact:
   * the only row a one-seat plan has is the reader's own. It is true of a centre
   * that signed up on a teacher tier and false of one that was moved down to it —
   * `setCenterPlan` writes the new plan and only warns when the centre is over its
   * seat count, so six teachers stay switched on under a plan that covers one, and
   * this is the only screen that can switch them off. It refused to draw. So the
   * count is now read before the decision is made, and /settings and /settings/billing
   * both stop hiding the fact under the same condition.
   *
   * Which costs one query on a screen that used to cost none for these plans. A
   * `teachers` table holds one row per teacher at one centre — single digits, and
   * this is a settings page reached from a hub, not a screen anybody sits on.
   */
  const staff = hasStaff(session.plan)

  const supabase = await createClient()

  const [{ data: teachers }, { data: allSubjects }, branches, { data: members }] =
    await Promise.all([
      supabase
        .from('teachers')
        .select(
          `id, name, phone, active, user_id, branch_id,
         teacher_permissions (
           can_manage_students, can_manage_exams, can_send_sms,
           can_view_fees, can_manage_batches
         ),
         teacher_subjects (subjects (id, name, name_bn)),
         batches (id, active)`,
        )
        // Scoped as well as governed by RLS, for the reason the roster gives: an
        // owner of two centres passes is_staff_admin for both, so the policy alone
        // would list the other centre's teachers here — and their permissions, under
        // a switcher that says this centre.
        .eq('coaching_center_id', session.active.centerId)
        .order('name', { ascending: true }),
      // The tick list of what each of them teaches. Switched-off subjects are read
      // too, and not because they are on offer: a link made before a subject was
      // turned off is still real, and a form that left it out would cut it the next
      // time the owner saved a name. Each row draws the live ones plus its own.
      supabase
        .from('subjects')
        .select('id, name, name_bn, active')
        .eq('coaching_center_id', session.active.centerId)
        .order('name', { ascending: true }),
      // Which building each of them is based in, for the head office of an organisation
      // with more than one. `null` for everybody else and no query for them — see
      // branchChoicesFor. This is `teachers.branch_id` and not the membership's: which
      // building's list they appear on and whose salary bill pays them, not what they see.
      branchChoicesFor(supabase, session),
      // And the membership's, which is the other one: what they may reach. Keyed by
      // user rather than by teacher because that is what a membership is about — the
      // same person may hold a teacher row here and another at a second centre.
      supabase
        .from('center_members')
        .select('user_id, branch_id')
        .eq('coaching_center_id', session.active.centerId)
        .eq('role', 'teacher'),
    ])

  /*
   * BOTH READS, AND THIS SCREEN IS THE ONE WHERE THAT IS NOT A JUDGMENT CALL.
   *
   * The subject list, because of what an empty tick list means when it is saved. Every
   * box on a teacher's row is drawn from `subjectOptions`; with none drawn, the row
   * still submits, `saveTeacherDetails` reads no `subjectIds`, and the difference it
   * writes is “remove every subject they teach”. An owner correcting a spelling in a
   * name would unlink the three subjects that name teaches, and the action would be
   * right to do it — the form asked. So the form is not drawn.
   *
   * The teacher list, because of the card below. `activeCount` off an empty list is
   * nought, nought is never over the seats, and the reader is handed “you are the only
   * teacher on this plan, there is nothing to manage” — on the one screen that can
   * switch a colleague off, to the owner the settings hub sent here for exactly that
   * reason. The plan screen says “— / 1” beside their teachers for the same failure;
   * this is where they arrive next.
   */
  if (teachers === null || allSubjects === null) {
    return (
      // Capped on the card and not on the column, so the bar still reaches the workspace
      // edges: one sentence set across 1,216px is the defect §26 names, and a refusal is
      // one sentence.
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.title}
          back={{ href: '/settings', label: d.settings.hub.title }}
        />
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{d.settings.listUnreadable}</p>
        </Card>
      </div>
    )
  }

  const subjectOptions = allSubjects.map((subject) => {
    const label = localName(subject, locale)
    return {
      id: subject.id,
      label: subject.active ? label : t.subjectOff(label),
      off: !subject.active,
    }
  })

  /*
   * Which branch each account may reach, or nothing at all if that read dropped.
   *
   * Nothing at all is the point of the `null`. A missing membership branch drawn as head
   * office is a select that says "the whole organisation" about somebody pinned to
   * Mirpur, and saving the panel for an unrelated reason would then grant it. So a failed
   * read draws no access field, `updateTeacher` sees no `accessBranchId`, and the
   * membership is left exactly as it is.
   */
  const access = members && new Map(members.map((m) => [m.user_id, m.branch_id]))

  /*
   * And what each of them types to sign in, for the teachers whose account was minted
   * against a name rather than a number (§5.2).
   *
   * THE DEFECT THIS FIXES. The username was shown once — in the sentence reporting the
   * account had been made — and never again, so an owner who closed the panel could not
   * tell the teacher what to type a week later. Their only route back was to reset a
   * password for a login they could not name. Migration 38 wrote `profiles.username` for
   * this read and nothing was doing it.
   *
   * A separate round trip and not a fifth slot in the Promise.all above, because it needs
   * the ids that read returns. Single digits of teachers, on a settings page reached from a
   * hub. See usernamesFor for why it goes past RLS and why the id list is the fence — the
   * ids handed to it are the ones just read under this centre's own id.
   */
  const usernames = await usernamesFor(
    // actor-less: a read of one column, and a read writes no audit row to name anybody on
    createAdminClient(),
    teachers.map((teacher) => teacher.user_id),
  )

  const rows: TeacherRow[] = teachers.map((teacher) => {
    // PostgREST returns a to-one embed as an object and a to-many as an array,
    // and which one you get depends on whether it can see the unique constraint.
    // Handling both is cheaper than depending on that.
    const perms = Array.isArray(teacher.teacher_permissions)
      ? teacher.teacher_permissions[0]
      : teacher.teacher_permissions

    const linked = (teacher.teacher_subjects ?? []).map((ts) =>
      Array.isArray(ts.subjects) ? ts.subjects[0] : ts.subjects,
    )

    // The scan line keeps every name unmarked, switched off or not: it answers
    // "who teaches what" at a glance. The marking belongs in the form below,
    // where the owner is deciding rather than reading.
    const subjects = linked.map((subject) => localName(subject, locale)).filter(Boolean)

    const batchCount = (teacher.batches ?? []).filter((b) => b.active).length

    return {
      id: teacher.id,
      name: teacher.name,
      phone: teacher.phone,
      active: teacher.active,
      // No linked account means they cannot sign in yet — worth surfacing,
      // because an owner who added a teacher expects them to be able to log in.
      hasLogin: Boolean(teacher.user_id),
      // And where there is one, what it is called. Null for an account that signs in with
      // a phone number, which is the number already on the row.
      username: teacher.user_id ? (usernames.get(teacher.user_id) ?? null) : null,
      // Compared on user_id rather than on the teacher row, because that is the
      // thing a person is: an owner can hold one teacher record here and another
      // at a second centre. Read by the trimmed list, which will not switch it
      // off, and by the password box, which is not where you change your own.
      isSelf: teacher.user_id === session.userId,
      // Filed as it stands, so the panel below can hand it straight back when there
      // is nothing to choose from. Null is head office and a real answer.
      branchId: teacher.branch_id,
      /*
       * And what they may reach, which is a different column with a different meaning.
       *
       * `undefined` where there is no membership row to pin: no account, or an account
       * switched off — `toggleTeacherActive` deletes the row on purpose, and that is
       * what cuts them off. Also `undefined` if the read did not arrive. The panel draws
       * no field for it and the action leaves the column alone.
       */
      accessBranchId:
        access && teacher.user_id && access.has(teacher.user_id)
          ? (access.get(teacher.user_id) ?? null)
          : undefined,
      subjects,
      subjectIds: linked.map((subject) => subject?.id).filter(Boolean) as string[],
      // A finished sentence rather than the number, because the row is a client
      // component and a plural cannot cross that boundary. See the note on
      // settings.teachers.batches.
      batchLabel: t.batches(batchCount),
      permissions: {
        can_manage_exams: perms?.can_manage_exams ?? PERMISSION_DEFAULTS.can_manage_exams,
        can_send_sms: perms?.can_send_sms ?? PERMISSION_DEFAULTS.can_send_sms,
        can_manage_students:
          perms?.can_manage_students ?? PERMISSION_DEFAULTS.can_manage_students,
        can_manage_batches:
          perms?.can_manage_batches ?? PERMISSION_DEFAULTS.can_manage_batches,
        can_view_fees: perms?.can_view_fees ?? PERMISSION_DEFAULTS.can_view_fees,
      },
    }
  })

  const activeCount = rows.filter((r) => r.active).length
  const limit = session.plan.maxTeachers

  // The ordinary one-seat centre: one teacher, themselves, and nothing to manage.
  // The route stays reachable rather than 404ing, because a bookmark or a stale
  // link should explain itself. `overStaffSeats` is the same test the settings hub
  // uses to decide whether to link here at all, so the two cannot disagree about
  // whether this screen has a job.
  if (!staff && !overStaffSeats(session.plan, activeCount)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.title}
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

  /*
   * Only ever true for a capped multi-teacher tier, and no tier sold today is
   * one: every plan with staff on it has maxTeachers null, and a plan without
   * staff never reaches the add button at all. So this and the x/y counter are
   * both unreachable on today's tiers, and kept rather than deleted because the
   * day a mid tier caps staff at, say, twelve, the screen has to stop offering a
   * thirteenth. plans.test.ts holds the other half of that bargain — a tier
   * claiming staff must have room for a second teacher, or this page would refuse
   * the first colleague.
   */
  const atLimit = wouldExceed(session.plan, 'maxTeachers', activeCount)

  /*
   * And the question `atLimit` is not: the seat is not a wall the tier runs into, it is a
   * price it pays — so past the two a centre includes, a balance with nothing on it is
   * what stops the next colleague (`teacherSeatOpeningRefusal`, and `CD005` underneath it
   * in 20260811000097).
   *
   * NO EXTRA QUERY: `activeCount` is off the rows this screen has already read, and the
   * balance is on the session the last settlement wrote. The form the button leads to is
   * not refused — the action behind it gives the same sentence — but a button that can
   * only be refused is worse than no button, which is the branches screen's judgement and
   * this one's.
   */
  const seatRefusal = teacherSeatOpeningRefusal(session.plan, {
    activeTeachers: activeCount,
    balancePoisha: session.billing.balancePoisha,
  })

  return (
    /*
     * ONE COLUMN, DELIBERATELY, AND THE WIDTH SPENT INSIDE THE LIST.
     *
     * The roster is the screen; the only other thing on it is one button. A rail holding
     * that button and nothing else is §20.7's "two columns of white space around one
     * column of content", so the twelve columns go to the list instead — where a row
     * spends them on three aligned columns and an opened panel on three forms side by
     * side rather than a stack taller than the screen.
     */
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/settings', label: d.settings.hub.title }}
        subtitle={limit === null ? t.count(activeCount) : t.used(activeCount, limit)}
        /* The one thing to do here, in the bar rather than under the last row: on a centre
           with nine teachers it was below all nine, and adding somebody is the reason most
           visits happen. Nothing at all on a plan with no staff features — the card below
           already says the way out is down, not up. */
        actions={
          staff &&
          !atLimit &&
          seatRefusal === null && (
            <Link
              href="/settings/teachers/new"
              className="flex min-h-tap items-center justify-center rounded-xl border-2
                border-dashed border-brand-300 bg-brand-50/50 px-5 font-medium
                text-brand-700 hover:bg-brand-50"
            >
              <span aria-hidden>+&nbsp;</span>
              {t.new}
            </Link>
          )
        }
      />

      {/* Why this list is here at all, above the list rather than under it: on a
          plan with no staff features the only reason to draw one is to get back
          down to one teacher, and an owner who reads the names first will wonder
          which of them the app is asking about. */}
      {!staff && (
        <Card className="max-w-3xl">
          <h2 className="font-semibold text-ink">{t.trimTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.trimBody(
              planName(session.plan, locale),
              activeCount,
              // Non-null on every plan without staff: an uncapped seat count is
              // what hasStaff means. Guarded anyway rather than asserted.
              limit ?? activeCount,
            )}
          </p>
        </Card>
      )}

      {/* Where the add button would have been, for a capped multi-teacher tier that has
          filled its seats. Above the list for the reason the button is: it answers the
          question the reader came with. */}
      {staff && atLimit && (
        <Card className="max-w-3xl">
          {/* The same refusal the add form gives, in the same words. */}
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* limit is non-null here: wouldExceed is false on an uncapped plan. */}
            {t.cap(
              planName(session.plan, locale),
              limit ?? 0,
              planName(PLANS.center, locale),
            )}
          </p>
        </Card>
      )}

      {staff && seatRefusal === 'needs_money' && (
        <Card className="max-w-3xl">
          {/* The heading and the way out are the list's; the sentence is the add form's
              own refusal, in its own words, so a refusal and a card cannot disagree. */}
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
      )}

      {rows.length === 0 ? (
        <Card className="max-w-3xl">
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
        </Card>
      ) : (
        <TeacherList
          teachers={rows}
          subjects={subjectOptions}
          t={d.teacherList}
          permissions={d.teacherPermissions}
          common={d.common}
          branchPick={d.branchPick}
          branchAccess={d.branchAccess}
          branches={branches}
          trim={!staff}
        />
      )}
    </div>
  )
}
