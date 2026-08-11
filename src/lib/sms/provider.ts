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
 * per-operator rate limits, and reconcile delivery reports. When the aggregator
 * is live, only the worker changes — everything upstream already records exactly
 * what should be sent to whom.
 */
export function smsProviderConfigured(): boolean {
  return Boolean(process.env.SMS_API_KEY && process.env.SMS_SENDER_ID)
}
