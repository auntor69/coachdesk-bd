import Link from 'next/link'

import { Card } from '@/components/ui'
import { SearchBox, SearchEmpty } from '@/components/search-box'
import { pageRole, getSession, canManageExams } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageAll, type PageFailure, worstFailure } from '@/lib/supabase/page'
import { formatDate } from '@/lib/bd/time'
import { searchTerms, matchesSearch, MAX_QUERY } from '@/lib/search'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).exams.title} — CoachDesk` }
}

/**
 * How many rows the list draws, and how far back the box can reach.
 *
 * Two numbers because they answer two questions. A phone shows about six rows at a
 * time, so forty is already a long scroll and four hundred would be a page that
 * takes a second to paint on a mid-range handset for rows nobody reads. The second
 * is how much history the search is done over, and it is deliberately an order of
 * magnitude larger: a centre running weekly tests in twenty batches writes eighty
 * exams a month, so the newest forty is five days of work and five hundred is half
 * a year of it.
 *
 * The list is cut with a note that says so, and the ceiling gets its own note when
 * it is reached, because a search that quietly cannot see March is worse than no
 * search — the reader concludes the exam was never created.
 */
const LIST_ROWS = 40
const SEARCH_CEILING = 500

/**
 * Exams a teacher can enter marks for, newest first.
 *
 * The SMS state is on the row rather than buried in a detail screen, because
 * "did the parents get told" is the question a teacher actually has, and the
 * answer costs the centre money if they guess wrong and send twice.
 *
 * BOTH NUMBERS ON THE ROW CARRY THEIR DENOMINATOR OR THEIR SOURCE. A row that
 * said "12 marked" was true and useless: 12 out of a batch of 12 is a finished
 * exam and 12 out of 40 is an afternoon's work still to do, and they looked
 * identical down the whole list — which is the one question this list is opened to
 * answer. Likewise "did the parents get told": the two columns the chip read,
 * `sms_sent_at` and `sms_declined_at`, are set by the metered gateway, and there
 * is no gateway — no BTRC sender ID, so no aggregator, and every tier grants zero
 * credits. The sends that actually happen are the owner tapping through to their
 * own SMS or WhatsApp app, one family at a time, recorded in `result_notices`. So
 * the column answered from the table nothing writes and stayed silent about the
 * one that fills up, and a teacher who told forty parents last night came back to
 * a row that looked untouched.
 *
 * AND THE THIRTY-FIRST EXAM USED TO LEAVE THE PRODUCT. This list was the newest
 * thirty with no note and no box: a centre running weekly tests crosses thirty in
 * about seven months, and after that the March model test was unreachable through
 * every screen in the app — the exam existed, held its marks, and could not be
 * opened. So the list now searches its history by title, batch and subject, is
 * honest when it has been cut, and reads in two passes rather than one: the index
 * is the whole history in light columns, and the marks and notices are fetched only
 * for the rows actually drawn. That order matters. Filtering in memory over rows
 * the page already had is what every other search here does, and it is what keeps a
 * search from moving the figures on the screen; but embedding every result row of
 * five hundred exams to render forty would be twenty thousand rows fetched to throw
 * away.
 */
export default async function ExamsPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ q?: string }>
}) {
  const session = await pageRole('teacher')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.exams

  const query = ((await searchParams).q ?? '').slice(0, MAX_QUERY)
  const terms = searchTerms(query)

  // Whether this reader may create one. The list itself is not gated — a teacher
  // who may not create exams still needs to read the marks for the class they
  // teach, which is the whole distinction the permission draws — so this only
  // decides whether the two doors to /exams/new are drawn.
  const canMark = await canManageExams()

  /*
   * Pass one: the index. Every exam this reader can see, in the columns it takes to
   * list one and to find one, and nothing that costs a row per student.
   *
   * No permission gate on any of it. The batch list next door needs
   * `canManageStudents()` before it dares draw a headcount, because a teacher can be
   * allowed to see every batch in the centre while reading enrolments only for their
   * own — so the column would have read "0 জন" down the page. Nothing here can do
   * that: `exams_teacher_read` is `teaches_batch(batch_id)`, so the rows this reader
   * gets back are already only their own batches, and the enrolment, result and
   * notice policies are scoped through the same batch. An owner reads the centre.
   * Whatever comes back, the counts below are counts and not the shadow of a policy.
   */
  const { data: history } = await supabase
    .from('exams')
    .select(
      `id, title, total_marks, exam_date, batch_id, sms_sent_at, sms_declined_at,
       batches (name), subjects (name, name_bn)`,
    )
    .eq('coaching_center_id', session.active.centerId)
    .order('exam_date', { ascending: false })
    .limit(SEARCH_CEILING)

  /*
   * NULL, NOT AN EMPTY HISTORY.
   *
   * `(history ?? [])` put a dropped read into `indexed.length === 0`, and what stands
   * there is not a blank list: it is "no exams yet", and for a reader who may create
   * them, a button offering to make the centre's first. At a centre with two hundred
   * exams on file the next move is to create the one they came here to find — and a
   * duplicate exam is not a duplicate row. It is this week's marks entered against the
   * copy and last week's still on the original, both rows reading half-marked down the
   * list for ever, and two runs of result messages to the same families.
   *
   * The failed read also takes the search box away, which is how the reader would have
   * checked: the box is only drawn once `indexed` has something in it. That is right for
   * a centre with no exams and exactly wrong here.
   */
  const indexed =
    history &&
    history.map((exam) => {
      const batch = Array.isArray(exam.batches) ? exam.batches[0] : exam.batches
      const subject = Array.isArray(exam.subjects) ? exam.subjects[0] : exam.subjects

      return {
        id: exam.id,
        title: exam.title,
        // Number(), like the marks sheet: total_marks is numeric, so it arrives as
        // "100.00" and rendering it raw showed a full mark nobody typed.
        totalMarks: Number(exam.total_marks),
        examDate: exam.exam_date,
        batchId: exam.batch_id,
        batchName: batch?.name ?? '',
        subjectName: localName(subject, locale),
        smsSent: Boolean(exam.sms_sent_at),
        smsDeclined: Boolean(exam.sms_declined_at),
      }
    })

  /*
   * The sentence instead, before anything below is counted or searched over nothing.
   *
   * The heading stays, because it names the screen rather than claiming anything about
   * it. The New button does not, and that is the one active thing this refusal does:
   * creating an exam is only safe for a reader who can see the ones that already exist,
   * and seeing them is precisely what failed. So the door is shut while the sentence is
   * on the screen, the sentence says the door is shut and why, and the wait is one tap
   * of the browser's own refresh.
   */
  if (indexed === null) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-bold text-ink">{t.title}</h1>
          <p className="mt-1 text-ink-soft">{t.subtitle}</p>
        </div>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.listUnreadable}</p>
        </Card>
      </div>
    )
  }

  /*
   * Three fields, all of them visible on the row that will be returned.
   *
   * Not the date, which is the obvious fourth and the wrong one: the row prints it
   * through `formatDate` in Bangla numerals and the column behind it is an ISO
   * string, so a reader typing the ১৫ they can see would be told the exam does not
   * exist. A search that answers for fields the reader cannot see is a search they
   * stop trusting; one that silently fails on a field they can is worse.
   */
  const matched =
    terms.length === 0
      ? indexed
      : indexed.filter((e) => matchesSearch([e.title, e.batchName, e.subjectName], terms))

  const page = matched.slice(0, LIST_ROWS)

  /*
   * Pass two: the counts, for the rows being drawn and no others.
   *
   * Skipped entirely when there is nothing to draw, which is also why the three maps
   * are declared out here — an empty centre and a search that matched nothing both
   * arrive with every count legitimately zero, and neither should cost a round trip.
   *
   * `enrollments` is asked for separately rather than nested under `batches`: that
   * relationship is reached through a two-column foreign key, and PostgREST's
   * generated types do not carry it that far, so the embed came back untyped — which
   * is the wrong thing to build a count on.
   */
  const rosters = new Map<string, Set<string>>()
  const markedBy = new Map<string, Set<string>>()
  const toldBy = new Map<string, Set<string>>()

  /**
   * Whether the three counts can be trusted, out here with the maps they describe.
   *
   * Null when there was nothing to count, which is the honest answer for an empty
   * centre and for a search that matched nothing: no read was attempted, so no read
   * failed.
   */
  let countsProblem: PageFailure | null = null

  if (page.length > 0) {
    const examIds = page.map((e) => e.id)
    const batchIds = [...new Set(page.map((e) => e.batchId))]

    /*
     * All three paged, even though only forty rows get drawn. Forty rows is the
     * output; the input is one row per student per exam, so forty weekly tests
     * across batches of forty is sixteen hundred result rows — past the thousand
     * PostgREST answers with and says nothing about. A short read here does not
     * blank a row, it moves the number on it: "12 / 40 marked" under an exam that
     * was fully marked, and a lower "told" count under one where every family was
     * already messaged. That last one is the number a teacher checks before
     * sending, so the quiet cut would cost the centre a second SMS per family.
     */
    const [enrolled, results, notices] = await Promise.all([
      pageAll((from, to) =>
        supabase
          .from('enrollments')
          .select('id, batch_id')
          .eq('coaching_center_id', session.active.centerId)
          .eq('status', 'active')
          .in('batch_id', batchIds)
          .order('id')
          .range(from, to),
      ),
      pageAll((from, to) =>
        supabase
          .from('exam_results')
          .select('exam_id, enrollment_id')
          .eq('coaching_center_id', session.active.centerId)
          .in('exam_id', examIds)
          .order('id')
          .range(from, to),
      ),
      pageAll((from, to) =>
        supabase
          .from('result_notices')
          .select('exam_id, student_id')
          .eq('coaching_center_id', session.active.centerId)
          .in('exam_id', examIds)
          .order('id')
          .range(from, to),
      ),
    ])

    /*
     * And whether they arrived, which is the difference between a fraction and a
     * fiction. All three fed the maps below through `?? []`, so a failed read did not
     * blank the figures — it moved them to the flattering-looking end and left them
     * looking like figures: every exam reading "0/40 marked" with an amber "40 not
     * marked" under it, or every exam reading "nobody in the batch", or the told-count
     * gone from a row where forty families were messaged last night.
     *
     * The first sends a teacher to enter marks that are already in. The last sends a
     * second message to every one of those families, off the exact number the comment
     * above says a teacher checks before sending. So the figures come off the rows and
     * the list stays: the titles, dates and SMS state come from the index read and are
     * still true, each row still opens the exam, and the exam's own screen counts for
     * itself.
     */
    countsProblem = worstFailure(enrolled, results, notices)

    /*
     * Who the marks sheet would put in front of a teacher today, per batch.
     *
     * Every currently active enrolment, which is exactly what the sheet draws and
     * exactly what the exam's own screen subtracts to get "no marks yet". The two
     * screens have to agree — a list promising 28 left and a sheet offering 26 rows
     * is the kind of disagreement that gets a product distrusted — so this mirrors
     * that definition rather than improving on it.
     *
     * Not narrowed by `enrolled_at` to whoever was in the batch on the day, which is
     * the obvious refinement and is wrong here: a centre is onboarded by having its
     * real register typed in, so every enrolment dates from the afternoon of the
     * import and every exam held before it would come out with an empty roster.
     */
    for (const row of 'rows' in enrolled ? enrolled.rows : []) {
      let set = rosters.get(row.batch_id)
      if (!set) rosters.set(row.batch_id, (set = new Set()))
      set.add(row.id)
    }

    for (const row of 'rows' in results ? results.rows : []) {
      let set = markedBy.get(row.exam_id)
      if (!set) markedBy.set(row.exam_id, (set = new Set()))
      set.add(row.enrollment_id)
    }

    // Families, not messages. A row per send means a guardian who was texted and
    // then called again is in here twice, and "2 told" for one student would send a
    // teacher looking for a second family that does not exist.
    for (const row of 'rows' in notices ? notices.rows : []) {
      let set = toldBy.get(row.exam_id)
      if (!set) toldBy.set(row.exam_id, (set = new Set()))
      set.add(row.student_id)
    }
  }

  const rows = page.map((exam) => {
    // Marks counted through the roster and not by row, so a result belonging to a
    // student who has since left cannot push the count past the total it is drawn
    // over — the sheet does not show that row either.
    const roster = rosters.get(exam.batchId)
    const rosterSize = roster?.size ?? 0
    const marks = markedBy.get(exam.id)
    const marked = roster && marks ? [...marks].filter((id) => roster.has(id)).length : 0

    return {
      ...exam,
      rosterSize,
      marked,
      unmarked: rosterSize - marked,
      told: toldBy.get(exam.id)?.size ?? 0,
    }
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{t.title}</h1>
          <p className="mt-1 text-ink-soft">{t.subtitle}</p>
        </div>
        {canMark && (
          <Link
            href="/exams/new"
            className="inline-flex min-h-tap shrink-0 items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.new}
          </Link>
        )}
      </div>

      {indexed.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          {/* The instruction, or the reason there is no instruction. Same split as
              the fee board's empty state, and the same reason: a reader with no
              button must be told the emptiness is somebody else's to fix, not read
              "create an exam" and go looking for the way. */}
          <p className="mt-1 text-sm text-ink-soft">
            {canMark ? t.emptyBody : t.emptyBodyReadOnly}
          </p>
          {canMark && (
            <Link
              href="/exams/new"
              className="mt-4 inline-flex min-h-tap items-center justify-center
                rounded-xl bg-brand-600 px-5 font-semibold text-white"
            >
              {t.create}
            </Link>
          )}
        </Card>
      ) : (
        <>
          {/* Only once there is a history to search. A box over an empty centre is a
              control that can only ever fail, above a card explaining the centre has
              no exams — and the count it draws would read "0 of 0". */}
          <SearchBox
            q={query}
            t={d.search}
            placeholder={d.search.placeholderExams}
            count={{ shown: matched.length, total: indexed.length }}
          />

          {/* Once, above the list, with what to do about it — the rows themselves only
              have room to say the figure is missing, not why or what to try. Grey like
              the rest of this screen's asides rather than amber: nothing here is wrong
              with the centre's data, the exams are all still openable, and the one
              thing a teacher needs from the fractions is on the exam's own screen. */}
          {countsProblem !== null && (
            <Card>
              <p className="text-sm text-ink-soft">
                {countsProblem === 'tooLarge' ? t.countsTooLarge : t.countsUnreadable}
              </p>
            </Card>
          )}

          {rows.length === 0 ? (
            /* The search found nothing, which is not the same sentence as "no exams
               yet" above — that one would tell a teacher the centre has never held an
               exam because they mistyped a batch name. */
            <SearchEmpty t={d.search} />
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/exams/${row.id}`}
                    className="flex items-center gap-3 rounded-xl border border-line
                      bg-white px-4 py-3 transition-colors hover:border-brand-300"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{row.title}</p>
                      <p className="truncate text-sm text-ink-soft">
                        {[row.batchName, row.subjectName].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-sm text-ink-faint">
                        {formatDate(row.examDate, locale)} · {t.fullMarks}{' '}
                        <span className="num">{row.totalMarks}</span>
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {countsProblem !== null ? (
                        // Not a zero and not a blank. The card above carries the
                        // instruction; this only has to stop the slot claiming a
                        // number, on every row, where a blank would read as forty
                        // exams with nothing to report.
                        <p className="text-sm text-ink-soft">{t.countsUnknown}</p>
                      ) : row.rosterSize === 0 ? (
                        /* No roster, so no fraction. "0/0 marked" is a riddle, and
                           the honest reading of an exam set on a batch nobody is
                           enrolled in is that there is nothing here to mark — which
                           is also what the exam's own screen says when you open it.

                           Grey, not amber, and for the same reason the register's row
                           for an empty batch is grey: this list is mostly read by
                           teachers, the fix lives on a roster screen most of them
                           cannot open, and an alarm nobody can answer is noise on
                           their phone. */
                        <p className="text-sm text-ink-soft">{t.emptyBatch}</p>
                      ) : (
                        <>
                          <p className="num text-sm font-semibold text-ink">
                            {row.marked}/{row.rosterSize}
                          </p>
                          <p className="text-xs text-ink-faint">{t.marked}</p>
                          {/* The subtraction, done rather than left to the reader —
                              the number they act on is the one that is missing. It
                              stays amber on an exam from two months ago because it
                              stays true: those students have no mark, and the way to
                              clear the line is to enter one, or to mark the absence
                              they sat out. */}
                          {row.unmarked > 0 && (
                            <p className="num mt-1 text-xs font-medium text-late">
                              {t.marksLeft(row.unmarked)}
                            </p>
                          )}
                        </>
                      )}

                      {/* One line, in the order of how much it covers. A metered send
                          went to every family with a mark at once, so it answers the
                          question completely and the tap-through tally underneath it
                          would only muddy that. "Not sent" comes last because a
                          decline is the answer only while nothing else has happened. */}
                      {row.smsSent ? (
                        <p className="mt-1 text-xs font-medium text-brand-700">
                          {t.smsSent}
                        </p>
                      ) : countsProblem !== null ? (
                        /* Nothing, because the two arms below both rest on the
                           told-count, and that is one of the figures that did not
                           arrive. `smsSent` above is off the index read and still
                           true; "not sent" would be a claim about a number nobody
                           has, on an exam whose families may all have been messaged
                           last night. The slot above already says so. */
                        null
                      ) : row.told > 0 ? (
                        <p className="num mt-1 text-xs font-medium text-brand-700">
                          {t.toldCount(row.told)}
                        </p>
                      ) : row.smsDeclined ? (
                        <p className="mt-1 text-xs text-ink-faint">{t.smsNotSent}</p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* What the list is not showing, in two sentences that are two different
              facts. The first is a cut this reader can undo from the box above; the
              second is one they cannot, and it is here because a search box that
              silently stops at some depth would have a teacher concluding an exam was
              never created. */}
          {matched.length > rows.length && (
            <p className="num text-xs text-ink-faint">{t.limitNote(rows.length)}</p>
          )}
          {indexed.length >= SEARCH_CEILING && (
            <p className="num text-xs text-ink-faint">{t.ceilingNote(SEARCH_CEILING)}</p>
          )}
        </>
      )}
    </div>
  )
}
