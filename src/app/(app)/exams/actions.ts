'use server'

/**
 * Exams, marks, and the one action in this product that spends real money.
 *
 * Sending result SMS is the only irreversible thing a teacher can do here: a
 * message delivered to 40 parents cannot be recalled, and each one costs the
 * centre credits it paid for. So the send is deliberately not a side effect of
 * saving marks — marks save on their own, and the send is a separate, explicit
 * decision made on a screen that shows the recipient count and the exact cost
 * first. Everything below exists to make that boundary hold even if someone
 * calls these endpoints directly.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  requireRole,
  getSession,
  canManageExams,
  canSendSms,
  myTeacherIds,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { todayInDhaka } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import {
  deleteVerdict,
  figuresVerdict,
} from '@/lib/exams/edit'
import { readExamFacts } from '@/lib/exams/facts'
import { planResultSms } from '@/lib/sms/result-dispatch'
import type { OutreachChannel } from '@/lib/supabase/types'
import { MAX_NAME, MAX_NOTE, clamp } from '@/lib/limits'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { nameTooLong } from '@/lib/i18n/messages'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Who is calling, or why not — and in their own language.
 *
 * A union rather than "a session or an error object" with a type guard, because
 * the guard had no way to prove the error string existed and every caller ended
 * in `session?.error ?? 'no permission'`: a fallback that could not be reached
 * and would still have needed translating.
 */
type Caller =
  | { ok: true; session: CenterSession }
  | { ok: false; error: string }

async function teacherOrAbove(): Promise<Caller> {
  try {
    return { ok: true, session: await requireRole('teacher') }
  } catch (err) {
    if (err instanceof AuthError) {
      // getSession is memoised per request and requireRole above already called
      // it, so reading the caller's language back costs nothing. A signed-out
      // caller has no language at all, hence the default.
      const caller = await getSession()
      return {
        ok: false,
        error: dict(caller?.locale ?? DEFAULT_LOCALE).exams.errors.forbidden,
      }
    }
    throw err
  }
}

export type CreateExamState =
  | { ok: true; examId: string }
  | { ok: false; error: string }
  | null

export async function createExam(
  _prev: CreateExamState,
  formData: FormData,
): Promise<CreateExamState> {
  const caller = await teacherOrAbove()
  if (!caller.ok) return { ok: false, error: caller.error }
  const { session } = caller
  const t = dict(session.locale).exams

  // The owner's "Exams & marks" checkbox, checked here and not only by the policy.
  // exams_teacher_insert would reject this on its own — an INSERT that fails a
  // `with check` is an error, so that path at least reports *something* — but what
  // it reports is `createFailed`, which tells a teacher to try again at a thing
  // that will never work. See saveMarks for the case where the policy alone says
  // nothing at all.
  if (!(await canManageExams())) {
    return { ok: false, error: t.errors.noExamPermission }
  }

  const title = String(formData.get('title') ?? '').trim()
  const batchId = String(formData.get('batchId') ?? '')
  const examTypeId = String(formData.get('examTypeId') ?? '')
  const totalMarks = Number(formData.get('totalMarks') ?? 0)
  const rawPassMarks = String(formData.get('passMarks') ?? '').trim()
  const rawDate = String(formData.get('examDate') ?? '')

  if (!title) return { ok: false, error: t.errors.nameRequired }
  if (title.length > MAX_NAME) {
    return { ok: false, error: nameTooLong(session.locale) }
  }
  if (!batchId) return { ok: false, error: t.errors.pickBatch }

  if (!Number.isFinite(totalMarks) || totalMarks <= 0) {
    return { ok: false, error: t.errors.totalUnreadable }
  }
  if (totalMarks > 1000) {
    return { ok: false, error: t.errors.totalTooBig }
  }

  const passMarks = rawPassMarks === '' ? null : Number(rawPassMarks)
  if (passMarks !== null && (!Number.isFinite(passMarks) || passMarks < 0)) {
    return { ok: false, error: t.errors.passUnreadable }
  }
  // The database has the same check. Catching it here gives a field-level
  // message rather than a constraint name.
  if (passMarks !== null && passMarks > totalMarks) {
    return { ok: false, error: t.errors.passOverTotal }
  }

  // A future exam date is allowed — centres create next week's test in advance —
  // but a garbled one becomes today rather than failing the insert.
  const examDate = DATE_RE.test(rawDate) ? rawDate : todayInDhaka()

  const supabase = await createClient()

  // The subject comes from the batch, never from the form. A batch teaches one
  // subject; letting the client name a different one would put a physics exam
  // on a maths batch and quietly show the wrong roster on the marks sheet.
  //
  // batchId arrives in a FormData, and an owner of two centres passes RLS for
  // both — so the centre filter is what turns "some batch I can see" into "a
  // batch on the screen this form was submitted from". Without it the insert
  // below pairs this centre's exam with the other centre's batch, which the
  // composite foreign key rejects as a constraint error nobody can read.
  const { data: batch } = await supabase
    .from('batches')
    .select('id, subject_id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', batchId)
    .maybeSingle()

  if (!batch) return { ok: false, error: t.errors.noBatch }

  const { data: exam, error } = await supabase
    .from('exams')
    .insert({
      coaching_center_id: session.active.centerId,
      batch_id: batch.id,
      subject_id: batch.subject_id,
      // Whose exam this is. The shared helper answers with a list because
      // `teachers` has no unique key on (centre, user); the first is taken because
      // this column holds one id, and for a centre that entered the same person
      // twice there is no better answer than either of their rows. Null for an
      // owner or manager who holds no teacher row at all.
      teacher_id: (await myTeacherIds())[0] ?? null,
      exam_type_id: examTypeId || null,
      title,
      total_marks: totalMarks,
      pass_marks: passMarks,
      exam_date: examDate,
      created_by: session.userId,
    })
    .select('id')
    .single()

  if (error || !exam) {
    return { ok: false, error: t.errors.createFailed }
  }

  revalidatePath('/exams')
  return { ok: true, examId: exam.id }
}

export type SaveMarksState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

type SubmittedMark = {
  enrollmentId: string
  /** null with isAbsent false means "the teacher cleared this field". */
  marks: number | null
  isAbsent: boolean
  note: string | null
}

/**
 * Saves the whole sheet in one call, and only the marks — never an SMS.
 *
 * Keeping the send out of here is the entire point of the two-step design. If
 * this action also messaged parents, every correction to a typo would charge the
 * centre again and contradict the message already delivered.
 */
export async function saveMarks(
  _prev: SaveMarksState,
  formData: FormData,
): Promise<SaveMarksState> {
  const caller = await teacherOrAbove()
  if (!caller.ok) return { ok: false, error: caller.error }
  const { session } = caller
  const t = dict(session.locale).exams

  // The check that cannot be left to the policy.
  //
  // Clearing a mark is a DELETE, and a DELETE that matches no policy removes zero
  // rows and raises nothing — supabase-js hands back `error: null`. So without
  // this, a teacher whose permission had just been taken away would blank a wrong
  // mark, read "Marks saved", and leave the old number sitting in the row that the
  // result SMS reads. The upsert half would have failed loudly; the erase half is
  // silent, and it is the half that matters most.
  if (!(await canManageExams())) {
    return { ok: false, error: t.errors.noExamPermission }
  }

  const examId = String(formData.get('examId') ?? '')
  if (!examId) return { ok: false, error: t.errors.noExam }

  const supabase = await createClient()

  // RLS decides whether this teacher may touch this exam at all; the centre
  // filter decides which of their centres this sheet belongs to. Both are
  // needed — a teacher at two centres passes the policy for either one's exams.
  const { data: exam } = await supabase
    .from('exams')
    .select('id, batch_id, total_marks')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examId)
    .maybeSingle()

  if (!exam) return { ok: false, error: t.errors.noExam }

  const total = Number(exam.total_marks)

  // Which enrollments are genuinely on this batch's roster. A forged id from
  // another batch is dropped rather than written — the same guard the
  // attendance action uses, for the same reason.
  const { data: enrollments, error: rosterError } = await supabase
    .from('enrollments')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('batch_id', exam.batch_id)
    .eq('status', 'active')

  if (rosterError) return { ok: false, error: t.errors.rosterUnreadable }
  const validIds = new Set((enrollments ?? []).map((row) => row.id))

  const submitted: SubmittedMark[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('mark:')) continue
    const enrollmentId = key.slice('mark:'.length)
    if (!validIds.has(enrollmentId)) continue

    const raw = String(value).trim()
    // Clamped, not refused. The sheet's own field stops at MAX_NOTE, so a
    // longer one came from something other than the sheet — and this string is
    // read twice more, on /me and inside the result SMS.
    const note = clamp(
      String(formData.get(`note:${enrollmentId}`) ?? '').trim(),
      MAX_NOTE,
    )

    if (raw === 'absent') {
      submitted.push({ enrollmentId, marks: null, isAbsent: true, note: note || null })
      continue
    }
    if (raw === '') {
      submitted.push({ enrollmentId, marks: null, isAbsent: false, note: note || null })
      continue
    }

    const marks = Number(raw)
    if (!Number.isFinite(marks) || marks < 0) {
      return { ok: false, error: t.errors.marksNegative }
    }
    // A trigger enforces this too, but a trigger failure aborts the whole sheet
    // with a database message. Named here, the teacher knows which cap they hit.
    if (marks > total) {
      return { ok: false, error: t.errors.marksOverTotal(total) }
    }

    submitted.push({ enrollmentId, marks, isAbsent: false, note: note || null })
  }

  if (submitted.length === 0) {
    return { ok: false, error: t.errors.noStudents }
  }

  const toWrite = submitted.filter((m) => m.isAbsent || m.marks !== null)
  // A blanked field is a deliberate erase, not "leave it as it was". Honouring
  // it matters because the SMS gate reads these rows: a stale mark left behind
  // after a correction is a wrong number delivered to a parent's phone.
  const toClear = submitted.filter((m) => !m.isAbsent && m.marks === null)

  if (toWrite.length > 0) {
    const { error } = await supabase.from('exam_results').upsert(
      toWrite.map((m) => ({
        coaching_center_id: session.active.centerId,
        exam_id: exam.id,
        enrollment_id: m.enrollmentId,
        obtained_marks: m.isAbsent ? null : m.marks,
        is_absent: m.isAbsent,
        note: m.note,
        entered_by: session.userId,
      })),
      { onConflict: 'exam_id,enrollment_id' },
    )

    if (error) return { ok: false, error: t.errors.saveFailed }
  }

  if (toClear.length > 0) {
    await supabase
      .from('exam_results')
      .delete()
      .eq('coaching_center_id', session.active.centerId)
      .eq('exam_id', exam.id)
      .in(
        'enrollment_id',
        toClear.map((m) => m.enrollmentId),
      )
  }

  revalidatePath(`/exams/${exam.id}`)
  revalidatePath('/exams')

  // One finished sentence rather than two counts. English inflects on both of
  // them and the sheet is a client component, so it cannot be handed a
  // dictionary function to do it with — see `T` in lib/i18n.
  return {
    ok: true,
    message: t.marksSaved(
      toWrite.filter((m) => !m.isAbsent).length,
      toWrite.filter((m) => m.isAbsent).length,
    ),
  }
}

export type SmsGateState =
  | { ok: true; message: string }
  | { ok: true; declined: true }
  | { ok: false; error: string }
  | null

/**
 * The decline half of the gate.
 *
 * Recording "no" is not a no-op: without it the confirmation screen would ask
 * again every time anyone opened the exam, and a teacher who deliberately chose
 * not to message parents about a bad test would be nagged into it. It stays
 * reversible — the screen keeps offering the send afterwards.
 */
export async function declineResultSms(
  _prev: SmsGateState,
  formData: FormData,
): Promise<SmsGateState> {
  const caller = await teacherOrAbove()
  if (!caller.ok) return { ok: false, error: caller.error }
  const { session } = caller
  const t = dict(session.locale).exams

  const examId = String(formData.get('examId') ?? '')
  if (!examId) return { ok: false, error: t.errors.noExam }

  // A teacher who may not send may not silence either. Both halves of the gate
  // answer the same question — will parents hear about this test — and offering
  // "no" to someone who was never offered "yes" is a decision they do not have.
  if (!(await canSendSms())) {
    return { ok: false, error: t.errors.noSmsPermission }
  }

  const supabase = await createClient()

  // Read first, through the user's own client, so RLS decides which exam this is
  // allowed to be about. The write below goes through the admin client and would
  // otherwise trust a form field.
  //
  // The centre filter is on the read for the same reason it used to be on the
  // write: a teacher at two centres passes RLS for both, so without it this button
  // can silence the result SMS for an exam at the centre they are not looking at,
  // and the only symptom is parents who never hear about a test.
  const { data: exam } = await supabase
    .from('exams')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examId)
    .maybeSingle()

  if (!exam) return { ok: false, error: t.errors.noExam }

  // The admin client, and this is the change that makes the button work at all.
  // `sms_declined_at` is a column on `exams`, so the UPDATE used to be filtered by
  // exams_teacher_write — which 20260811000013 split into four policies and ANDed
  // the exam permission onto three of them. A teacher who may mark but may not
  // message would have reached an UPDATE that matched no policy: zero rows, no
  // error, `{ ok: true, declined: true }`, and the gate asking again on the next
  // page load. Deciding not to spend credits is not the same authority as entering
  // marks, so the check above is the boundary and this write is bookkeeping.
  const admin = createAdminClient()
  const { error } = await admin
    .from('exams')
    .update({ sms_declined_at: new Date().toISOString() })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', exam.id)

  if (error) return { ok: false, error: t.errors.declineFailed }

  revalidatePath(`/exams/${examId}`)
  revalidatePath('/exams')
  return { ok: true, declined: true }
}

/**
 * The send. The only place in this product that spends a centre's credits.
 *
 * Structured so that no failure path can charge without queueing or queue
 * without charging:
 *
 *   1. the dispatch row goes in first, and its unique (center, kind, ref_id)
 *      index is what makes a double-tap or a retried request impossible — the
 *      second insert fails rather than sending a second time;
 *   2. credits are debited by compare-and-swap, so two simultaneous sends
 *      cannot both read the same balance and both spend it;
 *   3. only then are the messages queued.
 *
 * Steps 1-3 use the service-role client because `sms_logs`, the ledger, and the
 * credit balance deliberately have no client-writable RLS policy — a browser
 * session must never be able to write its own billing records. Every query here
 * therefore filters by coaching_center_id by hand.
 */
export async function sendResultSms(
  _prev: SmsGateState,
  formData: FormData,
): Promise<SmsGateState> {
  const caller = await teacherOrAbove()
  if (!caller.ok) return { ok: false, error: caller.error }
  const { session } = caller
  const t = dict(session.locale).exams

  const examId = String(formData.get('examId') ?? '')
  if (!examId) return { ok: false, error: t.errors.noExam }

  // The user's own client, so RLS still decides which exam they may act on.
  const supabase = await createClient()
  const centerId = session.active.centerId

  // Filtered by centre, not only by the id in the form. This is the read the
  // whole money path hangs off: everything below charges `centerId`, so if the
  // exam came from the other centre a teacher belongs to, one centre's credits
  // would pay for the other centre's messages.
  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, batch_id, sms_sent_at')
    .eq('coaching_center_id', centerId)
    .eq('id', examId)
    .maybeSingle()

  if (!exam) return { ok: false, error: t.errors.noExam }

  if (exam.sms_sent_at) {
    return { ok: false, error: t.errors.alreadySent }
  }

  // A teacher may be denied SMS by the owner. Owners and managers always may —
  // they are the ones paying for the credits.
  //
  // This was its own query here and another on the exam screen, both reading
  // teacher_permissions with `maybeSingle()`, which would have thrown outright at a
  // centre that entered the same teacher twice. One helper now, memoised per
  // request, and it is the same one the screen uses to decide whether to draw the
  // button — so the gate and the door agree by construction.
  if (!(await canSendSms())) {
    return { ok: false, error: t.errors.noSmsPermission }
  }

  const { count: rosterSize } = await supabase
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('coaching_center_id', centerId)
    .eq('batch_id', exam.batch_id)
    .eq('status', 'active')

  const plan = await planResultSms(supabase, {
    centerId,
    centerName: session.active.centerName,
    examId: exam.id,
    rosterSize: rosterSize ?? 0,
  })

  if (!plan || plan.recipients.length === 0) {
    return { ok: false, error: t.errors.noRecipients }
  }

  const cost = plan.creditCost
  const admin = createAdminClient()

  // Read the balance through the admin client rather than trusting the session
  // copy, which was cached when the page was rendered.
  const { data: center } = await admin
    .from('coaching_centers')
    .select('sms_credit_balance')
    .eq('id', centerId)
    .maybeSingle()

  const balance = center?.sms_credit_balance ?? 0
  if (balance < cost) {
    return { ok: false, error: t.errors.creditsShort(cost, balance) }
  }

  // Step 1. The unique (coaching_center_id, kind, ref_id) index turns a double
  // submit into a duplicate-key error instead of a second charge.
  const { data: dispatch, error: dispatchError } = await admin
    .from('sms_dispatches')
    .insert({
      coaching_center_id: centerId,
      kind: 'exam_result',
      ref_id: exam.id,
      recipient_count: plan.recipients.length,
      segment_count: cost,
      credit_cost: cost,
      triggered_by: session.userId,
    })
    .select('id')
    .single()

  if (dispatchError || !dispatch) {
    if (dispatchError?.code === '23505') {
      return { ok: false, error: t.errors.alreadySent }
    }
    return { ok: false, error: t.errors.sendFailed }
  }

  // Step 2. Compare-and-swap on the balance we just read. If another send got
  // there first the row no longer matches, no rows update, and we back out
  // rather than overwriting their debit with ours.
  const { data: debited } = await admin
    .from('coaching_centers')
    .update({ sms_credit_balance: balance - cost })
    .eq('id', centerId)
    .eq('sms_credit_balance', balance)
    .select('sms_credit_balance')
    .maybeSingle()

  if (!debited) {
    await admin
      .from('sms_dispatches')
      .delete()
      .eq('coaching_center_id', centerId)
      .eq('id', dispatch.id)
    return { ok: false, error: t.errors.creditRace }
  }

  await admin.from('sms_credit_ledger').insert({
    coaching_center_id: centerId,
    delta: -cost,
    reason: `exam_result:${exam.id}`,
    dispatch_id: dispatch.id,
    balance_after: debited.sms_credit_balance,
    created_by: session.userId,
  })

  // Step 3. Queued, not sent. A worker delivers these and moves them to 'sent'
  // or 'failed'; nothing here claims a message reached a handset.
  const { error: logError } = await admin.from('sms_logs').insert(
    plan.recipients.map((r) => ({
      coaching_center_id: centerId,
      dispatch_id: dispatch.id,
      student_id: r.studentId,
      guardian_id: r.guardianId,
      to_phone: r.phone,
      kind: 'exam_result' as const,
      body: r.body,
      segments: r.segments,
      credit_cost: r.segments,
      status: 'queued' as const,
    })),
  )

  if (logError) {
    // The debit happened but nothing will ever be delivered, so give it back.
    // A centre that loses credits to our bug will not trust the counter again.
    const { data: refunded } = await admin
      .from('coaching_centers')
      .update({ sms_credit_balance: debited.sms_credit_balance + cost })
      .eq('id', centerId)
      .select('sms_credit_balance')
      .maybeSingle()

    await admin.from('sms_credit_ledger').insert({
      coaching_center_id: centerId,
      delta: cost,
      reason: `refund:exam_result:${exam.id}`,
      dispatch_id: dispatch.id,
      balance_after: refunded?.sms_credit_balance ?? balance,
      created_by: session.userId,
    })
    await admin
      .from('sms_dispatches')
      .delete()
      .eq('coaching_center_id', centerId)
      .eq('id', dispatch.id)

    return { ok: false, error: t.errors.sendFailedRefunded }
  }

  await admin
    .from('exams')
    .update({ sms_sent_at: new Date().toISOString(), sms_sent_by: session.userId })
    .eq('id', exam.id)
    .eq('coaching_center_id', centerId)

  revalidatePath(`/exams/${exam.id}`)
  revalidatePath('/exams')
  revalidatePath('/settings/sms')

  return { ok: true, message: t.smsQueued(plan.recipients.length, cost) }
}

/* -------------------------------------------------------------------------- */
/* Telling one family, from the centre's own phone                            */
/* -------------------------------------------------------------------------- */

/**
 * The queue above is the only way this product could tell a parent about marks,
 * and it has never told anybody: `sms_credit_balance` defaults to 0, every tier
 * grants 0 a month, and no screen can top it up — so `creditCost > balance` is
 * true for every centre and the gate disables its own button. That is correct
 * behaviour for a metered send with no gateway behind it. It is not an answer for
 * a teacher who marked forty papers tonight.
 *
 * So results get the same second way out that fees and the weekly note already
 * have: a link that opens the owner's own SMS or WhatsApp app with the message
 * written, and a row here saying it happened. Costs nothing, needs no sender ID,
 * and works on the free tier — `manualMessaging` is true on every plan and always
 * will be. See supabase/migrations/20260811000032_result_notices.sql.
 */

/** The three ways somebody at the centre can reach a family from their handset. */
const NOTICE_CHANNELS = new Set<OutreachChannel>(['sms', 'whatsapp', 'call'])

/**
 * Longer than the WhatsApp text, which is the longest of the two messages.
 *
 * Capped because this string arrives from the browser. It is *not* rebuilt here
 * from the marks, for the reason `logFeeReminder` gives about its amount: the row
 * answers "what did I tell them", and a message regenerated at log time could
 * describe a mark that was corrected between the tap and the insert.
 */
const MAX_NOTICE_BODY = 1000

export type ResultNoticeLog = {
  examId: string
  studentId: string
  channel: OutreachChannel
  /** The guardian number the link was aimed at; null for anything unparseable. */
  toPhone?: string | null
  /** The exact text put in front of whoever tapped. Null for a call. */
  body?: string | null
}

/**
 * Records that one family was told about one exam.
 *
 * Called from a chip's tap handler and not a form, because the tap has to do two
 * things at once: hand the message to the phone's own SMS or WhatsApp app, and
 * leave a note that it happened. The link does the first; nothing here interferes
 * with it, and a failure here never blocks it.
 *
 * Re-verifies `canSendSms()` even though the page did. A Server Action is a public
 * HTTP endpoint, and the owner's "send SMS" tickbox is the one thing standing
 * between a teacher and forty families — a check that only lives on the screen in
 * front of it is not a check.
 *
 * Returns whether the row was written. The caller ticks the row only on true, so
 * the sheet never shows a tick it has no record of.
 */
export async function logResultNotice(
  input: ResultNoticeLog,
): Promise<{ logged: boolean }> {
  const caller = await teacherOrAbove()
  // The error string is deliberately dropped: there is no form here and no place
  // to put a sentence, so an unauthorised tap leaves the row unticked and that is
  // the whole of the feedback. teacherOrAbove is reused rather than inlining
  // requireRole so this file has one answer to "who may touch an exam".
  if (!caller.ok) return { logged: false }
  const { session } = caller

  if (!(await canSendSms())) return { logged: false }

  const examId = String(input?.examId ?? '')
  const studentId = String(input?.studentId ?? '')
  const channel = input?.channel
  if (!examId || !studentId || !NOTICE_CHANNELS.has(channel)) return { logged: false }

  const supabase = await createClient()

  // Both read back through the caller's own client, so RLS decides whether this
  // exam and this student are theirs at all. The composite foreign keys would
  // refuse a cross-tenant pair anyway; this turns that into a quiet no-op instead
  // of a 500 out of Postgres, and it is the only defence against a studentId
  // typed by hand into a fetch.
  const [{ data: exam }, { data: student }] = await Promise.all([
    supabase
      .from('exams')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', examId)
      .maybeSingle(),
    // No status filter, unlike logProgressUpdate. A student who left last month
    // still sat this paper and still has a mark on it, so they are on the sheet
    // and their guardian is owed the result — requiring `active` here would make
    // the chip tap, open the message, and silently record nothing.
    supabase
      .from('students')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', studentId)
      .maybeSingle(),
  ])

  if (!exam?.id || !student?.id) return { logged: false }

  const body = String(input?.body ?? '').slice(0, MAX_NOTICE_BODY)

  const { error } = await supabase.from('result_notices').insert({
    coaching_center_id: session.active.centerId,
    exam_id: exam.id,
    student_id: student.id,
    channel,
    // Normalised so the column keeps the one meaning it is documented to have.
    // Null rather than the raw string when it will not parse: a record saying the
    // message went to "01712-34" is worse than one admitting it does not know.
    to_phone: normalizeBdMobile(input?.toPhone),
    body: body || null,
    sent_by: session.userId,
  })

  if (error) return { logged: false }

  revalidatePath(`/exams/${exam.id}`)

  return { logged: true }
}

/**
 * Correcting an exam created wrong, and removing one that should not exist.
 *
 * The insert used to be the only write path an exam had. A teacher creates one
 * standing between two batches, from four fields, on a phone — so the total is 50
 * for a paper out of 100, the title says "Model Test 1" when it was the second,
 * and the tap that did not look like it worked created the whole exam twice. None
 * of that could be undone: the wrong row sat on the list for ever showing
 * "0/28 marked", putting an amber line on a teacher's own to-do list every day
 * for a test that never happened, and a wrong total quietly turned every
 * percentage built from it — the marks sheet, the weekly note to a parent, the
 * at-risk signal, the printed report — into a different number.
 *
 * The rules are in lib/exams/edit.ts and not here, because the form has to say no
 * before a round trip and the delete panel must not offer a button that will be
 * refused. What is left for this file is counting the facts honestly.
 */
export type ExamEditState = { ok: true } | { ok: false; error: string } | null

/**
 * Changes the four things about an exam that can honestly be changed.

 *
 * Not the batch, and so not the subject. Marks are keyed by enrolment and an
 * enrolment belongs to a batch, so moving the exam would leave every mark on it
 * describing a child who was never in the room. The form does not draw the field
 * and this action does not read it — the way to fix a wrong batch is to create the
 * exam again on the right one.
 */
export async function updateExam(
  _prev: ExamEditState,
  formData: FormData,
): Promise<ExamEditState> {
  const caller = await teacherOrAbove()
  if (!caller.ok) return { ok: false, error: caller.error }
  const { session } = caller
  const t = dict(session.locale).exams

  // Re-checked here as in createExam, because this is a public HTTP endpoint and
  // the policy's own refusal arrives as `editFailed`: "try again" at a thing that
  // will never work.
  if (!(await canManageExams())) {
    return { ok: false, error: t.errors.noExamPermission }
  }

  const examId = String(formData.get('examId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const examTypeId = String(formData.get('examTypeId') ?? '')
  const totalMarks = Number(formData.get('totalMarks') ?? 0)
  const rawPassMarks = String(formData.get('passMarks') ?? '').trim()
  const rawDate = String(formData.get('examDate') ?? '')

  // The same order and the same words as createExam, so a figure refused on the
  // way in is refused identically on the way back.
  if (!examId) return { ok: false, error: t.errors.noExam }
  if (!title) return { ok: false, error: t.errors.nameRequired }
  if (title.length > MAX_NAME) {
    return { ok: false, error: nameTooLong(session.locale) }
  }
  if (!Number.isFinite(totalMarks) || totalMarks <= 0) {
    return { ok: false, error: t.errors.totalUnreadable }
  }
  if (totalMarks > 1000) return { ok: false, error: t.errors.totalTooBig }

  const passMarks = rawPassMarks === '' ? null : Number(rawPassMarks)
  if (passMarks !== null && (!Number.isFinite(passMarks) || passMarks < 0)) {
    return { ok: false, error: t.errors.passUnreadable }
  }
  if (passMarks !== null && passMarks > totalMarks) {
    return { ok: false, error: t.errors.passOverTotal }
  }

  // Refused rather than defaulted to today, which is where this parts company with
  // createExam. There the exam is new and today is a reasonable guess; here the row
  // already holds a date somebody may have got right, and a teacher fixing a
  // spelling would have the paper silently re-dated to the day they fixed it.
  if (!DATE_RE.test(rawDate)) return { ok: false, error: t.errors.dateRequired }
  const examDate = rawDate

  const supabase = await createClient()

  const { data: exam } = await supabase
    .from('exams')
    .select('id, total_marks, pass_marks, sms_sent_at')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examId)
    .maybeSingle()

  if (!exam) return { ok: false, error: t.errors.noExam }

  const facts = await readExamFacts(
    supabase,
    session.active.centerId,
    exam.id,
    Boolean(exam.sms_sent_at),
  )
  if (!facts) return { ok: false, error: t.errors.checkFailed }

  // numeric arrives as a string from PostgREST, so both sides of the comparison go
  // through Number() — otherwise an unchanged total reads as changed ('100' !== 100)
  // and every edit to a sent exam's title would be refused.
  const verdict = figuresVerdict(
    facts,
    {
      total: Number(exam.total_marks),
      pass: exam.pass_marks === null ? null : Number(exam.pass_marks),
    },
    { total: totalMarks, pass: passMarks },
  )

  if (verdict === 'sent') return { ok: false, error: t.errors.figuresSent }
  if (verdict === 'belowMark') {
    // The mark that produced the verdict, named: "cannot be lower than that" is
    // useless without the number the teacher has to look for on the sheet. It is
    // never null in this branch, and the fallback keeps that provable rather than
    // inventing a second refusal.
    return {
      ok: false,
      error: t.errors.totalBelowMark(facts.highestMark ?? totalMarks),
    }
  }

  // The kind is optional and "—" is a legal answer, so an id that is not one of this
  // centre's own becomes null instead of a message. The only way to submit one is by
  // hand, and left alone the composite foreign key would refuse the update as a
  // constraint name no reader can act on.
  let typeId: string | null = null
  if (examTypeId) {
    const { data: kind } = await supabase
      .from('exam_types')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', examTypeId)
      .maybeSingle()
    typeId = kind?.id ?? null
  }

  const { data: saved, error } = await supabase
    .from('exams')
    .update({
      title,
      exam_type_id: typeId,
      total_marks: totalMarks,
      pass_marks: passMarks,
      exam_date: examDate,
    })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', exam.id)
    .select('id')

  // Read back, for the reason saveMarks gives about its DELETE: an UPDATE that
  // matches no policy changes zero rows and hands back `error: null`. Without this a
  // teacher whose permission was withdrawn while the form was open would be told
  // "Saved" and walk away from a total that never moved.
  if (error || !saved || saved.length === 0) {
    return { ok: false, error: t.errors.editFailed }
  }

  revalidatePath('/exams')
  revalidatePath(`/exams/${exam.id}`)
  return { ok: true }
}

/**
 * Removes an exam nothing depends on yet, and refuses one anything does.
 *
 * The exam that needs this is the duplicate: one tap that did not look like it
 * worked, two rows on the list, and an amber "0/28 marked" line on a teacher's own
 * to-do list every day for a paper that was never sat. Nothing in the product could
 * clear it — marking it would be a lie and there was no other way out.
 *
 * What this never does is take a marks sheet with it. The verdict refuses while any
 * mark, any notice or a metered send exists, so no cascade can happen; the refusal
 * names the strongest reason and, for the common one, the way through — clear the
 * marks on the sheet, which the sheet already does.
 */
export async function deleteExam(
  _prev: ExamEditState,
  formData: FormData,
): Promise<ExamEditState> {
  const caller = await teacherOrAbove()
  if (!caller.ok) return { ok: false, error: caller.error }
  const { session } = caller
  const t = dict(session.locale).exams

  if (!(await canManageExams())) {
    return { ok: false, error: t.errors.noExamPermission }
  }

  const examId = String(formData.get('examId') ?? '')
  if (!examId) return { ok: false, error: t.errors.noExam }

  const supabase = await createClient()

  const { data: exam } = await supabase
    .from('exams')
    .select('id, sms_sent_at')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examId)
    .maybeSingle()

  if (!exam) return { ok: false, error: t.errors.noExam }

  const facts = await readExamFacts(
    supabase,
    session.active.centerId,
    exam.id,
    Boolean(exam.sms_sent_at),
  )
  if (!facts) return { ok: false, error: t.errors.checkFailed }

  // A switch and not an if-chain, so a fifth DeleteVerdict is a type error here
  // rather than an exam that silently deletes on a reason nobody wrote a sentence
  // for. 'ok' is written out for the same reason.
  switch (deleteVerdict(facts)) {
    case 'sent':
      return { ok: false, error: t.errors.deleteSent }
    case 'told':
      return { ok: false, error: t.errors.deleteTold(facts.noticeCount) }
    case 'marked':
      return { ok: false, error: t.errors.deleteMarked(facts.markCount) }
    case 'ok':
      break
  }

  const { data: gone, error } = await supabase
    .from('exams')
    .delete()
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', exam.id)
    .select('id')

  // Read back, because a DELETE matching no policy removes nothing and reports
  // nothing — the exact silence saveMarks documents. The caller navigates away on
  // ok, so a false ok would leave the exam sitting on the list it just claimed to
  // have cleared.
  if (error || !gone || gone.length === 0) {
    return { ok: false, error: t.errors.deleteFailed }
  }

  revalidatePath('/exams')
  return { ok: true }
}
