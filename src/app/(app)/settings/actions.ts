'use server'

/**
 * Everything an owner can configure.
 *
 * Each action re-derives the caller and re-checks the plan limit, because a
 * Server Action is a public endpoint and the button that called it is not a
 * permission. The plan check in particular has to live here: a client that
 * hides the "add batch" button is a courtesy, not a cap.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireRole, AuthError, type CenterSession } from '@/lib/auth/session'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { wouldExceed, type LimitKey } from '@/lib/plans'
import type { BatchSlot, SubjectKind } from '@/lib/supabase/types'

export type ActionState = { error?: string; ok?: string } | null

/** Long enough for a real Bangla name, short enough to keep a list readable. */
const MAX_NAME = 80

/**
 * requireRole throws for a signed-out or under-privileged caller. Every action
 * here wants the same Bangla message rather than a stack trace, so the throw is
 * converted once.
 */
async function staffAdmin(): Promise<CenterSession | ActionState> {
  try {
    return await requireRole('manager')
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: 'এই কাজটি শুধু মালিক বা ম্যানেজার করতে পারেন।' }
    }
    throw err
  }
}

function isSession(value: CenterSession | ActionState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Counts the rows that a plan limit applies to, then refuses if one more would
 * exceed it. `active`/`status` filters matter: a deactivated batch should not
 * hold a slot hostage on the one-batch free plan.
 */
async function overLimit(
  session: CenterSession,
  table: 'batches' | 'students' | 'teachers' | 'subjects',
  key: LimitKey,
): Promise<boolean> {
  const supabase = await createClient()
  const centerId = session.active.centerId
  const head = { count: 'exact' as const, head: true }

  // Built per table rather than through one shared builder: the generated
  // Supabase types narrow column names to whichever table is named, so a union
  // `from(table)` only admits the columns all four share — which excludes the
  // two we filter on.
  const { count } =
    table === 'students'
      ? await supabase
          .from('students')
          .select('id', head)
          .eq('coaching_center_id', centerId)
          .eq('status', 'active')
      : table === 'batches'
        ? await supabase
            .from('batches')
            .select('id', head)
            .eq('coaching_center_id', centerId)
            .eq('active', true)
        : table === 'teachers'
          ? await supabase
              .from('teachers')
              .select('id', head)
              .eq('coaching_center_id', centerId)
              .eq('active', true)
          : await supabase
              .from('subjects')
              .select('id', head)
              .eq('coaching_center_id', centerId)
              .eq('active', true)

  return wouldExceed(session.plan, key, count ?? 0)
}

const LIMIT_MESSAGE =
  'ফ্রি প্ল্যানের সীমা শেষ। আরও যোগ করতে প্ল্যান বদলাতে হবে — সব ফিচার খোলা থাকবে।'

export async function createSubject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const name = String(formData.get('name') ?? '').trim()
  const nameBn = String(formData.get('nameBn') ?? '').trim()
  const kind = String(formData.get('kind') ?? 'academic') as SubjectKind

  if (!name) return { error: 'বিষয়ের নাম লিখুন।' }
  if (name.length > MAX_NAME) return { error: `নাম ${MAX_NAME} অক্ষরের মধ্যে রাখুন।` }

  if (await overLimit(session, 'subjects', 'maxSubjects')) {
    return { error: LIMIT_MESSAGE }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('subjects').insert({
    coaching_center_id: session.active.centerId,
    name,
    name_bn: nameBn || null,
    subject_kind: kind,
  })

  if (error) {
    // The unique index on (center, name) is the only realistic failure, and
    // "you already have this" is more useful than a database string.
    if (error.code === '23505') return { error: 'এই নামে বিষয় আগেই আছে।' }
    return { error: 'যোগ করা যায়নি। আবার চেষ্টা করুন।' }
  }

  revalidatePath('/settings/subjects')
  return { ok: 'যোগ হয়েছে' }
}

export async function createExamType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const name = String(formData.get('name') ?? '').trim()
  const nameBn = String(formData.get('nameBn') ?? '').trim()

  if (!name) return { error: 'পরীক্ষার ধরনের নাম লিখুন।' }
  if (name.length > MAX_NAME) return { error: `নাম ${MAX_NAME} অক্ষরের মধ্যে রাখুন।` }

  const supabase = await createClient()
  const { error } = await supabase.from('exam_types').insert({
    coaching_center_id: session.active.centerId,
    name,
    name_bn: nameBn || null,
  })

  if (error) {
    if (error.code === '23505') return { error: 'এই নামে ধরন আগেই আছে।' }
    return { error: 'যোগ করা যায়নি। আবার চেষ্টা করুন।' }
  }

  revalidatePath('/settings/exam-types')
  return { ok: 'যোগ হয়েছে' }
}

/** Turns "07:30" into a Postgres time, or null. Rejects anything else. */
function parseTime(input: string): string | null {
  const value = input.trim()
  if (!/^\d{1,2}:\d{2}$/.test(value)) return null
  const [h, m] = value.split(':').map(Number)
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const SLOTS = new Set<BatchSlot>(['morning', 'noon', 'afternoon', 'evening', 'night'])

export async function createBatch(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const name = String(formData.get('name') ?? '').trim()
  const subjectId = String(formData.get('subjectId') ?? '')
  const teacherId = String(formData.get('teacherId') ?? '')
  const rawSlot = String(formData.get('slot') ?? '')
  const monthlyFee = Number(formData.get('monthlyFee') ?? 0)
  const startTime = parseTime(String(formData.get('startTime') ?? ''))
  const endTime = parseTime(String(formData.get('endTime') ?? ''))

  if (!name) return { error: 'ব্যাচের নাম লিখুন।' }
  if (name.length > MAX_NAME) return { error: `নাম ${MAX_NAME} অক্ষরের মধ্যে রাখুন।` }
  if (!subjectId) return { error: 'বিষয় বাছুন।' }
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
    return { error: 'মাসিক ফি ঠিকভাবে লিখুন।' }
  }
  // The database has the same check; catching it here gives a field-level
  // message instead of a generic failure.
  if (startTime && endTime && endTime <= startTime) {
    return { error: 'শেষের সময় শুরুর সময়ের পরে হতে হবে।' }
  }

  // Which days this batch meets. 0=Sunday, matching Postgres extract(dow) and
  // dhakaDayOfWeek(). No days means "every day", which is what a centre that
  // skips this step almost certainly means.
  const days = formData
    .getAll('days')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)

  // batch_schedules.start_time and end_time are NOT NULL, so a per-day schedule
  // is only meaningful with both. Checked here rather than left to the insert:
  // the batch would be created and the schedule silently dropped, which looks
  // exactly like a batch that meets every day.
  if (days.length > 0 && (!startTime || !endTime)) {
    return { error: 'কোন দিন ক্লাস তা বাছলে শুরু ও শেষের সময়ও দিতে হবে।' }
  }

  if (await overLimit(session, 'batches', 'maxBatches')) {
    return { error: LIMIT_MESSAGE }
  }

  const slot = SLOTS.has(rawSlot as BatchSlot) ? (rawSlot as BatchSlot) : null

  const supabase = await createClient()
  const { data: batch, error } = await supabase
    .from('batches')
    .insert({
      coaching_center_id: session.active.centerId,
      subject_id: subjectId,
      teacher_id: teacherId || null,
      name,
      slot,
      start_time: startTime,
      end_time: endTime,
      monthly_fee_bdt: monthlyFee,
    })
    .select('id')
    .single()

  if (error || !batch) {
    if (error?.code === '23505') return { error: 'এই নামে ব্যাচ আগেই আছে।' }
    return { error: 'তৈরি করা যায়নি। আবার চেষ্টা করুন।' }
  }

  // Which days this batch meets, validated above.
  if (days.length > 0 && startTime && endTime) {
    const { error: scheduleError } = await supabase.from('batch_schedules').insert(
      days.map((day) => ({
        coaching_center_id: session.active.centerId,
        batch_id: batch.id,
        day_of_week: day,
        start_time: startTime,
        end_time: endTime,
      })),
    )

    // The batch exists either way. Say so rather than reporting a clean success
    // the teacher would only disprove tomorrow, when the batch fails to appear.
    if (scheduleError) {
      return {
        error:
          'ব্যাচ তৈরি হয়েছে, কিন্তু ক্লাসের দিন সেভ হয়নি। সেটিংস থেকে ঠিক করুন।',
      }
    }
  }

  revalidatePath('/settings/batches')
  revalidatePath('/teach')
  return { ok: 'ব্যাচ তৈরি হয়েছে' }
}

export async function createStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const name = String(formData.get('name') ?? '').trim()
  const batchIds = formData.getAll('batchIds').map(String).filter(Boolean)
  const rawGuardianPhone = String(formData.get('guardianPhone') ?? '')
  const guardianName = String(formData.get('guardianName') ?? '').trim()
  const rawStudentPhone = String(formData.get('phone') ?? '')
  const institution = String(formData.get('institution') ?? '').trim()
  const classLevel = String(formData.get('classLevel') ?? '').trim()
  const studentCode = String(formData.get('studentCode') ?? '').trim()

  if (!name) return { error: 'শিক্ষার্থীর নাম লিখুন।' }
  if (name.length > MAX_NAME) return { error: `নাম ${MAX_NAME} অক্ষরের মধ্যে রাখুন।` }

  // The guardian's number is the product's whole delivery channel — results and
  // fee reminders go there. Required, and validated as a real BD mobile rather
  // than accepted as free text, because a typo here is silent: the SMS just
  // never arrives and nobody finds out for a month.
  const guardianPhone = normalizeBdMobile(rawGuardianPhone)
  if (!guardianPhone) {
    return { error: 'অভিভাবকের সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।' }
  }

  const studentPhone = rawStudentPhone.trim()
    ? normalizeBdMobile(rawStudentPhone)
    : null
  if (rawStudentPhone.trim() && !studentPhone) {
    return { error: 'শিক্ষার্থীর নম্বরটি ঠিক নেই।' }
  }

  if (await overLimit(session, 'students', 'maxStudents')) {
    return { error: LIMIT_MESSAGE }
  }

  const supabase = await createClient()

  const { data: student, error } = await supabase
    .from('students')
    .insert({
      coaching_center_id: session.active.centerId,
      name,
      student_code: studentCode || null,
      phone: studentPhone,
      guardian_name: guardianName || null,
      guardian_phone: guardianPhone,
      institution: institution || null,
      class_level: classLevel || null,
    })
    .select('id')
    .single()

  if (error || !student) {
    if (error?.code === '23505') return { error: 'এই আইডিতে শিক্ষার্থী আগেই আছে।' }
    return { error: 'যোগ করা যায়নি। আবার চেষ্টা করুন।' }
  }

  // The guardian row is what the SMS sender reads. students.guardian_phone is
  // kept in step for display, so a roster never has to join to show a number.
  await supabase.from('guardians').insert({
    coaching_center_id: session.active.centerId,
    student_id: student.id,
    name: guardianName || null,
    phone: guardianPhone,
    is_primary: true,
  })

  if (batchIds.length > 0) {
    // Each batch carries its own subject, so an enrollment needs the batch's
    // subject rather than a separately chosen one — otherwise a student can be
    // enrolled in a maths batch under the physics subject and the marks screen
    // quietly shows the wrong list.
    const { data: batches } = await supabase
      .from('batches')
      .select('id, subject_id')
      .in('id', batchIds)

    if (batches && batches.length > 0) {
      await supabase.from('enrollments').insert(
        batches.map((b) => ({
          coaching_center_id: session.active.centerId,
          student_id: student.id,
          subject_id: b.subject_id,
          batch_id: b.id,
        })),
      )
    }
  }

  revalidatePath('/settings/students')
  revalidatePath('/teach')
  revalidatePath('/dashboard')
  return { ok: 'শিক্ষার্থী যোগ হয়েছে' }
}

/**
 * The owner's SMS kill switch for one student. Guardians can be opted out for
 * a hundred reasons — a wrong number, a parent who asked, a student who left —
 * and the centre must be able to stop messages without deleting records.
 */
export async function toggleSmsOptOut(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const studentId = String(formData.get('studentId') ?? '')
  const optOut = String(formData.get('optOut') ?? '') === 'true'
  if (!studentId) return { error: 'শিক্ষার্থী পাওয়া যায়নি।' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('students')
    .update({ sms_opt_out: optOut })
    .eq('id', studentId)

  if (error) return { error: 'বদলানো যায়নি। আবার চেষ্টা করুন।' }

  revalidatePath('/settings/sms')
  revalidatePath('/settings/students')
  return { ok: optOut ? 'SMS বন্ধ করা হয়েছে' : 'SMS চালু করা হয়েছে' }
}
