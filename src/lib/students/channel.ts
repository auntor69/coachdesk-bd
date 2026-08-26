/**
 * Which chase chip goes first for this family.
 *
 * The three chips — SMS, WhatsApp, call — sat in one fixed order from the day they
 * were built, and that order is right for a family nobody knows anything about and
 * wrong for the one whose father has never opened a text message. `students
 * .preferred_channel` is where an owner writes down what they learned in week one;
 * this is the two lines of arithmetic that turn it into a row of buttons.
 *
 * IT MOVES ONE CHIP AND MOVES NOTHING ELSE. The marked channel goes to the front
 * and the other two keep their relative order, so there are three possible layouts
 * rather than six. That bound is the whole design: these chips render in a list up
 * to a hundred and fifty rows long, an owner works down it with a thumb, and a chip
 * whose position depends on the row is a chip that gets tapped by mistake — which
 * here means opening the wrong app *and* writing a row claiming that channel was
 * used. Keeping the trailing pair in a known order, and colouring the one that
 * moved, means the button that is somewhere new is also the button that looks
 * different.
 *
 * NOTHING IS EVER REMOVED HERE. `available` is decided by the caller from
 * sms_opt_out and from whether there is anything to say, and this function only
 * orders what it is handed. A preference is not a permission: the one column that
 * silences a channel is sms_opt_out, and it is deliberately not an input to this.
 */
import type { OutreachChannel } from '../supabase/types.ts'

/**
 * The order to fall back to, which is the order the chips have always been in.
 *
 * `as const satisfies` so a fourth value added to the outreach_channel enum — the
 * migration reserves 'auto_sms' for the day a gateway exists — breaks here, in the
 * one place that decides what a row of chips looks like, rather than quietly
 * shipping a channel no screen offers.
 */
export const CHASE_CHANNELS = [
  'sms',
  'whatsapp',
  'call',
] as const satisfies readonly OutreachChannel[]

export type ChaseOrder = {
  /** The channels to offer, in the order to offer them. */
  order: OutreachChannel[]
  /**
   * The channel the owner marked, when it is still on offer — the one to draw as
   * the primary. Null when nothing is marked, and also null when the mark names a
   * channel this family is opted out of: a highlight on a chip that is not
   * rendered is nothing, and a highlight on a different chip would be a lie.
   */
  marked: OutreachChannel | null
}

/**
 * `preferred` is `students.preferred_channel`, null when nobody has said.
 *
 * `available` defaults to all three because that is the common case; the callers
 * that narrow it are the two chip components, which drop both message channels for
 * a family that asked not to be texted and drop SMS again on a week with nothing
 * in it. Order within `available` is ignored — the answer is always in
 * CHASE_CHANNELS order — so a caller cannot accidentally set the layout by
 * filtering in an unusual sequence.
 */
export function chaseOrder(
  preferred: OutreachChannel | null,
  available: readonly OutreachChannel[] = CHASE_CHANNELS,
): ChaseOrder {
  const offered = CHASE_CHANNELS.filter((channel) => available.includes(channel))
  const marked = preferred !== null && offered.includes(preferred) ? preferred : null

  if (marked === null) return { order: offered, marked: null }

  return {
    order: [marked, ...offered.filter((channel) => channel !== marked)],
    marked,
  }
}

/**
 * What came back from the `<select>`, which is a string or nothing at all.
 *
 * The empty string is "nobody has said" — a `<option value="">` is how a form says
 * null — and so is any value that is not one of the three. That last part matters
 * because this runs inside a Server Action, which is a public HTTP endpoint whoever
 * is signed in can post anything to: an unrecognised channel has to become null
 * rather than reach the database and sit in an enum column that rejects it, or
 * worse, be trusted by whatever reads it next.
 */
export function asPreferredChannel(value: unknown): OutreachChannel | null {
  if (typeof value !== 'string') return null
  const found = CHASE_CHANNELS.find((channel) => channel === value)
  return found ?? null
}
