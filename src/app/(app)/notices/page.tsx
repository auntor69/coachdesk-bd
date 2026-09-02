import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageCapability, getSession } from '@/lib/auth/session'
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

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
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
 *
 * `messages` GATES IT (§6.2), and the fence is this app's rather than the database's.
 * 20260811000063 puts `notices` in its fourth section — writes narrowed, reads left open —
 * so a manager without the word could read the log and would be refused the insert. Both
 * halves of this screen are the narrowed half: it exists to write a notice, and to hand the
 * owner every guardian's number in the centre. The action asks the same question again.
 */
export default async function NoticesPage() {
  const session = await pageCapability('messages')
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

  /*
   * THE AUDIENCE PICKER DEFAULTS TO EVERY FAMILY AT THE CENTRE, SO A BATCH LIST THAT
   * DID NOT ARRIVE MAY NOT BE THE ONLY THING LEFT ON IT.
   *
   * `batches ?? []` stood here, and on this screen of all of them it is the wrong
   * reflex. Everywhere else a dropped option list costs a tick an owner can add later;
   * here it leaves a form that looks finished, is already set to three hundred
   * families, and has no way left to say the thirty it was written for. The owner is
   * the one who sends — their own thumb, their own credit, out of their own handset —
   * so what it costs is not a row that can be corrected afterwards. It is an
   * unrecallable message about one shut room, read by every family in the centre.
   *
   * So null is carried down to the return, where the form is withheld and the reason
   * given. Not a hidden field, because there is no present value to carry: nothing is
   * being corrected here, a notice is being written. And not a line beside the picker
   * either, the way both admission forms take their missing ticks — the one audience
   * the picker could still offer is the widest one, and it is already chosen.
   */
  const batchIds = batches === null ? [] : batches.map((b) => b.id)

  // Null means the roster query failed, which is not the same as a centre with nobody
  // in it — see readAudienceRows. The form is told so it can offer the message chip
  // and withhold the numbers chip, rather than offering a chip that copies nothing.
  //
  // Two failures, one missing chip, two sentences: a dropped read is worth another tap
  // and a roster past the row ceiling is not, and `rosterFailed` used to end with "try
  // again in a moment for the numbers" either way.
  const rosterProblem = worstFailure(audience)
  const reach = 'rows' in audience ? noticeReach(audience.rows, batchIds) : null

  const options: BatchOption[] | null =
    batches &&
    batches.map((batch) => ({
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

  // `?? []` on purpose, and the last one on this screen. The log below is the half that
  // still draws when the batch list did not arrive, and a row it cannot name falls back
  // to `t.oneBatch` — which stays true either way. Its numbers are unaffected:
  // `noticeReach` builds `byBatch` out of the roster's own rows, and `batchIds` only
  // adds the batches nobody is enrolled in.
  const labelById = new Map((options ?? []).map((o) => [o.id, o.label]))

  /*
   * Null when the log itself did not arrive, which is a third state and not an empty
   * one. `(notices ?? []).map` made a dropped read indistinguishable from a centre on
   * its first day, so the card at the bottom said "nothing has been sent out yet" over
   * a term of real announcements — to a reader whose whole reason for opening this
   * screen may have been to check whether Thursday's notice went out.
   */
  const logRows: NoticeRowView[] | null =
    notices &&
    notices.map((row) => {
      const sms = buildNoticeSms({
        body: row.body,
        centerName: session.active.centerName,
      })
      const forBatch = row.batch_id ? (reach?.byBatch[row.batch_id] ?? null) : reach?.all

      return {
        id: row.id,
        title: row.title,
        body: row.body,
        when: formatDate(row.published_at.slice(0, 10), locale),
        // A batch that has since been switched off keeps its notice in the log and
        // loses its name from it, and so does one whose list did not arrive at all.
        // The alternative to the first is a second query for archived batches to label
        // a row nobody can act on any more; the alternative to the second is hiding the
        // record over a name. `t.oneBatch` says the true part of both.
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

      {/* The form, or the sentence in place of it. Amber and not the grey aside the
          roster gets below, because this one is a thing withheld rather than a note
          added: the reader came to write a notice and there is no form to write it on. */}
      {options === null ? (
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.batchesUnreadable}</p>
        </Card>
      ) : (
        <Card>
          <NoticeForm
            batches={options}
            everyone={reach?.all ?? null}
            t={t}
            common={d.common}
          />
        </Card>
      )}

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

      {/* Three arms, and the first is the whole point of the null above: a record that
          could not be read, a record with something in it, and a centre that has genuinely
          told its families nothing yet. The middle two were the only ones here. */}
      {logRows === null ? (
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.logUnreadable}</p>
        </Card>
      ) : logRows.length > 0 ? (
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
