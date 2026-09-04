import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { pagePermission, canManageStudents, isStaffAdmin, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { dayNameShort } from '@/lib/bd/time'
import { formatTaka } from '@/lib/money'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { capIsQuota } from '@/lib/plans'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.batches.title} — CoachDesk` }
}

/**
 * The timetable: every batch the centre runs, in the order the day runs them.
 *
 * A CAPPED COLUMN, AND TWO OF THEM AT 1,216px (§20.8.11). A batch row is a name, a
 * subject, a time, the days, a teacher and a price — a 1,216px row puts the price a
 * screen away from the name it belongs to, and stretching one to fit was the whole
 * complaint. Rows stay the width they are legible at, and where there is room for two
 * such columns the list becomes two: a centre with forty batches scrolls half as far.
 * Not sooner than `2xl` — at 960px two columns are 468px each, and "Sat, Mon, Wed ·
 * Rahim Uddin" wraps in that, which turns every row into five lines to save a scroll.
 */
export default async function BatchesPage() {
  const session = await pagePermission('can_manage_batches')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.batches

  /**
   * Whether the headcount beside each batch can be believed.
   *
   * `can_manage_batches` grants opening a batch and nothing on the roster, so a
   * teacher holding only that box reads `enrollments` through app.teaches_batch —
   * their own classes and no others. The embed below therefore comes back empty for
   * everyone else's batches and the column would read "0 জন" down the page, which is
   * the exact failure the note on myTeacherIds describes: a screen showing every
   * batch in the centre with nobody in it, and a reader with no way to tell that
   * from a centre that has lost its students.
   *
   * So the count is drawn when it is a count and left out when it would be a guess.
   * The other checkbox is the one that buys it.
   */
  const showCounts = await canManageStudents()

  // Whether a row is a link. A teacher holding `can_manage_batches` may open a batch
  // and may not change one — 20260811000019 grants that box INSERT and no UPDATE. An
  // unclickable row is the honest rendering of that; a link to a screen that refuses
  // them is not.
  const mayEdit = isStaffAdmin(session)

  const { data: batches } = await supabase
    .from('batches')
    .select(
      `id, name, slot, start_time, end_time, monthly_fee_bdt, active,
       subjects (name, name_bn), teachers (name),
       batch_schedules (day_of_week), enrollments (id, status)`,
    )
    .eq('coaching_center_id', session.active.centerId)
    .order('start_time', { ascending: true, nullsFirst: false })

  /*
   * The timetable, and an unread one used to draw the centre as a new one: “you have no
   * batches yet” under a line reading “0 of 5 used”. Every screen in the product hangs
   * off these rows — the register, the invoice run, the old-dues form — so an owner who
   * believes that sentence is an owner about to build their timetable again on top of
   * the one that is still there.
   */
  if (batches === null) {
    return (
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

  const rows = batches.map((batch) => {
    const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects
    const teacher = Array.isArray(batch.teachers) ? batch.teachers[0] : batch.teachers
    const days = (batch.batch_schedules ?? [])
      .map((s) => s.day_of_week)
      .sort((a, b) => a - b)
    return {
      id: batch.id,
      name: batch.name,
      slot: batch.slot,
      startTime: batch.start_time,
      endTime: batch.end_time,
      fee: batch.monthly_fee_bdt,
      // Whether this batch charges anything at all. `numeric` arrives as a string, so
      // the comparison goes through Number, and anything that is not a positive
      // amount — 0, null, a value that did not survive the wire — bills nobody. Same
      // test as lib/fees/billable.ts makes when it decides what to invoice.
      unpriced: !(Number(batch.monthly_fee_bdt ?? 0) > 0),
      active: batch.active,
      subjectName: localName(subject, locale),
      teacherName: teacher?.name ?? '',
      days,
      studentCount: (batch.enrollments ?? []).filter((e) => e.status === 'active')
        .length,
    }
  })

  const activeCount = rows.filter((r) => r.active).length
  // Null on the centre tiers even though they now cap batches at a hundred: that
  // ceiling is a guardrail, not a quota, and "4 of 100 batches" invites an owner to
  // manage a number nobody sold them. The cap still refuses the hundred-and-first,
  // and /settings/batches/new is where it says so. See capIsQuota.
  const limit = capIsQuota(session.plan, 'maxBatches') ? session.plan.maxBatches : null

  return (
    /* The cap is on the list and not the page, so the bar still reaches the workspace
       edges while the rows stay the width they are legible at. It lifts at `2xl`, which is
       where the list becomes two columns. */
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/settings', label: d.settings.hub.title }}
        /* The count, and the hint in the same line rather than a third one under it —
           only where tapping a row does something. A promise the rows do not keep is
           worse than no promise. */
        subtitle={
          <>
            {limit === null ? t.count(activeCount) : t.used(activeCount, limit)}
            {mayEdit && rows.length > 0 && (
              <span className="text-ink-faint"> · {t.editHint}</span>
            )}
          </>
        }
        actions={
          <Link
            href="/settings/batches/new"
            className="inline-flex min-h-tap items-center justify-center rounded-xl
              bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700"
          >
            {t.new}
          </Link>
        }
      />

      {rows.length === 0 ? (
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
        </Card>
      ) : (
        <ul
          className="flex max-w-2xl flex-col gap-2 2xl:grid 2xl:max-w-none
            2xl:grid-cols-2 2xl:gap-3"
        >
          {rows.map((row) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{row.name}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {[
                        row.subjectName,
                        <BatchSlot
                          key="slot"
                          slot={row.slot}
                          start={row.startTime}
                          end={row.endTime}
                          locale={locale}
                        />,
                      ]
                        .filter(Boolean)
                        .map((part, i) => (
                          <span key={i}>
                            {i > 0 && ' · '}
                            {part}
                          </span>
                        ))}
                    </p>
                    <p className="text-sm text-ink-faint">
                      {/* Short day names: five spelled-out ones run past the width of
                          a phone and truncate mid-week. */}
                      {row.days.length > 0
                        ? row.days.map((day) => dayNameShort(day, locale)).join(', ')
                        : t.everyDay}
                      {row.teacherName && ` · ${row.teacherName}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {/* A price, or the fact that there is none. "৳0 / per month" is
                        arithmetic nobody performs while scrolling — it takes reading
                        the figure, remembering that the invoice run skips zeros, and
                        connecting the two. The words do it for them, and an owner who
                        priced a batch at nothing on purpose loses nothing by seeing
                        their own decision written down. Amber, not red: a free batch
                        is a normal thing to run. */}
                    {row.unpriced ? (
                      <p className="text-sm font-semibold text-late">{t.noFee}</p>
                    ) : (
                      <>
                        <p className="num text-sm font-semibold text-ink">
                          {formatTaka(row.fee)}
                        </p>
                        <p className="text-xs text-ink-faint">{t.monthly}</p>
                      </>
                    )}
                    {showCounts && (
                      <p className="mt-1 text-sm text-ink-soft">
                        <span className="num">{row.studentCount}</span>{' '}
                        {t.people(row.studentCount)}
                      </p>
                    )}
                  </div>
                </div>
                {!row.active && (
                  <p className="mt-2 text-sm text-ink-faint">{t.inactive}</p>
                )}
              </>
            )

            return (
              <li key={row.id}>
                {mayEdit ? (
                  // The whole row, not a pencil in the corner: the thing an owner
                  // comes here to change is usually the number they are already
                  // looking at, and on the phone this is held in one hand.
                  // `h-full` only where there are two columns, so the pair in a row
                  // are the same height and the border does not step mid-list.
                  <Link
                    href={`/settings/batches/${row.id}`}
                    className="block rounded-xl border border-line bg-white px-4 py-3
                      hover:border-brand-300 active:bg-brand-50 2xl:h-full"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="rounded-xl border border-line bg-white px-4 py-3 2xl:h-full">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
