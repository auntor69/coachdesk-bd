import {
  getSession,
  isStaffAdmin,
  type Session,
} from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { has } from '@/lib/plans'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { currentPeriodMonth } from '@/lib/bd/time'
import {
  toCsv,
  contentDisposition,
  CSV_CONTENT_TYPE,
} from '@/lib/csv'
import {
  buildReport,
  isReportId,
  MAX_EXPORT_ROWS,
} from '@/lib/export/reports'

/**
 * The download itself: one CSV, built server-side, handed back as an attachment.
 *
 * A Route Handler and not a Server Action, because the thing being produced is a
 * file. A Server Action returns a value to a React tree, so a browser only ever
 * receives a download from one if the client component turns the bytes into a Blob
 * and synthesises a click — which means shipping the whole sheet through the RSC
 * payload, holding a month of payments in a phone's memory, and losing the download
 * entirely if the tab is backgrounded halfway. A plain `<a href>` to this route is
 * the browser's own download manager, works with no JavaScript at all, and can be
 * retried by pulling down on the page.
 *
 * THREE GATES, ALL OF THEM HERE. The proxy only proves a session cookie exists, and
 * an exported roster is every minor's name, class and guardian's mobile number in one
 * file — so this handler re-checks all of it:
 *
 *   1. a session with an active centre, or 401;
 *   2. staff-admin in that centre, or 403. A teacher holding `can_view_fees` reads
 *      their own students' arrears on the board; the centre's roster and its month
 *      of takings are not that, and no export here is scoped down to one teacher's
 *      batches — so the answer is no rather than a narrower file;
 *   3. `exportReports` on the plan, or 403. This is what the Pro tier sells.
 *
 * The queries then run as the caller through RLS, so even if all three were wrong
 * the database would still refuse to hand over another centre's rows.
 *
 * ERRORS ARE PLAIN TEXT, IN THE READER'S LANGUAGE. There is no page to render into —
 * the browser navigated here expecting a file — so a rendered error component would
 * mean a blank download in a new tab. A short sentence is what a browser shows.
 *
 * No route segment config: GET handlers read the query string here, which already
 * makes this dynamic, and `runtime = 'nodejs'` is the default that the Next 16 docs
 * ask not to be restated.
 */

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/**
 * A plain-text refusal.
 *
 * `no-store` on every one of them: a 403 cached by a browser or an intermediary is a
 * customer who upgrades their plan and still cannot download anything.
 */
function refuse(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** The reader's language, from the session if there is one. */
function words(session: Session | null) {
  return dict(session?.locale ?? DEFAULT_LOCALE).settings.export
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession()
  const t = words(session)

  if (!session) return refuse(401, t.errors.signIn)
  if (!session.active) return refuse(403, t.errors.noCenter)
  if (!isStaffAdmin(session)) return refuse(403, t.errors.forbidden)
  if (!has(session.plan, 'exportReports')) return refuse(403, t.errors.needsPlan)

  const params = new URL(request.url).searchParams

  const kind = params.get('kind') ?? ''
  // A bad `kind` is refused rather than defaulted. Unlike a month — where the
  // obvious sheet is this one — there is no obvious report, and silently handing
  // back the roster when the link said `collections` would be a file the owner
  // then reconciles against the wrong thing.
  if (!isReportId(kind)) return refuse(400, t.errors.unknownKind)

  const rawMonth = params.get('month') ?? ''
  // An unparseable month is this month rather than an error, matching the register:
  // the parameter comes from a URL somebody may have edited or shared, and a
  // download that refuses to happen is less useful than one for the obvious month.
  const month = MONTH_RE.test(rawMonth) ? rawMonth : currentPeriodMonth()

  const supabase = await createClient()

  const built = await buildReport(kind, {
    supabase,
    centerId: session.active.centerId,
    month,
    locale: session.locale,
  })

  if (!built.ok) {
    return built.reason === 'tooLarge'
      ? refuse(413, t.errors.tooLarge(MAX_EXPORT_ROWS))
      : refuse(502, t.errors.unreadable)
  }

  const { header, rows, period } = built.sheet
  const body = toCsv(header, rows)

  // Two filenames, because the browser gets to choose which it can honour. The
  // ASCII one is always the same shape — coachdesk-dues-2026-08.csv — so a folder
  // of them sorts by kind and then by period; the full one leads with the centre's
  // own name, which is what an owner sending the file on to somebody else needs on
  // it. See contentDisposition for how the two travel in one header.
  const asciiName = `coachdesk-${kind}-${period}.csv`
  const fullName = `${session.active.centerName}-${kind}-${period}.csv`

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': CSV_CONTENT_TYPE,
      'content-disposition': contentDisposition(asciiName, fullName),
      // A centre's roster and its takings, keyed to a session cookie. Nothing about
      // this may sit in a shared cache, and a browser re-serving yesterday's file
      // from disk would be an owner reconciling against stale numbers.
      'cache-control': 'no-store, private',
    },
  })
}
