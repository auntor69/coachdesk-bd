/**
 * Who administers a centre, and who could be asked to.
 *
 * A MANAGER IS A MEMBERSHIP AND NOTHING ELSE. 20260811000061 made an `owner` or
 * `manager` row in `center_members` owner-only to write, and that row is the whole of
 * what a manager is — every policy in the schema resolves through it, and nothing else
 * in the database records the appointment. So appointing somebody is one insert, and
 * removing them is one delete.
 *
 * WHICH LEAVES THE NAME NOWHERE READABLE, and that is the problem this module exists to
 * solve. `center_members` carries a `user_id` and no name; `profiles` is self-read since
 * 20260811000002, so an owner looking up a colleague there is handed nothing (the audit
 * screen says the same thing about actor names). The two tables that *do* carry a name a
 * staff admin may read are `teachers` (§5.1) and `employees` (§9.4), both keyed to the
 * same `user_id`. So the roster is assembled by joining memberships to those two lists in
 * application code, and an administrator who is in neither has no name to show.
 *
 * THAT IS ALSO WHY APPOINTMENT STARTS FROM A PERSON AND NOT FROM A PHONE BOX. A screen
 * that took a number would create administrators nobody can name a week later. Starting
 * from a row the centre has already written down means the name, the number and the
 * building are already recorded, on the screen where they are editable — and the
 * `employees.user_id` comment in 20260811000043 asks for exactly this: "a manager who
 * wants to give the accountant access creates the membership row".
 *
 * NOTHING HERE IS A BOUNDARY. Every list below is drawn from rows the policies already
 * handed over, and `appointManager` re-reads the chosen person from their own table
 * before it writes. A candidate list is a convenience for the reader; the fences are
 * `members_owner_write` and `centerOwner()`.
 */
import type { MemberRole } from '../supabase/types.ts'

/** One row of `center_members`, as the screen reads it. */
export type MemberRow = {
  id: string
  userId: string
  role: MemberRole
  branchId: string | null
}

/**
 * Somebody the centre has written down, from either of the two tables that name people.
 *
 * `from` travels with the row because the appointment has to read the person back out of
 * the table they came from, and because a teacher and an employee can share an id — both
 * are `gen_random_uuid()`, so `id` alone is not a key across the pair.
 */
export type Person = {
  id: string
  from: 'teachers' | 'employees'
  userId: string | null
  name: string
  /** What the centre calls the job, for a list where two people share a first name. */
  role: string | null
  phone: string | null
  branchId: string | null
  active: boolean
}

/** One administrator, ready to draw. */
export type Administrator = {
  memberId: string
  userId: string
  role: MemberRole
  branchId: string | null
  /** The name a readable row carried, or `null` when neither list holds this person. */
  name: string | null
  /** What they are employed as, where that is recorded. */
  job: string | null
  /** The reader themselves, who is labelled rather than named. */
  isSelf: boolean
}

/** Somebody who could be appointed, and what it would take. */
export type Candidate = {
  /** `teachers:<id>` or `employees:<id>` — the one value the select posts. */
  value: string
  name: string
  job: string | null
  /** Where they already work, offered as the default pin. */
  branchId: string | null
  /**
   * No account yet, so appointing them has to make one and therefore needs a password.
   *
   * The form asks for one only when the person it is pointed at needs it, which is the
   * only piece of per-candidate state the client component carries.
   */
  needsLogin: boolean
  /**
   * True when the account would be minted against a username rather than their number.
   *
   * §5.2's fallback, and worth saying on the form: an owner appointing somebody whose
   * phone was never written down has to read a generated username out to them.
   */
  byUsername: boolean
}

/** The two roles this screen is about, in the order it draws them. */
const ADMIN_RANK: Partial<Record<MemberRole, number>> = { owner: 0, manager: 1 }

/** Whether a membership row is one of the two an administrator holds. */
export function isAdminRole(role: MemberRole): boolean {
  return role === 'owner' || role === 'manager'
}

/**
 * The people who administer this centre, named where a name can be found.
 *
 * Owners first and then managers, each group by name, with the unnamed last inside their
 * group — a row reading "a member of this centre" is the least useful line on the screen
 * and belongs at the bottom of it rather than wherever a null happens to sort.
 *
 * ONE PERSON CAN APPEAR ONCE, even holding two memberships. `unique (coaching_center_id,
 * user_id, role)` lets somebody be a teacher and a manager at the same time, which is the
 * ordinary case in a coaching centre — but this list is only ever handed the admin rows,
 * so the teacher membership is not among them. A person who somehow held both `owner` and
 * `manager` would be drawn twice, which is the honest picture of two rows.
 */
export function administratorsFrom(
  members: readonly MemberRow[],
  people: readonly Person[],
  readerId: string,
): Administrator[] {
  const named = new Map<string, Person>()
  for (const person of people) {
    if (person.userId === null) continue
    // First writer wins, and the caller passes teachers before employees: somebody on
    // both lists is more likely to be looked for under the name their colleagues use.
    if (!named.has(person.userId)) named.set(person.userId, person)
  }

  return members
    .filter((member) => isAdminRole(member.role))
    .map((member) => {
      const person = named.get(member.userId)
      return {
        memberId: member.id,
        userId: member.userId,
        role: member.role,
        branchId: member.branchId,
        name: person?.name ?? null,
        job: person?.role ?? null,
        isSelf: member.userId === readerId,
      }
    })
    .sort(
      (a, b) =>
        (ADMIN_RANK[a.role] ?? 9) - (ADMIN_RANK[b.role] ?? 9) ||
        Number(a.name === null) - Number(b.name === null) ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    )
}

/**
 * The people an owner could appoint next.
 *
 * SWITCHED ON, AND NOT ALREADY AN ADMINISTRATOR. Somebody who has left is not offered —
 * their teacher membership was deleted when they were switched off, and handing them a
 * manager row would let them back in through a screen about promotions. Somebody who is
 * already an owner or a manager is not offered either, because the insert would hit
 * `unique (coaching_center_id, user_id, role)` and the useful answer is a shorter list.
 *
 * A PERSON WITH NO ACCOUNT IS STILL OFFERED, carrying `needsLogin` so the form knows to
 * ask for a password. The alternative — offering only people who can already sign in —
 * would hide the accountant an owner wrote down this morning behind a second screen and
 * a step nobody explained.
 *
 * Teachers before employees at equal names is not asserted anywhere: the sort is by name,
 * and the tie is broken by whichever the caller passed first.
 */
export function candidatesFrom(
  people: readonly Person[],
  members: readonly MemberRow[],
): Candidate[] {
  const admins = new Set(
    members.filter((member) => isAdminRole(member.role)).map((member) => member.userId),
  )

  return people
    .filter((person) => person.active && !(person.userId !== null && admins.has(person.userId)))
    .map((person) => ({
      value: `${person.from}:${person.id}`,
      name: person.name,
      job: person.role,
      branchId: person.branchId,
      needsLogin: person.userId === null,
      // Only meaningful while there is no account: an existing login was minted one way
      // or the other months ago and this screen is not changing it.
      byUsername: person.userId === null && person.phone === null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** What a `teachers:<id>` value from the form means, or `null` when it means nothing. */
export function parsePerson(
  value: string,
): { from: 'teachers' | 'employees'; id: string } | null {
  const cut = value.indexOf(':')
  if (cut === -1) return null

  const from = value.slice(0, cut)
  const id = value.slice(cut + 1)
  if (id === '') return null
  // Checked against the two literals rather than cast, because this string arrives from a
  // form post and `.from(table)` is the one place in the app a bad one would matter.
  if (from !== 'teachers' && from !== 'employees') return null

  return { from, id }
}
