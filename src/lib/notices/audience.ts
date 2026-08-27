/**
 * Which numbers one notice goes to, and how many families it cannot reach.
 *
 * The four outbound things this product already sends are one message per family —
 * a fee, an absence, a result, the week's note — and each is built per student
 * because each says that student's name. A notice is the opposite shape: the same
 * sentence to everybody in a batch, or to the whole centre. So the unit of work here
 * is a list of numbers rather than a list of messages, and the arithmetic that
 * matters is deduplication.
 *
 * WHY DEDUPLICATION IS THE WHOLE JOB. A student is enrolled once per subject, so a
 * boy taking physics and chemistry in one batch is two enrolment rows; two sisters in
 * one batch are two students behind one guardian number. Either would put the same
 * number in the list twice, and a list pasted into a phone with a number in it twice
 * sends that family the message twice. Counted once per batch and once centre-wide,
 * separately — a family with a child in two batches does get a message from each,
 * because those are two different pieces of news.
 *
 * WHAT SILENCES A FAMILY is `sms_opt_out`, on the student or on the primary guardian,
 * exactly as `planAbsenceNotices` reads it. A notice is not exempt for being general:
 * a family who asked not to be texted did not ask only about fees. They are counted
 * rather than dropped in silence, so a screen can say "38 numbers, 2 families not
 * messaged" instead of quietly sending to 38 and calling it everybody.
 *
 * The arithmetic is a pure function below the reader, so tests/notice-reach.test.ts
 * can put the sibling and the two-subject cases in front of it without a database.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../supabase/types.ts'

/** A guardian as the query below asks for them. */
type GuardianRow = {
  phone: string
  is_primary: boolean
  sms_opt_out: boolean
}

/** A student as the query below asks for them. */
type StudentRow = {
  id: string
  guardian_phone: string | null
  sms_opt_out: boolean
  guardians: GuardianRow[] | null
}

/**
 * One active enrolment. `students` is typed both ways because PostgREST returns a
 * to-one embed as an object and the generated types are not always sure which.
 */
export type AudienceRow = {
  batch_id: string
  students: StudentRow | StudentRow[] | null
}

/** How far one notice gets. */
export type Reach = {
  /** Deduplicated E.164 numbers, in the order the roster gave them. */
  phones: string[]
  /** Distinct students behind those numbers — higher than `phones.length` for siblings. */
  students: number
  /** Families whose student or primary guardian is opted out of messages. */
  skippedOptedOut: number
  /** Families with no guardian number on file at all. */
  skippedNoPhone: number
}

export type NoticeReach = {
  /** Every active enrolment in the centre, deduplicated across batches. */
  all: Reach
  /** The same, per batch id. A batch with no reachable family still has an entry. */
  byBatch: Record<string, Reach>
}

/** An empty result, which is a real answer: a centre on its first day has one. */
const EMPTY: Reach = { phones: [], students: 0, skippedOptedOut: 0, skippedNoPhone: 0 }

/**
 * A `Reach` under construction, plus the two sets that make it dedupe.
 *
 * The sets are what keep this honest and they are why the accumulator is not just a
 * `Reach`: `seenStudent` stops a second subject counting a family twice, and
 * `seenPhone` stops a sibling adding a number the message would then go to twice.
 * They are dropped by `finish`, so nothing downstream can be tempted to read them.
 */
type Acc = Reach & { seenStudent: Set<string>; seenPhone: Set<string> }

function newAcc(): Acc {
  return { ...EMPTY, phones: [], seenStudent: new Set(), seenPhone: new Set() }
}

function finish(acc: Acc): Reach {
  return {
    phones: acc.phones,
    students: acc.students,
    skippedOptedOut: acc.skippedOptedOut,
    skippedNoPhone: acc.skippedNoPhone,
  }
}

/**
 * Fold one student into one accumulator.
 *
 * The order of the three refusals is the order the absence planner uses, and it is
 * deliberate: opted out is checked before the number is looked for, so a family who
 * asked not to be texted and also has no number on file is reported as the first and
 * not the second. Only one of those two sentences leads an owner to do something, and
 * "add a number" is the wrong thing to go and do for that family.
 */
function add(acc: Acc, student: StudentRow): void {
  if (acc.seenStudent.has(student.id)) return
  acc.seenStudent.add(student.id)
  acc.students++

  const guardians = student.guardians ?? []
  const primary = guardians.find((g) => g.is_primary) ?? guardians[0] ?? null

  if (student.sms_opt_out || primary?.sms_opt_out) {
    acc.skippedOptedOut++
    return
  }

  // The guardian row wins; students.guardian_phone is the display copy and the
  // fallback for rows written before guardians existed. Same precedence as
  // ../sms/absence-dispatch.ts, so one family is never reachable on one screen and
  // unreachable on the other.
  const phone = primary?.phone ?? student.guardian_phone
  if (!phone) {
    acc.skippedNoPhone++
    return
  }

  if (acc.seenPhone.has(phone)) return
  acc.seenPhone.add(phone)
  acc.phones.push(phone)
}

/**
 * The reach of every possible notice, from the centre's active enrolments.
 *
 * Every batch at once rather than one on request, because the screen offers a batch
 * picker: an owner changing their mind about who a notice is for would otherwise cost
 * a round trip per change, and the whole roster is one query either way.
 *
 * `batchIds` is passed in so a batch nobody is enrolled in still gets an entry. The
 * alternative is a picker where choosing an empty batch shows nothing at all, which
 * reads as a screen that failed rather than as a batch with nobody in it yet.
 */
export function noticeReach(rows: AudienceRow[], batchIds: string[] = []): NoticeReach {
  const all = newAcc()
  const perBatch = new Map<string, Acc>()
  for (const id of batchIds) perBatch.set(id, newAcc())

  for (const row of rows) {
    const student = Array.isArray(row.students) ? row.students[0] : row.students
    if (!student) continue

    add(all, student)

    let acc = perBatch.get(row.batch_id)
    if (!acc) {
      acc = newAcc()
      perBatch.set(row.batch_id, acc)
    }
    add(acc, student)
  }

  const byBatch: Record<string, Reach> = {}
  for (const [id, acc] of perBatch) byBatch[id] = finish(acc)

  return { all: finish(all), byBatch }
}

/**
 * How many numbers go on the clipboard at once.
 *
 * Not a fact about Bangladesh and not a fact about the operators — it is a fact about
 * handsets. The recipient box in Google Messages and in the stock Samsung app stops
 * accepting names somewhere around twenty, silently, and a paste of a hundred and
 * fifty numbers into one of them either truncates or refuses. So a batch of thirty is
 * two chips and the whole centre is eight, which is eight sends the owner can count
 * rather than one that half worked.
 *
 * Twenty rather than the highest number that works on the newest phone, because the
 * cost of being conservative is one extra paste and the cost of being wrong is a
 * notice forty families never got and nobody knows they never got.
 */
export const CLIPBOARD_RECIPIENTS = 20

/**
 * The numbers, in the groups they can actually be pasted in.
 *
 * Always at least one group, even an empty one, so a caller can render "no numbers"
 * from the same shape it renders numbers from.
 */
export function chunkPhones(
  phones: string[],
  size: number = CLIPBOARD_RECIPIENTS,
): string[][] {
  if (phones.length === 0) return [[]]
  const out: string[][] = []
  for (let i = 0; i < phones.length; i += size) out.push(phones.slice(i, i + size))
  return out
}

/**
 * The active enrolments `noticeReach` counts, and nothing else.

 *
 * A reader rather than a read-and-count, so the page can put this in the same
 * `Promise.all` as its batch list and its notice log — the arithmetic needs the batch
 * ids, and a helper that did both would have to wait for the batches before it started
 * on the roster.
 *
 * Null on a failed query, and the caller must not read that as an empty roster: a
 * centre with two hundred families would then be told its notice reaches nobody
 * because a request timed out. The screen says it could not read the roster instead.
 *
 * Student status is deliberately not a condition here, the same call the arrears
 * worklist makes about its own list. Somebody marked inactive who still holds an
 * active enrolment is still sitting in the room on Saturday, and a notice about
 * Saturday is for them.
 */
export async function readAudienceRows(
  supabase: SupabaseClient<Database>,
  centerId: string,
): Promise<AudienceRow[] | null> {
  const { data } = await supabase
    .from('enrollments')
    .select(
      `batch_id,
       students (id, guardian_phone, sms_opt_out,
                 guardians (phone, is_primary, sms_opt_out))`,
    )
    .eq('coaching_center_id', centerId)
    .eq('status', 'active')

  return (data as AudienceRow[] | null) ?? null
}

