import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { EyeIcon, PencilIcon } from '@/components/icons'
import { SearchBox, SearchEmpty } from '@/components/search-box'
import { PlacesWarning } from '@/components/places-warning'
import { Th, Td } from '@/components/table'
import { pagePermission, getSession, isStaffAdmin } from '@/lib/auth/session'
import { isHqMember } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { pageAll } from '@/lib/supabase/page'
import { formatBdMobile } from '@/lib/bd/phone'
import { MAX_IMPORT_ROWS } from '@/lib/bd/roster'
import { capacityPressure } from '@/lib/plans'
import { centerStudentCount } from '@/lib/students/headcount'
import { searchTerms, matchesSearch, MAX_QUERY } from '@/lib/search'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.students.title} — CoachDesk` }
}

/**
 * The way into one student, drawn instead of left for the reader to discover.
 *
 * Quiet on purpose: neutral border, no fill, `font-medium`. Three hundred rows of a
 * brand-coloured button is a screen nobody can read, and the one thing on a roster row
 * that should draw the eye is a child's name.
 *
 * `whitespace-nowrap` because the Bangla labels are longer than the English ones — a
 * button that wraps in one language is a row that is a different height in one language.
 */
const ROW_BUTTON =
  'inline-flex min-h-tap shrink-0 items-center justify-center whitespace-nowrap gap-1.5 ' +
  'rounded-xl border-2 border-line bg-white px-3 font-medium text-ink hover:border-brand-300'

/**
 * The same button on the wide sheet, square, holding a shape instead of a word.
 *
 * WHY THE SHEET DRAWS ICONS WHERE THE CARDS DRAW WORDS. The sheet used to carry one
 * button where the card carries two, on the reasoning that the name in the first cell is
 * visibly a link and so already is the other one. That was wrong, and an owner said so:
 * reading a record and rewriting one are two errands, and leaving the reader to work out
 * that a coloured name is the second of them is the same "I found it by being an
 * engineer" problem the buttons were added to fix. Two *worded* buttons would want about
 * 150px of a 640px sheet, which is width off a child's name; two squares want 80px, so
 * both errands fit and every other column keeps its share.
 *
 * The word is not dropped, it is moved: `aria-label` says it to a screen reader and
 * `title` says it on hover — and the sheet only draws from `xl`, where there is a pointer
 * to hover with. Below that the cards draw the same pair with the words still on them,
 * because that is where the report came from and where a thumb is doing the work.
 *
 * 36px square rather than `min-h-tap`'s 3rem: 48 would add 24px to every row of a sheet
 * whose whole reason for existing is that §20.7 wants forty of them on a screen rather
 * than eight, and 36 still clears the floor a pointer needs.
 */
const SHEET_ICON =
  'inline-flex size-9 shrink-0 items-center justify-center ' +
  'rounded-xl border-2 border-line bg-white text-ink hover:border-brand-300'

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
 *
 * AND EACH WARNING IS A DOOR. "12 students are in no batch" over three hundred names
 * is a fact nobody can act on — the twelve are somewhere in the scroll, and finding
 * them is the entire cost of fixing them, which is why they stay unfixed. Tapping the
 * card filters the list to exactly the students it counted. The count itself does not
 * move: the card goes on reporting the centre while the list below it reports the
 * twelve.
 *
 * TWO LAYOUTS OUT OF ONE DOM, as on the dashboard, the plan screen and the add-student
 * form: `order-N` on every block, two wrappers that are `display: contents` below `lg`.
 * On a phone this is the column it has always been, in the order it has always been in.
 * From `lg` the roster takes eight columns and everything that is not the roster — the
 * places warning, the paste door, the two problem cards — moves into a four-column rail
 * beside it, because five full-width blocks stacked above a list on a laptop is a screen
 * whose first three hundred pixels contain no students.
 *
 * AND FROM `xl` THE LIST BECOMES A REAL TABLE. §20.7: a manager reconciling a month
 * wants forty rows visible, not eight, and the same five facts in a card are two
 * inches taller than they are in a row. Below `xl` it stays cards — the table wants
 * about 700px to keep a Bangla name off the ellipsis, and a table narrower than its
 * columns is a horizontal scroll on the device most of this product is read on. Both
 * shapes are drawn from the same `shown` rows and carry the same five facts; the test
 * file holds them to that, because two renderings of one row is the kind of thing that
 * drifts.
 */
export default async function StudentsPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ q?: string; show?: string }>
}) {
  const session = await pagePermission('can_manage_students')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.students

  const { q: rawQuery, show: rawShow } = await searchParams
  const query = (rawQuery ?? '').slice(0, MAX_QUERY)
  const terms = searchTerms(query)

  // Paged, and this is the read where a silent cut does the most damage. The two
  // warning cards below are built out of these rows and so is the list they open, so
  // a roster that stopped at a thousand names would report a centre of 1,240 as a
  // centre of 1,000 — with the students past the cut absent from the count, absent
  // from the list, absent from the "in no batch" door that exists to find them, and
  // no way at all to reach their row. Nothing on the screen would look wrong.
  //
  // `.range()` counts the top-level rows, so the embedded enrolments come back whole
  // for each student in the page. `.order('id')` last, after the name, because two
  // students named the same have no order otherwise and the offset walk would be
  // free to hand back one of them twice and never the other.
  const [students, pooledStudents] = await Promise.all([
    pageAll((from, to) =>
      supabase
        .from('students')
        .select(
          `id, name, student_code, guardian_phone, class_level, institution,
           status, sms_opt_out, enrollments (id, status, batches (name))`,
        )
        // Scoped as well as governed by RLS: an owner of two centres passes
        // is_staff_admin for both, so the policy alone would mix two rosters.
        .eq('coaching_center_id', session.active.centerId)
        .order('name', { ascending: true })
        .order('id')
        .range(from, to),
    ),
    /*
     * The ORGANISATION's headcount, which the rows above cannot give: they are this
     * reader's branch (students_branch_scope) and the ceiling they get compared against
     * pools across the institution (§3.6). 20260811000076 exists for that gap. One
     * integer, no rows, and refused with 42501 to anybody who is not a staff admin or a
     * teacher with can_manage_students — which is everybody who reaches this screen.
     *
     * Beside the roster read rather than after it: this screen already walks every page
     * of a 1,200-name register, and a second round trip after that walk is a warning
     * card that arrives late on the slowest screen in the product.
     */
    centerStudentCount(supabase, session.active.centerId),
  ])

  /*
   * And a read that did not arrive is not a centre with nobody in it, which is the
   * only other thing an empty roster could mean here. The `?? []` this replaces made
   * them the same screen: a headcount of nought, the plan reading 0 of 150, both
   * warning cards gone because each is gated on a count, and "no students yet — add
   * your first one" printed over a centre of three hundred whose names are all still
   * in the table.
   *
   * Every claim on this screen is built from these rows, so there is nothing to draw
   * around the gap and no partial version worth showing. The way back to the rest of
   * settings stays, and the two doors that do not need the roster — add a student, the
   * paste screen — are one tap away through it.
   */
  if (!('rows' in students)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.title}
          back={{ href: '/settings', label: d.settings.hub.title }}
        />
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">
            {students.failed === 'tooLarge' ? t.tooLarge : t.unreadable}
          </p>
        </Card>
      </div>
    )
  }

  const rows = students.rows.map((student) => ({
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

  /*
   * WHOSE CEILING THIS IS, and it is never one branch's. A place is a licence and
   * licences pool across the organisation (§3.6), so `session.ceiling` is one figure for
   * the whole institution — while `activeCount` above is counted out of `rows`, and
   * `students_branch_scope` narrowed those to the reader's own building.
   *
   * It used to read `session.plan.maxStudents` and show a bare count on the centre
   * tiers, where that column is null. Unlike batches and subjects, where a cap is a
   * guardrail we set and `capIsQuota` hides it, a centre's student ceiling is the thing
   * the centre is paying for: the number belongs to them and this is the screen it
   * belongs on. What it does not belong to is one branch, hence the fork below.
   */
  const limit = session.ceiling.ceiling
  const pooled = isHqMember(session.active)

  /*
   * And §3.7's warning, which this screen is named for: the roster is where somebody sits
   * down to add the names, so it is the one place where "nearly full" arrives before the
   * refusal rather than after it.
   *
   * Fed the ORGANISATION's headcount through 20260811000076, not `activeCount`. The old
   * comment here claimed the count was the whole centre "because the read above is
   * centre-scoped and carries no branch filter" — true when it was written and untrue
   * since 20260811000053, whose RESTRICTIVE policy narrows that read whatever it asks
   * for. A manager pinned to Mirpur with 40 of the organisation's 300 students was shown
   * 260 free places on the screen built to warn them, and `app.guard_student_capacity()`
   * refused the 41st.
   *
   * Null is no warning, which is the same fail-open the add-student form takes: the
   * database still refuses at the real ceiling, and "no places left" off a read nobody
   * has would turn a family away over a number we could not fetch.
   *
   * Staff admins only, and the reason is the door rather than the news: the warning ends
   * in a link to /settings/plan, which is `pageRole('manager')`, so a teacher who got here
   * on `can_manage_students` would be sent to a refusal. Their version of this warning is
   * the student form saying no, which it already does.
   */
  const pressure =
    pooledStudents === null ? null : capacityPressure(session.ceiling, pooledStudents)
  const warnPlaces = isStaffAdmin(session)

  /**
   * Whether to draw the Edit button on a row.
   *
   * The same set as the `pageRole('manager')` on the edit screen itself, which is
   * stricter than the `can_manage_students` that opens this one: 20260811000019 gives
   * that box SELECT and INSERT and deliberately no UPDATE, so a permitted teacher may
   * read a student and admit one and not rewrite a guardian's number. Their row still
   * gets View — the record is theirs to read — and no button to a screen that would
   * refuse them.
   */
  const mayEdit = isStaffAdmin(session)

  // The two problem sets, kept as lists rather than counts, because each one is now
  // both a number on a card and the list that card opens. Two predicates written twice
  // would eventually disagree, and the way that failure shows up is a card promising
  // twelve students and a filtered list holding eleven.
  const noPhoneRows = rows.filter((r) => r.active && !r.guardianPhone)

  // The counterpart, and the one the product depends on. A student with no active
  // enrolment is inert: the invoice generator bills enrolments, the attendance sheet
  // lists a batch, the old-dues screen hangs each debt on one. So a name here with no
  // batch is on the roster and in nothing else, and nothing anywhere said so — the
  // symptom was a fee board that stayed at ৳0. Every path produces them, not just the
  // paste: the one-at-a-time form ticks no batch by default either, and a batch closed
  // in March leaves its whole class like this in April.
  //
  // Active only, both of them. Somebody who has left has no batch because they left,
  // and labelling every leaver would bury the ones that matter.
  const noBatchRows = rows.filter((r) => r.active && r.batchNames.length === 0)

  const missingPhone = noPhoneRows.length
  const noBatch = noBatchRows.length

  /*
   * And the third filter, which is not a problem and so is not a warning: how many
   * names on this roster belong to somebody who has left.
   *
   * A leaver stays on the roster on purpose — their attendance, their marks and their
   * bills are all still theirs, and a centre that re-admits a student in July needs to
   * find the record rather than type a second one. But by a centre's third year half
   * the list is people who are not coming, and there was no way at all to put them
   * aside: the count in the heading says 280 of 312 while the list under it is all 312,
   * and the reader has to read the status tag on every row to tell which is which.
   */
  const leftCount = rows.length - activeCount

  /**
   * Which filter the reader chose, if any.
   *
   * Only honoured while the thing it names is actually on the screen, and the `> 0` is
   * what does it. Each control is the only door into its own filter, so a `show` for a
   * problem the centre does not have is a stale bookmark from an afternoon when it did
   * — and the honest answer to that is the full roster with no control above it, rather
   * than an empty list explaining nothing. It also means an unknown value in the URL
   * cannot empty the screen.
   */
  const show =
    rawShow === 'no-phone' && missingPhone > 0
      ? 'no-phone'
      : rawShow === 'no-batch' && noBatch > 0
        ? 'no-batch'
        : rawShow === 'current' && leftCount > 0
          ? 'current'
          : null

  const kept =
    show === 'no-phone'
      ? noPhoneRows
      : show === 'no-batch'
        ? noBatchRows
        : show === 'current'
          ? rows.filter((r) => r.active)
          : rows

  // The same three fields the box promises and the fee board searches — a name, the
  // code on the slip, the number that rang them. Deliberately not the batch or the
  // class: one matcher over one set of fields is what lets an owner learn the box
  // once. See lib/search.ts.
  //
  // Applied on top of the warning filter rather than instead of it, so a search
  // inside "in no batch" stays inside it.
  const shown = terms.length === 0
    ? kept
    : kept.filter((r) => matchesSearch([r.name, r.code, r.guardianPhone], terms))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/settings', label: d.settings.hub.title }}
        /* The ceiling they are paying for, and nothing else. There used to be a line
           here telling the reader to tap a student, because tapping a student was the
           only way in and nothing on the row said so. Every row now carries the button
           instead, which is the honest fix: an instruction that teaches an invisible
           control is a control that should have been drawn.

           The ceiling comes off for a pinned manager, because `activeCount` is their
           branch's and the ceiling is the organisation's — §9.1 forbids two figures of
           different scope side by side without saying so, and here there is no room to
           say it, so the pair is broken instead. Their pooled figure is in the warning
           in the rail. */
        subtitle={pooled ? t.used(activeCount, limit) : t.usedHere(activeCount)}
        actions={
          <Link
            href="/settings/students/new"
            className="inline-flex min-h-tap items-center justify-center rounded-xl
              bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700"
          >
            {t.new}
          </Link>
        }
      />

      {/* The grid is nested under the bar rather than holding it as a twelfth-column
          cell: a sticky box only travels inside its containing block, and a grid cell's
          block is one grid row. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        {/*
          THE RAIL, and it is written before the roster on purpose.
          `contents` below `lg` puts these four straight into the page column, where
          `order-N` decides what the reader sees first — but `order` moves nothing for a
          keyboard or a screen reader, which follow the DOM. Written after the list, a
          phone would tab through three hundred student links before reaching "Show
          these". So the DOM order here is the phone's reading order, 2 to 6, and the two
          wrappers swap themselves into columns from `lg` with `lg:order`.
        */}
        <div className="contents lg:order-3 lg:col-span-4 lg:flex lg:flex-col lg:gap-5">
          {/* Above the paste door on purpose: 200 names against 40 places is the import
              that stops half way, and this is the sentence that gets read first. Null
              while there is room, and a null child costs no gap. The pool note for a
              pinned reader, whose branch roster is 40 names next to a figure about 300
              — the same qualifier the dashboard's places line carries. */}
          {warnPlaces && pressure && (
            <PlacesWarning
              className="order-2"
              pressure={pressure}
              t={d.dashboard}
              note={pooled ? undefined : d.hq.poolNote}
            />
          )}

          {/*
            The way a centre actually gets its students in: somebody sits down with
            the register and pastes it. Kept in front of the owner rather than hidden
            behind the one-at-a-time form, because 200 students typed one by one is
            an evening nobody spends.
          */}
          <Link
            href="/settings/students/import"
            className="order-3 flex min-h-tap items-center justify-between gap-3
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

          {missingPhone > 0 && (
            <Card className="order-4 border-late/30 bg-late/5">
              <p className="font-medium text-ink">{t.missingPhone(missingPhone)}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.missingPhoneBody}</p>
              <WarningFilter
                value="no-phone"
                active={show === 'no-phone'}
                q={query}
                showThese={t.showThese}
                clear={d.search.clear}
              />
            </Card>
          )}

          {/* Amber, like the missing number, and for the same reason: neither is an error
              — a name can legitimately sit on the roster for a day before it is sorted —
              but both stop the product working for that student until somebody acts. */}
          {noBatch > 0 && (
            <Card className="order-5 border-late/30 bg-late/5">
              <p className="font-medium text-ink">{t.noBatch(noBatch)}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.noBatchBody}</p>
              <WarningFilter
                value="no-batch"
                active={show === 'no-batch'}
                q={query}
                showThese={t.showThese}
                clear={d.search.clear}
              />
            </Card>
          )}
        </div>

        {/* THE ROSTER ITSELF, eight columns of it from `lg`. One ordered block rather
            than three, because the box, the scope control and the list are one thing:
            each of the first two narrows what the third shows, and a full flex gap
            between them on a phone would read as three unrelated cards. No `contents`
            wrapper either — there is one block in this column, so the block is the
            column. */}
        <div className="order-6 flex flex-col gap-3 lg:order-2 lg:col-span-8">
          {rows.length === 0 ? (
            <Card>
              <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
              <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
            </Card>
          ) : (
            <>
              <SearchBox
                q={query}
                t={d.search}
                keep={{ show }}
                narrowed={show !== null}
                count={{ shown: shown.length, total: rows.length }}
              />

              {/* Only while there is somebody to put aside, and only while neither
                  problem filter is on — both of those are active-only already, so
                  "current students" on top of one would narrow nothing, and tapping it
                  would quietly drop the filter the reader is actually looking at. */}
              {leftCount > 0 && (show === null || show === 'current') && (
                <ScopeFilter
                  active={show === 'current'}
                  q={query}
                  showCurrent={t.showCurrent}
                  clear={d.search.clear}
                />
              )}

              {shown.length === 0 ? (
                /* Not `t.emptyTitle` — "no students yet" under a filtered roster would
                   read as a lost database rather than a mistyped name. */
                <SearchEmpty t={d.search} />
              ) : (
                <>
                  {/*
                    A REAL TABLE FROM `xl`, AND NO EARLIER. §20.7 wants forty rows on a
                    screen, and five columns need about 700px before a Bangla name starts
                    meeting the ellipsis: the 8-of-12 column has 640px at `xl` and only
                    469px at `lg`, so a table drawn at `lg` would ship a sideways scrollbar
                    to every laptop. `table-fixed` with the widths named here rather than
                    left to the browser, so one long school name cannot re-shape the sheet.

                    The sixth column is the two buttons, and the 15% it costs came out of
                    the name, the batches and the class — the three whose headings have the
                    most slack over their share, and whose contents truncate either way.
                    The guardian's number keeps its 19% because 'Guardian’s number' is the
                    longest heading on the sheet and a thead that wraps is a column that
                    truncates its own name.
                  */}
                  <div className="hidden xl:block">
                    <table className="w-full table-fixed border-collapse text-sm">
                      <thead>
                        <tr className="border-b-2 border-line text-left align-bottom">
                          <Th className="w-[24%]">{t.colName}</Th>
                          <Th className="w-[16%]">{t.colBatches}</Th>
                          <Th className="w-[16%]">{t.colClass}</Th>
                          <Th className="w-[19%]" num>
                            {t.colPhone}
                          </Th>
                          <Th className="w-[10%]" num>
                            {t.colCode}
                          </Th>
                          {/* Read aloud and never drawn: the two buttons under it say what
                              they do, and a word above them would be the widest thing in
                              the narrowest column. */}
                          <Th className="w-[15%]" right>
                            <span className="sr-only">{t.colActions}</span>
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((row) => (
                          <tr key={row.id} className="border-b border-line align-top">
                            <Td>
                              {/* The name is the link and the row is not: a stretched
                                  overlay would make the guardian's number unselectable, and
                                  that number is what this sheet gets read for. */}
                              <Link
                                href={`/students/${row.id}`}
                                className="block truncate font-medium text-brand-800
                                  hover:underline"
                              >
                                {row.name}
                              </Link>
                              {!row.active && (
                                <span className="block text-xs text-ink-faint">{t.inactive}</span>
                              )}
                            </Td>
                            <Td>
                              <span className="block truncate text-ink-soft">
                                {row.batchNames.length > 0
                                  ? row.batchNames.join(' · ')
                                  : row.active && (
                                      <span className="font-medium text-late">
                                        {t.noBatchRow}
                                      </span>
                                    )}
                              </span>
                            </Td>
                            <Td>
                              <span className="block truncate text-ink-soft">
                                {[row.classLevel, row.institution].filter(Boolean).join(' · ')}
                              </span>
                            </Td>
                            <Td num>
                              <span className="block truncate text-ink-soft">
                                {row.guardianPhone ? (
                                  formatBdMobile(row.guardianPhone)
                                ) : (
                                  <span className="font-medium text-absent">{t.noPhone}</span>
                                )}
                              </span>
                              {row.smsOptOut && (
                                <span className="block text-xs text-ink-faint">{t.smsOff}</span>
                              )}
                            </Td>
                            <Td num>
                              <span className="block truncate text-ink-faint">{row.code}</span>
                            </Td>
                            {/* Both errands, the same two the card offers: the eye for
                                every reader of this screen, the pencil only for the ones
                                the edit screen admits. `justify-end` because the column is
                                right-aligned and two squares in a flex row would otherwise
                                sit left of the heading they belong under. `print:hidden` —
                                a printed roster is a list to read. */}
                            <Td right>
                              <div className="flex items-center justify-end gap-1 print:hidden">
                                <Link
                                  href={`/students/${row.id}`}
                                  className={SHEET_ICON}
                                  aria-label={t.rowView}
                                  title={t.rowView}
                                >
                                  <EyeIcon />
                                </Link>
                                {mayEdit && (
                                  <Link
                                    href={`/settings/students/${row.id}`}
                                    className={SHEET_ICON}
                                    aria-label={t.rowEdit}
                                    title={t.rowEdit}
                                  >
                                    <PencilIcon />
                                  </Link>
                                )}
                              </div>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* The same rows as cards, below `xl`. A card can put the guardian's
                      number on a line of its own at 320px, which no five-column sheet can. */}
                  <ul className="flex flex-col gap-2 xl:hidden">
                    {shown.map((row) => (
                      <li key={row.id}>
                        {/*
                          THE CARD IS NOT A LINK ANY MORE, and that is the whole change.
                          The whole card used to be one, with nothing on it saying so — an
                          owner reported that clicking a student's name was the only way
                          into their record and that they found it by being an engineer.
                          A control nobody can see is a control nobody uses.

                          So the row draws its two ways in: View, which every reader of
                          this screen may take, and Edit, only for the owners and managers
                          the edit screen admits. The name stays a link on top of them —
                          it is the same destination as View, kept because a name that
                          opens a record is the one gesture every reader already knows,
                          and now it is coloured like a link instead of hiding inside one.

                          It also un-buries the guardian's number: text inside a link
                          cannot be selected on a phone, and that number is what this
                          list gets read for.
                        */}
                        <div className="rounded-xl border border-line bg-white px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                <Link
                                  href={`/students/${row.id}`}
                                  className="text-brand-800 hover:underline"
                                >
                                  {row.name}
                                </Link>
                                {!row.active && (
                                  <span className="ml-2 text-sm text-ink-faint">{t.inactive}</span>
                                )}
                              </p>
                              {row.batchNames.length > 0 ? (
                                <p className="truncate text-sm text-ink-soft">
                                  {row.batchNames.join(' · ')}
                                </p>
                              ) : (
                                // The count above says how many; this says which. Amber
                                // rather than the missing number's red, so a row carrying
                                // both problems still reads as two.
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

                          {/* The same two shapes as the sheet, with the words kept: there
                              is room for both at 320px, and an icon beside its label is
                              what teaches the icon on the sheet. Both neutral, and neither
                              brand-filled: three hundred rows of a coloured button is a
                              screen nobody can read, and the one thing on this row that
                              should draw the eye is a child's name. `print:hidden` — a
                              printed roster is a list to read. */}
                          <div className="mt-3 flex items-center gap-2 print:hidden">
                            <Link href={`/students/${row.id}`} className={ROW_BUTTON}>
                              <EyeIcon />
                              {t.rowView}
                            </Link>
                            {mayEdit && (
                              <Link
                                href={`/settings/students/${row.id}`}
                                className={ROW_BUTTON}
                              >
                                <PencilIcon />
                                {t.rowEdit}
                              </Link>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The control that turns one of the two warnings into the list of students it counts.
 *
 * A GET FORM, NOT A LINK, for the reason written up in search-box.tsx: a `<Link>` here
 * would need a href built out of two query params, and `typedRoutes` makes an
 * assembled query string a type error rather than a convenience. A GET form submits to
 * the current path carrying exactly the inputs it holds — which turns out to be
 * precisely what each direction of this wants.
 *
 * ENTERING DROPS THE SEARCH. The card counts the whole centre, so tapping it has to
 * produce that whole count; filtering "12 in no batch" down to the two of them called
 * Rahman, because Rahman was still in the box from ten minutes ago, would make the
 * number on the card a lie about what tapping it does. So the form carries only
 * `show`.
 *
 * LEAVING KEEPS IT. The mirror image, and for a plainer reason: somebody who typed a
 * name is looking for that student, and tidying a warning away should not throw the
 * search out with it. So the form carries only `q`, and dropping `show` is what
 * clearing means.
 *
 * The label is `search.clear` — the same "Show all" that empties the box — because it
 * does the same job to the same list, and inventing a second phrasing for it would
 * only ask an owner to learn which of two identical-looking buttons undoes what.
 */
function WarningFilter({
  value,
  active,
  q,
  showThese,
  clear,
}: {
  value: 'no-phone' | 'no-batch'
  /** Whether this warning is the one currently filtering the list. */
  active: boolean
  /** The query in the box, preserved out of the filter but never into it. */
  q: string
  showThese: string
  clear: string
}) {
  return (
    <form method="get" className="mt-3 print:hidden">
      {!active && <input type="hidden" name="show" value={value} />}
      {active && q !== '' && <input type="hidden" name="q" value={q} />}
      <button
        type="submit"
        className="inline-flex min-h-tap items-center rounded-xl border-2 border-late/40
          bg-white px-4 font-medium text-ink"
      >
        {active ? clear : showThese}
      </button>
    </form>
  )
}

/**
 * The control that puts the leavers aside.
 *
 * A SEPARATE COMPONENT BECAUSE IT KEEPS THE SEARCH IN BOTH DIRECTIONS, which is the one
 * thing `WarningFilter` deliberately does not do. The asymmetry there protects a count
 * printed on a card: tapping "12 in no batch" has to show twelve. Nothing is counted
 * here — this narrows whatever list the reader is already looking at, so throwing their
 * search away on the way in would be a second, unasked-for change to the screen.
 *
 * Neutral border, not the warnings' amber: a student who left is not a problem with the
 * data. The default stays everyone, because search has to be able to reach a student who
 * left — a re-admission in July must find last year's record rather than type a second
 * one.
 */
function ScopeFilter({
  active,
  q,
  showCurrent,
  clear,
}: {
  active: boolean
  /** Carried both ways, unlike the warnings'. */
  q: string
  showCurrent: string
  clear: string
}) {
  return (
    <form method="get" className="print:hidden">
      {!active && <input type="hidden" name="show" value="current" />}
      {q !== '' && <input type="hidden" name="q" value={q} />}
      <button
        type="submit"
        className="inline-flex min-h-tap items-center rounded-xl border-2 border-line
          bg-white px-4 font-medium text-ink-soft hover:text-ink"
      >
        {active ? clear : showCurrent}
      </button>
    </form>
  )
}
