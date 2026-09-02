import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { pageRole, getSession, isStaffAdmin, myTeacherIds } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { todayInDhaka, dhakaDayOfWeek } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'

/**
 * A page title has to read the session, and `export const metadata` cannot —
 * it is evaluated without a request. `generateMetadata` can, and costs nothing
 * extra: `getSession` is wrapped in React `cache()`, so the page below reuses
 * the same result rather than asking Supabase twice.
 *
 * `getSession` and not `pageRole`: a title is not an authorization boundary. The
 * guard belongs in the page body, which runs right after this and does the same
 * check properly — put it here as well and an unauthorized visitor is decided
 * twice, in the one place where the answer cannot be rendered. Whichever guard is
 * used it interrupts by throwing, and a throw while building metadata is a 500
 * where the page itself would have shown a 403 or a redirect.
 */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).teach.title} — CoachDesk` }
}

/**
 * A teacher's home: today's batches, each one tap from attendance.
 *
 * Ordered by whether attendance is already taken, then by start time. The point
 * is that a teacher arriving at 4pm sees the 4pm batch at the top without
 * reading anything — the screen answers "what do I do now" before it answers
 * "what does this app contain".
 *
 * A BATCH WITH NOBODY IN IT IS NOT A CLASS TO MARK. The register refuses to draw a
 * form for one, so it could never be marked, so it sat in the "still to mark" count
 * for ever: an owner with three batches and one empty one marked the two real ones
 * and was still told one was left. Every count and every button on this screen now
 * asks whether there is anybody to mark, and the row says so where the button used
 * to be, because the count above cannot say which batch it means.
 */
export default async function TeachPage() {
  // Matches teach/[batchId], which has always required `teacher`. This list was
  // the looser of the two: a student could open the screen that takes attendance,
  // then get a 403 on any batch they tapped.
  const session = await pageRole('teacher')
  const supabase = await createClient()
  const today = todayInDhaka()
  const dow = dhakaDayOfWeek()
  const locale = session.locale
  const t = dict(locale).teach

  // Whose batches this screen is about.
  //
  // Not RLS's job, and this page used to assume it was. batches_member_read lets
  // any member read any batch at their own centre, which is right: an owner needs
  // it for the setup screens, and a batch's name and time are not a secret from
  // the people inside the centre. It is simply not the answer to "what am I
  // teaching today" — and this page asked the database that question and printed
  // whatever came back. A teacher at a nine-batch centre got all nine, every one
  // captioned "0 students" because the enrolment embed *is* narrowed to their own
  // batches, each linking to a register they would not have been allowed to save.
  //
  // A staff-admin is not filtered. An owner opening this is reviewing the centre's
  // day rather than their own timetable, and bootstrap_center gives them a teachers
  // row that no batch need point at — filtering them would empty their own screen.
  const isAdmin = isStaffAdmin(session)

  /*
   * The reader's own teacher rows, now asked of everybody and read two different ways.
   *
   * For a teacher it is the filter: which batches are theirs is the whole question this
   * screen answers, and a list that did not arrive is a refusal rather than a wide
   * answer — see below.
   *
   * For a staff-admin it filters nothing and answers only which of the centre's batches
   * they teach themselves, which is what decides whether opening one is attendance or a
   * correction (§6.3). So an unreadable list costs them a word on a row and never the
   * page: every batch simply reads as somebody else's, which is the safe direction.
   */
  const scope = await myTeacherIds()
  const unreadable = 'unreadable' in scope
  const ownIds = unreadable ? [] : scope.ids

  /*
   * Two nulls that mean opposite things, kept apart before either is used.
   *
   * `null` below is a staff-admin, and it means "do not filter" — every batch in the
   * centre, which is what an owner opened this to see. A staff list that did not
   * arrive would have meant exactly the same thing to the query below, and it would
   * have been the widest answer the screen can give to the reader who least wants it:
   * a teacher at a nine-batch centre shown all nine, with a register on each one they
   * would not be allowed to save. Which is the bug the filter was added to fix, coming
   * back in through the failure path.
   *
   * So the read is not sent at all. `batchesUnreadable` below is already the sentence
   * for it, and this is the third way of reaching it.
   */
  const scopeUnreadable = !isAdmin && unreadable
  const mine = isAdmin || unreadable ? null : ownIds

  // Two steps rather than one chain: supabase-js's `.order()` returns a builder
  // with the filter methods already dropped off it, so a conditional filter has to
  // be added before the ordering rather than after.
  let batchQuery = supabase
    .from('batches')
    .select(
      `id, name, slot, start_time, end_time, teacher_id,
       subjects (name, name_bn),
       teachers (name),
       batch_schedules (day_of_week, start_time, end_time),
       enrollments (id, status)`,
    )
    .eq('coaching_center_id', session.active.centerId)
    .eq('active', true)

  if (mine) batchQuery = batchQuery.in('teacher_id', mine)

  // A member whose role reads teacher but who holds no active row in the staff
  // list teaches nothing — an unfinished invitation, or a row switched off. `in.()`
  // would be a round trip to be told what is already known here.
  //
  // Kept as its own flag as well as a skipped read, because the two nulls have to be
  // told apart below: nothing to teach is an answer, and a read that never arrived is
  // not. Both used to come out of this line as the same `data: null`.
  const noBatchesOfMine = mine?.length === 0

  const { data: batches } =
    noBatchesOfMine || scopeUnreadable
      ? { data: null }
      : await batchQuery.order('start_time', { ascending: true, nullsFirst: false })

  const { data: sessions } = await supabase
    .from('attendance_sessions')
    .select('id, batch_id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('session_date', today)

  /*
   * Null, not an empty set, when today's marked registers could not be read.
   *
   * `(sessions ?? [])` made a dropped read say that nothing has been marked today,
   * which on this screen is not a blank space — it is a count at the top and a green
   * button on every row. A teacher who marked four batches this morning came back at
   * four o'clock and was told four were still to mark, so they would mark them again;
   * an owner reading the same line would go and ask why.
   *
   * It is the exact disease the tally below was rewritten for, pointing the other way.
   * A counter that cannot reach zero gets ignored; a counter that walks back up to four
   * gets ignored faster.
   *
   * So both things that would claim it are withheld: the count at the top says which
   * read failed, and the badge on each row is left off rather than falling through to
   * "Mark", which would be the same claim again in the louder place. Tapping the row
   * still opens the register, and the register is the authority on what is in it.
   */
  const takenBatchIds =
    sessions === null ? null : new Set(sessions.map((s) => s.batch_id))
  const markingUnknown = takenBatchIds === null

  /*
   * BOTH EMPTY CARDS ON THIS SCREEN ARE SENTENCES ABOUT WHOSE BATCHES THESE ARE, SO A
   * DROPPED READ MAY NOT BE ALLOWED TO REACH EITHER OF THEM.
   *
   * `(batches ?? [])` put a failed read straight into `rows.length === 0`, and what is
   * drawn there is not a blank list. An owner got "make a batch to get started" with a
   * button under it that makes their tenth — students then split across two batches and
   * a register kept in each. A teacher got "none of the batches are yours yet", which
   * reads as having been taken off the timetable, on a morning they are standing in
   * front of the class. And the line above both of them said "no classes today", which
   * is the one sentence on this screen a teacher acts on without reading twice.
   *
   * `noBatchesOfMine` is the empty list that *is* an answer and still reaches the
   * teacher's card, exactly as before. Everything else null is now the sentence.
   */
  const batchRows: NonNullable<typeof batches> | null = noBatchesOfMine ? [] : batches

  if (batchRows === null) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-bold text-ink">{greetingFor(session)}</h1>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.batchesUnreadable}</p>
        </Card>
      </div>
    )
  }

  const rows = batchRows.map((batch) => {
    const schedules = batch.batch_schedules ?? []
    // A batch with no schedule rows is treated as meeting every day. Centres
    // set schedules up late, and hiding their batches until they do would look
    // like data loss.
    const meetsToday =
      schedules.length === 0 || schedules.some((s) => s.day_of_week === dow)
    const todaySchedule = schedules.find((s) => s.day_of_week === dow)
    const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects
    const teacher = Array.isArray(batch.teachers) ? batch.teachers[0] : batch.teachers

    const studentCount = (batch.enrollments ?? []).filter(
      (e) => e.status === 'active',
    ).length
    const taken = takenBatchIds?.has(batch.id) ?? false
    /**
     * Whether this is the reader's own batch, by the `teacher_id` on it and never by
     * rank — the same rule `registerAct` and the trigger read. A teacher sees only
     * these, and an owner who also teaches gets §6.3's unchanged normal path on theirs.
     */
    const ownBatch = batch.teacher_id !== null && ownIds.includes(batch.teacher_id)

    return {
      id: batch.id,
      name: batch.name,
      subjectName: localName(subject, locale),
      slot: batch.slot,
      startTime: todaySchedule?.start_time ?? batch.start_time,
      endTime: todaySchedule?.end_time ?? batch.end_time,
      studentCount,
      taken,
      meetsToday,
      /** Whose batch this is — nothing to say about the reader's own. */
      teacherName: ownBatch ? null : teacher?.name ?? null,
      /**
       * Who the review is waiting on, drawn in place of that name.
       *
       * Admin-only and never on their own batch, and withheld when the marked-registers
       * read failed: "has not submitted" drawn from a blank is an accusation against a
       * teacher who may well have filed it an hour ago, on the screen their owner reads.
       */
      waiting: isAdmin && !ownBatch && !markingUnknown && !taken && studentCount > 0,
    }
  })

  const todayRows = rows.filter((r) => r.meetsToday)
  const otherRows = rows.filter((r) => !r.meetsToday)

  /**
   * Today's classes that somebody can actually mark.
   *
   * A batch with nobody enrolled is excluded, and that is a fix rather than a
   * refinement: the register refuses to draw a form for an empty batch, so such a
   * batch could never be marked, so the "still to mark" count could never reach zero.
   * An owner with two real batches and one empty one was told three were left, marked
   * both, and was still told one was left — for ever. A counter that cannot be cleared
   * is a counter people stop reading, and it would have taken the other two with it.
   */
  const pending = todayRows.filter((r) => !r.taken && r.studentCount > 0)

  /**
   * Whether there is a register to take today at all.
   *
   * Separates "everything is marked" from "there is nothing markable", which used to
   * come out as the same sentence. A centre in its first week — batches made, nobody
   * enrolled yet — was told all of today's attendance was taken.
   */
  const markable = todayRows.some((r) => r.studentCount > 0)

  /*
   * Ordered so the honest answer wins over the arithmetic. No classes today is true
   * whatever the register read did; after that, a tally nobody can stand behind is not
   * printed as a number.
   *
   * The last fork is §6.3: the same two counts, worded as a review for a staff-admin,
   * because these are not their registers to file. See `reviewPending`.
   */
  const summary =
    todayRows.length === 0
      ? t.noClassToday
      : markingUnknown
        ? t.markedUnknown
        : pending.length > 0
          ? isAdmin
            ? t.reviewPending(pending.length)
            : t.pending(pending.length)
          : markable
            ? isAdmin
              ? t.reviewAllTaken
              : t.allTaken
            : t.emptyToday

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{greetingFor(session)}</h1>
        <p className="mt-1 text-ink-soft">{summary}</p>
      </div>

      {rows.length === 0 &&
        (isAdmin ? (
          <Card>
            <h2 className="font-semibold text-ink">{t.firstBatchTitle}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t.firstBatchBody}</p>
            <Link
              href="/settings/batches/new"
              className="mt-4 inline-flex min-h-tap items-center justify-center
                rounded-xl bg-brand-600 px-5 font-semibold text-white"
            >
              {t.addBatch}
            </Link>
          </Card>
        ) : (
          /* The same emptiness, without the button. /settings/batches/new is
             staff-admin, so the card above offered the only role that normally
             reads this screen a door that answers 403 — and told them to make a
             batch, which is not a thing a teacher does. This one names who
             does. */
          <Card>
            <h2 className="font-semibold text-ink">{t.noBatchesTitle}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t.noBatchesBody}</p>
          </Card>
        ))}

      {todayRows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {todayRows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/teach/${row.id}`}
                className="flex items-center gap-4 rounded-2xl border border-line
                  bg-white p-4 shadow-sm transition-colors hover:border-brand-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{row.name}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-soft">
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
                  <p className="num mt-0.5 text-sm text-ink-faint">
                    {t.students(row.studentCount)}
                  </p>
                  {/* §6.3's review line: whose register this is, or who it is waiting
                      on. Only ever on somebody else's batch — a teacher reading their
                      own name here learns nothing, and an owner who teaches gets the
                      unchanged path on the batches they take themselves. */}
                  {row.waiting ? (
                    <p className="mt-0.5 truncate text-sm font-medium text-late">
                      {row.teacherName
                        ? t.notSubmitted(row.teacherName)
                        : t.noTeacherYet}
                    </p>
                  ) : (
                    row.teacherName && (
                      <p className="mt-0.5 truncate text-sm text-ink-faint">
                        {row.teacherName}
                      </p>
                    )
                  )}
                </div>

                {row.taken ? (
                  <span
                    className="shrink-0 rounded-lg bg-brand-50 px-3 py-1.5 text-sm
                      font-semibold text-brand-700"
                  >
                    ✓ {t.taken}
                  </span>
                ) : row.studentCount === 0 ? (
                  /* No register behind this one, so no button offering to take it.
                     Tapping still opens the batch — the card there explains that the
                     students have to be put in it, which is the fix and is not
                     something this row has room to say.

                     Checked after `taken`, not before: a batch marked in the morning
                     and emptied in the afternoon really was marked, and what happened
                     outranks what can happen next.

                     Grey rather than the amber the roster uses for the same students.
                     There it is a warning to the owner who can fix it; here it is
                     mostly read by a teacher who cannot, and an alarm nobody can
                     answer is just noise on their screen every day. */
                  <span
                    className="shrink-0 rounded-lg bg-surface-alt px-3 py-1.5 text-sm
                      font-medium text-ink-soft"
                  >
                    {t.emptyBatch}
                  </span>
                ) : markingUnknown ? null : (
                  <span
                    className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 text-sm
                      font-semibold text-white"
                  >
                    {t.take}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {otherRows.length > 0 && (
        <details className="rounded-2xl border border-line bg-white p-4">
          <summary className="min-h-tap cursor-pointer font-medium text-ink-soft">
            {t.otherBatches} (<span className="num">{otherRows.length}</span>)
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {otherRows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/teach/${row.id}`}
                  className="flex min-h-tap items-center justify-between gap-3
                    rounded-xl px-3 hover:bg-surface-alt"
                >
                  <span className="truncate text-ink">{row.name}</span>
                  <span className="num shrink-0 text-sm text-ink-faint">
                    {t.studentsShort(row.studentCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
