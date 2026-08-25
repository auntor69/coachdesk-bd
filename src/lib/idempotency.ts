/**
 * The token that makes one tap on a money button record one payment.
 *
 * WHY A BROWSER-SIDE KEY AND NOT A SERVER-SIDE CHECK. An owner taps "টাকা নিন",
 * the insert lands in Postgres, and the response dies somewhere between Dhaka and
 * the phone. The button unsticks with an error for a payment that was in fact
 * recorded, so they tap again — and 20260811000017 has made both rows permanent,
 * because a fee payment cannot be deleted by anybody from a browser session. No
 * check the server could make prevents this: "does a payment like this already
 * exist" is wrong on its face, since a parent settling two months in one visit is
 * two real payments against the same invoice for the same amount on the same day.
 * Only the browser knows that two arrivals are one tap, so only the browser can
 * say so, and it says so with this.
 *
 * The uniqueness is a unique index (20260811000025) rather than a lookup, because
 * two requests a millisecond apart both pass any lookup.
 *
 * No imports, for the reason `./limits.ts` gives: `mint` runs in the browser, so
 * anything this file pulls in ships to a phone on 3G.
 */

/**
 * The shape Postgres will accept for a `uuid` column.
 *
 * Checked here rather than left to the database because the alternative is an
 * insert that fails on a cast, and a payment form is the last place to hand
 * somebody a type error. Deliberately not a full RFC 4122 check — the version and
 * variant nibbles are not constrained — because this value has one job, being
 * different from every other one, and a token from some future `crypto` that sets
 * those bits differently is still perfectly good at that job.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The Postgres error code for a unique violation.
 *
 * Named because the alternative is `'23505'` sitting bare in an `if` on the money
 * path, where a reader has to know Postgres by heart to see that the branch is the
 * happy one. Already used unnamed in the SMS send path, which is where the pattern
 * came from.
 */
export const UNIQUE_VIOLATION = '23505'

/**
 * Reads a token out of form data, or null if there is not a usable one.
 *
 * Null rather than an error on anything unusable, and that is the whole design: a
 * submit with no token, a truncated token, or a token from something that is not the
 * form is recorded as a payment with no retry protection — which is exactly what
 * every payment in this product had before the column existed. The failure mode of
 * this function must never be a refused payment, because the cash is already on the
 * desk and the parent is already waiting.
 */
export function readIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return UUID_RE.test(key) ? key : null
}

/**
 * A fresh token, or an empty string if this browser cannot mint one.
 *
 * `crypto.randomUUID` needs a secure context. Production always is one and
 * `localhost` counts, but `http://192.168.0.14:3000` — a laptop dev server opened on
 * a phone, which is how this app actually gets looked at on a real handset — is not,
 * and there `crypto.randomUUID` is undefined. Optional chaining rather than a
 * polyfill: the honest degradation is the payment recording without retry protection,
 * and the dishonest one is a crash on the screen the product is sold on.
 *
 * Never called during render. The server would mint one string and the browser
 * another for the same hidden input, which is a hydration mismatch; the forms call
 * this from an effect after mount and again after each recorded payment.
 */
export function mintIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? ''
}
