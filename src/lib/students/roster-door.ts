import 'server-only'

/**
 * Whether the roster's doors are open, and the sentence to draw when they are not.
 *
 * THE SCREEN HALF OF THE THIRD FENCE (20260811000098). The rule is `trialRosterRefusal` in
 * plans.ts, the count is `trialRosterVerdict` in headcount.ts, and the enforcement is
 * `app.guard_trial_roster` in the database — a trigger, so it holds whatever route a write came
 * in by. What is left is the thing every fence in this product needs and no trigger can do:
 * **not drawing a door that could only refuse.** Four screens have one — the roster's own "New"
 * button and its paste tile, the admission form, and the import screen — and each of them draws
 * a different thing in its place, so the words are resolved once here and each page decides
 * where its card goes.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN EACH PAGE, which is the shape the branches and
 * teachers screens use: those two fences are answered off a count the page has already made and
 * a balance it already holds. This one is not — it needs the policy row, and the headcount is a
 * different number from the one the roster screen has in hand (`activeCount` there is the
 * reader's branch, because students_branch_scope narrows the list; the bound is the
 * organisation's). Four copies of that would be four chances for a screen to disagree with the
 * action about which of the two numbers the rule is about.
 *
 * AND IT COSTS A DRY TRIAL TWO QUERIES, OR NOTHING AT ALL. `trialRosterVerdict` returns before
 * its count on a teacher tier and on any organisation holding money, so the funded path — which
 * is every visit from every paying customer — pays for neither read; the policy row is asked
 * after that early answer for the same reason. A failed count is a closed door rather than an
 * open one: the action would refuse the write with the same sentence, and a form that could
 * only refuse is what this file exists to stop drawing.
 *
 * THE SENTENCE IS THE ACTION'S OWN, word for word (`settings.students.errors.rosterNotFunded`),
 * so a card and a refusal can never disagree about the number — and the way out is the one
 * screen that takes money (§20.4).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { CenterSession } from '../auth/session.ts'
import { dict } from '../i18n/index.ts'
import { readPlatformSettings } from '../platform/settings.ts'
import { trialRosterVerdict } from './headcount.ts'
import type { Database } from '../supabase/types.ts'

/**
 * Open, or closed with everything a screen needs to say why and where to go.
 *
 * `to` IS A LITERAL TYPE AND HAS TO BE one: Next 16 types `Link`'s `href` as a route rather
 * than as a string, so a `string` field reaching a `<Link>` is a build error — which is the
 * compiler refusing to let a fence point at a page nobody has. Both fences before this one
 * hardcode the same address at their own call site for the same reason.
 */
export type RosterDoor =
  | { open: true }
  | { open: false; title: string; body: string; to: '/settings/billing'; link: string }

export async function rosterDoor(
  supabase: SupabaseClient<Database>,
  session: CenterSession,
): Promise<RosterDoor> {
  if (session.plan.maxStudents !== null) return { open: true }
  if (session.billing.balancePoisha !== null && session.billing.balancePoisha > 0) {
    return { open: true }
  }

  const policy = await readPlatformSettings(supabase)
  const verdict = await trialRosterVerdict(supabase, {
    centerId: session.active.centerId,
    plan: session.plan,
    balancePoisha: session.billing.balancePoisha,
    ceiling: policy.trialRosterCeiling,
  })

  if (verdict.state === 'ok') return { open: true }

  const t = dict(session.locale).settings.students
  return {
    open: false,
    title: t.rosterTitle,
    // The numberless sentence for the two cases that have no number to name: a roster that
    // could not be counted, and a policy row that could not be read. Both are refusals, and
    // both are the action's own words, so a card and a refusal still say one thing.
    body:
      verdict.state === 'full' && verdict.ceiling !== null
        ? t.errors.rosterNotFunded(verdict.ceiling)
        : t.errors.rosterUnknown,
    to: '/settings/billing',
    link: t.rosterLink,
  }
}
