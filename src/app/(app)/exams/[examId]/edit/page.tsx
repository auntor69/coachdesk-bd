import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { pageRole, getSession, canManageExams } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { deleteVerdict } from '@/lib/exams/edit'
import { readExamFacts } from '@/lib/exams/facts'
import { EditExamForm, RemoveExam } from './edit-exam'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).examEdit.title} — CoachDesk` }
}

/**
 * Undoing a mistyped exam.
 *
 * The screen exists because the insert used to be the only write an exam had. A
 * teacher creates one on a phone, between two batches, from four fields — so the
 * total says 50 for a paper out of 100, the title says "Model Test 1" when it was the
 * second, and a tap that did not look like it worked creates the whole thing twice.
 * The duplicate then sat on the list for ever showing "0/28 marked", putting an amber
 * line on that teacher's own to-do list every day for a test nobody sat, and a wrong
 * total quietly re-based every percentage the product computes from it.
 *
 * WHAT IS DRAWN DEPENDS ON WHAT IS ALREADY THERE, and that is the whole design. An
 * exam nobody has touched is four editable fields and a delete link. Add marks and the
 * total gains a floor; add a tap-through notice and the delete link explains itself
 * instead of working; send the metered SMS and the two figures freeze while the name
 * and the date stay editable. Every one of those sentences comes from
 * `deleteVerdict`/`figuresVerdict`, which the Server Actions call again — the screen is
 * not allowed to be the only thing that knows.
 *
 * THE BATCH IS A LINE OF TEXT AND NOT A FIELD. Marks are keyed by enrolment and an
 * enrolment belongs to a batch, so moving the exam would leave every mark on it
 * describing a child who was never in the room. There is no honest repair for that, so
 * the line says what the batch is and that it cannot change.
 */
export default async function EditExamPage({
  params,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  params: Promise<{ examId: string }>
}) {
  const { examId } = await params
  const session = await pageRole('teacher')

  // The owner's "Exams & marks" tick, and a 403 rather than a form that would fail on
  // submit — the same gate /exams/new has, reached by the same bookmarks and typed
  // URLs. An owner or manager is never asked; see canManageExams.
  if (!(await canManageExams())) forbidden()

  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.examEdit

  // RLS decides visibility, and a miss is a 404 rather than a 403 — so the URL cannot
  // be used to find out which exam ids exist in other centres. Same call as the exam
  // page's own.
  const { data: exam } = await supabase
    .from('exams')
    .select(
      `id, title, exam_type_id, total_marks, pass_marks, exam_date, sms_sent_at,
       batches (name), subjects (name, name_bn)`,
    )
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examId)
    .maybeSingle()

  if (!exam) notFound()

  const [{ data: examTypes }, facts] = await Promise.all([
    supabase
      .from('exam_types')
      .select('id, name, name_bn')
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    // The same reader the actions use, so the notes below and the refusals behind the
    // buttons are built from one count rather than two that can disagree.
    readExamFacts(
      supabase,
      session.active.centerId,
      exam.id,
      Boolean(exam.sms_sent_at),
    ),
  ])

  const batch = Array.isArray(exam.batches) ? exam.batches[0] : exam.batches
  const subject = Array.isArray(exam.subjects) ? exam.subjects[0] : exam.subjects
  const batchLabel = [batch?.name, localName(subject, locale)].filter(Boolean).join(' · ')

  /*
   * The lines describing what is already on this exam, in the order they constrain
   * what the form can do: how many marks, the floor they put under the total, who was
   * told by hand, and whether the figures are frozen outright.
   *
   * Built here rather than in the form because every one of them counts something, and
   * a client component cannot call a dictionary function — see GateLines.
   *
   * `facts` is null when a count did not run. Nothing is claimed in that case: no note
   * says "0 marks entered" about a sheet that was never read, the figures are treated
   * as frozen so the form cannot re-base a total against a floor nobody knows, and the
   * delete panel refuses in the actions' own words. Both actions re-count anyway.
   */
  const notes: string[] = []
  if (facts) {
    if (facts.markCount > 0) notes.push(t.marked(facts.markCount))
    if (facts.highestMark !== null) notes.push(t.highest(facts.highestMark))
    if (facts.noticeCount > 0) notes.push(t.told(facts.noticeCount))
    if (facts.smsSent) notes.push(t.frozen)
  } else {
    notes.push(d.exams.errors.checkFailed)
  }

  /**
   * Why the delete link will refuse, or null when it will not.
   *
   * The action's own sentence, so the panel explains a refusal in the words that
   * would have refused it. A `switch` and not a ternary chain, and 'ok' written out
   * rather than left to a default: that is what makes a fifth `DeleteVerdict` a type
   * error here instead of a button that quietly starts working.
   */
  function refusal(): string | null {
    if (!facts) return d.exams.errors.checkFailed
    switch (deleteVerdict(facts)) {
      case 'sent':
        return d.exams.errors.deleteSent
      case 'told':
        return d.exams.errors.deleteTold(facts.noticeCount)
      case 'marked':
        return d.exams.errors.deleteMarked(facts.markCount)
      case 'ok':
        return null
    }
  }

  const blockedReason = refusal()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href={`/exams/${exam.id}`}
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.back}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.lead}</p>
      </div>

      {/* The one thing on this screen that is a fact rather than a field, with the
          reason underneath it. Above the form, because a teacher who opened this page
          to move a physics test off the maths batch needs to read it before they start
          re-typing anything else. */}
      <Card>
        <p className="font-medium text-ink">{t.onBatch(batchLabel)}</p>
        <p className="mt-1 text-sm text-ink-soft">{t.cannotMove}</p>
      </Card>

      {notes.length > 0 && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="text-sm font-medium text-brand-800">{t.dependsTitle}</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-brand-900">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
      )}

      <EditExamForm
        examId={exam.id}
        examTypes={(examTypes ?? []).map((type) => ({
          id: type.id,
          label: localName(type, locale),
        }))}
        current={{
          title: exam.title,
          examTypeId: exam.exam_type_id ?? '',
          // Number(), so a teacher sees the 100 they typed and not 100.00 — numerics
          // arrive from PostgREST with their scale intact.
          totalMarks: Number(exam.total_marks),
          passMarks: exam.pass_marks === null ? '' : String(Number(exam.pass_marks)),
          examDate: exam.exam_date,
        }}
        frozen={!facts || facts.smsSent}
        t={d.examEditForm}
        form={d.examForm}
        common={d.common}
      />

      <RemoveExam
        examId={exam.id}
        blockedReason={blockedReason}
        t={d.examEditForm}
      />
    </div>
  )
}
