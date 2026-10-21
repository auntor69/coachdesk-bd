import 'server-only'

/**
 * Consent is a row, not a checkbox — MASTERPLAN.md §14.1, build-order step 25a.
 *
 * WHAT THIS MODULE IS FOR. Two writes and one read. The write happens twice in a customer's
 * life — at signup, where the contract and the data terms are agreed to, and at the first
 * recharge, where the money terms are (§14.1) — and the read exists so that a version we
 * change asks the reader again instead of quietly inheriting an agreement to wording they
 * never saw.
 *
 * THE RE-ASK RULE ITSELF IS NOT HERE — it is `pendingAcceptances` in ./reask.ts, which is a
 * comparison of two maps and therefore has no business sitting behind the module that holds
 * the service-role key. What this file adds is the reading that half needs.
 *
 * THE VERSIONS ARE NOT ARGUMENTS. Every function here takes a *kind* and reads the version
 * out of `policies.ts` itself. That is the whole reason this module exists rather than two
 * inserts in the two callers: a version arriving as a parameter is a version a caller can
 * get wrong, and the failure is silent and permanent — a row saying somebody agreed to
 * today's billing terms when the page they read was last written in August. The browser
 * cannot name a version either, since no form field reaches these functions at all.
 *
 * THE PROFILE IS THE ACTOR'S. `recordAcceptance` is called with an id that came from a
 * session or from `verifyOtp`'s own answer, and it writes with the service role — so this
 * module, and not a policy, is what keeps one person from recording another's consent. The
 * table's own policies do hold for anything that writes as the reader (see migration 85);
 * the service role is used because signup's acceptance lands in the same request that
 * confirms the address, before a cookie has been written to the response.
 *
 * NOTHING HERE DECIDES WHETHER SOMEBODY MAY PROCEED. There is no gate on the recharge
 * action and none on signup — the checkbox is refused before the account or the claim is
 * written, and that refusal is a sentence in the action. A "you must accept" thrown from
 * here would be a second, invisible refusal in a place no screen can word.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, TablesInsert } from '@/lib/supabase/types'
import { UNIQUE_VIOLATION } from '@/lib/idempotency'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentVersions, type PolicyKind } from './policies.ts'

/*
 * THE CAST IS GONE. The hand-written shape for `policy_acceptances` — written while
 * migration 20260811000085 was still unpushed and the generated types could not see the
 * table — is deleted now that `npm run gen:types` has run against the live database. Every
 * client below is typed as `Database` directly, which is the whole point: the shape that is
 * checked against the database is the one that wins.
 */

/**
 * Records that this person agreed to the current wording of these policies.
 *
 * IDEMPOTENT, AND THAT IS A FEATURE OF THE FORM RATHER THAN OF THIS FUNCTION. A form
 * submitted twice — a double tap on a slow connection, a retry — must not produce two rows,
 * and `policy_acceptances` has the unique indexes that say so. A unique violation here is
 * therefore the *success* path of a repeat: it means a row already exists for exactly this
 * person, this policy and this version, which is the fact we were trying to write.
 *
 * A FAILURE IS NOT THROWN AT THE CALLER. The two callers are a signup that has already
 * confirmed an address and a recharge claim that has already been filed; neither of them
 * can undo what happened, and refusing them afterwards would turn a bookkeeping problem
 * into a customer who lost their account. So this returns whether the write landed, and the
 * caller decides — today, both of them let it pass, and what is on the record is the claim
 * and the audit log rather than a broken signup. It is logged, because a consent row that
 * never wrote is the one failure this table cannot discover later.
 */
export async function recordAcceptance(
  profileId: string,
  centerId: string | null,
  kinds: readonly PolicyKind[],
): Promise<boolean> {
  if (kinds.length === 0) return true

  const versions = currentVersions()
  const rows: TablesInsert<'policy_acceptances'>[] = kinds.map((kind) => {
    // Read here and not passed in — see the module note. A kind with no page throws rather
    // than writing a row that names a policy nobody has written, which is the one way this
    // table could hold an acceptance of nothing at all.
    const version = versions[kind]
    if (!version) throw new Error(`No policy version is written for ${kind}`)

    return {
      profile_id: profileId,
      coaching_center_id: centerId,
      policy_kind: kind,
      policy_version: version,
    }
  })

  const { error } = await createAdminClient(profileId)
    // scoped-by: profile_id is a column of the row and the only subject. This table is
    // about a person rather than a centre — it has no coaching_center_id filter the way a
    // tenant read does, for the reason the module note gives: policy_acceptances_self_read
    // is `profile_id = auth.uid()`, and the service role here is the same person.
    .from('policy_acceptances')
    .insert(rows)

  if (!error) return true
  if (error.code === UNIQUE_VIOLATION) return true

  // Deliberately not the row contents: this table names people, and a log line is not a
  // place to put a profile id beside the fact that they accepted something.
  console.error('policy_acceptances insert failed', error.code, error.message)
  return false
}

/**
 * Every version this person has agreed to, keyed by policy — the read the re-ask rule needs.
 *
 * THE MOST RECENT VERSION PER KIND AND NOT A LIST OF EVERY ROW. Somebody who accepted the
 * September terms and was asked again in December has two rows, and the question a screen
 * asks is "is what they agreed to what we are showing", which only the newest row answers.
 * Taking it here, in one place, is what keeps two screens from disagreeing about which row
 * to read — the same argument as `currentVersions`.
 *
 * AN UNREADABLE TABLE ANSWERS `null`, NOT `{}`, and the distinction is the one this codebase
 * makes everywhere else: an empty map means "this person has agreed to nothing", which is
 * true of every new account and would re-ask a long-standing customer to accept terms they
 * accepted a year ago, on the screens where being asked again looks like the product having
 * forgotten them. Null means the question could not be put, and the callers treat that as
 * "do not ask" rather than "ask again".
 *
 * The client is passed in so the read happens under the caller's own RLS — `profile_id =
 * auth.uid()` — and the cast is only about types.
 */
export async function acceptedVersions(
  supabase: SupabaseClient<Database>,
  profileId: string,
): Promise<Partial<Record<PolicyKind, string>> | null> {
  const { data, error } = await supabase
    // scoped-by: profileId, filtered below — and the row's own policy
    // (`profile_id = auth.uid()`) would narrow it to the same rows regardless, because
    // this is the caller's client and the acceptance is their own.
    .from('policy_acceptances')
    .select('policy_kind, policy_version, accepted_at')
    .eq('profile_id', profileId)
    .order('accepted_at', { ascending: false })

  if (error || !data) return null

  const newest: Partial<Record<PolicyKind, string>> = {}
  for (const row of data) {
    // The list is newest-first, so the first row seen for a kind is the one that counts.
    newest[row.policy_kind] ??= row.policy_version
  }
  return newest
}

