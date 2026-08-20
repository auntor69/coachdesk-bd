import 'server-only'

import { smsProviderConfigured } from '@/lib/sms/provider'

/**
 * Handing one message to the gateway.
 *
 * Everything about *which* message and *whether* it should go is decided before
 * this file is reached — the queue, the credits, the opt-out, the retry count all
 * live in SQL. This is the one place that talks to the outside world, and it is
 * deliberately the dumbest code in the delivery path: take a number and a body,
 * come back with accepted or not.
 *
 * WHAT IS STILL UNVERIFIED HERE, stated plainly because it is the one thing in
 * the SMS path that has never been run against a real server: no BTRC sender ID
 * exists yet, so no aggregator account exists, so the request shape below has
 * been written from the published APIs of the Bangladeshi aggregators a small
 * centre would actually use — bulksmsbd, MiM SMS, Elitbuzz, REVE, Alpha Net —
 * rather than tested. They agree on the wire format (form-encoded POST with an
 * api key, a sender id, a number and a message) and disagree on how they report
 * failure, which is exactly the part that matters and the part `SMS_SUCCESS_RE`
 * below exists to pin down without a code change.
 *
 * Everything else in the delivery path is tested and does not depend on this
 * file being right. If a send is misjudged, the message is retried or refunded by
 * rules that hold regardless.
 */

/** Accepted by the gateway, or not. `ref` is whatever the gateway calls it. */
export type SendResult =
  | { ok: true; ref: string | null }
  | { ok: false; error: string }

/**
 * A pattern the response body must match for a 2xx to count as accepted.
 *
 * This is the one setting that stops this file telling the lie the whole product
 * is built to avoid. Every aggregator in this market answers HTTP 200 for
 * business failures — `1002 Sender Id not correct`, `{"Status":"3"}`, an empty
 * body — and taking a 200 at face value would mark a message 'sent', refund
 * nothing, and tell the teacher পাঠানো হয়েছে while the parent heard nothing.
 *
 * So: set SMS_SUCCESS_RE the day the account is live, to whatever the aggregator
 * calls success (`202` for bulksmsbd, `"statusCode":"200"` for MiM,
 * `"Status":"0"` for Elitbuzz). Until then a 2xx is taken at face value, which is
 * the only assumption in the delivery path that a real gateway can falsify — and
 * it cannot fire at all, because the worker refuses to run while the gateway is
 * unconfigured.
 */
function successPattern(): RegExp | null {
  const raw = process.env.SMS_SUCCESS_RE
  if (!raw) return null
  try {
    return new RegExp(raw)
  } catch {
    // A typo'd regex must not silently become "accept everything". Treated as a
    // pattern nothing matches, so every send fails loudly and is refunded, which
    // is the safe direction: a centre gets its credits back and an owner reads
    // the reason on the SMS screen.
    return /(?!)/
  }
}

/**
 * How long to wait for one message.
 *
 * Four seconds. Short, because the whole batch has to finish inside a serverless
 * function's wall clock and a gateway that has not answered in four seconds is
 * not about to. A timeout is reported as a failure rather than left in flight, so
 * the message goes back in the queue with a backoff instead of waiting for the
 * reaper.
 */
const TIMEOUT_MS = 4000

/**
 * Field names, in one place because they are the first thing that will need
 * changing against a live account. Every aggregator listed at the top of this
 * file uses these four or something a line away from them.
 */
const FIELDS = {
  key: 'api_key',
  sender: 'senderid',
  to: 'number',
  message: 'message',
} as const

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const url = process.env.SMS_API_URL
  const key = process.env.SMS_API_KEY
  const sender = process.env.SMS_SENDER_ID

  if (!smsProviderConfigured() || !url || !key || !sender) {
    // Reachable only by a caller that skipped smsProviderConfigured(). Reported
    // as a failure rather than thrown so a misconfiguration cannot take a whole
    // batch down with it. The three reads are repeated for the type narrowing;
    // the function above is what the UI and the worker both ask.
    return { ok: false, error: 'gateway not configured' }
  }

  const form = new URLSearchParams({
    [FIELDS.key]: key,
    [FIELDS.sender]: sender,
    [FIELDS.to]: to,
    [FIELDS.message]: body,
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Nothing about this is cacheable, and a cached 200 would be a message
      // nobody sent.
      cache: 'no-store',
    })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : 'send failed',
    }
  }

  // Capped: this ends up in sms_logs.error or provider_ref, and an aggregator
  // having a bad day can answer with an HTML error page.
  const text = (await response.text().catch(() => '')).trim().slice(0, 500)

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}${text ? `: ${text}` : ''}` }
  }

  const pattern = successPattern()
  if (pattern && !pattern.test(text)) {
    return { ok: false, error: `rejected: ${text || '(empty response)'}` }
  }

  // The body is the reference. Aggregators return a message id, a status code, or
  // nothing; whichever it is, it is what a human will quote in a support email.
  return { ok: true, ref: text || null }
}
