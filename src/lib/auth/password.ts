/**
 * The password rule, in one place.
 *
 * Two screens create passwords — someone signing themselves up, and an owner
 * issuing a starting password to a teacher standing next to them — and a client
 * form echoes the same rule in `minLength`. Three copies of one number drift,
 * and the way you find out is a teacher whose password was accepted when it was
 * set and rejected when they tried to use it.
 *
 * Six, not twelve. This gets typed on a mid-range Android keypad by someone who
 * was told it out loud, and the realistic attacker is a colleague guessing —
 * which GoTrue rate-limits — not an offline crack of a hash they cannot reach.
 */
export const MIN_PASSWORD = 6

export const PASSWORD_TOO_SHORT_BN =
  `পাসওয়ার্ড কমপক্ষে ${MIN_PASSWORD} অক্ষরের হতে হবে।`
