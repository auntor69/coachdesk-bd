/**
 * Whether an owner may set a new password on one of their teachers' accounts.
 *
 * WHY A RESET EXISTS AT ALL. Logging in here is a phone number and a password, with
 * no email and no OTP — see the note at the head of (auth)/login-form.tsx for why
 * that is the shape and what it is waiting on. The cost of it is that there is no
 * "forgot password" link to click, because there is nowhere to send one. A teacher
 * whose starting password was told to them out loud in June and who comes back from
 * a term break in September has, today, no way back into the app at all. The owner
 * issued that password in the first place (teacherForm.password, typed in the clear
 * while the teacher stood there), so the owner issuing another one is the same act,
 * not a new privilege.
 *
 * WHY IT IS A MODULE AND NOT AN `if` IN THE ACTION. Because the wrong version of
 * this check is an account takeover, and the wrong version is the obvious one.
 *
 * The obvious version is "you may reset a teacher of your centre". Adding a teacher
 * links, by design, to an account that already exists — profiles.phone is unique
 * across the platform, so a teacher who works at two centres has one login, and
 * createTeacher's confirm step exists to link it rather than fail. Now put those two
 * rules together: owner B types owner A's mobile number into their own teacher form
 * — a coaching centre owner's number is on their signboard — confirms the link, and
 * A becomes a teacher of centre B. That much is deliberate and visible; B has gained
 * nothing, because A's centre is not reachable through a teacher row at B's.
 *
 * With the obvious version of this check, the next tap is B setting a password on
 * A's account and signing in as A. Not as a teacher at B — as A, in A's own centre,
 * with A's owner membership: the whole fee book, every student, every guardian's
 * phone number. Every one of those students is somebody's child.
 *
 * SO THE RULE IS THE OTHER WAY ROUND. Not "does this account teach here" but "is
 * this account ours and only ours": exactly one membership anywhere on the platform,
 * and it is a teacher membership in the centre doing the asking. An account that
 * belongs anywhere else — as an owner, a manager, a teacher at a second centre, or
 * to the platform itself — is refused, and the refusal is not negotiable by any
 * combination of taps on the teacher screen.
 *
 * WHAT THAT COSTS, said plainly because it is a real cost: a teacher who genuinely
 * works at two CoachDesk centres cannot be reset by either owner, and in this market
 * teaching at two centres is common. That is the correct answer anyway. If owner B
 * could reset them, B could sign in as them and read centre C's batches, marks and
 * guardian numbers, which is the same leak in a smaller shape. Until an OTP route
 * exists, those accounts are a founder-intervention case, and the copy says so
 * rather than pretending the button will work.
 *
 * The memberships are read past RLS with the service-role client — an owner is not
 * allowed to see the other centres an account belongs to, which is exactly the fact
 * this rule turns on — and they are read regardless of `active`, because a
 * deactivated owner membership somewhere else is still an account that is not ours.
 */
import type { MemberRole } from '../supabase/types.ts'

/** One `center_members` row, read past RLS. */
export type Membership = {
  coaching_center_id: string
  role: MemberRole
}

export type ResetTarget = {
  /** The account behind the teacher row, or null if nobody ever gave them one. */
  userId: string | null
  /** Whoever is asking. Their own row is refused; see `self` below. */
  readerId: string
  /**
   * Every membership the account holds anywhere on the platform, including the
   * inactive ones. An empty list is an account with no centre at all.
   */
  memberships: Membership[]
  /** `profiles.is_platform_admin`, which is not a membership and not a role. */
  isPlatformAdmin: boolean
}

/**
 * Why not, or null for yes. Four reasons rather than one boolean, because each of
 * them needs a different sentence on the screen and two of them are actionable:
 * `inactive` means switch the teacher back on first, and `self` means this is the
 * wrong screen for your own password.
 *
 * A list rather than a bare union so that i18n.test.ts can walk it and prove every
 * refusal has a sentence in both languages. A refusal that reaches an owner as a
 * blank line is a button that did nothing, which is the one outcome worse than being
 * told no.
 */
export const RESET_REFUSALS = ['noAccount', 'self', 'inactive', 'notOurs'] as const

export type ResetRefusal = (typeof RESET_REFUSALS)[number]

export function passwordResetRefusal(
  target: ResetTarget,
  centerId: string,
): ResetRefusal | null {
  // Nothing to reset: a teacher record without a login is a name in a list, and
  // plenty of part-timers never get one.
  if (!target.userId) return 'noAccount'

  // Checked before the membership rule so the sentence is right. An owner's own
  // account fails that rule too — they hold an owner membership — but "this account
  // is not only this centre's" is a strange thing to read about yourself.
  if (target.userId === target.readerId) return 'self'

  // Not a membership, so the rule below would not catch it, and the one account on
  // the platform that must never be resettable from a centre screen is the one that
  // can read every centre.
  if (target.isPlatformAdmin) return 'notOurs'

  // No membership anywhere. Reachable through the ordinary route: switching a
  // teacher off deletes their membership, so a teacher who was switched off in June
  // has none. Actionable — switching them back on writes one — and safe, because an
  // account that belongs to some other centre has that centre's membership and
  // lands on `notOurs` instead.
  if (target.memberships.length === 0) return 'inactive'

  const [only] = target.memberships
  const ours
    = target.memberships.length === 1
      && only.coaching_center_id === centerId
      && only.role === 'teacher'

  return ours ? null : 'notOurs'
}
