'use server'

/**
 * Writing down something the centre told its families.
 *
 * The one write behind /notices, and like every other outbound thing in this product
 * it sends nothing. There is no registered sender ID and no aggregator account, so the
 * message goes out of the owner's own handset — this records what was said, to whom,
 * and when, so that a fortnight later the centre can answer "did we tell them about
 * Thursday?" with something better than memory.
 *
 * WHY IT IS A ROW AND NOT JUST A CLIPBOARD. Without the record this screen is a
 * textarea, and a textarea is what the owner already has in WhatsApp. The row is the
 * product: it is the difference between a message and a noticeboard, it survives the
 * phone being handed to somebody else, and on the day an aggregator exists it is
 * already the queue — `notices` is read by `notices_audience_read`, which is written
 * for a parent app that does not exist yet and will.
 *
 * Staff-admin only, matching `notices_staff_admin_write` exactly. A notice goes out in
 * the centre's name to every family in a batch, which is not a thing a teacher hired
 * in March should be able to do on their own; `can_send_sms` lets them tell one family
 * about one absence, which is a different act. The role is re-checked here rather than
 * trusted from the page, because a Server Action is a public HTTP endpoint.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireRole, AuthError, getSession } from '@/lib/auth/session'
import { MAX_NAME, MAX_NOTICE } from '@/lib/limits'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { nameTooLong } from '@/lib/i18n/messages'
import type { CenterSession } from '@/lib/auth/session'

export type NoticeState = { error?: string; ok?: string } | null

/**
 * How long an identical notice counts as the same notice. See `postNotice`.
 *
 * Two hours, which is a guess at the far end of an offline gap rather than at
 * anything about noticeboards. `useOffline` replays a queued request when the phone
 * finds a signal, and a centre in a tin-roofed room on the edge of a town can be an
 * hour away from that.
 */
const SAME_NOTICE_MS = 2 * 60 * 60 * 1000

/**
 * The caller, or the sentence to show somebody who is not allowed to be one.
 *
 * The same conversion the settings and account actions do: the require* helpers throw
 * and a form wants a sentence. One message for both failures — not signed in, and
 * signed in as a teacher — because they are the same answer from the reader's side and
 * because a screen that distinguishes them tells a stranger which of the two they got.
 */
async function caller(): Promise<CenterSession | NoticeState> {
  try {
    return await requireRole('manager')
  } catch (err) {
    if (err instanceof AuthError) {
      const who = await getSession()
      return { error: dict(who?.locale ?? DEFAULT_LOCALE).denied.title }
    }
    throw err
  }
}

function isSession(value: CenterSession | NoticeState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Puts one notice on the centre's record.
 *
 * `audience: 'guardians'` on every row, and the column is not offered as a choice.
 * The enum holds four values because the schema was written for an app with a parent
 * panel and a student panel in it; this product has neither, so the only audience a
 * notice can actually reach is a guardian with a phone, and a picker offering
 * "students" would promise a delivery nothing performs.
 *
 * `batch_id` null means the whole centre. A nullable column rather than a row per
 * batch, because "closed for Eid" is one thing the centre said once — five rows saying
 * it would make the record read as five announcements and would make the log unusable
 * by the third holiday.
 *
 * WHY AN IDENTICAL NOTICE IS NOT WRITTEN TWICE. Any Server Action in this app may be
 * replayed: `useOffline` queues the request when the phone has no signal and sends it
 * again when it does, and the browser's own double-submit is a thumb on a slow
 * connection. Nothing here is money and nothing is sent, so a duplicate costs no more
 * than a log with the same sentence in it twice — but the log is the entire feature,
 * and one an owner stops trusting is worse than none. So the same title and body to the
 * same audience inside two hours is treated as the notice that is already there, and
 * reported as success rather than as a refusal: the owner wanted a record of saying
 * this, and there is one.
 */
export async function postNotice(
  _prev: NoticeState,
  formData: FormData,
): Promise<NoticeState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).notices
  const centerId = session.active.centerId

  const title = String(formData.get('title') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  // '' from the picker's first option, which is the whole centre. Not a sentinel
  // string like 'all': an empty value is what a `<select>` submits for an option with
  // no value, so the null case needs no agreement between the form and this file.
  const batchId = String(formData.get('batchId') ?? '').trim() || null

  if (!title) return { error: t.errors.titleRequired }
  if (title.length > MAX_NAME) return { error: nameTooLong(session.locale) }
  if (!body) return { error: t.errors.bodyRequired }
  if (body.length > MAX_NOTICE) return { error: t.errors.bodyTooLong }

  const supabase = await createClient()

  /*
   * The batch is read back before it is written down, through the caller's own client
   * so RLS decides. A batch id off a form is a suggestion — the composite foreign key
   * would refuse another centre's batch anyway, but it would refuse it as a database
   * error, and "something went wrong" is the wrong sentence for a picker whose batch
   * was archived while the screen was open.
   */
  if (batchId) {
    const { data: batch } = await supabase
      .from('batches')
      .select('id')
      .eq('coaching_center_id', centerId)
      .eq('id', batchId)
      .maybeSingle()

    if (!batch) return { error: t.errors.noBatch }
  }

  const since = new Date(Date.now() - SAME_NOTICE_MS).toISOString()
  let recent = supabase
    .from('notices')
    .select('id')
    .eq('coaching_center_id', centerId)
    .eq('title', title)
    .eq('body', body)
    .gte('published_at', since)
    .limit(1)

  // `.is` and not `.eq`, because SQL will not compare a null with an equals sign and
  // the whole-centre notice is exactly the null case.
  recent = batchId ? recent.eq('batch_id', batchId) : recent.is('batch_id', null)

  const { data: already } = await recent
  if (already && already.length > 0) return { ok: t.saved }

  const { data: saved, error } = await supabase
    .from('notices')
    .insert({
      coaching_center_id: centerId,
      batch_id: batchId,
      title,
      body,
      audience: 'guardians',
      // Who wrote it, for a centre with a manager as well as an owner. Nothing reads
      // it back on any screen yet; it is here because the day somebody asks "who told
      // them the exam moved" is the day it is too late to start recording it.
      created_by: session.userId,
    })
    .select('id')

  // Zero rows and no error is what an RLS refusal looks like from here, which is why
  // the count is checked and not only `error`.
  if (error || !saved || saved.length === 0) return { error: t.errors.failed }

  revalidatePath('/notices')

  return { ok: t.saved }
}
