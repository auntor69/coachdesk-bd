/**
 * The two numbers of the email verification step, in one place so the action,
 * the page and the form cannot disagree about them.
 *
 * THE CODE'S LENGTH IS THE PLATFORM'S, NOT OURS. Supabase generates the code
 * and the email carries it; how many digits that is is not ours to promise and
 * has been observed at eight, not the six this module first guessed. So the
 * input accepts up to `EMAIL_CODE_MAX` digits and no sentence on the screen
 * names a count — a form that truncated the code the mail actually carries
 * would be a signup nobody could finish, and the failure would read as "wrong
 * code" every time.
 *
 * `RESEND_COOLDOWN_SECONDS` is how long the resend button counts down,
 * matching GoTrue's own sixty-second window. The button may offer a resend a
 * moment before the platform allows one; tapping early costs one refused round
 * trip and no message.
 */

/** The most digits the code input will accept. The mail decides how many it is. */
export const EMAIL_CODE_MAX = 10

/** How long the resend button stays counting, matching GoTrue's own window. */
export const RESEND_COOLDOWN_SECONDS = 60
