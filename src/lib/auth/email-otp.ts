/**
 * The two numbers of the email verification step, in one place so the action,
 * the page and the form cannot disagree about them.
 *
 * Neither is ours to enforce. Supabase's confirmation flow decides how long a
 * code lives (and refuses a resend inside its own sixty-second window), so these
 * are what the SCREEN says, not a second rule running beside the real one:
 * `EMAIL_CODE_LENGTH` is how many boxes the input accepts and how many digits
 * the sentence mentions, and `RESEND_COOLDOWN_SECONDS` is how long the button
 * counts down before offering to ask again. If the platform's numbers ever move,
 * these move with them or the screen is lying — and a countdown that ends
 * before the server would allow a resend is the cheaper lie, because tapping
 * early costs one refused round trip and no message.
 *
 * The old `otp.ts`/`otp-gate.ts` this replaces (§18, retired 2026-09-13) held
 * the whole gate: hashing, ceilings, a dev transport. Email verification needs
 * none of that — the counting, the expiry and the burning of wrong attempts are
 * GoTrue's — so what is left is two constants and the prose that explains them.
 */

/** How many digits the emailed code has. Supabase email OTPs are six. */
export const EMAIL_CODE_LENGTH = 6

/** How long the resend button stays counting, matching GoTrue's own window. */
export const RESEND_COOLDOWN_SECONDS = 60
