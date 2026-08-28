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

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  requireRole,
  requirePermission,
  getSession,
  AuthError,
  type CenterSession,
  type RosterPermission,
} from '@/lib/auth/session'
import { normalizeBdMobile, phoneToLoginEmail } from '@/lib/bd/phone'
import {
  MAX_IMPORT_ROWS,
  parseRoster,
  readyRows,
  rosterKey,
} from '@/lib/bd/roster'
import { MIN_PASSWORD } from '@/lib/auth/password'
import {
  passwordResetRefusal,
  type Membership,
} from '@/lib/auth/reset'
import { SLOT_ORDER } from '@/lib/bd/schedule'
import { MAX_NAME, MAX_LABEL, clamp } from '@/lib/limits'
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/permissions'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { nameTooLong, passwordTooShort } from '@/lib/i18n/messages'
import { roomFor, wouldExceed, hasStaff, type LimitKey } from '@/lib/plans'
import {
  examTypeDeleteVerdict,
  subjectDeleteVerdict,
  subjectOffVerdict,
} from '@/lib/settings/retire'
import { readExamTypeUse, readSubjectUse } from '@/lib/settings/usage'
import { asPreferredChannel } from '@/lib/students/channel'
import { STUDENT_STATUSES } from '@/lib/students/status'
import type {
  BatchSlot,
  Database,
  EnrollmentStatus,
  PayoutWallet,
  StudentStatus,
  SubjectKind,
} from '@/lib/supabase/types'

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
 * The require* helpers throw for a signed-out or under-privileged caller. Every
 * action here wants a sentence rather than a stack trace, so the throw is converted
 * once, in one place, and each guard below supplies only its own wording.
 *
 * Written in the caller's own language, which costs a second read of the session:
 * the check threw, so it never handed one back. Worth the round trip — this is the
 * one message somebody sees on the screens they are not allowed to touch, and an
 * English-medium manager reading a lone Bangla sentence under an English form cannot
 * tell a permission boundary from a bug. A signed-out caller has no locale to read,
 * so they get the default.
 *
 * `message` takes the whole dictionary rather than a string, because it is chosen
 * before the locale is known.
 */
async function guard(
  check: () => Promise<CenterSession>,
  message: (d: ReturnType<typeof dict>) => string,
): Promise<CenterSession | ActionState> {
  try {
    return await check()
  } catch (err) {
    if (err instanceof AuthError) {
      const caller = await getSession()
      return { error: message(dict(caller?.locale ?? DEFAULT_LOCALE)) }
    }
    throw err
  }
}

/** Owners and managers. Most of this file. */
async function staffAdmin(): Promise<CenterSession | ActionState> {
  return guard(
    () => requireRole('manager'),
    (d) => d.settings.errors.forbidden,
  )
}

/**
 * Owners and managers, or a teacher the owner ticked the box for.
 *
 * The three admissions actions and the batch action use this instead of
 * `staffAdmin`, which is the whole point of 20260811000019: `can_manage_students`
 * and `can_manage_batches` were stored, shown and enforced nowhere, because every
 * action they should have opened asked for a rank a teacher cannot reach.
 *
 * A different sentence when it refuses. `forbidden` says only an owner or a manager
 * may do this, which stopped being true here — a teacher who is refused needs to
 * know the answer is a checkbox on their own row and who owns it.
 */
async function mayManage(
  permission: RosterPermission,
): Promise<CenterSession | ActionState> {
  return guard(
    () => requirePermission(permission),
    (d) => d.settings.errors.notPermitted,
  )
}

function isSession(value: CenterSession | ActionState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Counts the rows that a plan limit applies to, then returns the refusal to send
 * back — or null when there is room for one more. `active`/`status` filters matter:
 * a deactivated batch should not hold a slot hostage on the one-batch free plan.
 *
 * IT HANDS BACK THE MESSAGE RATHER THAN A BOOLEAN, and that is the whole point of
 * the shape. It used to answer true or false, and a count that came back as no
 * answer at all was read as zero rows — so a failed read said "this centre has
 * nothing yet", which is the one answer that opens the gate. Nothing else enforces
 * these caps: there is no trigger behind them, this function is the limit. A
 * boolean has nowhere to put "could not tell", and the caller that has to decide
 * what to do with a third state is the caller that gets it wrong.
 *
 * `count: 'exact', head: true` is typed `number | null` and null means the query
 * failed. It is not zero, and the difference is a free plan quietly taking a second
 * batch on the day Supabase hiccups.
 */
async function limitRefusal(
  session: CenterSession,
  table: 'batches' | 'students' | 'teachers' | 'subjects',
  key: LimitKey,
): Promise<ActionState | null> {
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

  const t = dict(session.locale).settings.errors
  if (count === null) return { error: t.limitUnknown }
  return wouldExceed(session.plan, key, count) ? { error: t.planLimit } : null
}

/**
 * Which of these batches cannot take `adding` more students.
 *
 * Its own function rather than another arm of `limitRefusal`, because the question
 * is a different shape: the cap is per batch, so the count has to be taken once per
 * batch, and the refusal has to name the batch that is full. An owner enrolling
 * one student into three batches who is told only "this plan is full" has to guess
 * which of the three to change — and the centre may well have room in the other
 * two, in which case nobody needs to pay us anything to fix it.
 *
 * Returns names, in the paste's own words, for that reason.
 *
 * Null means neither read came back and the question is unanswered — not that every
 * batch has room, which is what `?? []` on either query used to say. An unreadable
 * roster made no batch look full; an unreadable name list turned a batch that *was*
 * full into an empty array of names, and the caller checks the length. Both ended
 * with the seat cap not applying.
 *
 * Empty on an uncapped plan without touching the database. The centre tiers have
 * no per-batch cap at all and this runs on the path every new student takes, so
 * the common case has to cost nothing. On a capped plan the first query returns
 * one uuid per active enrollment across at most a handful of batches — a teacher
 * plan holds 150 students — and the second only runs when a batch is actually
 * full, which is the screen an owner sees once and then fixes.
 */
async function fullBatches(
  supabase: SupabaseClient<Database>,
  session: CenterSession,
  batchIds: string[],
  adding: number,
): Promise<string[] | null> {
  const cap = session.plan.maxStudentsPerBatch
  if (cap === null || batchIds.length === 0 || adding <= 0) return []

  // Scoped by centre as well as by RLS, for the reason the enrollment insert
  // below gives: an owner of two centres satisfies is_staff_admin for both, so
  // the policy alone would count a batch belonging to the other one.
  //
  // Active enrollments only, on the same reasoning as every other cap here: a
  // student who left the batch should not hold a seat nobody sits in.
  const { data: taken, error: takenError } = await supabase
    .from('enrollments')
    .select('batch_id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('status', 'active')
    .in('batch_id', batchIds)

  if (takenError || !taken) return null

  const seats = new Map<string, number>()
  for (const row of taken) {
    seats.set(row.batch_id, (seats.get(row.batch_id) ?? 0) + 1)
  }

  const full = batchIds.filter((id) => (seats.get(id) ?? 0) + adding > cap)
  if (full.length === 0) return []

  const { data: named, error: namedError } = await supabase
    .from('batches')
    .select('name')
    .eq('coaching_center_id', session.active.centerId)
    .in('id', full)
    .order('name')

  if (namedError || !named) return null

  return named.map((b) => b.name)
}

/**
 * The rows of a pasted register that are not on the roster already.
 *
 * Split out because two caps need this same number and the roster should only be
 * read once for both. Matching is on name plus guardian number — the same key the
 * import itself dedupes by — so the count an owner is refused with is the count
 * the import would actually have added, and not one line more.
 *
 * Generic over the row so it can take the parser's output without this file
 * needing to name that type; all it looks at is the two fields in the key.
 *
 * Null when the roster could not be read, rather than "none of them are known".
 * That fallback was the safe direction — every pasted line counted as new, so a
 * capped plan refused the paste — but it refused it with the wrong sentence, and an
 * owner told their plan is full when the truth is a failed read goes to the upgrade
 * screen instead of tapping paste again.
 *
 * Unpaged on purpose, and it stays correct: the only caller skips this entirely on
 * the uncapped tiers, so the roster it reads belongs to a plan that holds 150
 * students. Nothing here would survive being called for a centre.
 */
async function unknownRows<T extends { name: string; guardian_phone: string }>(
  supabase: SupabaseClient<Database>,
  centerId: string,
  ready: T[],
): Promise<T[] | null> {
  const { data: roster, error } = await supabase
    .from('students')
    .select('name, guardian_phone')
    .eq('coaching_center_id', centerId)

  if (error || !roster) return null

  const known = new Set(
    roster.map((s) => rosterKey(s.name, s.guardian_phone ?? '')),
  )
  return ready.filter((s) => !known.has(rosterKey(s.name, s.guardian_phone)))
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
  // Both names, because both end up in the same lists. The Bangla one is
  // optional, not exempt.
  if (name.length > MAX_NAME || nameBn.length > MAX_NAME) {
    return { error: nameTooLong(session.locale) }
  }

  const subjectLimit = await limitRefusal(session, 'subjects', 'maxSubjects')
  if (subjectLimit) return subjectLimit

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
  if (name.length > MAX_NAME || nameBn.length > MAX_NAME) {
    return { error: nameTooLong(session.locale) }
  }

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

/**
 * Correcting and retiring the two lists a centre writes for itself.
 *
 * Both were add-only until now, which made a typo permanent: "Physcis" went onto
 * the batch, onto every exam sat in it, onto the marks sheet, into the parent's
 * SMS and onto the printed report, and the only repair was a second subject called
 * "Physics" sitting beside it for ever — on a plan that holds five of them.
 *
 * THREE VERBS, AND WHICH ONE IS NEEDED DEPENDS ON WHAT WENT WRONG. Rename fixes
 * the spelling everywhere at once, because every batch, enrolment and exam holds
 * the id and not the letters. Off ends a subject the centre has stopped teaching
 * while all of its history keeps the name it was taught under. Remove is only for
 * the duplicate that nothing ever used, and it is the one that can be refused.
 *
 * Every refusal comes from `lib/settings/retire.ts`, which the list screen calls
 * as well — so the panel cannot offer a button this will decline, and cannot
 * explain a refusal in different words from the refusal itself.
 */
export async function renameSubject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const subjectId = String(formData.get('subjectId') ?? '')
  if (!subjectId) return { error: t.subjects.errors.notFound }

  const name = String(formData.get('name') ?? '').trim()
  const nameBn = String(formData.get('nameBn') ?? '').trim()

  // Validated exactly as createSubject validates the same two fields — a subject
  // reached through this form has to end up as legal as one reached through that.
  if (!name) return { error: t.subjects.errors.nameRequired }
  if (name.length > MAX_NAME || nameBn.length > MAX_NAME) {
    return { error: nameTooLong(session.locale) }
  }

  const supabase = await createClient()

  // Read back first and scoped by centre as well as by RLS, for the reason
  // updateBatch's own note gives: an owner of two centres satisfies
  // is_staff_admin for both, so the policy alone would rename the other one's.
  //
  // No cap check and no use check. A rename cannot break anything pointing here,
  // which is exactly why it is the repair every refusal below recommends.
  const { data: before } = await supabase
    .from('subjects')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', subjectId)
    .maybeSingle()

  if (!before) return { error: t.subjects.errors.notFound }

  const { data: saved, error } = await supabase
    .from('subjects')
    .update({ name, name_bn: nameBn || null })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', before.id)
    .select('id')

  if (error) {
    if (error.code === '23505') return { error: t.subjects.errors.duplicate }
    return { error: t.errors.saveFailed }
  }
  // An update matching no policy changes nothing and reports no error, so the rows
  // written are counted rather than assumed — the trap saveMarks documents.
  if (!saved || saved.length === 0) return { error: t.errors.saveFailed }

  revalidatePath('/settings/subjects')
  revalidatePath('/settings/batches')
  return { ok: t.saved }
}

export async function setSubjectActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const subjectId = String(formData.get('subjectId') ?? '')
  if (!subjectId) return { error: t.subjects.errors.notFound }

  // 'on'/'off' rather than a checkbox, because this arrives from a button and not
  // from a form somebody filled in: absence has to mean a broken request here, not
  // "off". Anything else was forged, so it gets the sentence for a broken request.
  const raw = String(formData.get('next') ?? '')
  if (raw !== 'on' && raw !== 'off') return { error: t.errors.changeFailed }
  const next = raw === 'on'

  const supabase = await createClient()

  const { data: before } = await supabase
    .from('subjects')
    .select('id, active')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', subjectId)
    .maybeSingle()

  if (!before) return { error: t.subjects.errors.notFound }

  // Already where it is being asked to go. Reported as done rather than written
  // again, which is what makes a replay harmless: `useOffline` re-sends whatever
  // was queued when the connection dropped, and this is a public endpoint anyway.
  if (before.active === next) return { ok: t.saved }

  if (next) {
    // Turning one back on is an addition as far as the plan is concerned, so it
    // passes the same cap createSubject does — checked before anything is written,
    // the way a reopened batch is.
    const limit = await limitRefusal(session, 'subjects', 'maxSubjects')
    if (limit) return limit
  } else {
    // Turning one off frees a plan slot without stopping a single class, so a
    // subject a running batch still teaches may not go quiet. See subjectOffVerdict.
    const use = await readSubjectUse(supabase, session.active.centerId, before.id)
    if (!use) return { error: t.subjects.errors.checkFailed }
    if (subjectOffVerdict(use) === 'liveBatches') {
      return { error: t.subjects.errors.offLiveBatches(use.liveBatchCount) }
    }
  }

  const { data: saved, error } = await supabase
    .from('subjects')
    .update({ active: next })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', before.id)
    .select('id')

  if (error || !saved || saved.length === 0) {
    return { error: t.errors.changeFailed }
  }

  revalidatePath('/settings/subjects')
  revalidatePath('/settings/batches')
  // Both of these count the active ones and would otherwise keep showing the
  // number this call just changed.
  revalidatePath('/settings/plan')
  revalidatePath('/settings')
  return { ok: t.saved }
}

export async function deleteSubject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const subjectId = String(formData.get('subjectId') ?? '')
  if (!subjectId) return { error: t.subjects.errors.notFound }

  const supabase = await createClient()

  const { data: before } = await supabase
    .from('subjects')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', subjectId)
    .maybeSingle()

  if (!before) return { error: t.subjects.errors.notFound }

  // Counted again here rather than trusted from the screen that offered the
  // button: a list rendered ten minutes ago can be a batch out of date, and the
  // foreign keys would refuse with a constraint name nobody can read.
  const use = await readSubjectUse(supabase, session.active.centerId, before.id)
  if (!use) return { error: t.subjects.errors.checkFailed }

  // Written out rather than left to a default, so a fifth SubjectDeleteVerdict is
  // a type error here instead of a delete that quietly starts going through.
  switch (subjectDeleteVerdict(use)) {
    case 'batches':
      return { error: t.subjects.errors.deleteBatches(use.batchCount) }
    case 'enrolments':
      return { error: t.subjects.errors.deleteEnrolments(use.enrolmentCount) }
    case 'exams':
      return { error: t.subjects.errors.deleteExams(use.examCount) }
    case 'ok':
      break
  }

  const { data: gone, error } = await supabase
    .from('subjects')
    .delete()
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', before.id)
    .select('id')

  if (error || !gone || gone.length === 0) {
    return { error: t.subjects.errors.deleteFailed }
  }

  revalidatePath('/settings/subjects')
  revalidatePath('/settings/batches')
  revalidatePath('/settings/plan')
  revalidatePath('/settings')
  return { ok: t.removed }
}

export async function renameExamType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const examTypeId = String(formData.get('examTypeId') ?? '')
  if (!examTypeId) return { error: t.examTypes.errors.notFound }

  const name = String(formData.get('name') ?? '').trim()
  const nameBn = String(formData.get('nameBn') ?? '').trim()

  if (!name) return { error: t.examTypes.errors.nameRequired }
  if (name.length > MAX_NAME || nameBn.length > MAX_NAME) {
    return { error: nameTooLong(session.locale) }
  }

  const supabase = await createClient()

  const { data: before } = await supabase
    .from('exam_types')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examTypeId)
    .maybeSingle()

  if (!before) return { error: t.examTypes.errors.notFound }

  const { data: saved, error } = await supabase
    .from('exam_types')
    .update({ name, name_bn: nameBn || null })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', before.id)
    .select('id')

  if (error) {
    if (error.code === '23505') return { error: t.examTypes.errors.duplicate }
    return { error: t.errors.saveFailed }
  }
  if (!saved || saved.length === 0) return { error: t.errors.saveFailed }

  revalidatePath('/settings/exam-types')
  // The kind is the second line under every exam's heading, and the picker on the
  // form that creates one.
  revalidatePath('/exams')
  return { ok: t.saved }
}

export async function setExamTypeActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const examTypeId = String(formData.get('examTypeId') ?? '')
  if (!examTypeId) return { error: t.examTypes.errors.notFound }

  const raw = String(formData.get('next') ?? '')
  if (raw !== 'on' && raw !== 'off') return { error: t.errors.changeFailed }
  const next = raw === 'on'

  const supabase = await createClient()

  const { data: before } = await supabase
    .from('exam_types')
    .select('id, active')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examTypeId)
    .maybeSingle()

  if (!before) return { error: t.examTypes.errors.notFound }

  if (before.active === next) return { ok: t.saved }

  // Neither half of the subject version's check applies here, and both omissions
  // are deliberate: exam kinds have no plan cap to buy anything by turning one
  // off, and taking a kind out of the picker is the ordinary way to stop running
  // it — every exam already held keeps the name it was held under.
  const { data: saved, error } = await supabase
    .from('exam_types')
    .update({ active: next })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', before.id)
    .select('id')

  if (error || !saved || saved.length === 0) {
    return { error: t.errors.changeFailed }
  }

  revalidatePath('/settings/exam-types')
  revalidatePath('/exams')
  revalidatePath('/settings')
  return { ok: t.saved }
}

export async function deleteExamType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const examTypeId = String(formData.get('examTypeId') ?? '')
  if (!examTypeId) return { error: t.examTypes.errors.notFound }

  const supabase = await createClient()

  const { data: before } = await supabase
    .from('exam_types')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', examTypeId)
    .maybeSingle()

  if (!before) return { error: t.examTypes.errors.notFound }

  // The count matters more here than anywhere else on this screen, because the
  // database would not stop this one: exams.exam_type_id is `on delete set null`,
  // so a removal Postgres is happy with would quietly strip the kind off every
  // exam ever held under it. See examTypeDeleteVerdict.
  const use = await readExamTypeUse(supabase, session.active.centerId, before.id)
  if (!use) return { error: t.examTypes.errors.checkFailed }

  switch (examTypeDeleteVerdict(use)) {
    case 'exams':
      return { error: t.examTypes.errors.deleteExams(use.examCount) }
    case 'ok':
      break
  }

  const { data: gone, error } = await supabase
    .from('exam_types')
    .delete()
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', before.id)
    .select('id')

  if (error || !gone || gone.length === 0) {
    return { error: t.examTypes.errors.deleteFailed }
  }

  revalidatePath('/settings/exam-types')
  revalidatePath('/exams')
  revalidatePath('/settings')
  return { ok: t.removed }
}

/** Turns "07:30" into a Postgres time, or null. Rejects anything else. */
function parseTime(input: string): string | null {
  const value = input.trim()
  if (!/^\d{1,2}:\d{2}$/.test(value)) return null
  const [h, m] = value.split(':').map(Number)
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The valid slots, from the one list that also orders the picker.
 *
 * A Set built here by hand was the fourth copy of these five strings, and the
 * only one `tsc` could not check against the picker the owner had just used.
 */
const SLOTS = new Set<BatchSlot>(SLOT_ORDER)

export async function createBatch(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await mayManage('can_manage_batches')
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

  const batchLimit = await limitRefusal(session, 'batches', 'maxBatches')
  if (batchLimit) return batchLimit

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

/**
 * Changing a batch that already exists.
 *
 * The twin of updateStudent, and missing for the same length of time: a batch is
 * where a subject, a teacher, a time and a fee meet, and until now not one of the
 * four could be corrected. What that cost:
 *
 * The fee is the price. Typed with a zero too few, every invoice raised from then on
 * is wrong, and the only remedy was to open a second batch and move the whole class
 * into it — which orphans their attendance and their marks, because both hang off
 * the enrollment.
 *
 * A time that moves is the ordinary life of a coaching centre — Ramadan, exam season,
 * a room double-booked — and the register reads `batch_schedules` to decide which
 * classes are today. A batch whose days cannot be changed is a register that is wrong
 * every week until somebody rebuilds the batch.
 *
 * A teacher who leaves keeps the batch. `app.my_batch_ids` is what opens attendance
 * and marks, so until the batch points at somebody else the departed teacher still
 * holds the class, and the person actually teaching it holds nothing.
 *
 * And `active` was write-once at insert, so a batch that stopped running could not be
 * closed — it stayed on the register and kept billing for ever.
 *
 * It also keeps a promise the product had already made: `scheduleFailed` tells an
 * owner whose batch was created without its days to "fix that from settings", and
 * there was nothing in settings that could.
 *
 * Guarded by rank, like updateStudent and for the same reason: 20260811000019 grants
 * `can_manage_batches` INSERT on batches and their schedules and deliberately no
 * UPDATE. Opening a batch is not the same permission as repricing one.
 */
export async function updateBatch(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const batchId = String(formData.get('batchId') ?? '')
  if (!batchId) return { error: t.batches.errors.notFound }

  const name = String(formData.get('name') ?? '').trim()
  const subjectId = String(formData.get('subjectId') ?? '')
  const teacherId = String(formData.get('teacherId') ?? '')
  const rawSlot = String(formData.get('slot') ?? '')
  const monthlyFee = Number(formData.get('monthlyFee') ?? 0)
  const startTime = parseTime(String(formData.get('startTime') ?? ''))
  const endTime = parseTime(String(formData.get('endTime') ?? ''))
  // An unchecked checkbox is absent from FormData, so absence is the off state.
  const active = formData.get('active') !== null

  // Validated exactly as createBatch validates the same fields — a batch reached
  // through this form has to end up as legal as one reached through that one.
  if (!name) return { error: t.batches.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }
  if (!subjectId) return { error: t.batches.errors.pickSubject }
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
    return { error: t.batches.errors.feeUnreadable }
  }
  if (startTime && endTime && endTime <= startTime) {
    return { error: t.batches.errors.endBeforeStart }
  }

  const days = formData
    .getAll('days')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)

  if (days.length > 0 && (!startTime || !endTime)) {
    return { error: t.batches.errors.daysNeedTimes }
  }

  const slot = SLOTS.has(rawSlot as BatchSlot) ? (rawSlot as BatchSlot) : null

  const supabase = await createClient()

  // Read it back first, scoped by centre as well as by RLS: an owner of two centres
  // satisfies is_staff_admin for both, so the policy alone would open a batch
  // belonging to the other one. The old subject and the old active flag are both
  // needed — one decides whether the enrollments have to follow, the other whether
  // this save is a reopening that has to pass the plan cap.
  const { data: before } = await supabase
    .from('batches')
    .select('id, subject_id, active')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', batchId)
    .maybeSingle()

  if (!before) return { error: t.batches.errors.notFound }

  // A batch that was not counted against maxBatches and is about to be. Refused
  // before anything is written, so the batch stays exactly as it was.
  if (active && !before.active) {
    const limit = await limitRefusal(session, 'batches', 'maxBatches')
    if (limit) return limit
  }

  // The subject is filtered through the centre's own rather than trusted, for the
  // reason createBatch's own note gives about batchId: this is a public endpoint, and
  // an id from the other centre would be refused by the composite foreign key as an
  // error nobody can read.
  const { data: subjectRow } = await supabase
    .from('subjects')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', subjectId)
    .maybeSingle()

  if (!subjectRow) return { error: t.batches.errors.pickSubject }

  // Same for the teacher, where the stakes are access rather than a constraint:
  // teacher_id is what app.my_batch_ids reads, so an id from another centre would
  // hand somebody else's teacher this batch's attendance and marks.
  let teacher: string | null = null
  if (teacherId) {
    const { data: teacherRow } = await supabase
      .from('teachers')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', teacherId)
      .maybeSingle()
    teacher = teacherRow?.id ?? null
  }

  const { error: saveError } = await supabase
    .from('batches')
    .update({
      subject_id: subjectRow.id,
      teacher_id: teacher,
      name,
      slot,
      start_time: startTime,
      end_time: endTime,
      monthly_fee_bdt: monthlyFee,
      active,
    })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', batchId)

  if (saveError) {
    if (saveError.code === '23505') return { error: t.batches.errors.duplicate }
    return { error: t.batches.errors.saveFailed }
  }

  // enrollments.subject_id is a copy taken from the batch when the student was
  // enrolled, so a batch that changes subject leaves every one of them naming the
  // old one. Carried over rather than left behind: two rows disagreeing about what a
  // class teaches is the kind of thing that reads as a bug in whichever screen
  // happens to surface it.
  //
  // Exams are deliberately not touched. exams.subject_id is the subject the exam was
  // actually sat in, and rewriting history to match a correction made later would
  // move marks under a subject nobody was taught.
  if (subjectRow.id !== before.subject_id) {
    await supabase
      .from('enrollments')
      .update({ subject_id: subjectRow.id })
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId)
  }

  // The days are edited as a set, so they are written as one: whatever is on the
  // form replaces whatever was there. Deleted first even when the new set is empty,
  // because clearing the days back to "every day" is a thing an owner may well mean.
  const { error: clearError } = await supabase
    .from('batch_schedules')
    .delete()
    .eq('coaching_center_id', session.active.centerId)
    .eq('batch_id', batchId)

  if (clearError) return { error: t.batches.errors.scheduleSaveFailed }

  if (days.length > 0 && startTime && endTime) {
    const { error: scheduleError } = await supabase.from('batch_schedules').insert(
      days.map((day) => ({
        coaching_center_id: session.active.centerId,
        batch_id: batchId,
        day_of_week: day,
        start_time: startTime,
        end_time: endTime,
      })),
    )

    // The batch itself saved. Say which half did not rather than reporting a clean
    // success the teacher would disprove tomorrow morning.
    if (scheduleError) return { error: t.batches.errors.scheduleSaveFailed }
  }

  revalidatePath('/settings/batches')
  revalidatePath('/teach')
  revalidatePath('/dashboard')
  // The fee moved, and so did whether this batch is billed at all.
  revalidatePath('/fees')
  revalidatePath('/settings')
  return { ok: t.batches.saved }
}

export async function createStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await mayManage('can_manage_students')
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const name = String(formData.get('name') ?? '').trim()
  const batchIds = formData.getAll('batchIds').map(String).filter(Boolean)
  const rawGuardianPhone = String(formData.get('guardianPhone') ?? '')
  const guardianName = String(formData.get('guardianName') ?? '').trim()
  const rawStudentPhone = String(formData.get('phone') ?? '')
  // Clamped rather than refused: every one of these is optional, every one is
  // capped in the browser already, and a value over the cap therefore did not
  // come from the form. See `clamp` in @/lib/limits.
  const institution = clamp(String(formData.get('institution') ?? '').trim(), MAX_NAME)
  const classLevel = clamp(String(formData.get('classLevel') ?? '').trim(), MAX_LABEL)
  const studentCode = clamp(String(formData.get('studentCode') ?? '').trim(), MAX_LABEL)

  if (!name) return { error: t.students.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }
  if (guardianName.length > MAX_NAME) return { error: nameTooLong(session.locale) }

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

  const studentLimit = await limitRefusal(session, 'students', 'maxStudents')
  if (studentLimit) return studentLimit

  const supabase = await createClient()

  // Before the insert, not after: a student created and then left un-enrolled
  // because the batch was full is a row the owner has to find and delete, and
  // they would reasonably assume the whole thing failed.
  const full = await fullBatches(supabase, session, batchIds, 1)
  if (full === null) return { error: t.errors.limitUnknown }
  if (full.length > 0) {
    return {
      error: t.errors.batchFull(
        full.join(', '),
        session.plan.maxStudentsPerBatch ?? 0,
      ),
    }
  }

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
 * What leaving means for the batches the student was in.
 *
 * Not one value for all three, because the distinction is the difference between a
 * batch that ran its course and one somebody walked out of, and `completed` written
 * over as `dropped` cannot be recovered. `paused` for `inactive` is the pair that
 * does the most work: a student who has stopped coming for a while is the common
 * case, and it is the only one this screen brings back on its own.
 */
const ENROLMENT_END: Record<Exclude<StudentStatus, 'active'>, EnrollmentStatus> = {
  inactive: 'paused',
  graduated: 'completed',
  dropped: 'dropped',
}

/**
 * Fixing what somebody typed, and marking who has left.
 *
 * The screen this serves did not exist until now, which made the roster a list an
 * owner could read and not correct. Two things made that expensive rather than
 * merely annoying:
 *
 * The guardian's mobile number is the product's entire delivery channel, and it is
 * the field most likely to be wrong — the roster shows it on every row precisely so
 * a wrong one gets caught. Caught, and then nothing could be done: re-admitting the
 * student under a corrected number would have orphaned their attendance, their marks
 * and their fee history. And the roster's own warning card counts the students with
 * no number at all, which was a dead end pointing at a screen that did not exist.
 *
 * And a student who leaves keeps being billed. `generateInvoices` reads every active
 * enrollment in the centre, so without a way to end one, next month's board carries a
 * row for somebody who is not coming — and the reminder worklist asks their parent
 * for it. So the status here is not a label: it ends the enrollments, which is what
 * stops the bill.
 *
 * Guarded by rank rather than by `can_manage_students`, matching the policies:
 * 20260811000019 grants a permitted teacher SELECT and INSERT and deliberately no
 * UPDATE, because "admit students" is what that box says and editing a guardian's
 * number is not that. A teacher reaching this action is refused twice — here, and
 * again by RLS if this check were ever removed.
 */
export async function updateStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const studentId = String(formData.get('studentId') ?? '')
  if (!studentId) return { error: t.students.errors.notFound }

  const name = String(formData.get('name') ?? '').trim()
  const rawGuardianPhone = String(formData.get('guardianPhone') ?? '')
  const guardianName = String(formData.get('guardianName') ?? '').trim()
  const rawStudentPhone = String(formData.get('phone') ?? '')
  const institution = clamp(String(formData.get('institution') ?? '').trim(), MAX_NAME)
  const classLevel = clamp(String(formData.get('classLevel') ?? '').trim(), MAX_LABEL)
  const studentCode = clamp(String(formData.get('studentCode') ?? '').trim(), MAX_LABEL)
  const batchIds = formData.getAll('batchIds').map(String).filter(Boolean)

  const rawStatus = String(formData.get('status') ?? '')
  const status: StudentStatus = (STUDENT_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as StudentStatus)
    : 'active'

  if (!name) return { error: t.students.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }
  if (guardianName.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  // Still required, and still validated, for the reason createStudent gives: a
  // number that does not work fails silently a month later. An edit is where a
  // wrong one gets fixed, so this is the last place to be lenient about it.
  const guardianPhone = normalizeBdMobile(rawGuardianPhone)
  if (!guardianPhone) return { error: t.students.errors.guardianPhone }

  const studentPhone = rawStudentPhone.trim()
    ? normalizeBdMobile(rawStudentPhone)
    : null
  if (rawStudentPhone.trim() && !studentPhone) {
    return { error: t.students.errors.studentPhone }
  }

  const supabase = await createClient()

  // Read the row back before writing it, scoped by centre as well as by RLS: an
  // owner of two centres satisfies is_staff_admin for both, so the policy alone
  // would let an id from the other one through. The previous status is needed
  // anyway — it decides whether this save is a reactivation, and a reactivation has
  // to pass the plan cap.
  const { data: before } = await supabase
    .from('students')
    .select('id, status')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', studentId)
    .maybeSingle()

  if (!before) return { error: t.students.errors.notFound }

  // A student who was not counted against maxStudents and is about to be. Checked
  // before anything is written, so a refusal leaves the roster exactly as it was.
  if (status === 'active' && before.status !== 'active') {
    const limit = await limitRefusal(session, 'students', 'maxStudents')
    if (limit) return limit
  }

  // Everything the batch checkboxes might change, decided before the first write
  // for the same reason: the per-batch cap has to refuse the whole save rather
  // than half of it.
  const { data: existing, error: existingError } = await supabase
    .from('enrollments')
    .select('id, batch_id, status')
    .eq('coaching_center_id', session.active.centerId)
    .eq('student_id', studentId)

  // A read that failed is not a student with no batches, and the `?? []` this
  // replaces said it was. Read that way, the box the owner just unticked would be
  // dropped on the floor and the save would report success, while every box they
  // left ticked came back as an insert against a row that already exists.
  if (existingError || !existing) return { error: t.errors.saveFailed }

  const enrolments = existing
  const live = enrolments.filter((e) => e.status === 'active' || e.status === 'paused')

  // The checkbox set is authoritative only while the student is coming. Any other
  // status means they have gone, and the boxes the form hid do not get a say.
  //
  // Filtered through the centre's own batches rather than trusted: this is a public
  // endpoint, and a batch id from the other centre would otherwise become an
  // enrollment that RLS has no reason to refuse — the tenant column on the row would
  // be this centre's.
  let wantedIds: string[] = []
  if (status === 'active' && batchIds.length > 0) {
    const { data: mine, error: mineError } = await supabase
      .from('batches')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .in('id', batchIds)

    // The same rule as above and a sharper consequence: nothing came back means
    // none of those batches are this centre's, which ends every enrolment the
    // student has. A failed read must not be allowed to say that.
    if (mineError || !mine) return { error: t.errors.saveFailed }
    wantedIds = mine.map((b) => b.id)
  }

  const wanted = new Set<string>(wantedIds)

  const toRevive = enrolments.filter((e) => e.status !== 'active' && wanted.has(e.batch_id))
  const toInsert = [...wanted].filter((id) => !enrolments.some((e) => e.batch_id === id))
  const toEnd = status === 'active' ? live.filter((e) => !wanted.has(e.batch_id)) : live

  // One seat is one seat whether it is new or coming back, so both count against
  // the per-batch cap — and neither is written if any of them is full.
  const filling = [...toRevive.map((e) => e.batch_id), ...toInsert]
  const full = await fullBatches(supabase, session, filling, 1)
  if (full === null) return { error: t.errors.limitUnknown }
  if (full.length > 0) {
    return {
      error: t.errors.batchFull(full.join(', '), session.plan.maxStudentsPerBatch ?? 0),
    }
  }

  const { error: saveError } = await supabase
    .from('students')
    .update({
      name,
      status,
      student_code: studentCode || null,
      phone: studentPhone,
      guardian_name: guardianName || null,
      guardian_phone: guardianPhone,
      institution: institution || null,
      class_level: classLevel || null,
    })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', studentId)

  if (saveError) {
    if (saveError.code === '23505') return { error: t.students.errors.duplicateCode }
    return { error: t.students.errors.saveFailed }
  }

  // Both copies of the number, because two different features read two different
  // columns. `guardians.phone` is what result-dispatch sends to; the fee board view
  // selects `students.guardian_phone`, so the reminder worklist reads that one.
  // Updating only one of them fixes half the product and leaves the other half
  // texting a stranger — which is worse than the original typo, because the owner
  // has now watched themselves correct it.
  const { data: touched } = await supabase
    .from('guardians')
    .update({ phone: guardianPhone, name: guardianName || null })
    .eq('coaching_center_id', session.active.centerId)
    .eq('student_id', studentId)
    .eq('is_primary', true)
    .select('id')

  // No primary guardian row at all: a student imported before guardians existed, or
  // one whose guardian insert failed. The edit is where that gets repaired rather
  // than noticed, so it is created instead of skipped.
  if ((touched ?? []).length === 0) {
    await supabase.from('guardians').insert({
      coaching_center_id: session.active.centerId,
      student_id: studentId,
      name: guardianName || null,
      phone: guardianPhone,
      is_primary: true,
    })
  }

  if (toEnd.length > 0) {
    // ended_at as well as the status, because a status on its own cannot say when.
    // The invoices already raised for these months are left alone: the student was
    // taught, so the money is owed, and a bill that disappears when somebody leaves
    // is a bill the centre never collects.
    await supabase
      .from('enrollments')
      .update({
        status: status === 'active' ? 'dropped' : ENROLMENT_END[status],
        ended_at: new Date().toISOString(),
      })
      .eq('coaching_center_id', session.active.centerId)
      .in(
        'id',
        toEnd.map((e) => e.id),
      )
  }

  if (toRevive.length > 0) {
    await supabase
      .from('enrollments')
      .update({ status: 'active', ended_at: null })
      .eq('coaching_center_id', session.active.centerId)
      .in(
        'id',
        toRevive.map((e) => e.id),
      )
  }

  if (toInsert.length > 0) {
    // The batch's own subject, for the reason createStudent gives: a chosen one can
    // disagree with the batch and the marks screen then shows the wrong list.
    const { data: batches } = await supabase
      .from('batches')
      .select('id, subject_id')
      .eq('coaching_center_id', session.active.centerId)
      .in('id', toInsert)

    if (batches && batches.length > 0) {
      await supabase.from('enrollments').insert(
        batches.map((b) => ({
          coaching_center_id: session.active.centerId,
          student_id: studentId,
          subject_id: b.subject_id,
          batch_id: b.id,
        })),
      )
    }
  }

  revalidatePath('/settings/students')
  revalidatePath('/teach')
  revalidatePath('/dashboard')
  // The two screens that read a guardian's number: the fee board and the reminder
  // worklist behind it, and the at-risk list, which names the parent to call.
  revalidatePath('/fees')
  revalidatePath('/at-risk')
  return { ok: t.students.saved }
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
  const session = await mayManage('can_manage_students')
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
  // 300 students, so it is a small one.
  const { count } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('coaching_center_id', centerId)
    .eq('status', 'active')

  // Asked only when the plan has a total to compare against, and refused rather
  // than read as zero, for the reason `limitRefusal` carries. A paste is where it
  // would cost the most: one failed count would not admit one row past the cap,
  // it would admit eighty.
  if (session.plan.maxStudents !== null && count === null) {
    return { error: t.errors.limitUnknown }
  }

  const room = roomFor(session.plan, 'maxStudents', count ?? 0)
  const perBatchCap = session.plan.maxStudentsPerBatch

  // Both caps ask about the same number — how many of these lines are new — so
  // the roster is read once for both. Rows that are already on it are taken out
  // first, or re-pasting a register to fix three names would be refused by a
  // plan that has plenty of room for those three.
  const fresh =
    room === null && perBatchCap === null
      ? ready
      : await unknownRows(supabase, centerId, ready)

  // Null is an unread roster, and this one errs the other way: with nothing known,
  // every pasted line looks new, so the paste would be refused as though it were
  // eighty first-time students. Refused either way, then — but told the truth
  // about it, so the owner tries again instead of going to look at our prices.
  if (fresh === null) return { error: t.errors.limitUnknown }

  if (room !== null && fresh.length > room) {
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

  // The RPC writes one enrollment per new student per selected batch, so a paste
  // that fits the roster can still overflow a batch — 40 names into one batch on
  // a plan that holds 30. Checked before the call rather than inside it because
  // refusing the paste whole is the point: the RPC is deliberately one statement,
  // and a half-imported register is exactly what that exists to prevent.
  const full = await fullBatches(supabase, session, batchIds, fresh.length)
  if (full === null) return { error: t.errors.limitUnknown }
  if (full.length > 0) {
    return { error: t.errors.batchFull(full.join(', '), perBatchCap ?? 0) }
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
  // Scoped to the active centre, not only to the id. studentId arrives in a
  // FormData on a public endpoint, and an owner of two centres passes RLS for
  // both — so without this line the switch on one centre's screen can silence a
  // guardian at the other, and the centre that stopped sending has no record of
  // anyone having asked it to.
  const { error } = await supabase
    .from('students')
    .update({ sms_opt_out: optOut })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', studentId)

  if (error) return { error: t.errors.changeFailed }

  revalidatePath('/settings/sms')
  revalidatePath('/settings/students')
  return { ok: optOut ? t.sms.optedOut : t.sms.optedIn }
}

/**
 * Which of the three chase buttons goes first for one family.
 *
 * The owner learns in week one that this father never opens a text and answers
 * WhatsApp inside a minute, and until now there was nowhere to write that down —
 * so they re-remembered it thirty times a month. This is the whole of the write
 * path for it. See src/lib/students/channel.ts for what it changes on the screen,
 * and 20260811000026 for why the product asks rather than guesses.
 *
 * A PREFERENCE IS NOT A PERMISSION. This cannot silence a channel and cannot
 * un-silence one: sms_opt_out is the only column that decides who may be messaged,
 * and it is set by the switch beside this on the same row. Marking a family as
 * WhatsApp-preferred while they are opted out of messages leaves them opted out,
 * and the mark quietly does nothing until that switch changes.
 *
 * Anything unrecognised becomes null rather than an error. This is a public HTTP
 * endpoint like every Server Action, so the value in the FormData is whatever the
 * caller put there; `asPreferredChannel` is what stands between that and an enum
 * column. There is nothing to tell a user about a value no dropdown can produce,
 * and "nobody has said" is the honest reading of a channel we do not recognise.
 */
export async function setPreferredChannel(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  const studentId = String(formData.get('studentId') ?? '')
  const channel = asPreferredChannel(formData.get('channel'))
  if (!studentId) return { error: t.students.errors.notFound }

  const supabase = await createClient()
  // Scoped to the active centre as well as the id, for the reason toggleSmsOptOut
  // gives: an owner of two centres passes RLS for both, and studentId arrives in a
  // FormData that anyone signed in can post.
  const { error } = await supabase
    .from('students')
    .update({ preferred_channel: channel })
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', studentId)

  if (error) return { error: t.errors.changeFailed }

  revalidatePath('/settings/sms')
  // The three screens that draw chase chips. Without these the owner marks a
  // channel, goes to the fee board, and finds the chips in the old order — which
  // reads as the setting not having saved, and the next thing they do is set it
  // again.
  revalidatePath('/fees')
  revalidatePath('/fees/reminders')
  revalidatePath('/progress')
  return { ok: channel ? t.sms.channelSaved : t.sms.channelCleared }
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

/**
 * An unchecked checkbox is simply absent from a FormData, so "missing" has to
 * mean false here. That is only safe because the form always renders all five —
 * a partial form would revoke whatever it happened to leave out, silently. Which
 * is why the list of five lives in `@/lib/permissions` and both forms read it
 * from there rather than keeping their own copy.
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

  /*
   * Staff is a coaching-centre feature, and this endpoint is public HTTP: the
   * screen no longer offers the form, which stops nobody from posting to it.
   *
   * The count check further down cannot stand in for this one. `bootstrap_center`
   * only writes the owner's own teacher row in teacher mode, so a centre that
   * signed up as a centre counts zero teachers — and zero is under a cap of one,
   * so `limitRefusal` said yes and a solo plan could take on staff.
   */
  if (!hasStaff(session.plan)) {
    return { error: t.errors.staffNeedsCenter }
  }

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

  const teacherLimit = await limitRefusal(session, 'teachers', 'maxTeachers')
  if (teacherLimit) return teacherLimit

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

/**
 * Correcting a teacher's name, and what they teach.
 *
 * The same add-only hole the subject list had, on the record of a person: the name
 * typed into the add form was the name for ever. It is on this list, on every batch
 * they run, and it is what an owner reads back when a guardian asks who takes their
 * child's class — so "Rafiqul Islan" was permanent, and the only repair was a
 * second teacher record beside the first, which would have cost a seat and split
 * their batches in two.
 *
 * Subjects move for an ordinary reason rather than a mistaken one: a centre that
 * hires a physics teacher in June has them taking chemistry by September. There was
 * no way to say so.
 *
 * The phone number is deliberately not here. Before an account exists it is edited
 * on the login form below; after one exists it is the login id, copied onto the
 * profile and into the account itself, and giveTeacherLogin's own note explains why
 * a list showing a number that does not sign in would be worse than no edit at all.
 *
 * Neither is `profiles.full_name`. This is the centre's label for a colleague, and
 * the profile is the person's own — they may teach at two centres and see their own
 * name in both. An owner fixing their spelling of it does not get to rewrite what
 * somebody else's app calls them.
 */
export async function updateTeacher(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  // Nobody to edit on a one-teacher plan — see createTeacher's own note on why the
  // screen not offering the form is not the same as the endpoint refusing it.
  if (!hasStaff(session.plan)) {
    return { error: t.errors.staffNeedsCenter }
  }

  const teacherId = await ownTeacherId(
    session,
    String(formData.get('teacherId') ?? ''),
  )
  if (!teacherId) return { error: t.teachers.errors.notFound }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: t.teachers.errors.nameRequired }
  if (name.length > MAX_NAME) return { error: nameTooLong(session.locale) }

  const subjectIds = formData.getAll('subjectIds').map(String).filter(Boolean)

  const supabase = await createClient()
  const centerId = session.active.centerId

  // Re-read rather than trusted from the form, exactly as createTeacher does:
  // nothing stops a POST from carrying another centre's subject id, and
  // teacher_subjects only checks that its own coaching_center_id is ours.
  let wanted: string[] = []
  if (subjectIds.length > 0) {
    const { data: subjects } = await supabase
      .from('subjects')
      .select('id')
      .eq('coaching_center_id', centerId)
      .in('id', subjectIds)
    wanted = (subjects ?? []).map((s) => s.id)
  }

  const { data: saved, error } = await supabase
    .from('teachers')
    .update({ name })
    .eq('coaching_center_id', centerId)
    .eq('id', teacherId)
    .select('id')

  if (error || !saved || saved.length === 0) {
    return { error: t.errors.saveFailed }
  }

  /*
   * The subject links are moved by difference rather than cleared and rewritten.
   *
   * Two reasons, and the second is the one that matters. A delete-then-insert has a
   * moment where the teacher teaches nothing, and if the insert half fails the links
   * are simply gone — the owner asked to add chemistry and lost physics. And because
   * `useOffline` replays whatever was queued when the connection dropped, this
   * action has to survive arriving twice: a difference computed against what is
   * already there is empty the second time, so a replay writes nothing at all.
   *
   * A failed read is not an empty set. `null` here would compute "remove every
   * subject they teach", so it stops instead and says the name was saved, which is
   * true — the name is already written above.
   */
  const { data: linked } = await supabase
    .from('teacher_subjects')
    .select('subject_id')
    .eq('coaching_center_id', centerId)
    .eq('teacher_id', teacherId)

  if (!linked) return { error: t.errors.saveFailed }

  const had = linked.map((row) => row.subject_id)
  const gone = had.filter((id) => !wanted.includes(id))
  const added = wanted.filter((id) => !had.includes(id))

  if (gone.length > 0) {
    await supabase
      .from('teacher_subjects')
      .delete()
      .eq('coaching_center_id', centerId)
      .eq('teacher_id', teacherId)
      .in('subject_id', gone)
  }

  if (added.length > 0) {
    await supabase.from('teacher_subjects').insert(
      added.map((subjectId) => ({
        teacher_id: teacherId,
        subject_id: subjectId,
        coaching_center_id: centerId,
      })),
    )
  }

  revalidatePath('/settings/teachers')
  // The name is what the batch list calls whoever runs each batch, and the
  // dashboard names them too.
  revalidatePath('/settings/batches')
  revalidatePath('/dashboard')
  return { ok: t.teachers.detailsSaved }
}

/** The permission checkboxes on the teacher list. */
export async function saveTeacherPermissions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  // Nobody to restrict on a one-teacher plan — see createTeacher's own note.
  if (!hasStaff(session.plan)) {
    return { error: t.errors.staffNeedsCenter }
  }

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

  /*
   * Switching a teacher off is allowed on every plan, including the ones with no
   * staff features at all. This used to refuse them outright, on the reasoning
   * that "the only row a solo plan has is the owner's own" — which is true of a
   * centre that started on a teacher tier and false of one that was moved down to
   * it. `setCenterPlan` writes the new plan and only warns when the centre is over
   * its seat count, so a centre that drops from six teachers to a one-seat plan
   * keeps five rows it is not paying for, and this refusal was the reason it could
   * never get rid of them: /settings/plan reported 6/1 and the one screen that
   * could fix it would not act. A centre may always shrink toward its plan.
   *
   * Growing past it is still refused, by the seat check below — unchanged, and the
   * reason the two directions are not one rule.
   *
   * The single row this does refuse is the reader's own, and only on a plan with
   * no staff features. That plan draws the list solely to let an over-cap owner
   * trim it, so an owner who switched themselves off would land back on the solo
   * card holding no teacher row, with nothing on screen offering it back. Their
   * own seat is the one the plan actually covers.
   */
  if (!hasStaff(session.plan) && !active && teacher.user_id === session.userId) {
    return { error: t.teachers.errors.keepOwnSeat }
  }

  // Reactivating has to respect the plan limit, or "off then on" would be a way
  // past maxTeachers on the free plan.
  if (active) {
    const limit = await limitRefusal(session, 'teachers', 'maxTeachers')
    if (limit) return limit
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

/**
 * A login for a teacher who was added without one.
 *
 * The add form promises this out loud — teacherForm.loginNowBody, "a login can be
 * given any time later" — and until now nothing in the product could. Adding a
 * teacher without a login is the common case and the form encourages it: the
 * part-timer who takes two batches a week and will never open the app. When that
 * part-timer starts marking their own register in September, the only way to give
 * them a way in was to add them a second time, which is a second teacher row, a
 * second seat against the plan, and last term's batches still hanging off the first.
 *
 * The number comes from the form rather than from the row, because for most of these
 * teachers there is no number on the row — the field is optional on the add form and
 * the reason to fill it is exactly this. It is written back, which makes this the one
 * place a teacher's phone can be corrected, and deliberately the only one: once an
 * account exists that number is its login id, held on `profiles` and inside the auth
 * email as well, so editing the copy on the teacher row would leave the list showing
 * a number that does not sign in.
 *
 * The account itself is createTeacher's path, step for step: the admin client because
 * the public signUp would try the shared free SMTP, the lookup against the unique
 * `profiles.phone`, and the refusal to link on the first submit. See that action for
 * why the confirm step is not a courtesy. The password typed here is used only when
 * an account is created — a linked teacher keeps the one they already had, which is
 * what settings.teachers.confirmLink promises them.
 *
 * What linking still cannot do is prove the owner has the number. Nobody has sent a
 * code to it, so an owner who knows a stranger's number can attach that account to a
 * teacher row here. It buys them nothing on its own, and the password box next door
 * refuses any account with a second membership anywhere (lib/auth/reset.ts) — but an
 * account whose only membership is the one just created is resettable, so an owner can
 * lock out a person who is currently nobody's teacher. Closing that needs an OTP on
 * the number, which needs a sender ID; until then it is written down rather than
 * pretended away.
 *
 * No seat check, and its absence is deliberate rather than forgotten. A plan limit
 * counts teacher rows that are switched on; this adds no row and switches nothing on,
 * so an owner already at their cap may still give the teachers they have a way in.
 */
export async function giveTeacherLogin(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  if (!hasStaff(session.plan)) {
    return { error: t.errors.staffNeedsCenter }
  }

  const rawPhone = String(formData.get('phone') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirmedLink = formData.get('confirmLink') !== null

  // The two failures are told apart, as they are on the add form: an empty box and
  // a mistyped number are different mistakes and only one of them is retyping.
  if (!rawPhone.trim()) return { error: t.teachers.errors.loginNeedsPhone }
  const phone = normalizeBdMobile(rawPhone)
  if (!phone) return { error: t.teachers.errors.phoneInvalid }

  if (password.length < MIN_PASSWORD) {
    return { error: passwordTooShort(session.locale) }
  }

  const supabase = await createClient()
  const centerId = session.active.centerId

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, name, user_id, active')
    .eq('id', String(formData.get('teacherId') ?? ''))
    .eq('coaching_center_id', centerId)
    .maybeSingle()

  if (!teacher) return { error: t.teachers.errors.notFound }

  // Not an upgrade path for an account that exists. Changing a password is
  // resetTeacherPassword and changing the number behind a live login is neither.
  if (teacher.user_id) return { error: t.teachers.errors.hasLogin }

  const loginEmail = phoneToLoginEmail(phone)
  if (!loginEmail) return { error: t.teachers.errors.phoneInvalid }

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('phone', phone)
    .maybeSingle()

  // Never on the first submit — createTeacher's note, and the same stakes: one
  // mistyped digit would hand a stranger a teacher account inside this centre.
  if (existing && !confirmedLink) {
    return { confirm: t.teachers.confirmLink(existing.full_name || t.teachers.noName) }
  }

  let userId = existing?.id ?? null

  if (!userId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: teacher.name, phone, locale: session.locale },
    })

    if (createError || !created.user) {
      return { error: t.teachers.errors.loginFailed }
    }
    userId = created.user.id
  }

  const { error } = await supabase
    .from('teachers')
    .update({ user_id: userId, phone })
    .eq('id', teacher.id)
    .eq('coaching_center_id', centerId)

  // The account may exist at this point with nothing pointing at it, which is
  // recoverable exactly as it is in createTeacher: submitting again finds it
  // through the lookup above and links it rather than failing on the unique phone.
  if (error) return { error: t.teachers.errors.loginFailed }

  // Only for a teacher who is switched on. Switching one off deletes this row on
  // purpose — it is what cuts them off from the batch list and their colleagues'
  // numbers — so writing one here would quietly let somebody back in through the
  // login screen an owner has just been given a button for.
  if (teacher.active) {
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

  if (existing) {
    return {
      ok: t.teachers.linked(existing.full_name || t.teachers.noName),
      linked: existing.full_name || t.teachers.noName,
    }
  }

  return { ok: t.teachers.loginGiven }
}

/**
 * A new password for a teacher who cannot get in.
 *
 * The only way back into this app for somebody who has forgotten their password.
 * Login is a phone number and a password — no email, no OTP — so there is no link to
 * send and nowhere to send it; see (auth)/login-form.tsx. The owner told this teacher
 * their first password out loud, so telling them a second one is the same act.
 *
 * WHO MAY BE RESET IS NOT "MY TEACHERS". It is lib/auth/reset.ts, and the reasoning
 * there is worth reading before touching this: because adding a teacher deliberately
 * links to an account that already exists, "a teacher of my centre" includes accounts
 * that own other centres, and resetting one of those is a full takeover of somebody
 * else's fee book and somebody else's students' guardians' phone numbers. Both reads
 * below run past RLS because the deciding fact — every centre this account belongs to
 * — is one an owner is not allowed to see.
 *
 * IT IS NOT HOW YOU REMOVE SOMEBODY WHO HAS LEFT, and the copy on the screen says so.
 * GoTrue keeps existing sessions alive across a password change, so a teacher already
 * signed in on their own phone stays signed in. `toggleTeacherActive` is the control
 * that actually cuts access: it drops the centre membership and the teacher-scoped
 * policies with it.
 */
export async function resetTeacherPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await staffAdmin()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings

  // Staff is a coaching-centre feature and this is a public endpoint —
  // createTeacher's note on the same line applies here word for word.
  if (!hasStaff(session.plan)) {
    return { error: t.errors.staffNeedsCenter }
  }

  const password = String(formData.get('password') ?? '')
  if (password.length < MIN_PASSWORD) {
    return { error: passwordTooShort(session.locale) }
  }

  const supabase = await createClient()
  const centerId = session.active.centerId

  // The account is read off our own teacher row and never taken from the form. A
  // `user_id` in a POST body is a request to change a stranger's password.
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, user_id')
    .eq('id', String(formData.get('teacherId') ?? ''))
    .eq('coaching_center_id', centerId)
    .maybeSingle()

  if (!teacher) return { error: t.teachers.errors.notFound }

  const userId = teacher.user_id
  const admin = createAdminClient()

  let memberships: Membership[] = []
  let isPlatformAdmin = false

  if (userId) {
    const [{ data: rows, error: readFailed }, { data: profile }] = await Promise.all([
      // scoped-by: deliberately platform-wide — the rule is "does this account
      // belong to any centre other than ours", and a centre filter would answer
      // yes to exactly the accounts that must be refused.
      admin.from('center_members').select('coaching_center_id, role').eq('user_id', userId),
      admin.from('profiles').select('is_platform_admin').eq('id', userId).maybeSingle(),
    ])

    // A failed read is not an empty one. Falling through with no memberships would
    // refuse with "switch them on first", which is a wrong answer that sounds like
    // a right one.
    if (readFailed) return { error: t.errors.changeFailed }

    memberships = rows ?? []
    isPlatformAdmin = profile?.is_platform_admin ?? false
  }

  // `|| !userId` only narrows the type: a null id already comes back as noAccount
  // from the function, which is where that rule is written and tested.
  const refusal = passwordResetRefusal(
    { userId, readerId: session.userId, memberships, isPlatformAdmin },
    centerId,
  )
  if (refusal || !userId) {
    return { error: t.teachers.reset.errors[refusal ?? 'noAccount'] }
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { error: t.teachers.reset.failed }

  // Nothing on the page changes, so nothing is revalidated. What the owner needs
  // next is to read the password back out to the teacher standing there.
  return { ok: t.teachers.reset.done }
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
  return guard(
    () => requireRole('owner'),
    (d) => d.settings.center.errors.ownerOnly,
  )
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
