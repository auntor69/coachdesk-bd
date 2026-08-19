/**
 * Which of a reader's centres they are currently working in.
 *
 * Most people have one and never think about this. The case it exists for is a
 * teacher who takes batches at two centres — common here, because a physics
 * teacher with a reputation is booked by every centre in the neighbourhood. They
 * arrive through `addTeacher`, which links an account that already exists when the
 * second owner types a phone number it recognises.
 *
 * Not a second centre of their own: `bootstrap_center` refuses one, on purpose,
 * because a free centre per batch is the cheapest way around the one-batch cap.
 * So the roles in this list are usually different — owner at the centre they run,
 * teacher at the one they visit — which is why switching changes the navigation
 * and the landing page as well as the name in the header.
 *
 * Until now the app picked for them: `memberships[0]`, highest role first, and
 * among equals whichever order Postgres happened to return. The second centre was
 * unreachable.
 *
 * The choice is kept in a cookie rather than on `profiles`, because it belongs to
 * the browser and not to the person: an owner with the fee board open on a laptop
 * for one branch and a phone in their hand for the other is doing something
 * reasonable, and a column would make the two windows fight.
 *
 * No imports on purpose. `pickActive` is the one function in this codebase that
 * decides which centre a request may read, so it is kept where a unit test can
 * reach it without a database, a request, or a Next.js runtime.
 */

/** Client-writable, like every cookie. See `pickActive`. */
export const ACTIVE_CENTER_COOKIE = 'cd_center'

/**
 * A year. This is a preference and not a credential — nothing is authorised by
 * holding it, so there is no reason to make a teacher re-choose every week.
 */
export const ACTIVE_CENTER_MAX_AGE = 60 * 60 * 24 * 365

/** Just enough of a Membership to choose between them. */
type Choosable = { centerId: string }

/**
 * One entry per centre, keeping the strongest role the reader holds at each.
 *
 * `center_members` is unique on (centre, user, role), which is deliberate: a
 * coaching-centre owner who also teaches a batch genuinely has two rows at one
 * centre, and both are true. But nothing above this line wants a list of rows —
 * every caller is asking "which centres can I work in, and as what", and the
 * first version of the switcher answered that by listing উত্তরা আইডিয়াল কোচিং
 * twice, both marked as the one you are already in.
 *
 * Collapsing to the strongest role matches what the database already grants.
 * RLS evaluates every policy the user's rows satisfy and takes the union, so an
 * owner row decides every question a teacher row at the same centre could — the
 * teacher row adds nothing to remove.
 *
 * Ranked by the caller rather than by a table in here, because the ordering of
 * roles is a fact about the product's permissions and belongs beside them.
 */
export function strongestPerCenter<M extends Choosable>(
  rows: readonly M[],
  rankOf: (row: M) => number,
): M[] {
  const strongest = new Map<string, M>()
  for (const row of rows) {
    const seen = strongest.get(row.centerId)
    if (!seen || rankOf(row) > rankOf(seen)) strongest.set(row.centerId, row)
  }
  // Strongest first, so a reader who owns one centre and teaches at another lands
  // on the one they run before they have chosen anything.
  return [...strongest.values()].sort((a, b) => rankOf(b) - rankOf(a))
}

/**
 * The membership the reader chose, or the one we choose for them.
 *
 * The security property is structural, not a check to remember: the return value
 * is always an element of `memberships`, never the cookie's value. A cookie
 * naming a centre this user does not belong to — a stale choice after their
 * access was revoked, or a forged one typed into devtools — matches nothing and
 * falls through to the first membership they really have. There is no path by
 * which a string from the browser becomes `session.active.centerId`.
 *
 * That matters more since every query in the app filters by that id. RLS would
 * still refuse another centre's rows, so a forged cookie could never *read*
 * anything; what it could do is put another centre's name in the header while
 * the screen below it renders empty, and have the reader believe the branch they
 * just opened has no students in it.
 */
export function pickActive<M extends Choosable>(
  memberships: readonly M[],
  chosen: string | null | undefined,
): M | null {
  if (chosen) {
    const match = memberships.find((m) => m.centerId === chosen)
    if (match) return match
  }
  return memberships[0] ?? null
}
