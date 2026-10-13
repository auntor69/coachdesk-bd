import Link from 'next/link'
import type { Route } from 'next'

import { Card } from '@/components/ui'
import { pagePlatformAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import {
  describeAuditEntry,
  isAuditedTable,
  type AuditEntry,
  type AuditShift,
} from '@/lib/audit'
import { dhakaMoment, digits, formatDate, formatTime } from '@/lib/bd/time'
import { dict, type Dictionary, type Locale } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { planFor, planName } from '@/lib/plans'
import { FounderNav } from '../nav'
import {
  AUDIT_OPERATIONS,
  PLATFORM_ENTITIES,
  auditHref,
  isFiltered,
  readAuditFilter,
} from '@/lib/platform/audit'

/*
 * NO generateMetadata, like the founder page itself — a browser tab, a history entry or a
 * shared screenshot should say "CoachDesk" rather than name an admin panel. See the note at
 * the top of ../page.tsx.
 */

/** One line, not a concatenation — the fee board's note on COLUMNS says what splitting does. */
const COLUMNS =
  'id, coaching_center_id, entity, entity_id, operation, before, after, actor, actor_role, created_at'

/**
 * A screenful, and one row past it.
 *
 * The extra row is how the pager knows there is an older page without asking for a `count`,
 * which on a table that only ever grows is a second scan per view. Same fifty as the
 * owner's own log, because the two screens are the same list read by two people.
 */
const PAGE = 50

/**
 * §10, for the platform: who did what to a customer.
 *
 * WHY THIS PAGE EXISTS AT ALL. The founder's four levers — money, granted days, the plan, a
 * password reset — all write through the service role, which means the audit lines they leave
 * name *our team* and nothing finer: `actor` is set, `actor_role` is `service_role`, and an
 * owner reading their own log sees that we moved their line on some Tuesday. The question
 * "who did this, and from where" is answerable only from this side of the fence, and until
 * this screen existed the answer lived in a SQL console.
 *
 * THE ENTITY LIST IS THE PRIVACY LINE, not a filter default. See lib/platform/audit.ts: a
 * founder sees the five tables that describe our relationship with a customer — the centre
 * row itself, payments, payment requests, subscriptions, logins — and never the register, the
 * fee board or a student. `audit_log_owner_read` would hand over all eighteen; this screen
 * asks for five, and a test asserts the five stay inside the audited list.
 *
 * THE ACTOR IS A NAME WHERE ONE CAN BE READ, and `profiles_self_read` answers a platform admin
 * (20260811000002), so a founder's own actions read as their name rather than as a uuid. The
 * three words the owner's log uses for the rest carry over unchanged: `platform` for a
 * service-role write, `automatic` for the cron worker with no actor at all, `someone` for an
 * account since deleted.
 *
 * PLAIN GET FOR EVERY CONTROL, like the owner's log and the customer list: no client
 * component, the URL is the state, and a filtered view is a link a founder can send to
 * themselves. A cursor instead of a page number, because the log is ordered by
 * `clock_timestamp()` and a page number would shift under a refresh.
 */
export default async function FounderAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await pagePlatformAdmin()
  const locale = session.locale
  const d = dict(locale)
  const t = d.founder.audit

  const filter = readAuditFilter(await searchParams)
  const supabase = await createClient()

  /*
   * Filters first, `.order`/`.limit` last: once a query builder has been transformed it has
   * no `.eq` left, so the chain has to be built in the order the builder allows.
   *
   * `.in('entity', …)` is not optional and comes before the rest — it is the whole privacy
   * argument of this screen, and it holds even when the founder has chosen nothing.
   */
  let query = supabase
    .from('audit_log')
    .select(COLUMNS)
    // scoped-by: every centre is the point of this log; audit_log_owner_read in
    // 20260811000046 answers app.is_platform_admin(), and the entity list beside it is what
    // keeps a founder out of a centre's classroom rows.
    .in('entity', [...PLATFORM_ENTITIES])

  if (filter.centerId !== null) query = query.eq('coaching_center_id', filter.centerId)
  if (filter.entity !== null) query = query.eq('entity', filter.entity)
  if (filter.operation !== null) query = query.eq('operation', filter.operation)
  // Strictly less than, so the row the cursor came from is not repeated at the top of the
  // next page.
  if (filter.before !== null) query = query.lt('created_at', filter.before)

  const [page, centers] = await Promise.all([
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE + 1),
    // The whole book, twice over: the filter's `<select>`, and the name on every line. One
    // read serves both, and it is two columns wide.
    // scoped-by: every centre is the point of this panel; centers_member_read in
    // 20260811000002_rls_policies.sql is what authorises it.
    supabase.from('coaching_centers').select('id, name').order('name'),
  ])

  const rows = page.data ?? []
  const hasOlder = rows.length > PAGE

  /*
   * The line and the customer it belongs to, kept together.
   *
   * `describeAuditEntry` answers about the change, not about whose it was — the owner's own
   * log never needs the second because the whole page is one centre. Here the centre's name
   * is half of what a founder is scanning for, so the id travels beside the described line
   * rather than being pushed into lib/audit.ts, which is shared with a screen that has no
   * use for it.
   */
  const lines = rows
    .slice(0, PAGE)
    .map((row) => ({ entry: describeAuditEntry(row), centerId: row.coaching_center_id }))
  const entries = lines.map((line) => line.entry)

  const centerNames = new Map((centers.data ?? []).map((row) => [row.id, row.name]))

  /**
   * The people on this page, by id.
   *
   * `profiles_self_read` answers a platform admin for every row, so one read names a page's
   * actors regardless of which centre they belong to — and an actor with no name (a removed
   * account, a service write) falls back to the three words below rather than to a uuid.
   */
  const actorIds = [...new Set(entries.flatMap((e) => (e.actor === null ? [] : [e.actor])))]
  const actors =
    actorIds.length === 0
      ? []
      : ((
          await supabase
            .from('profiles')
            .select('id, full_name, email, phone')
            .in('id', actorIds)
        ).data ?? [])
  // The address before the number: an actor with no name typed on their profile is named
  // by whichever identifier they sign in with, and §5.4 leaves an email-signup account with
  // no number to fall back to. A phone stays for the staff logins that have one.
  const names = new Map(
    actors.map((row) => [row.id, row.full_name ?? row.email ?? row.phone ?? '']),
  )

  const filtered = isFiltered(filter) || filter.before !== null

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
      <div>
        <Link
          href="/founder"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.founder.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.lead}</p>
      </div>

      <FounderNav here="audit" words={d.founder.nav} />

      <form
        method="get"
        className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-xs text-ink-soft">{t.center}</span>
            <select
              name="center"
              defaultValue={filter.centerId ?? ''}
              className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
            >
              <option value="">{t.allCenters}</option>
              {(centers.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">{t.entity}</span>
            <select
              name="entity"
              defaultValue={filter.entity ?? ''}
              className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
            >
              <option value="">{t.allEntities}</option>
              {PLATFORM_ENTITIES.map((entity) => (
                <option key={entity} value={entity}>
                  {d.audit.entities[entity]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">{t.operation}</span>
            <select
              name="operation"
              defaultValue={filter.operation ?? ''}
              className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
            >
              <option value="">{t.anyOperation}</option>
              {AUDIT_OPERATIONS.map((operation) => (
                <option key={operation} value={operation}>
                  {t.operations[operation]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="min-h-tap rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.apply}
          </button>

          {filtered && (
            <Link
              href={'/founder/audit' as Route}
              className="inline-flex min-h-tap items-center px-3 text-sm font-medium text-ink-soft hover:text-ink"
            >
              {t.clear}
            </Link>
          )}
        </div>

        {/* What the controls did, and it is not decoration: a filtered log of four lines from
            a table of thousands reads as "nothing has ever happened" unless the screen says
            how much it is showing. */}
        <p className="text-xs text-ink-faint">
          {t.lines(digits(entries.length, locale))}
        </p>
      </form>

      {page.error ? (
        <Card>
          <p className="font-medium text-ink">{d.audit.unreadable}</p>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <p className="font-medium text-ink">{t.none}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.noneHint}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map(({ entry, centerId }) => (
            <AuditRow
              key={entry.id}
              entry={entry}
              center={centerNames.get(centerId) ?? null}
              actor={actorLabel(entry, session.userId, names, d.audit)}
              locale={locale}
              d={d}
              unknown={t.unknownCenter}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {hasOlder && (
          <Link
            href={auditHref(filter, { before: entries[entries.length - 1]?.at ?? null }) as Route}
            className="inline-flex min-h-tap items-center rounded-xl border-2 border-line px-4 font-semibold text-ink"
          >
            {d.audit.older} →
          </Link>
        )}
        {filter.before !== null && (
          <Link
            href={auditHref(filter, { before: null }) as Route}
            className="inline-flex min-h-tap items-center rounded-xl border-2 border-line px-4 font-semibold text-ink"
          >
            {d.audit.newest}
          </Link>
        )}
      </div>

      {/*
       * The one thing a reader of this page has to know and could not guess: the lines below
       * are not the whole of what happened to these customers. Their own log holds the rest,
       * and it is theirs to read.
       */}
      <p className="max-w-3xl text-xs text-ink-soft">{t.scope}</p>
      <p className="max-w-3xl text-xs text-ink-soft">{d.audit.writtenBy}</p>
    </main>
  )
}

/**
 * Who saved it, in a word the founder can act on.
 *
 * Themselves first — a founder scanning their own log recognises \"you\" faster than their
 * own name — then by name out of `profiles`. A `service_role` write with no actor is one of
 * our own jobs, and the same role *with* an actor is a founder action taken through the
 * admin client; `20260811000056` argues the cron worker must not be given a name, because
 * that would name somebody who was asleep.
 */
function actorLabel(
  entry: AuditEntry,
  readerId: string,
  names: Map<string, string>,
  t: Dictionary['audit'],
): string {
  if (entry.actor === null) return entry.actorRole === 'service_role' ? t.platform : t.automatic
  if (entry.actor === readerId) return t.you
  return names.get(entry.actor) || t.someone
}

/** `Record<string, string>` so a value out of jsonb can be looked up without a cast. */
function pick(table: Record<string, string>, value: string): string {
  return table[value] ?? value
}

/**
 * One side of a before-and-after.
 *
 * SIX ARMS AND A DEFAULT, and the hole is deliberate rather than lazy. A platform log holds
 * no `students`, `attendance_records` or `guardians` row — `PLATFORM_ENTITIES` is the fence —
 * so `studentStatus` and `attendanceStatus` cannot arrive. A switch that pretended otherwise
 * would be dead code; a switch with no default at all would be a crash the day a migration
 * widens the list, and a log that throws while somebody is looking for an audit trail is worse
 * than one printing a raw value.
 */
function sideOf(
  shift: AuditShift,
  value: string | number | null,
  locale: Locale,
  d: Dictionary,
): string {
  if (value === null) return '—'
  switch (shift.kind) {
    case 'money':
      return formatTaka(Number(value))
    case 'count':
      return String(value)
    case 'date':
      return formatDate(String(value), locale)
    case 'plan':
      return planName(planFor(String(value)), locale)
    // The founder panel's own four words, already written for these values.
    case 'centerStatus':
      return pick(d.founder.status, String(value))
    case 'role':
      return pick(d.audit.roles, String(value))
    default:
      return String(value)
  }
}

/**
 * One line: when, who, what happened to which customer, and the figure worth drawing.
 *
 * THE CENTRE IS THE SUBJECT HERE, which is the difference from the owner's log: an owner
 * already knows which centre they are reading about, and a founder reading fifty lines across
 * eleven customers does not. So the name goes in the sentence on every row, and the action
 * comes first — the scan a founder makes is "what happened", then "to whom".
 *
 * Three columns from `lg`, the same shape the owner's log settled on: an 8rem time, the
 * sentence, and the figures right-aligned.
 */
function AuditRow({
  entry,
  center,
  actor,
  locale,
  d,
  unknown,
}: {
  entry: AuditEntry
  /** The customer's name, or null when the read could not name it — a row is never dropped. */
  center: string | null
  actor: string
  locale: Locale
  d: Dictionary
  /** Said where the name could not be read. A line without a customer is still a line. */
  unknown: string
}) {
  const t = d.audit
  const when = dhakaMoment(entry.at)
  const hasFigures = entry.amountBdt !== null || entry.shift !== null || entry.otherCount > 0

  return (
    <li
      className="flex flex-col gap-1 rounded-xl border border-line bg-white px-4 py-3
        lg:grid lg:grid-cols-[8rem_minmax(0,1fr)_auto] lg:items-baseline lg:gap-x-4"
    >
      <div className="num text-xs text-ink-soft lg:flex lg:flex-col">
        <span>{formatDate(when.date, locale)}</span>{' '}
        <span>{formatTime(when.time, locale)}</span>
      </div>

      <div className="min-w-0">
        <div className="font-semibold text-ink">{t.actions[entry.action]}</div>
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-soft">
          <span className="font-medium text-ink">{center ?? unknown}</span>
          <span>· {actor}</span>
          {/* The table's own name, but only where the action did not already say it:
              "Changed" on its own is not a sentence. */}
          {entry.action.startsWith('row') && isAuditedTable(entry.entity) && (
            <span>· {t.entities[entry.entity]}</span>
          )}
        </div>
      </div>

      {hasFigures && (
        <div className="flex flex-col lg:items-end lg:text-right">
          {entry.amountBdt !== null && (
            <div className="num font-semibold text-ink">{formatTaka(entry.amountBdt)}</div>
          )}

          {entry.shift !== null && (
            <div className="num text-sm text-ink">
              {sideOf(entry.shift, entry.shift.from, locale, d)}{' '}
              <span className="text-ink-soft">→</span>{' '}
              {sideOf(entry.shift, entry.shift.to, locale, d)}
            </div>
          )}

          {entry.otherCount > 0 && (
            <div className="text-xs text-ink-soft">{t.more(entry.otherCount)}</div>
          )}
        </div>
      )}
    </li>
  )
}
