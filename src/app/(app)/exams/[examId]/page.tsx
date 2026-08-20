import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/bd/time'
import { planResultSms } from '@/lib/sms/result-dispatch'
import { smsProviderConfigured } from '@/lib/sms/provider'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { MarksSheet, type MarksRow } from './marks-sheet'
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

  const [{ data: enrollments }, { data: results }] = await Promise.all([
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
  ])

  const saved = new Map(
    (results ?? []).map((r) => [
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

  const rows: MarksRow[] = (enrollments ?? [])
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

  // The same function the send action uses, so the count and cost shown here
  // are the count and cost that will actually be charged.
  const plan = await planResultSms(supabase, {
    centerId: session.active.centerId,
    centerName: session.active.centerName,
    examId: exam.id,
    rosterSize: rows.length,
  })

  // Owners and managers pay for the credits, so they may always spend them. A
  // teacher can be denied by the owner in settings.
  let canSend = true
  if (session.active.role === 'teacher') {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('id, teacher_permissions (can_send_sms)')
      .eq('user_id', session.userId)
      .eq('coaching_center_id', session.active.centerId)
      .maybeSingle()

    const perms = Array.isArray(teacher?.teacher_permissions)
      ? teacher?.teacher_permissions[0]
      : teacher?.teacher_permissions
    // No permission row means nothing has been restricted yet.
    if (perms && perms.can_send_sms === false) canSend = false
  }

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
            t={d.marksSheet}
            common={d.common}
          />

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
            providerLive={smsProviderConfigured()}
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
        </>
      )}
    </div>
  )
}
