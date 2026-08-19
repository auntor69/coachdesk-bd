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
import { createAdminClient } from '@/lib/supabase/admin'
import {
  requireRole,
  getSession,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { normalizeBdMobile, phoneToLoginEmail } from '@/lib/bd/phone'
import {
  MAX_IMPORT_ROWS,
  parseRoster,
  readyRows,
  rosterKey,
} from '@/lib/bd/roster'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { MAX_NAME } from '@/lib/limits'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { nameTooLong, passwordTooShort } from '@/lib/i18n/messages'
import { roomFor, wouldExceed, type LimitKey } from '@/lib/plans'
import type { BatchSlot, PayoutWallet, SubjectKind } from '@/lib/supabase/types'

export type ActionState = {
  error?: string
  ok?: string
  /**
   * Set when the action stopped to ask something instead of failing. The teacher
   * form re-submits with a confirmation field; see createTeacher.
   */
  confirm?: string
  /**
   * Name on the pre-existing account a teacher was linked to. Present only when
   * something happened that the owner should read before moving on, so the form
   * knows not to navigate away from its own success message.
   */
  linked?: string
} | null

/**
 * requireRole throws for a signed-out or under-privileged caller. Every action
 * here wants the same sentence rather than a stack trace, so the throw is
 * converted once.
 *
 * Written in the caller's own language, which costs a second read of the session:
 * requireRole threw, so it never handed one back. Worth the round trip — this is
 * the one message a manager sees on the screens they are not allowed to touch,
 * and an English-medium manager reading a lone Bangla sentence under an English
 * form cannot tell a permission boundary from a bug. A signed-out caller has no
 * locale to read, so they get the default.
 */
async function staffAdmin(): Promise<CenterSession | ActionState> {
  try {
    return await requireRole('manager')
  } catch (err) {
    if (err instanceof AuthError) {
      const caller = await getSession()
      const d = dict(caller?.locale ?? DEFAULT_LOCALE)
      return { error: d.settings.errors.forbidden }
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

export async function createSubject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const name = String(formData.get('name') ?? '').trim()
  const nameBn = String(formData.get('nameBn') ?? '').trim()
  const kind = String(formData.get('kind') ?? 'academic') as SubjectKind

  if (!name) return { error: t.subjects.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  if (await overLimit(session, 'subjects', 'maxSubjects')) {
    return { error: t.errors.planLimit }
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
    if (error.code === '23505') return { error: t.subjects.errors.duplicate }
    return { error: t.errors.addFailed }
  }

  revalidatePath('/settings/subjects')
  return { ok: t.added }
}

export async function createExamType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const name = String(formData.get('name') ?? '').trim()
  const nameBn = String(formData.get('nameBn') ?? '').trim()

  if (!name) return { error: t.examTypes.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  const supabase = await createClient()
  const { error } = await supabase.from('exam_types').insert({
    coaching_center_id: session.active.centerId,
    name,
    name_bn: nameBn || null,
  })

  if (error) {
    if (error.code === '23505') return { error: t.examTypes.errors.duplicate }
    return { error: t.errors.addFailed }
  }

  revalidatePath('/settings/exam-types')
  return { ok: t.added }
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

  const t = dict(session.locale).settings

  const name = String(formData.get('name') ?? '').trim()
  const subjectId = String(formData.get('subjectId') ?? '')
  const teacherId = String(formData.get('teacherId') ?? '')
  const rawSlot = String(formData.get('slot') ?? '')
  const monthlyFee = Number(formData.get('monthlyFee') ?? 0)
  const startTime = parseTime(String(formData.get('startTime') ?? ''))
  const endTime = parseTime(String(formData.get('endTime') ?? ''))

  if (!name) return { error: t.batches.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }
  if (!subjectId) return { error: t.batches.errors.pickSubject }
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
    return { error: t.batches.errors.feeUnreadable }
  }
  // The database has the same check; catching it here gives a field-level
  // message instead of a generic failure.
  if (startTime && endTime && endTime <= startTime) {
    return { error: t.batches.errors.endBeforeStart }
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
    return { error: t.batches.errors.daysNeedTimes }
  }

  if (await overLimit(session, 'batches', 'maxBatches')) {
    return { error: t.errors.planLimit }
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
    if (error?.code === '23505') return { error: t.batches.errors.duplicate }
    return { error: t.errors.createFailed }
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
      return { error: t.batches.errors.scheduleFailed }
    }
  }

  revalidatePath('/settings/batches')
  revalidatePath('/teach')
  return { ok: t.batches.created }
}

export async function createStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const name = String(formData.get('name') ?? '').trim()
  const batchIds = formData.getAll('batchIds').map(String).filter(Boolean)
  const rawGuardianPhone = String(formData.get('guardianPhone') ?? '')
  const guardianName = String(formData.get('guardianName') ?? '').trim()
  const rawStudentPhone = String(formData.get('phone') ?? '')
  const institution = String(formData.get('institution') ?? '').trim()
  const classLevel = String(formData.get('classLevel') ?? '').trim()
  const studentCode = String(formData.get('studentCode') ?? '').trim()

  if (!name) return { error: t.students.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  // The guardian's number is the product's whole delivery channel — results and
  // fee reminders go there. Required, and validated as a real BD mobile rather
  // than accepted as free text, because a typo here is silent: the SMS just
  // never arrives and nobody finds out for a month.
  const guardianPhone = normalizeBdMobile(rawGuardianPhone)
  if (!guardianPhone) {
    return { error: t.students.errors.guardianPhone }
  }

  const studentPhone = rawStudentPhone.trim()
    ? normalizeBdMobile(rawStudentPhone)
    : null
  if (rawStudentPhone.trim() && !studentPhone) {
    return { error: t.students.errors.studentPhone }
  }

  if (await overLimit(session, 'students', 'maxStudents')) {
    return { error: t.errors.planLimit }
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
    if (error?.code === '23505') return { error: t.students.errors.duplicateCode }
    return { error: t.errors.addFailed }
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
    //
    // Scoped by center id as well as by RLS: an owner of two centres satisfies
    // is_staff_admin for both, so the policy alone would let a batch from the
    // other one through.
    const { data: batches } = await supabase
      .from('batches')
      .select('id, subject_id')
      .eq('coaching_center_id', session.active.centerId)
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
  return { ok: t.students.added }
}

/**
 * Loading a whole register in one paste.
 *
 * This is how a centre becomes a customer: somebody sits down with their
 * notebook and it goes in before the owner ever logs in. Two hundred students
 * through the form above is an evening of typing per centre.
 *
 * The paste is re-parsed here rather than trusting rows sent from the browser.
 * A Server Action is a public endpoint, so that would be a hole; but the better
 * reason is that the same pure parser runs in both places, which is what makes
 * the preview's promise and the import's result the same number.
 */
export async function importStudents(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const rows = parseRoster(String(formData.get('roster') ?? ''))
  const ready = readyRows(rows)
  const batchIds = formData.getAll('batchIds').map(String).filter(Boolean)

  if (rows.length === 0) return { error: t.import.errors.empty }
  if (rows.length > MAX_IMPORT_ROWS) {
    return { error: t.import.errors.tooManyRows(MAX_IMPORT_ROWS, rows.length) }
  }
  if (ready.length === 0) return { error: t.import.errors.noneReadable }

  const supabase = await createClient()
  const centerId = session.active.centerId

  // The cap applies to the paste as a whole. Letting the first 15 of 80 names
  // through and dropping the rest is worse than refusing: the owner has no way
  // to know which 65 are missing, and would have to diff two hundred lines.
  //
  // Only capped plans pay for the roster fetch — and a capped plan holds at most
  // 300 students, so it is a small one. Rows that are already on the roster are
  // taken out of the count first, or re-pasting a register to fix three names
  // would be refused by a plan that has plenty of room for those three.
  const { count } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('coaching_center_id', centerId)
    .eq('status', 'active')
  const room = roomFor(session.plan, 'maxStudents', count ?? 0)

  if (room !== null) {
    const { data: roster } = await supabase
      .from('students')
      .select('name, guardian_phone')
      .eq('coaching_center_id', centerId)
    const known = new Set(
      (roster ?? []).map((s) => rosterKey(s.name, s.guardian_phone ?? '')),
    )
    const fresh = ready.filter((s) => !known.has(rosterKey(s.name, s.guardian_phone)))

    if (fresh.length > room) {
      // Two sentences when there is room for some of them, because "the plan is
      // full" is not true yet and an owner who is told it stops reading. The
      // plan sentence is the same one every other limit uses.
      return {
        error:
          room === 0
            ? t.errors.planLimit
            : `${t.import.errors.roomShort(room, fresh.length)} ${t.errors.planLimit}`,
      }
    }
  }

  // One statement, so a dropped connection either lands the whole register or
  // none of it. See 20260811000009_student_import.sql for why this is the only
  // RPC in the app; the short version is that a student whose guardian row never
  // arrived is a parent who never hears anything.
  const { data, error } = await supabase
    .rpc('import_students', {
      p_center_id: centerId,
      p_students: ready,
      p_batch_ids: batchIds,
    })
    .single()

  if (error || !data) return { error: t.import.errors.failed }

  revalidatePath('/settings/students')
  revalidatePath('/teach')
  revalidatePath('/dashboard')
  // This screen too, and not for the sake of a stale list: the page hands the
  // form the roster it already knows, and the form marks a pasted line as
  // already on it. Without this the owner imports, pastes the same register to
  // check it worked, and is told all forty are new — which is the one thing this
  // screen exists to be honest about. The import itself would still skip them.
  revalidatePath('/settings/students/import')

  // Reported from what the database actually did, not from what the preview
  // predicted. The two should agree; when they do not, this is the honest one.
  const parts = [t.import.added(data.added)]
  if (data.already_there > 0) parts.push(t.import.alreadyThere(data.already_there))
  if (data.enrolled > 0) parts.push(t.import.enrolled(data.enrolled))
  return { ok: parts.join(' · ') }
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

  const t = dict(session.locale).settings

  const studentId = String(formData.get('studentId') ?? '')
  const optOut = String(formData.get('optOut') ?? '') === 'true'
  if (!studentId) return { error: t.students.errors.notFound }

  const supabase = await createClient()
  const { error } = await supabase
    .from('students')
    .update({ sms_opt_out: optOut })
    .eq('id', studentId)

  if (error) return { error: t.errors.changeFailed }

  revalidatePath('/settings/sms')
  revalidatePath('/settings/students')
  return { ok: optOut ? t.sms.optedOut : t.sms.optedIn }
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

/** The five switches, in the order the settings screen shows them. */
const PERMISSION_KEYS = [
  'can_manage_exams',
  'can_send_sms',
  'can_manage_students',
  'can_manage_batches',
  'can_view_fees',
] as const

type PermissionKey = (typeof PERMISSION_KEYS)[number]

/**
 * An unchecked checkbox is simply absent from a FormData, so "missing" has to
 * mean false here. That is only safe because the form always renders all five —
 * a partial form would revoke whatever it happened to leave out, silently.
 */
function readPermissions(formData: FormData): Record<PermissionKey, boolean> {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [key, formData.get(key) !== null]),
  ) as Record<PermissionKey, boolean>
}

/**
 * Confirms a teacher belongs to the caller's center, and returns their id.
 *
 * RLS already stops another center's teacher, but an owner who runs two centers
 * passes `is_staff_admin` for both — so the policy would admit a teacher of the
 * other one. Every write below is scoped by center id for that reason.
 */
async function ownTeacherId(
  session: CenterSession,
  teacherId: string,
): Promise<string | null> {
  if (!teacherId) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('teachers')
    .select('id')
    .eq('id', teacherId)
    .eq('coaching_center_id', session.active.centerId)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Adds a teacher, and optionally gives them a login.
 *
 * The login is optional on purpose: `teachers.user_id` is nullable so a centre
 * can record a part-timer who will never open the app, and the list labels them
 * "লগইন নেই". Making an account is the owner's job rather than a self-service
 * invite — there is no SMS sender ID yet to send an invite through, and letting
 * anyone who signs up with a matching number join a centre would hand a stranger
 * other people's children's marks and their parents' phone numbers.
 */
export async function createTeacher(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const name = String(formData.get('name') ?? '').trim()
  const rawPhone = String(formData.get('phone') ?? '')
  const subjectIds = formData.getAll('subjectIds').map(String).filter(Boolean)
  const wantsLogin = formData.get('wantsLogin') !== null
  const password = String(formData.get('password') ?? '')
  const confirmedLink = formData.get('confirmLink') !== null
  const permissions = readPermissions(formData)

  if (!name) return { error: t.teachers.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  const phone = rawPhone.trim() ? normalizeBdMobile(rawPhone) : null
  if (rawPhone.trim() && !phone) {
    return { error: t.teachers.errors.phoneInvalid }
  }
  if (wantsLogin && !phone) {
    return { error: t.teachers.errors.loginNeedsPhone }
  }
  if (wantsLogin && password.length < MIN_PASSWORD) {
    return { error: passwordTooShort(session.locale) }
  }

  if (await overLimit(session, 'teachers', 'maxTeachers')) {
    return { error: t.errors.planLimit }
  }

  const supabase = await createClient()
  const centerId = session.active.centerId

  // Subjects are re-read rather than trusted from the form. Nothing stops a POST
  // from carrying a subject id belonging to somewhere else, and teacher_subjects
  // only checks that its *coaching_center_id* is ours — the foreign key would
  // accept the smuggled subject sitting next to it.
  let ownSubjectIds: string[] = []
  if (subjectIds.length > 0) {
    const { data: subjects } = await supabase
      .from('subjects')
      .select('id')
      .eq('coaching_center_id', centerId)
      .in('id', subjectIds)
    ownSubjectIds = (subjects ?? []).map((s) => s.id)
  }

  let userId: string | null = null
  let linkedName: string | null = null

  if (wantsLogin && phone) {
    const loginEmail = phoneToLoginEmail(phone)
    if (!loginEmail) return { error: t.teachers.errors.phoneInvalid }

    const admin = createAdminClient()

    // profiles.phone is unique across the whole platform, so a teacher who
    // already works at another centre cannot be given a second account — they
    // have to be linked to the one they have. Read with the admin client: RLS
    // shows an owner only their own profile row, which is the one row this
    // lookup is not interested in.
    const { data: existing } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('phone', phone)
      .maybeSingle()

    if (existing && !confirmedLink) {
      // Never link on the first submit. One mistyped digit would otherwise hand
      // a stranger a teacher account inside this centre: attendance, marks, and
      // the guardians' phone numbers of other people's children. So the owner is
      // shown whose account it is and has to agree.
      //
      // This does tell an owner that some number has a CoachDesk account and
      // what name is on it. A real disclosure, accepted because the alternative
      // is silent mis-linking and because it takes knowing the number first.
      return {
        confirm: t.teachers.confirmLink(existing.full_name || t.teachers.noName),
      }
    }

    if (existing) {
      userId = existing.id
      linkedName = existing.full_name || t.teachers.noName
    } else {
      // Same admin path as signup, and for the same reason: the public signUp
      // endpoint would try to send a confirmation email through the shared free
      // SMTP, which is rate-limited to a couple an hour.
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: loginEmail,
        password,
        email_confirm: true,
        // The owner's own language, not the app default. An English-medium
        // centre configures its teachers from an English screen, and a teacher
        // who lands in Bangla has to find the switch before their first class.
        user_metadata: { full_name: name, phone, locale: session.locale },
      })

      if (createError || !created.user) {
        return { error: t.teachers.errors.loginFailed }
      }
      userId = created.user.id
    }
  }

  const { data: teacher, error } = await supabase
    .from('teachers')
    .insert({
      coaching_center_id: centerId,
      user_id: userId,
      name,
      phone,
    })
    .select('id')
    .single()

  // An account may exist at this point with no teacher row attached to it. That
  // is recoverable rather than orphaned: retrying the form finds it through the
  // lookup above and links it instead of failing on the unique phone.
  if (error || !teacher) {
    return { error: t.errors.addFailed }
  }

  // Written even when every box is unticked, because a missing permissions row
  // reads as "no restrictions" downstream — the SMS gate only closes on an
  // explicit `can_send_sms === false`. Absent means allowed, so absent is not an
  // option for a teacher an owner just configured.
  await supabase.from('teacher_permissions').insert({
    teacher_id: teacher.id,
    coaching_center_id: centerId,
    ...permissions,
  })

  if (ownSubjectIds.length > 0) {
    await supabase.from('teacher_subjects').insert(
      ownSubjectIds.map((subjectId) => ({
        teacher_id: teacher.id,
        subject_id: subjectId,
        coaching_center_id: centerId,
      })),
    )
  }

  if (userId) {
    // The membership is what makes the centre visible to them at all. Unique on
    // (center, user, role), so a re-linked teacher who is already a member is a
    // no-op rather than an error.
    await supabase.from('center_members').upsert(
      {
        coaching_center_id: centerId,
        user_id: userId,
        role: 'teacher',
      },
      { onConflict: 'coaching_center_id,user_id,role', ignoreDuplicates: true },
    )
  }

  revalidatePath('/settings/teachers')
  revalidatePath('/settings/batches')
  revalidatePath('/dashboard')

  // Which of the two things happened is said out loud, with the name that was on
  // the account. If the owner mistyped a digit and linked somebody else, this
  // sentence is where they notice — so when it applies, `linked` tells the form
  // to stay put rather than redirect past it.
  if (linkedName) {
    return { ok: t.teachers.linked(linkedName), linked: linkedName }
  }

  return { ok: userId ? t.teachers.addedWithLogin : t.teachers.addedNoLogin }
}

/** The permission checkboxes on the teacher list. */
export async function saveTeacherPermissions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const teacherId = await ownTeacherId(
    session,
    String(formData.get('teacherId') ?? ''),
  )
  if (!teacherId) return { error: t.teachers.errors.notFound }

  const supabase = await createClient()

  // upsert, not update: bootstrap_center creates the owner's own teacher row
  // without a permissions row, so the first save for that teacher is an insert.
  const { error } = await supabase.from('teacher_permissions').upsert(
    {
      teacher_id: teacherId,
      coaching_center_id: session.active.centerId,
      ...readPermissions(formData),
    },
    { onConflict: 'teacher_id' },
  )

  if (error) return { error: t.errors.saveFailed }

  revalidatePath('/settings/teachers')
  return { ok: t.teachers.permissionsSaved }
}

/**
 * Turns a teacher off without deleting anything they recorded.
 *
 * Two things happen, because one is not enough. `teachers.active = false` cuts
 * the teacher-scoped policies: `app.my_teacher_ids()` filters on `active` and
 * every batch, student, guardian and marks policy for teachers is built on it,
 * so those go on the next request. But the centre membership is separate, and on
 * its own it would leave an ex-employee reading the batch list with its monthly
 * fees, the subject list, and their former colleagues' phone numbers. So the
 * teacher membership goes too.
 *
 * Only the `teacher` membership. The key is (center, user, role), so someone who
 * is also a manager keeps that, and an owner in Teacher Mode who deactivates
 * their own teacher record does not lock themselves out of their centre.
 *
 * What they entered stays: attendance and marks belong to the centre, not to the
 * person who typed them. A teacher who leaves should not take last term with them.
 */
export async function toggleTeacherActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings
  const supabase = await createClient()
  const centerId = session.active.centerId

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, user_id')
    .eq('id', String(formData.get('teacherId') ?? ''))
    .eq('coaching_center_id', centerId)
    .maybeSingle()

  if (!teacher) return { error: t.teachers.errors.notFound }

  const active = String(formData.get('active') ?? '') === 'true'

  // Reactivating has to respect the plan limit, or "off then on" would be a way
  // past maxTeachers on the free plan.
  if (active && (await overLimit(session, 'teachers', 'maxTeachers'))) {
    return { error: t.errors.planLimit }
  }

  const { error } = await supabase
    .from('teachers')
    .update({ active })
    .eq('id', teacher.id)
    .eq('coaching_center_id', centerId)

  if (error) return { error: t.errors.changeFailed }

  if (teacher.user_id) {
    if (active) {
      await supabase.from('center_members').upsert(
        {
          coaching_center_id: centerId,
          user_id: teacher.user_id,
          role: 'teacher',
        },
        { onConflict: 'coaching_center_id,user_id,role', ignoreDuplicates: true },
      )
    } else {
      await supabase
        .from('center_members')
        .delete()
        .eq('coaching_center_id', centerId)
        .eq('user_id', teacher.user_id)
        .eq('role', 'teacher')
    }
  }

  revalidatePath('/settings/teachers')
  revalidatePath('/teach')
  return { ok: active ? t.teachers.activated : t.teachers.deactivated }
}

/* -------------------------------------------------------------------------- */
/* Centre details                                                             */
/* -------------------------------------------------------------------------- */

const WALLETS = new Set<PayoutWallet>(['bkash', 'nagad', 'rocket'])

/**
 * Owner, not manager — the only action in this file that draws the line there.
 *
 * `centers_owner_update` has always been owner-only, so a manager calling this
 * would be refused by RLS regardless. What that refusal cannot do is explain
 * itself: the update would report zero rows changed and the form would say the
 * save failed, which reads as a bug. And the reason the policy is drawn there
 * matters more now than when the whitelist held a name and an address — whoever
 * can edit the payment number decides where every fee reminder the centre sends
 * points, so a wrong answer here redirects a month of income.
 */
async function centerOwner(): Promise<CenterSession | ActionState> {
  try {
    return await requireRole('owner')
  } catch (err) {
    if (err instanceof AuthError) {
      const caller = await getSession()
      const d = dict(caller?.locale ?? DEFAULT_LOCALE)
      return { error: d.settings.center.errors.ownerOnly }
    }
    throw err
  }
}

/**
 * The centre's name and the wallet a parent sends fees to.
 *
 * Both live on one screen because they are the same decision. The name is not
 * decoration: it is the signature on every reminder, and it is also what eats
 * the SMS budget, so shortening it is what buys the payment number a place in a
 * single segment. Splitting them across two screens would hide that trade.
 */
export async function saveCenterDetails(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await centerOwner()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const name = String(formData.get('name') ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return { error: t.center.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  const walletInput = String(formData.get('paymentWallet') ?? '')
  const numberInput = String(formData.get('paymentNumber') ?? '').trim()

  const wallet = WALLETS.has(walletInput as PayoutWallet)
    ? (walletInput as PayoutWallet)
    : null
  const number = normalizeBdMobile(numberInput)

  // Told apart deliberately: "you left this blank" and "what you typed is not a
  // number" need different answers, and the second one is where a digit gets
  // lost. Money sent to a wrong-but-valid number is gone, and the centre gets
  // blamed for losing a fee that was paid.
  if (numberInput && !number) {
    return { error: t.center.errors.numberInvalid }
  }

  // Half-configured is refused rather than saved, because neither half is
  // usable on its own and the check constraint would reject it anyway — with a
  // Postgres string no owner can read. The pair is also how "we do not take
  // mobile payments" is expressed: clear both, and reminders stop naming one.
  if (wallet && !number) return { error: t.center.errors.walletNeedsNumber }
  if (number && !wallet) return { error: t.center.errors.numberNeedsWallet }

  const supabase = await createClient()
  const { error } = await supabase
    .from('coaching_centers')
    .update({ name, payment_wallet: wallet, payment_number: number })
    .eq('id', session.active.centerId)

  if (error) return { error: t.errors.saveFailed }

  // Layout-wide, because the name is in the header of every screen and is read
  // from the session, not from this page.
  revalidatePath('/', 'layout')
  return { ok: t.saved }
}
