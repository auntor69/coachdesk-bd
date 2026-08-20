import 'server-only'

/**
 * Whether a real SMS gateway is wired up yet.
 *
 * It is not, and pretending otherwise would be the worst possible bug in this
 * product: a teacher told "পাঠানো হয়েছে" while nothing left the building would
 * find out from a parent, weeks later, and never trust the app again.
 *
 * So sends are queued into `sms_logs` with status 'queued' and the UI says
 * plainly that delivery starts once the centre's sender ID is approved. Sender
 * IDs in Bangladesh go through a BTRC-approved aggregator and need the owner's
 * NID, which is a real-world step no amount of code can shortcut.
 *
 * The queue is the right design regardless: a delivery worker can retry, respect
 * per-operator rate limits, and reconcile delivery reports. That worker now
 * exists — 20260811000016 and /api/cron/sms — and this is the switch it reads
 * before claiming anything. A worker that ran without a gateway would spend three
 * attempts and a refund on every message in the queue.
 *
 * All three variables, not two. The endpoint was added to this check when the
 * worker arrived: a deployment holding a key and a sender ID but no URL used to
 * report "gateway live" on the settings screen, which was harmless while nothing
 * sent anything and is a lie now that something does.
 */
export function smsProviderConfigured(): boolean {
  return Boolean(
    process.env.SMS_API_URL && process.env.SMS_API_KEY && process.env.SMS_SENDER_ID,
  )
}
