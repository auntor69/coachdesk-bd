import Link from 'next/link'

import { Card } from '@/components/ui'
import { SearchBox, SearchEmpty } from '@/components/search-box'
import { pagePermission, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile } from '@/lib/bd/phone'
import { MAX_IMPORT_ROWS } from '@/lib/bd/roster'
import { searchTerms, matchesSearch, MAX_QUERY } from '@/lib/search'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.students.title} — CoachDesk` }
}

/**
 * The roster.
 *
 * Shows the guardian's number on every row on purpose: it is the field most
 * likely to be wrong, and an owner scanning the list is the only realistic way
 * a wrong one gets caught before a parent complains.
 *
 * Which is also why the guard is `can_manage_students` and not a rank. This screen
 * is every minor's record and every parent's mobile number at the centre, so it is
 * open to owners and managers and to exactly the teachers an owner ticked a box for
 * — a box that until 20260811000019 granted nothing at all.
 *
 * AND IT IS SEARCHABLE, which matters more here than anywhere else in the product:
 * this is the only roster, so it is the only way anybody reaches a student's page,
 * and at three hundred names "the only way" was a scroll. The box filters the list
 * and leaves the headcount, the plan limit and the two warnings above it alone —
 * those are facts about the centre, and a roster filtered to one family must not
 * report that the centre has one student in it or that one number is missing.
 *
 * THE TWO WARNINGS ARE THE POINT OF THE SCREEN as much as the list is. A missing
 * guardian's number and a missing batch are the only two ways a student can look
 * admitted and produce nothing, and neither shows up anywhere else: no SMS is sent,
 * no bill is raised, and the first symptom in both cases arrives weeks later as a
 * parent who heard nothing or a fee board that reads ৳0. Counted at the top so the
 * owner knows scrolling is worth it, and labelled on the row so they can find them.
 */
export default async function StudentsPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ q?: string }>
}) {
  const session = await pagePermission('can_manage_students')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.students

  const { q: rawQuery } = await searchParams
  const query = (rawQuery ?? '').slice(0, MAX_QUERY)
  const terms = searchTerms(query)

  const { data: students } = await supabase
    .from('students')
    .select(
      `id, name, student_code, guardian_phone, class_level, institution,
       status, sms_opt_out, enrollments (id, status, batches (name))`,
    )
    // Scoped as well as governed by RLS: an owner of two centres passes
    // is_staff_admin for both, so the policy alone would mix two rosters.
    .eq('coaching_center_id', session.active.centerId)
    .order('name', { ascending: true })

  const rows = (students ?? []).map((student) => ({
    id: student.id,
    name: student.name,
    code: student.student_code,
    guardianPhone: student.guardian_phone,
    classLevel: student.class_level,
    institution: student.institution,
    active: student.status === 'active',
    smsOptOut: student.sms_opt_out,
    batchNames: (student.enrollments ?? [])
      .filter((e) => e.status === 'active')
      .map((e) => {
        const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches
        return batch?.name ?? ''
      })
      .filter(Boolean),
  }))

  const activeCount = rows.filter((r) => r.active).length
  const limit = session.plan.maxStudents
  const missingPhone = rows.filter((r) => r.active && !r.guardianPhone).length

  // The counterpart, and the one the product depends on. A student with no active
  // enrolment is inert: the invoice generator bills enrolments, the attendance sheet
  // lists a batch, the old-dues screen hangs each debt on one. So a name here with no
  // batch is on the roster and in nothing else, and nothing anywhere said so — the
  // symptom was a fee board that stayed at ৳0. Every path produces them, not just the
  // paste: the one-at-a-time form ticks no batch by default either, and a batch closed
  // in March leaves its whole class like this in April.
  //
  // Active only. Somebody who has left has no batch because they left, and labelling
  // every leaver would bury the ones that matter.
  const noBatch = rows.filter((r) => r.active && r.batchNames.length === 0).length

  // The same three fields the box promises and the fee board searches — a name, the
  // code on the slip, the number that rang them. Deliberately not the batch or the
  // class: one matcher over one set of fields is what lets an owner learn the box
  // once. See lib/search.ts.
  const shown = terms.length === 0
    ? rows
    : rows.filter((r) => matchesSearch([r.name, r.code, r.guardianPhone], terms))

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">{t.title}</h1>
            <p className="mt-1 text-ink-soft">
              {limit === null ? t.count(activeCount) : t.used(activeCount, limit)}
            </p>
            {/* Every reader who gets this far can open a student, so the hint is
                unconditional now — it was gated on `mayEdit` when the row was an
                edit link and a teacher's row did nothing when tapped. */}
            {rows.length > 0 && <p className="text-sm text-ink-faint">{t.openHint}</p>}
          </div>
          <Link
            href="/settings/students/new"
            className="inline-flex min-h-tap shrink-0 items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.new}
          </Link>
        </div>
      </div>

      {/*
        The way a centre actually gets its students in: somebody sits down with
        the register and pastes it. Kept in front of the owner rather than hidden
        behind the one-at-a-time form, because 200 students typed one by one is
        an evening nobody spends.
      */}
      <Link
        href="/settings/students/import"
        className="flex min-h-tap items-center justify-between gap-3 rounded-xl
          border-2 border-dashed border-line bg-white px-4 py-3
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

      {missingPhone > 0 && (
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.missingPhone(missingPhone)}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.missingPhoneBody}</p>
        </Card>
      )}

      {/* Amber, like the missing number, and for the same reason: neither is an error
          — a name can legitimately sit on the roster for a day before it is sorted —
          but both stop the product working for that student until somebody acts. */}
      {noBatch > 0 && (
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.noBatch(noBatch)}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.noBatchBody}</p>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
        </Card>
      ) : (
        <>
          {/* Below the import card and the missing-number warning, directly above
              the list. Both of those are about the roster as a whole and stay put
              while the list narrows. */}
          <SearchBox
            q={query}
            t={d.search}
            count={{ shown: shown.length, total: rows.length }}
          />

          {shown.length === 0 ? (
            /* Not `t.emptyTitle` — "no students yet" under a filtered roster would
               read as a lost database rather than a mistyped name. */
            <SearchEmpty t={d.search} />
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((row) => {
                const body = (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {row.name}
                        {!row.active && (
                          <span className="ml-2 text-sm text-ink-faint">{t.inactive}</span>
                        )}
                      </p>
                      {row.batchNames.length > 0 ? (
                        <p className="truncate text-sm text-ink-soft">
                          {row.batchNames.join(' · ')}
                        </p>
                      ) : (
                        // The count above says how many; this says which. Without it
                        // the owner reads "12 in no batch" and then scrolls three
                        // hundred names looking for a line that is not there, because
                        // a student in no batch used to render nothing at all here.
                        //
                        // Amber rather than the red the missing number gets, so a row
                        // carrying both problems still reads as two.
                        row.active && (
                          <p className="truncate text-sm font-medium text-late">
                            {t.noBatchRow}
                          </p>
                        )
                      )}
                      <p className="truncate text-sm text-ink-faint">
                        {[row.classLevel, row.institution].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num text-sm text-ink-soft">
                        {row.guardianPhone ? (
                          formatBdMobile(row.guardianPhone)
                        ) : (
                          <span className="font-medium text-absent">{t.noPhone}</span>
                        )}
                      </p>
                      {row.smsOptOut && (
                        <p className="text-xs text-ink-faint">{t.smsOff}</p>
                      )}
                      {row.code && (
                        <p className="num text-xs text-ink-faint">{row.code}</p>
                      )}
                    </div>
                  </div>
                )

                return (
                  <li key={row.id}>
                    {/*
                      The whole row, and it opens the student rather than the edit form.
                      This is the only roster in the app, so it is the only way anybody
                      reaches a student — a row that went straight to a form left the
                      student's own page reachable from nowhere but the at-risk list,
                      which is to say invisible to every centre whose students are fine.

                      Editing is one tap further, on a button at the top of that page,
                      and the tap is cheaper than it looks: the field most likely to be
                      wrong is the guardian's number, which is printed on this row, so an
                      owner checking the roster never taps in until they have found the
                      one to fix.

                      Clickable for every reader who gets this far, including a permitted
                      teacher whose rows used to do nothing — they may not edit a student
                      and there was never a reason they could not read one.
                    */}
                    <Link
                      href={`/students/${row.id}`}
                      className="block rounded-xl border border-line bg-white px-4 py-3
                        hover:border-brand-300 active:bg-brand-50"
                    >
                      {body}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
