'use server'

/**
 * The one write this screen has: a note that a family was told how their child's
 * week went.
 *
 * Nothing here sends anything. The chip beside it hands the message to the owner's
 * own phone — their number, their operator's rate, no registered sender ID, none of
 * which exists yet — and this records that it happened so the same family is not
 * offered the same message twice on Thursday and again on Friday. Without the
 * record the feature works for the first twenty students and is unusable for a
 * centre with a hundred and fifty.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import {
  requireRole,
  requireWritable,
  requireCapability,
  AuthError,
} from '@/lib/auth/session'
import { has } from '@/lib/plans'
import { normalizeBdMobile } from '@/lib/bd/phone'
import type { OutreachChannel } from '@/lib/supabase/types'

/** The three ways an owner can reach a family from their own handset. */
const CHANNELS = new Set<OutreachChannel>(['sms', 'whatsapp', 'call'])

/**
 * Comfortably longer than the WhatsApp text, which is the longest of the three.
 * A cap at all because this string arrives from the browser — the row builds the
 * message client-side, so the page does not ship two rendered variants per student
 * to a phone on 3G — and an unbounded text column fed by a client is a place to
 * paste a megabyte.
 */
const MAX_BODY = 1000

/** YYYY-MM-DD, and nothing that merely looks like a date. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export type ProgressLog = {
  studentId: string
  channel: OutreachChannel
  /** The window the message described, as the view handed it to the screen. */
  coversFrom: string
  coversTo: string
  /** The guardian number the link was aimed at; null for anything unparseable. */
  toPhone?: string | null
  /** The exact text put in front of the owner. Null for a call. */
  body?: string | null
}

/**
 * Records that a guardian was told about their child's week.
 *
 * Called from the chip's tap handler rather than a form, because the tap has to do
 * two things at once: open the phone's SMS or WhatsApp app, and leave a note that
 * it happened. The link does the first and nothing here interferes with it.
 *
 * The window and the body come from the client rather than being recomputed, for
 * the reason `logFeeReminder` gives about its amount: this row exists to answer
 * "what did I tell this family", and a message rebuilt at log time could describe
 * a different week — the owner sends on Thursday night, the register for Friday
 * lands an hour later, and the log would insist the parent was told about it. What
 * must not come from the client is *which student*, and that is read back through
 * RLS so the database decides whether they are this centre's at all.
 *
 * Re-checks the plan as well as the role. A Server Action is a public HTTP endpoint
 * — the paywall on the page in front of it stops nobody who can type a fetch — and
 * `parentSummary` is the line a teacher pays ৳499 for.
 *
 * And `messages` (§6.2), for the same reason and one more: `progress_updates` is not one of
 * the tables 20260811000063 narrows, so there is no policy behind this line. It is the fence.
 *
 * Returns whether the row was written. The caller ticks the row only on true, so
 * the screen never claims a note it has no record of.
 */
export async function logProgressUpdate(
  input: ProgressLog,
): Promise<{ logged: boolean }> {
  let session
  try {
    session = requireCapability(
      'messages',
      requireWritable(await requireRole('manager')),
    )
  } catch (err) {
    // Nothing to say to the caller beyond "it did not happen": this is called from
    // a tap handler with no form and no place to put a sentence, so the row it
    // would have ticked simply stays unticked. An AuthError is the expected failure
    // here — anything else is a bug and belongs in the logs.
    //
    // A read-only centre lands here too and is refused for the same reason the rest of
    // its writes are. The chip stays unticked, which is the truth: the SMS app opened
    // because a link cannot be un-tapped, but nothing was recorded. The banner across
    // the top of the screen is what explains it.
    if (err instanceof AuthError) return { logged: false }
    throw err
  }

  if (!has(session.plan, 'parentSummary')) return { logged: false }

  const studentId = String(input?.studentId ?? '')
  const channel = input?.channel
  if (!studentId || !CHANNELS.has(channel)) return { logged: false }

  const coversFrom = String(input?.coversFrom ?? '')
  const coversTo = String(input?.coversTo ?? '')
  // Checked here as well as by the table's own constraint, so a malformed window
  // fails as a no-op rather than as a 500 out of Postgres.
  if (!DAY_RE.test(coversFrom) || !DAY_RE.test(coversTo)) return { logged: false }
  if (coversTo < coversFrom) return { logged: false }

  const supabase = await createClient()

  // Through the students table, which RLS scopes to this centre. Active only: the
  // screen never lists a dropped student, so a note against one can only come from
  // a page left open through the change, and their guardian does not want a weekly
  // update about a seat their child has left.
  const { data: student } = await supabase
    .from('students')
    .select('id, status')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', studentId)
    .maybeSingle()

  if (!student?.id || student.status !== 'active') return { logged: false }

  const body = String(input?.body ?? '').slice(0, MAX_BODY)

  const { error } = await supabase.from('progress_updates').insert({
    coaching_center_id: session.active.centerId,
    student_id: student.id,
    channel,
    covers_from: coversFrom,
    covers_to: coversTo,
    // Normalised so the column keeps the one meaning it is documented to have.
    // Null rather than the raw string if it will not parse: a log saying the
    // message went to "01712-34" is worse than one that admits it does not know.
    to_phone: normalizeBdMobile(input?.toPhone),
    body: body || null,
    sent_by: session.userId,
  })

  if (error) return { logged: false }

  // The worklist, so the next visit no longer offers this family. Not /dashboard:
  // its count is server-rendered on every navigation anyway, and this screen
  // defends its own list against the re-render — see the frozen state in
  // progress-list.tsx, which exists so a row cannot vanish under a thumb.
  revalidatePath('/progress')

  return { logged: true }
}
