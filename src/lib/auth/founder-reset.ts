/**
 * Whether the founder may set a new password on a staff account at a centre.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE OWNER'S RESET.
 *
 * Login here is a mobile number and a password: no email, no OTP, and therefore no
 * "forgot password" link, because there is nowhere to send one. lib/auth/reset.ts
 * closes half of that gap — an owner may issue a new password to a teacher — and it
 * closes it deliberately narrowly: the account must hold exactly one membership on the
 * whole platform, and it must be a teacher membership at the centre doing the asking.
 * Read that module before this one; the takeover it refuses is the reason it is written
 * the way it is.
 *
 * The cost of that narrowness is three groups of people it cannot help, and they are
 * named there: an owner, a manager, and a teacher who works at two CoachDesk centres,
 * which in this market is common. For every one of them the copy on the owner's screen
 * says to ring the founder — and until this rule existed, the founder's own panel had
 * no button either, so ringing them meant they opened a database console.
 *
 * SO THIS RULE IS DELIBERATELY THE OPPOSITE SHAPE. It does not ask "does this account
 * belong only to us". A teacher at two centres is precisely the case that has to pass.
 * What it asks is narrower in a different direction: is this a person who works at the
 * centre the founder is looking at.
 *
 * WHAT THAT IS SAFE ON, said plainly, because "the platform admin may reset anybody"
 * deserves more than an assurance. It grants the founder nothing they do not already
 * hold: the service-role key sits in their own environment, and it can set any password
 * on the platform with one curl. The panel does not widen that power, it removes the
 * console from the middle of it — which matters at 9pm with a locked-out owner on the
 * phone, and matters again because a founder who is used to opening a SQL console to
 * fix support calls will eventually run something else in it.
 *
 * Two refusals are still worth having against a key that could ignore them:
 *
 * `platformAdmin` — the founder's own account, or a second one the day there is one.
 * The panel is reachable by anybody holding a founder session, and a session token is a
 * thing that leaks; a button that resets platform admins would turn one leaked founder
 * session into a permanent one. Nobody needs it either: a founder who knows their
 * password changes it at /account, and one who does not cannot reach this screen.
 *
 * `notStaff` — the account must actually work at this centre, in a role that runs it.
 * The number is typed by hand beside a centre's card, so a mistyped digit is the
 * ordinary case rather than the exotic one, and without this it would land on whichever
 * stranger holds that number. It also keeps students and guardians out: their records
 * are minors' records, and handing out access to a child's account over a phone call is
 * not a founder's decision to make.
 */
import type { MemberRole } from '../supabase/types.ts'

/** The roles that run a coaching centre, and the only ones this rule will reset. */
const STAFF_ROLES: MemberRole[] = ['owner', 'manager', 'teacher']

/**
 * Why not, or null for yes.
 *
 * A list rather than a bare union for the same reason RESET_REFUSALS is one: i18n.test
 * walks it and proves every refusal has a sentence in both languages. A founder reading
 * a blank line where a reason should be has been told the button is broken.
 */
export const FOUNDER_RESET_REFUSALS = [
  'noAccount',
  'self',
  'platformAdmin',
  'notStaff',
] as const

export type FounderResetRefusal = (typeof FOUNDER_RESET_REFUSALS)[number]

export type FounderResetTarget = {
  /** The account holding the number that was typed in, or null if none does. */
  userId: string | null
  /** The founder asking. Their own account is refused; see `self`. */
  readerId: string
  /**
   * The roles this account holds **at the centre being looked at**, and only there.
   * Unlike the owner's reset this rule does not care what the account is elsewhere, so
   * the query behind it is filtered by centre rather than platform-wide.
   */
  rolesAtCenter: MemberRole[]
  /** `profiles.is_platform_admin`, which is not a membership and not a role. */
  isPlatformAdmin: boolean
}

export function founderResetRefusal(
  target: FounderResetTarget,
): FounderResetRefusal | null {
  // No account has that number. Usually a typo, occasionally a teacher who was added
  // to the roster without a login — which is the owner's own screen to fix, not this.
  if (!target.userId) return 'noAccount'

  // Checked before the platform-admin rule so the sentence is right. The founder is a
  // platform admin, so their own account fails that rule too, and "this account can
  // read every centre" is a strange thing to be told about yourself.
  if (target.userId === target.readerId) return 'self'

  if (target.isPlatformAdmin) return 'platformAdmin'

  // `some`, not `length`: a student or guardian membership is a membership and must
  // not be enough. A person with both — a teacher whose own child studies there — is
  // staff, and passes on the teacher row.
  return target.rolesAtCenter.some((role) => STAFF_ROLES.includes(role))
    ? null
    : 'notStaff'
}
