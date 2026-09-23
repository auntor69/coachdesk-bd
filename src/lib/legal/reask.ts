/**
 * The re-ask rule — MASTERPLAN.md §14.1's "re-asked when a version changes".
 *
 * ITS OWN MODULE, AND ONLY BECAUSE OF WHERE IT HAS TO BE REACHABLE FROM. The rule is
 * arithmetic over two maps of versions and needs no database, no client and no `server-only`
 * — and that is precisely the point: it is the one part of the consent machinery a unit test
 * can hold. Next door, `acceptance.ts` reads and writes the rows, which means it imports the
 * service-role client and the `@/` path alias, and nothing that does that can be imported by
 * `node --test`.
 *
 * `accepted === null` MEANS "COULD NOT BE READ" AND ANSWERS NOTHING, which is the one place
 * this function is silent. The alternative is a customer on a flaky connection being asked to
 * accept terms they agreed to in September, on every screen, with no way to tell whether
 * their tick was kept. Asking again is not the safe direction here: it is a wrong claim about
 * the record we hold.
 *
 * A KIND WITH NO VERSION THROWS RATHER THAN PASSING. `currentVersions()` is total over the
 * kinds `policies.ts` writes, so a kind missing from it is a typo in a list of kinds — and a
 * typo that answered "already agreed" would be a page nobody is ever asked about.
 */
import { currentVersions, type PolicyKind } from './policies.ts'

export function pendingAcceptances(
  kinds: readonly PolicyKind[],
  accepted: Partial<Record<PolicyKind, string>> | null,
): PolicyKind[] {
  if (accepted === null) return []

  const versions = currentVersions()
  return kinds.filter((kind) => {
    const version = versions[kind]
    if (!version) throw new Error(`No policy version is written for ${kind}`)
    return accepted[kind] !== version
  })
}
