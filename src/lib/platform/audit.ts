/**
 * The founder's audit browser: which lines it may show, and how its URL is read.
 *
 * WHAT THIS SCREEN IS FOR, and the reason it is not the centre's own log. /settings/activity
 * is an owner's record of *their* centre — a register overridden, a fee corrected, a
 * permission changed — and the whole point of it is that the subject of the log is inside
 * the centre. A founder reading that log would be reading a child's marks and a parent's
 * phone number through a table, which is the one thing the panel's design keeps out: every
 * figure /founder shows is counted by a definer function precisely so that a founder never
 * reads a row about a family.
 *
 * So this browser is scoped to the questions a platform actually has to answer: did this
 * customer's payment get recorded, who moved that centre's plan or its status, who added or
 * switched off that login, what happened to a subscription. Those are the five tables below,
 * and every one of them is a row about the platform's relationship with a customer rather
 * than about the customer's own business. `20260811000046` audits eighteen tables; a founder
 * sees five of them and this file is where that is decided and written down.
 *
 * IT IS NOT A PERMISSION. `audit_log_owner_read` grants a platform admin every row in the
 * table, so nothing here is a fence — it is a decision about what this screen is *for*, and
 * the honest way to keep that decision is a closed list with a test that it never drifts
 * out of `AUDITED_TABLES`.
 *
 * WHY THE FILTER PARSING LIVES HERE RATHER THAN IN THE PAGE. Every value arrives from a URL
 * somebody can edit, and every one of them is passed to PostgREST: an entity that is not a
 * table, a timestamp that is not a timestamp, or a centre id that is not a uuid is not a
 * filter that returns nothing — it is a request the database refuses, which the screen would
 * draw as an unreadable log. So the four keys are validated against closed lists and
 * shapes, one at a time, and anything that fails is dropped rather than refused: a typo in a
 * bookmark draws the whole log, the same call /founder makes for its own controls.
 *
 * The list is compared against `AUDITED_TABLES` in tests/platform-audit.test.ts rather than
 * imported beside it here: a module that imported the full list to validate its own subset
 * would still load the full list into the founder's screen, and the assertion belongs where
 * it can fail loudly rather than where it runs on every request.
 */

/**
 * The tables a founder's log holds — the platform's side of the relationship, newest first
 * in the order the filter offers them.
 *
 * `coaching_centers` leads because it carries the plan, the status and the line, which is
 * the history a founder reads when a customer says "you changed something and never told
 * me". `subscriptions` is last only because money and logins are asked about more.
 */
export const PLATFORM_ENTITIES = [
  'coaching_centers',
  'payments',
  'payment_intents',
  'subscriptions',
  'center_members',
] as const

export type PlatformEntity = (typeof PLATFORM_ENTITIES)[number]

export function isPlatformEntity(value: unknown): value is PlatformEntity {
  return typeof value === 'string' && (PLATFORM_ENTITIES as readonly string[]).includes(value)
}

/** Matches `public.audit_operation` in 20260811000046. */
export const AUDIT_OPERATIONS = ['created', 'updated', 'deleted'] as const

export type AuditOperation = (typeof AUDIT_OPERATIONS)[number]

export function isAuditOperation(value: unknown): value is AuditOperation {
  return typeof value === 'string' && (AUDIT_OPERATIONS as readonly string[]).includes(value)
}

/**
 * A uuid, lower case or not.
 *
 * Deliberately not the strict RFC 4122 variant/version pattern: this is a filter, and the
 * only thing it has to guarantee is that PostgREST will not be handed a `text` where a
 * `uuid` belongs. A v7 id from a future `gen_random_uuid` replacement still matches.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What the log is currently showing. Nulls are "no filter", never "no rows". */
export type AuditFilter = {
  centerId: string | null
  entity: PlatformEntity | null
  operation: AuditOperation | null
  /** The cursor: strictly older than this, for the pager. */
  before: string | null
}

/** One value out of a query string that Next hands over as a string or a list. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/**
 * The four keys, read and validated.
 *
 * `before` is checked with `Date.parse` rather than a regex because what it has to satisfy is
 * the *postgres* timestamp parser on the far side, and `Date.parse` accepts exactly the
 * ISO-8601 shapes PostgREST sends back in a `created_at`. An unparseable cursor is dropped,
 * which re-draws the newest page instead of an error — the failure a founder reading an old
 * page is most likely to cause, and the one with the least to explain.
 */
export function readAuditFilter(
  params: Record<string, string | string[] | undefined>,
): AuditFilter {
  const center = one(params.center)
  const entity = one(params.entity)
  const operation = one(params.operation)
  const before = one(params.before)

  return {
    centerId: UUID.test(center) ? center.toLowerCase() : null,
    entity: isPlatformEntity(entity) ? entity : null,
    operation: isAuditOperation(operation) ? operation : null,
    before: before !== '' && !Number.isNaN(Date.parse(before)) ? before : null,
  }
}

/** Whether anything is narrowed — what decides if the Clear link is drawn. */
export function isFiltered(filter: AuditFilter): boolean {
  return (
    filter.centerId !== null || filter.entity !== null || filter.operation !== null
  )
}

/**
 * The URL for this filter, or for a different page of it.
 *
 * Built here rather than in the page because the pager and the Clear link have to agree with
 * the form about what the keys are called, and three places spelling `operation` is how a
 * filter that works in the form stops working one page deeper.
 */
export function auditHref(
  filter: AuditFilter,
  overrides: { before?: string | null } = {},
): string {
  const search = new URLSearchParams()
  if (filter.centerId !== null) search.set('center', filter.centerId)
  if (filter.entity !== null) search.set('entity', filter.entity)
  if (filter.operation !== null) search.set('operation', filter.operation)

  const before = overrides.before === undefined ? filter.before : overrides.before
  if (before !== null) search.set('before', before)

  const suffix = search.toString()
  return suffix === '' ? '/founder/audit' : `/founder/audit?${suffix}`
}
