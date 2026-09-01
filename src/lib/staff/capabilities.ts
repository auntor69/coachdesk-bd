/**
 * What a manager may do, one narrowing at a time (MASTERPLAN.md §6.2).
 *
 * THE VOCABULARY LIVES HERE AND NOT IN THE SCHEMA, which is the whole point of the
 * design: §6.2 asks for a permission system that can express a new narrowing "without a
 * migration each time", so `center_members.capabilities` is a plain `text[]` and the words
 * in it are defined by this file. 20260811000063 says so in the column's own comment.
 *
 * IT IS A VETO, NOT A GRANT, and `can` below is the same sentence as `app.member_allows`.
 * Null means the whole of the role — every membership row that existed before the column
 * did — and an array narrows the membership to the words in it. Nothing here grants
 * anything: an owner is not narrowed, a teacher is not narrowed, and a manager whose column
 * is null is exactly as powerful as they were.
 *
 * WHICH IS WHY AN UNKNOWN WORD FAILS CLOSED. `can` asks whether the capability is in the
 * array, so a misspelling narrows the manager further rather than widening them. That is
 * also why `parseCapabilities` filters on the way in: a word the vocabulary does not have
 * would be stored forever and do nothing but confuse the next reader of the row.
 *
 * NOT A BOUNDARY. The fences are the restrictive policies in 20260811000063, which hold
 * against a hand-posted form. This file is what the screens read and what the two
 * service-role paths (`exams/actions.ts`, `settings/actions.ts`) check by hand, because RLS
 * cannot see a query the service role makes.
 */

/**
 * The six capabilities, in the order the tick boxes offer them.
 *
 * Money first because that is what an owner is most often taking away, then the roster and
 * the staff list, then the centre's voice. Each word names a group of tables in
 * 20260811000063 and nothing else — there is no `plan` or `branches` capability, because a
 * manager has no reach over either and a tick box for one would read like a promise.
 */
export const CAPABILITIES = [
  'fees',
  'expenses',
  'payroll',
  'students',
  'staff',
  'messages',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/** Whether `value` is one of the six. For a word off a form or out of a row. */
export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value)
}

/**
 * Whether this membership may do the thing — the app-side twin of `app.member_allows`.
 *
 * Null is the whole role and `undefined` is read the same way, because a caller holding a
 * session from before this column existed must not be narrowed by the upgrade.
 *
 * NO SPECIAL CASE FOR AN OWNER, and none is needed: nothing narrows an owner's row, so the
 * column is null for them and this returns true. A special case here would be a second
 * place for the rule to be written and a second place for it to be got wrong.
 */
export function can(
  capabilities: readonly string[] | null | undefined,
  capability: Capability,
): boolean {
  if (capabilities === null || capabilities === undefined) return true
  return capabilities.includes(capability)
}

/**
 * The narrowing that survives every membership this person holds at one centre.
 *
 * A person commonly holds `teacher` and `manager` at the same centre, and the database's
 * veto is refused by *any* row that leaves the capability out — `app.member_allows` is a
 * `not exists` over all of them. So the app-side answer is the intersection, and null only
 * when nothing narrows at all.
 *
 * ANYTHING SOFTER WOULD BE A LIE ABOUT WHAT THE DATABASE WILL DO, which is worse than being
 * strict: a screen that showed the fee card because the teacher row is unnarrowed would
 * draw a card whose every query comes back empty, and read as a centre with no bills.
 */
export function narrowingOf(
  rows: readonly { capabilities: readonly string[] | null }[],
): string[] | null {
  let allowed: string[] | null = null

  for (const row of rows) {
    if (row.capabilities === null) continue
    const theirs = row.capabilities
    allowed =
      allowed === null
        ? [...theirs]
        : allowed.filter((capability) => theirs.includes(capability))
  }

  return allowed
}

/**
 * What an owner ticked, cleaned up: the capabilities in `CAPABILITIES` order, or null.
 *
 * NULL WHEN EVERY BOX IS TICKED, deliberately, and this is the one judgement call in the
 * file. An owner who wants a deputy with the whole job and an owner who has ticked all six
 * mean the same thing today — but they will not once a seventh capability exists, and the
 * one who meant "everything" would then find their deputy quietly missing the new one. So
 * "all of them" is stored as null, which is the row that means the whole of the role
 * however the role grows.
 *
 * AN EMPTY TICK LIST IS AN EMPTY ARRAY AND NOT NULL, which is the opposite reading and the
 * right one: the read-only administrator is somebody the owner deliberately gave nothing,
 * and 20260811000063's constraint allows `'{}'` for exactly that person.
 */
export function parseCapabilities(posted: readonly string[]): Capability[] | null {
  const ticked = CAPABILITIES.filter((capability) => posted.includes(capability))
  return ticked.length === CAPABILITIES.length ? null : [...ticked]
}

/**
 * A role as a named bundle of capabilities rather than a branch in an `if` — §6.2's own
 * words for what it wants.
 *
 * These are the three jobs a coaching centre actually appoints, and the bundle is a
 * starting point for the tick boxes rather than a stored value: nothing in the database
 * records which bundle was picked, because the moment an owner unticks one box the name
 * would be a lie. `deputy` is null on purpose — the whole of the role is a bundle too, and
 * it is the one every existing manager already has.
 *
 * `employee_role` IS NOT THIS, for the reason `roles.ts` gives about `member_role`: that
 * enum says what the centre pays somebody to do, and these say what the app lets them
 * reach. A centre may well have an accountant it never appoints as a manager at all.
 */
export const CAPABILITY_BUNDLES = {
  deputy: null,
  accountant: ['fees', 'expenses', 'payroll'],
  receptionist: ['students', 'messages'],
  coordinator: ['students', 'staff', 'messages'],
  observer: [],
} as const satisfies Record<string, readonly Capability[] | null>

export type BundleName = keyof typeof CAPABILITY_BUNDLES

/** The five bundles in the order the picker offers them, widest first. */
export const BUNDLE_NAMES = [
  'deputy',
  'accountant',
  'coordinator',
  'receptionist',
  'observer',
] as const satisfies readonly BundleName[]

/** Whatever `BUNDLE_NAMES` left out. `never` while it is complete. */
type UnlistedBundle = Exclude<BundleName, (typeof BUNDLE_NAMES)[number]>

/**
 * Nothing at runtime, and a compile error the moment a bundle is added without a place in
 * the picker. Same device and the same reasoning as `ALL_ROLES_LISTED` next door.
 */
export const ALL_BUNDLES_LISTED: UnlistedBundle extends never ? true : UnlistedBundle = true

/**
 * Which bundle a stored narrowing is, if it is one of them.
 *
 * For the screen that has to describe an existing appointment in a word. Null when the
 * ticks do not match any bundle, which is an ordinary answer and not an error — the boxes
 * are the truth and the name is a summary of them.
 */
export function bundleOf(capabilities: readonly string[] | null): BundleName | null {
  if (capabilities === null) return 'deputy'

  for (const name of BUNDLE_NAMES) {
    const bundle = CAPABILITY_BUNDLES[name]
    if (bundle === null) continue
    if (
      bundle.length === capabilities.length &&
      bundle.every((capability) => capabilities.includes(capability))
    ) {
      return name
    }
  }

  return null
}

/** The dictionary's six labels, keyed off the vocabulary so a word cannot go unnamed. */
export type CapabilityLabels = Record<Capability, string>

/** And the five bundle names, for the same reason. */
export type BundleLabels = Record<BundleName, string>
