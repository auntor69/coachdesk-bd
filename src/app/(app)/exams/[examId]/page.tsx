import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { pageRole, getSession, canSendSms, canManageExams } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate, todayInDhaka } from '@/lib/bd/time'
import { planResultSms } from '@/lib/sms/result-dispatch'
import { smsProviderConfigured } from '@/lib/sms/provider'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { MarksSheet, type MarksRow } from './marks-sheet'
import { ResultNotices, type ResultRowView } from './result-notices'
import { SmsGate } from './sms-gate'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).exams.marksTitle} — CoachDesk` }
}

/**
 * One exam: the marks sheet, then the parent-SMS decision under it.
 *
 * Both on one page, in that order, because they are one task in a teacher's
 * head — "put the marks in and tell the parents" — but two separate writes in
 * the database. Saving marks never sends anything; the gate below is the only
 * thing that spends credits, and it reads the marks that were actually saved
 * rather than whatever is currently typed into the sheet. That is deliberate:
 * a preview built from unsaved input would show parents' names for marks that
 * are not in the database yet.
 */
export default async function ExamPage({
  params,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  params: Promise<{ examId: string }>
}) {
  const { examId } = await params
  const session = await pageRole('teacher')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.exams

  // RLS decides visibility. A miss is a 404, not a 403, so the URL cannot be
  // used to find out which exam ids exist in other centres.
  const { data: exam } = await supabase
    .from('exams')
    .select(
      `id, title, total_marks, pass_marks, exam_date, batch_id,
       sms_sent_at, sms_declined_at,
       batches (name), subjects (name, name_bn), exam_types (name, name_bn)`,
    )
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examId)
    .maybeSingle()

  if (!exam) notFound()

  const [{ data: enrollments }, { data: results }, { data: notices }] =
    await Promise.all([
      supabase
        .from('enrollments')
        .select('id, students (id, name, student_code)')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', exam.batch_id)
        .eq('status', 'active'),
      supabase
        .from('exam_results')
        .select('enrollment_id, obtained_marks, is_absent, note')
        .eq('coaching_center_id', session.active.centerId)
        .eq('exam_id', exam.id),
      // Who has already been told, from anybody's phone, on any visit. Ordered so
      // the first row per student is the most recent — the index is on exactly
      // this, so the sort is free.
      supabase
        .from('result_notices')
        .select('student_id, created_at')
        .eq('coaching_center_id', session.active.centerId)
        .eq('exam_id', exam.id)
        .order('created_at', { ascending: false }),
    ])

  /*
   * NEITHER OF THE TWO READS THE SHEET IS BUILT FROM MAY BE TAKEN AS EMPTY, AND THE
   * MARKS ONE IS THE WORST INSTANCE OF THAT MISTAKE IN THIS PRODUCT.
   *
   * `exam_results` read as an empty list draws every box on the sheet blank — and a
   * blank box is not "no mark yet" to the action behind the save button. `saveMarks`
   * says so in its own words: "A blanked field is a deliberate erase, not leave it as it
   * was", and it is right to, because a stale mark left behind after a correction is a
   * wrong number sent to a parent. So a teacher who opens a sheet that was marked last
   * week, finds it empty, types the three they have in hand and saves has just deleted
   * the other thirty-seven — silently, with a green "marks saved", and the action cannot
   * tell that from a deliberate clearing because its own read succeeded.
   *
   * The roster, for the reason the attendance screen gives: an empty one has a sentence
   * of its own here, and "no students in this batch" is a statement about the batch when
   * the truth was about the read.
   *
   * Not the notices read. Unread it says nobody has been told, so a family may hear the
   * result twice; withheld, the ones who have not heard at all would not be listed. The
   * cheaper mistake is the one that sends a message.
   */
  if (enrollments === null || results === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/exams"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="text-xl font-bold text-ink">{exam.title}</h1>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.sheetUnreadable}</p>
        </Card>
      </div>
    )
  }

  const saved = new Map(
    results.map((r) => [
      r.enrollment_id,
      {
        // Number() drops the trailing .00 that Postgres numerics arrive with,
        // so a teacher sees the 45 they typed rather than 45.00.
        value: r.is_absent
          ? 'absent'
          : r.obtained_marks === null
            ? ''
            : String(Number(r.obtained_marks)),
        note: r.note ?? '',
      },
    ]),
  )

  const rows: MarksRow[] = enrollments
    .map((enrollment) => {
      const student = Array.isArray(enrollment.students)
        ? enrollment.students[0]
        : enrollment.students
      if (!student) return null
      const prior = saved.get(enrollment.id)
      return {
        enrollmentId: enrollment.id,
        name: student.name,
        studentCode: student.student_code,
        value: prior?.value ?? '',
        note: prior?.note ?? '',
      }
    })
    .filter((row): row is MarksRow => row !== null)
    // Same Bangla collation as the attendance roster, so a teacher reads both
    // screens in one order and can go down the two lists in parallel.
    .sort((a, b) => a.name.localeCompare(b.name, 'bn-BD'))

  // student_code by student id, for the notice list below. `planResultSms` answers
  // who may be told and what to say — not what the register calls them.
  const codes = new Map<string, string | null>()
  for (const enrollment of enrollments) {
    const student = Array.isArray(enrollment.students)
      ? enrollment.students[0]
      : enrollment.students
    if (student) codes.set(student.id, student.student_code)
  }

  // The same function the send action uses, so the count and cost shown here
  // are the count and cost that will actually be charged.
  const plan = await planResultSms(supabase, {
    centerId: session.active.centerId,
    centerName: session.active.centerName,
    examId: exam.id,
    rosterSize: rows.length,
  })

  // Owners and managers pay for the credits, so they may always spend them, and a
  // teacher can be denied either capability by the owner in settings. Two
  // questions, one memoised query, and the same two helpers the actions behind
  // both buttons call — so nothing here can offer a control that the action will
  // refuse.
  const [canSend, canMark] = await Promise.all([canSendSms(), canManageExams()])

  const batch = Array.isArray(exam.batches) ? exam.batches[0] : exam.batches
  const subject = Array.isArray(exam.subjects) ? exam.subjects[0] : exam.subjects
  const examType = Array.isArray(exam.exam_types) ? exam.exam_types[0] : exam.exam_types

  const subtitle = [batch?.name, localName(subject, locale), localName(examType, locale)]
    .filter(Boolean)
    .join(' · ')

  const first = plan?.recipients[0]

  // Every counted sentence on the gate, written here. The gate is a client
  // component and cannot call a dictionary function; see GateLines for why that
  // matters more in English than in Bangla.
  const recipientCount = plan?.recipients.length ?? 0
  const creditCost = plan?.creditCost ?? 0
  const balance = session.active.smsCreditBalance
  const skippedNoPhone = plan?.skippedNoPhone ?? 0
  const skippedOptedOut = plan?.skippedOptedOut ?? 0
  const withoutMarks = plan?.withoutMarks ?? rows.length
  const notesTrimmed = plan?.notesTrimmed ?? []

  /*
   * The list that can actually reach a parent tonight.
   *
   * The gate below spends credits, and no centre has any: the column defaults to
   * zero, every tier grants zero a month, and nothing in the product can top it up
   * — because there is no BTRC sender ID, so no aggregator, so no gateway. So the
   * gate has never sent anybody's marks to anybody, on any plan. This list is the
   * same answer fees and the weekly note already had: the message written out, the
   * owner's own phone, nothing metered. See result_notices.
   */
  const toldAt = new Map<string, string>()
  for (const notice of notices ?? []) {
    // Newest first out of the query, so the first row for a student is the latest
    // send and the rest are the times before it.
    if (!toldAt.has(notice.student_id)) {
      toldAt.set(notice.student_id, notice.created_at)
    }
  }

  const noticeRows: ResultRowView[] = (plan?.recipients ?? []).map((r) => {
    const told = toldAt.get(r.studentId)
    return {
      studentId: r.studentId,
      name: r.studentName,
      studentCode: codes.get(r.studentId) ?? null,
      phone: r.phone,
      smsBody: r.body,
      chatBody: r.chatBody,
      preferredChannel: r.preferredChannel,
      // An absence is a result and never a zero, the same call buildResultText
      // makes. The em dash is for a row with neither — a mark row saved blank,
      // which the sheet allows and the message describes as "no mark yet".
      fact: r.isAbsent
        ? d.resultNotices.absent
        : `${r.obtainedMarks ?? '—'}/${Number(exam.total_marks)}`,
      told: told ? t.toldOn(formatDate(todayInDhaka(new Date(told)), locale)) : null,
    }
  })

  // The same three counts the gate lists, for the same reason: a teacher looking
  // at a list of twelve names on a batch of forty needs to know where the other
  // twenty-eight went before they assume the screen is broken.
  const noticeNotes = [
    withoutMarks > 0 ? t.withoutMarksCount(withoutMarks) : null,
    skippedNoPhone > 0 ? t.noPhoneCount(skippedNoPhone) : null,
    skippedOptedOut > 0 ? t.optedOutCount(skippedOptedOut) : null,
  ].filter((line): line is string => line !== null)

  const providerLive = smsProviderConfigured()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/exams"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{exam.title}</h1>
        {subtitle && <p className="mt-0.5 text-ink-soft">{subtitle}</p>}
        <p className="mt-0.5 text-sm text-ink-faint">
          {formatDate(exam.exam_date, locale)} · {t.fullMarks}{' '}
          <span className="num">{Number(exam.total_marks)}</span>
          {exam.pass_marks !== null && (
            <>
              {' '}
              · {t.pass} <span className="num">{Number(exam.pass_marks)}</span>
            </>
          )}
        </p>

        {/* The way out of a mistyped exam, and deliberately quiet — the errand on this
            screen is entering marks, not correcting the heading. Gated on the same
            permission the edit screen and both its actions check, so a teacher without
            it is never offered a door that answers 403. */}
        {canMark && (
          <Link
            href={`/exams/${exam.id}/edit`}
            className="mt-1 inline-flex min-h-tap items-center text-sm font-medium
              text-brand-700"
          >
            {d.examEdit.title} →
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.noStudentsTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.noStudentsBody}</p>
        </Card>
      ) : (
        <>
          <MarksSheet
            examId={exam.id}
            totalMarks={Number(exam.total_marks)}
            passMarks={exam.pass_marks === null ? null : Number(exam.pass_marks)}
            rows={rows}
            locked={Boolean(exam.sms_sent_at)}
            readOnly={!canMark}
            t={d.marksSheet}
            common={d.common}
          />

          {/* Above the metered gate, because it is the one of the two that
              works. A teacher who has just saved forty marks wants the next
              thing under their thumb to be the first parent. */}
          {canSend &&
            (noticeRows.length > 0 ? (
              <ResultNotices
                examId={exam.id}
                rows={noticeRows}
                notes={noticeNotes}
                words={{
                  t: d.resultNotices,
                  list: d.chaseList,
                  chase: d.chase,
                  channels: d.channels,
                }}
              />
            ) : (
              <Card>
                <h2 className="font-semibold text-ink">{d.resultNotices.title}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {withoutMarks > 0
                    ? d.resultNotices.saveMarksFirst
                    : d.resultNotices.noNumbers}
                </p>
                {skippedNoPhone > 0 && (
                  <p className="num mt-2 text-sm text-ink-faint">
                    {t.noPhoneCount(skippedNoPhone)}
                  </p>
                )}
              </Card>
            ))}

          {/* The metered queue, now only when it can do something: a gateway is
              configured, or a send already happened and this is the record of
              it, or the reader has no permission and this is where that is said.
              Drawn unconditionally before, which meant every exam page carried a
              send button that arithmetic guaranteed was disabled, under a red
              line about credits no screen in the product can sell. */}
          {(providerLive || exam.sms_sent_at || !canSend) && (
            <SmsGate
              examId={exam.id}
              recipientCount={recipientCount}
              creditCost={creditCost}
              balance={balance}
              preview={
                first
                  ? {
                      heading: t.previewFor(first.studentName),
                      body: first.body,
                      segmentNote: `${t.segments(first.segments)} · ${
                        d.smsGate.perPersonNote
                      }`,
                    }
                  : null
              }
              skippedOptedOut={skippedOptedOut}
              skippedNoPhone={skippedNoPhone}
              withoutMarks={withoutMarks}
              notesTrimmed={notesTrimmed.length}
              anyMultiSegment={plan?.anyMultiSegment ?? false}
              alreadySentAt={exam.sms_sent_at}
              declinedAt={exam.sms_declined_at}
              providerLive={providerLive}
              canSend={canSend}
              t={d.smsGate}
              common={d.common}
              lines={{
                recipients: t.recipients(recipientCount),
                cost: t.credits(creditCost),
                balance: t.balanceNow(balance),
                shortfall: t.shortfall(creditCost - balance),
                withoutMarks: t.withoutMarksCount(withoutMarks),
                noPhone: t.noPhoneCount(skippedNoPhone),
                optedOut: t.optedOutCount(skippedOptedOut),
                notesTrimmed: t.notesTrimmedCount(
                  notesTrimmed.length,
                  // Every name, not the first few. The list is as long as the
                  // number of notes a teacher wrote that morning, and truncating
                  // it would hide the very student they need to go back to.
                  notesTrimmed.join(', '),
                ),
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
