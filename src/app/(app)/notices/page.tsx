import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/bd/time'
import { buildNoticeSms } from '@/lib/sms/templates'
import { noticeReach, readAudienceRows, chunkPhones } from '@/lib/notices/audience'
import { worstFailure } from '@/lib/supabase/page'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { NoticeForm, type BatchOption } from './notice-form'
import { NoticeLog, type NoticeRowView } from './notice-log'

/** How far back the log goes. See the note on it below. */
const LOG_LIMIT = 20

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).notices.title} — CoachDesk`,
  }
}

/**
 * Telling every family in a batch the same thing, once.
 *
 * The other four messages this product sends are one per family and say the child's
 * name: the fee, the absence, the result, the week's note. This is the errand none of
 * them cover and every centre has — the room is shut on Thursday, the exam moved to
 * Saturday, buy the new book — and today an owner does it by typing the same sentence
 * into WhatsApp forty times, or by pinning paper to a wall that parents never enter.
 *
 * WHAT THIS SCREEN CAN HONESTLY DO. It cannot send. There is no BTRC-registered sender
 * ID and no aggregator account behind this product yet, so the sending is a thumb on
 * the owner's own handset, and the two things that actually make that bearable are the
 * two chips: the message on the clipboard, and every number on the clipboard. Pasting
 * thirty numbers into one SMS or WhatsApp recipient box and pasting the message under
 * it is three taps for a batch, against forty. That is the whole feature, and it is
 * deliberately not dressed up as a broadcast — nothing here claims a delivery.
 *
 * AND IT WRITES THE ROW, which is the part that survives. `notices` is the record of
 * what the centre told whom, it outlives the owner's chat history and the phone being
 * passed to the new receptionist, and on the day an aggregator exists it is already
 * the queue: `notices_audience_read` was written for a parent app that does not exist
 * yet, and this fills the table it reads.
 *
 * No plan gate, on purpose. `manualMessaging` is true on every tier including free and
 * always will be — a centre's own thumb sending its own message on its own phone is
 * not ours to sell. What ৳499 buys is the message the product *writes* for them, which
 * is /progress.
 */
export default async function NoticesPage() {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.notices
  const centerId = session.active.centerId
  const supabase = await createClient()

  /*
   * Three reads at once, none of which needs the others. The roster is the expensive
   * one — every active enrolment in the centre, with its guardian — and it is read in
   * full rather than per batch because the picker changes audience without a round
   * trip: an owner deciding between "the whole centre" and "morning physics" while
   * looking at how many numbers each reaches is the point of the screen.
   */
  const [{ data: batches }, { data: notices }, audience] = await Promise.all([
    supabase
      .from('batches')
      .select('id, name, subjects (name, name_bn)')
      .eq('coaching_center_id', centerId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('notices')
      .select('id, title, body, batch_id, published_at')
      .eq('coaching_center_id', centerId)
      // Newest first, and capped: this is a record to check against, not an archive to
      // browse. Twenty is about a term of real announcements, and a centre that needs
      // the one from March needs a search box, which is a different screen than this.
      .order('published_at', { ascending: false })
      .limit(LOG_LIMIT),
    readAudienceRows(supabase, centerId),
  ])

  const batchRows = batches ?? []
  const batchIds = batchRows.map((b) => b.id)

  // Null means the roster query failed, which is not the same as a centre with nobody
  // in it — see readAudienceRows. The form is told so it can offer the message chip
  // and withhold the numbers chip, rather than offering a chip that copies nothing.
  //
  // Two failures, one missing chip, two sentences: a dropped read is worth another tap
  // and a roster past the row ceiling is not, and `rosterFailed` used to end with "try
  // again in a moment for the numbers" either way.
  const rosterProblem = worstFailure(audience)
  const reach = 'rows' in audience ? noticeReach(audience.rows, batchIds) : null

  const options: BatchOption[] = batchRows.map((batch) => ({
    id: batch.id,
    // The batch's own name and its subject, because a centre with "সকাল ক" twice —
    // once for physics, once for chemistry — is the ordinary case, and a picker that
    // shows only the first half asks the owner to guess which one they are texting.
    label: `${batch.name} · ${localName(
      Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects,
      locale,
    )}`,
    reach: reach?.byBatch[batch.id] ?? null,
  }))

  const labelById = new Map(options.map((o) => [o.id, o.label]))

  const logRows: NoticeRowView[] = (notices ?? []).map((row) => {
    const sms = buildNoticeSms({ body: row.body, centerName: session.active.centerName })
    const forBatch = row.batch_id ? (reach?.byBatch[row.batch_id] ?? null) : reach?.all

    return {
      id: row.id,
      title: row.title,
      body: row.body,
      when: formatDate(row.published_at.slice(0, 10), locale),
      // A batch that has since been switched off keeps its notice in the log and loses
      // its name from it. The alternative is a second query for archived batches to
      // label a row nobody can act on any more, and `t.oneBatch` says the true part.
      audience: row.batch_id ? (labelById.get(row.batch_id) ?? t.oneBatch) : t.everyone,
      sms: sms.body,
      segments: sms.segments,
      groups: chunkPhones(forBatch?.phones ?? []),
    }
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.back}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.lead}</p>
      </div>

      <Card>
        <NoticeForm
          batches={options}
          everyone={reach?.all ?? null}
          t={t}
          common={d.common}
        />
      </Card>

      {/* The roster failed to load, which is a different sentence from "nobody is
          enrolled" and has to be, because the numbers chip is missing in both cases and
          only one of them is the owner's to fix. The form above still works: a notice
          with no numbers beside it is still a record, and the message chip still hands
          them the words. */}
      {rosterProblem !== null && (
        <Card>
          <p className="text-sm text-ink-soft">
            {rosterProblem === 'tooLarge' ? t.rosterTooLarge : t.rosterFailed}
          </p>
        </Card>
      )}

      {logRows.length > 0 ? (
        <div>
          <h2 className="mb-2 font-semibold text-ink">{t.logTitle}</h2>
          <NoticeLog rows={logRows} t={t} chase={d.chase} />
        </div>
      ) : (
        <Card>
          <p className="font-medium text-ink">{t.noneTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.noneBody}</p>
        </Card>
      )}
    </div>
  )
}
