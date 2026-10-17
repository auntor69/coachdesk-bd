import Link from 'next/link'
import type { Route } from 'next'

import { Alert, buttonClass, Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { getSession, pageRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, DEFAULT_LOCALE, type Dictionary, type Locale } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import { planFor, planName } from '@/lib/plans'
import { dhakaMoment, formatDate, formatTime } from '@/lib/bd/time'
import {
  AUDITED_TABLES,
  describeAuditEntry,
  isAuditedTable,
  type AuditEntry,
  type AuditShift,
  type AuditedTable,
} from '@/lib/audit'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).audit.title} — CoachDesk` }
}

/** One line, not a concatenation — see the fee board's COLUMNS for what splitting does. */
const COLUMNS = 'id, entity, entity_id, operation, before, after, actor, actor_role, created_at'

/**
 * A screenful, and one row past it.
 *
 * The extra row is how this page knows there is an older page without asking for a
 * `count`, which on a table that only grows is a second scan per view.
 */
const PAGE = 50

/**
 * §10 — who did what.
 *
 * OWNER ONLY, matching `audit_log_owner_read` in 20260811000046. Not a manager, and that
 * is the design rather than an omission: the support conversation this log exists for is
 * "my manager says he never entered that", and a subject who can read the record is a
 * subject who knows what it says about them. The policy refuses a manager anyway;
 * `pageRole` turns that into a 403 instead of an empty list.
 *
 * NOTHING HERE IS WRITTEN BY THE APP. The fourteen triggers in 20260811000046 write every
 * line inside the transaction that made the change, and the same migration revokes
 * insert, update, delete and truncate from every browser session. So this file has no
 * action beside it and never will — there is nothing a screen could offer.
 *
 * WHAT A LINE MEANS is decided in lib/audit.ts, where it is tested. This screen asks for
 * a page of raw snapshots, hands each to `describeAuditEntry`, looks up the names of the
 * people those lines are about, and draws them. The split matters because the naming is
 * the only part that can be wrong.
 *
 * PLAIN GET FOR BOTH CONTROLS — the filter and the older-page cursor — like the expenses
 * month select: no client component, and a URL an owner can send us mid-conversation.
 * The filter has a button because Android Chrome fires no navigation on a bare <select>.
 *
 * THREE COLUMNS FROM `lg` (§20.8.10). Fifty log lines are the densest list in the app and
 * were the loosest: a card per line with the time pushed 1,100px away from the action it
 * belonged to by `justify-between`, and the figure that settles the argument two lines
 * below that. From `lg` a line is `when | what, who, about | figure` — every time starting
 * at the same x, every amount ending at it — and a row is two lines instead of five.
 */
export default async function ActivityPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ entity?: string; before?: string }>
}) {
  const session = await pageRole('owner')
  const locale = session.locale
  const d = dict(locale)
  const t = d.audit

  const { entity: rawEntity, before: rawBefore } = await searchParams
  // Both arrive from a URL somebody may have edited. An entity that is not audited would
  // filter to nothing, and a cursor that is not a timestamp would make PostgREST refuse
  // the whole read, so neither is passed on.
  const entity: AuditedTable | null =
    rawEntity !== undefined && isAuditedTable(rawEntity) ? rawEntity : null
  const before =
    rawBefore !== undefined && !Number.isNaN(Date.parse(rawBefore)) ? rawBefore : null

  const supabase = await createClient()

  // `.eq` on the centre as well as the policy, for the reason the SMS screen gives about
  // its own: the policy is the guarantee, the filter is the query plan.
  //
  // Filters first and `.order`/`.limit` last, because that is the order the builder
  // allows — once a query is transformed it has no `.eq` left.
  let filtered = supabase
    .from('audit_log')
    .select(COLUMNS)
    .eq('coaching_center_id', session.active.centerId)

  if (entity !== null) filtered = filtered.eq('entity', entity)
  // Strictly less than, so the row the cursor came from is not repeated at the top of
  // the next page. `created_at` defaults to `clock_timestamp()`, so two lines from one
  // transaction differ and the tie-break below is a formality rather than a load-bearing
  // part of the ordering.
  if (before !== null) filtered = filtered.lt('created_at', before)

  // Teachers in the same round trip, needed whatever this page holds: once for the names
  // of lines *about* a teacher, and once as the only table that can turn an actor's
  // `user_id` into a person. `profiles` cannot — 20260811000002 leaves it self-read, so
  // an owner looking up a colleague's name there is handed nothing. A centre's whole
  // teacher list is a few dozen rows at any plan.
  const [page, teacherList] = await Promise.all([
    filtered
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE + 1),
    supabase
      .from('teachers')
      .select('id, user_id, name')
      .eq('coaching_center_id', session.active.centerId),
  ])

  const rows = page.data ?? []
  const hasOlder = rows.length > PAGE
  const entries = rows.slice(0, PAGE).map(describeAuditEntry)

  const teachers = teacherList.data ?? []
  const actorNames = new Map<string, string>()
  for (const teacher of teachers) {
    if (teacher.user_id !== null) actorNames.set(teacher.user_id, teacher.name)
  }

  /**
   * Which student a line is about, when its own snapshot could not say.
   *
   * 20260811000046 stores only the columns that moved, so a discount granted on an
   * invoice has `discount_bdt` in it and nothing else — `student_id` did not change, so
   * it is not there, so `describeAuditEntry` cannot see it. That is exactly the line the
   * migration header uses as its example, and "Discount granted, ৳200" with no name on it
   * is half a record.
   *
   * `entityId` is the invoice, the payment or the guardian, and each of those tables
   * carries the student as a column that never moves. So one lookup per table turns the
   * row's own id into the name an owner searches by. A row since deleted comes back with
   * nothing, and the line keeps its action and its figures.
   *
   * An attendance mark is the same detour with one more hop: the record holds an
   * enrolment, and the enrolment holds the student. Taken as an embed rather than two
   * reads, because the second would have to wait for the first. This is the line §10
   * exists for — "my manager says he never marked her absent" — and until it named the
   * child it was a log entry about a day rather than about a person.
   *
   * Not extended to salary_terms and salary_payments on purpose: their updates are the
   * automatic retirement of an agreement, which sits in the list directly beside the
   * `salarySet` line that replaced it — and that one is a create, so it carries the
   * teacher already.
   */
  const linkIds = (entity: 'fee_invoices' | 'fee_payments' | 'guardians' | 'attendance_records') => [
    ...new Set(
      entries.flatMap((e) =>
        e.subject === null && e.entity === entity && e.entityId !== null ? [e.entityId] : [],
      ),
    ),
  ]
  const invoiceIds = linkIds('fee_invoices')
  const paymentIds = linkIds('fee_payments')
  const guardianIds = linkIds('guardians')
  const markIds = linkIds('attendance_records')

  const idsFor = (table: 'students' | 'employees') => [
    ...new Set(entries.flatMap((e) => (e.subject?.table === table ? [e.subject.id] : []))),
  ]
  const employeeIds = idsFor('employees')

  // Spelled out one table at a time rather than through a helper taking the name,
  // because a `.from` given a variable is one check-scoping cannot see: the gate
  // matches a quoted table name, and a query it cannot see is a query it cannot prove
  // is centre-scoped. It refuses one now — these five are why. Every read below carries
  // its own `.eq` where the gate can find it.
  const [invoiceLinks, paymentLinks, guardianLinks, markLinks, employees] = await Promise.all([
    invoiceIds.length === 0
      ? null
      : supabase
          .from('fee_invoices')
          .select('id, student_id')
          .eq('coaching_center_id', session.active.centerId)
          .in('id', invoiceIds),
    paymentIds.length === 0
      ? null
      : supabase
          .from('fee_payments')
          .select('id, student_id')
          .eq('coaching_center_id', session.active.centerId)
          .in('id', paymentIds),
    guardianIds.length === 0
      ? null
      : supabase
          .from('guardians')
          .select('id, student_id')
          .eq('coaching_center_id', session.active.centerId)
          .in('id', guardianIds),
    markIds.length === 0
      ? null
      : supabase
          .from('attendance_records')
          .select('id, enrollments (student_id)')
          .eq('coaching_center_id', session.active.centerId)
          .in('id', markIds),
    employeeIds.length === 0
      ? null
      : supabase
          .from('employees')
          .select('id, name')
          .eq('coaching_center_id', session.active.centerId)
          .in('id', employeeIds),
  ])

  // entity_id -> student, for the lines that needed the detour.
  const linkedStudent = new Map<string, string>()
  for (const result of [invoiceLinks, paymentLinks, guardianLinks]) {
    for (const link of result?.data ?? []) linkedStudent.set(link.id, link.student_id)
  }

  // The mark's own row does not carry a student, so its enrolment is asked for it. Array
  // or object depending on how sharp the generated type is about a composite foreign key,
  // the way the absence notices read the same embed.
  for (const mark of markLinks?.data ?? []) {
    const enrollment = Array.isArray(mark.enrollments) ? mark.enrollments[0] : mark.enrollments
    if (enrollment) linkedStudent.set(mark.id, enrollment.student_id)
  }

  const studentIds = [...new Set([...idsFor('students'), ...linkedStudent.values()])]

  // Only the rows this page is about. A roster runs to hundreds of students; fifty log
  // lines name at most fifty of them.
  const students =
    studentIds.length === 0
      ? null
      : await supabase
          .from('students')
          .select('id, name')
          .eq('coaching_center_id', session.active.centerId)
          .in('id', studentIds)

  const names = new Map<string, string>()
  for (const student of students?.data ?? []) names.set(`students:${student.id}`, student.name)
  for (const employee of employees?.data ?? []) names.set(`employees:${employee.id}`, employee.name)
  for (const teacher of teachers) names.set(`teachers:${teacher.id}`, teacher.name)

  const last = entries.at(-1)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t.title}
        back={{ href: '/settings', label: d.settings.hub.title }}
        subtitle={t.subtitle}
        /* The one control on this screen, in the bar. Submitting drops the cursor on
           purpose: a filter applied halfway down the log would start from a timestamp
           that has nothing to do with the new list. Label-less for the bar's one line —
           the options are table names and the button says what it does. */
        actions={
          <form method="get" className="flex items-center gap-2">
            <select
              name="entity"
              aria-label={t.filterLabel}
              defaultValue={entity ?? ''}
              className="min-h-tap max-w-44 rounded-xl border-2 border-line bg-white px-3
                font-medium text-ink sm:max-w-64"
            >
              <option value="">{t.filterAll}</option>
              {AUDITED_TABLES.map((table) => (
                <option key={table} value={table}>
                  {t.entities[table]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className={buttonClass('primary', false, 'shrink-0')}
            >
              {t.show}
            </button>
          </form>
        }
      />

      {page.error !== null && <Alert>{t.unreadable}</Alert>}

      {page.error === null && entries.length === 0 && (
        /* Three sentences, so a card and not a column of one. */
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {entity === null ? t.emptyBody : t.emptyFiltered}
          </p>
        </Card>
      )}

      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <AuditRow
            key={entry.id}
            entry={entry}
            name={subjectName(entry, names, linkedStudent)}
            actor={actorLabel(entry, session.userId, actorNames, t)}
            locale={locale}
            d={d}
          />
        ))}
      </ul>

      {/* Forward only. A back link would need the previous page's first timestamp, which
          a stateless GET does not have — "newest" returns to the top of the same filter,
          which is where a reader who has gone too far actually wants to be.

          Apart at the two edges on a phone and together at the left from `lg`: on the
          first page the only link is "older", and at 1,216px `justify-between` parks it
          alone in the far corner, a screen's width from the list it continues. */}
      {(hasOlder || before !== null) && (
        <div className="flex items-center justify-between gap-3 lg:justify-start">
          {before === null ? (
            <span />
          ) : (
            <Link href={hrefFor(entity, null)} className={PAGER_CLASS}>
              {t.newest}
            </Link>
          )}
          {hasOlder && last !== undefined && (
            <Link href={hrefFor(entity, last.at)} className={PAGER_CLASS}>
              {t.older} →
            </Link>
          )}
        </div>
      )}

      <p className="max-w-2xl text-xs text-ink-soft">{t.writtenBy}</p>
    </div>
  )
}

/*
 * The shared button styles, so the pager cannot drift from the buttons on every other
 * screen — it was `px-4` against this file's own `px-5` before it was extracted.
 */
const PAGER_CLASS = buttonClass('secondary')

function hrefFor(entity: AuditedTable | null, before: string | null): Route {
  const search = new URLSearchParams()
  if (entity !== null) search.set('entity', entity)
  if (before !== null) search.set('before', before)
  const suffix = search.toString()
  return (suffix === '' ? '/settings/activity' : `/settings/activity?${suffix}`) as Route
}

/**
 * Who saved it, in a word the owner can act on.
 *
 * Themselves first, because an owner scanning their own log recognises "you" faster than
 * their own name. Then a teacher or manager by name. A `service_role` write is ours and
 * says so — a founder-panel action arrives that way — while the same role with no actor
 * at all is the cron worker, which 20260811000056 argues must not be given a name
 * because that would name somebody who was asleep. A `user_id` with no name behind it is
 * an account since removed, and "a member of this centre" is the honest answer where a
 * raw UUID would be none.
 */
function actorLabel(
  entry: AuditEntry,
  readerId: string,
  names: Map<string, string>,
  t: Dictionary['audit'],
): string {
  if (entry.actor === null) return entry.actorRole === 'service_role' ? t.platform : t.automatic
  if (entry.actor === readerId) return t.you
  return names.get(entry.actor) ?? t.someone
}

/**
 * The person or the paper a line is about.
 *
 * A looked-up name first, then the student the row belongs to when the snapshot could not
 * say (see `linkedStudent`), then whatever name or number the row itself carried — a
 * receipt number is a worse answer than a student's name and a better one than nothing.
 */
function subjectName(
  entry: AuditEntry,
  names: Map<string, string>,
  linked: Map<string, string>,
): string | null {
  if (entry.subject !== null) {
    return names.get(`${entry.subject.table}:${entry.subject.id}`) ?? entry.label
  }
  const studentId = entry.entityId === null ? undefined : linked.get(entry.entityId)
  if (studentId !== undefined) return names.get(`students:${studentId}`) ?? entry.label
  return entry.label
}

/** `Record<string, string>` so a value out of jsonb can be looked up without a cast. */
function pick(table: Record<string, string>, value: string): string {
  return table[value] ?? value
}

/** One side of a before-and-after. An absent side is a dash, not a zero. */
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
    // The founder panel's four words, the only ones written for these values and already
    // about a centre's own state.
    case 'centerStatus':
      return pick(d.founder.status, String(value))
    case 'studentStatus':
      return pick(d.studentForm.status, String(value))
    case 'role':
      return pick(d.audit.roles, String(value))
    // The register's own four words, which a manager reading a correction has already
    // seen on the register itself.
    case 'attendanceStatus':
      return pick(d.attendance, String(value))
  }
}

/**
 * One line: when, what happened to whom, and the one figure or from-to worth drawing.
 *
 * Individually bordered rather than a divided table, because on a 375px phone the
 * interesting part of a line is who did it and to whom, and a table would put that in a
 * column narrower than a name.
 *
 * FROM `lg` THE CARD IS THREE COLUMNS: a 128px time, the sentence, and the figures
 * right-aligned. Fixed widths and not `max-content`, which would size each row's columns
 * to its own longest word and align nothing — every card is its own grid. 128px holds
 * "১১ ফেব্রুয়ারি ২০২৬" at `text-xs`, and the time goes under the date rather than beside
 * it: the month names are spelled out in both languages, and a column wide enough for
 * "Student places bought" plus a date plus a time is a column that leaves no room for
 * the two names the line is actually about.
 *
 * The time is a line of its own on a phone rather than the top-right corner it used to
 * be. That corner cost nothing to give up — the same three cells in a column read as a
 * card, and one structure for both widths is one structure to get right.
 */
function AuditRow({
  entry,
  name,
  actor,
  locale,
  d,
}: {
  entry: AuditEntry
  name: string | null
  actor: string
  locale: Locale
  d: Dictionary
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
          <span className="font-medium text-ink">{actor}</span>
          {name !== null && <span>· {name}</span>}
          {/* The table's own name, but only where the action did not already say it —
              "Changed" on its own is not a sentence. */}
          {entry.action.startsWith('row') && isAuditedTable(entry.entity) && (
            <span>· {t.entities[entry.entity]}</span>
          )}
        </div>
      </div>

      {/* Rendered only when there is one, so an absent third cell leaves the sentence
          the width instead of a gap where a number would have been. */}
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
