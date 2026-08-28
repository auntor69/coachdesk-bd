/**
 * Reading every row of a query, when "every row" is more than PostgREST will hand
 * over in one answer.
 *
 * THE CEILING IS REAL AND IT IS SILENT. A Supabase project answers at most 1000
 * rows per request, and asking for more does not fail — it returns 1000 rows and a
 * 200. So a query that outgrows the ceiling does not break, it starts lying, and it
 * lies in the direction that looks fine: a shorter list, a smaller total, a month
 * billed for the first thousand enrolments and silently not the rest.
 *
 * WHICH QUERIES THIS IS FOR. A 250-student centre where each student takes four
 * subjects has a thousand active enrolments, and one invoice per enrolment per
 * month. That is not a hypothetical large customer, it is the middle of the tier
 * this product charges ৳1,999 a month for. Anything counted per enrolment, per
 * invoice or per payment crosses the ceiling at a centre size the business is
 * priced for, which is why this is a correctness module and not a scaling one.
 *
 * WHAT IT DOES NOT REPLACE. A total that Postgres could add up itself is better
 * asked for as a total — `count: 'exact', head: true` for a tally, an aggregate
 * view for a sum — and the reason attendance never appears in a `.from()` anywhere
 * in src/app is that its rates are computed in SQL. Page rows when the rows
 * themselves are needed. Do not page a query to add up one column.
 *
 * Extracted from lib/export/reports.ts, which had the only correct version of this
 * in the codebase and needed it because a spreadsheet that stops halfway looks
 * exactly like a complete one. That is true of a fee board too.
 */

/**
 * PostgREST's own default ceiling per request. Asking for more gets 1000, so this
 * is also the largest useful page: a smaller number costs extra round trips for
 * nothing and a larger one is quietly clamped back to this.
 */
export const PAGE_SIZE = 1000

/**
 * The point at which we stop and say so.
 *
 * Twenty thousand rows is far past any coaching centre in the country — the largest
 * chains run a few thousand students across all branches — so reaching it means
 * either a runaway query or a customer we should be talking to rather than quietly
 * handing a broken answer. Either way the honest reply is an error.
 */
export const MAX_PAGED_ROWS = 20_000

/** The shape of an awaited PostgREST response, narrowed to what paging needs. */
export type PageResponse<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Why a read produced no rows.
 *
 * Two failures and not one, because they need different words: `unreadable` is the
 * database not answering, which is worth a "try again"; `tooLarge` is the ceiling
 * above, which is not the reader's fault and is not fixed by trying again.
 */
export type PageFailure = 'unreadable' | 'tooLarge'

/** Rows, or the reason there are none. */
export type Paged<T> = { rows: T[] } | { failed: PageFailure }

/**
 * The failure to tell the reader about, across every read a screen needed.
 *
 * Screens draw one card, not one per query — an owner does not care which of two
 * reads came back empty-handed, only whether trying again could help. So this asks
 * the question the card asks, and `tooLarge` wins over `unreadable` because that is
 * the answer that stays true: with one read past the ceiling, no amount of retrying
 * produces a complete screen, and "try again in a moment" would be a promise this
 * screen cannot keep. Reverse the precedence and a reader retries their way to the
 * same wall with an extra tap in between.
 *
 * Null when every read arrived, which is the ordinary case and the only one where a
 * figure may be drawn.
 *
 * `Paged<unknown>` so one call can mix reads of different row types; nothing here
 * looks at a row.
 */
export function worstFailure(...results: Paged<unknown>[]): PageFailure | null {
  let seen: PageFailure | null = null
  for (const result of results) {
    if (!('failed' in result)) continue
    if (result.failed === 'tooLarge') return 'tooLarge'
    seen = result.failed
  }
  return seen
}

/**
 * Every row a query can return, one page at a time.
 *
 * `.range(from, to)` rather than `.limit()` plus a cursor, because these queries are
 * ordered by a non-unique column (a student's name, a payment's timestamp) and a
 * cursor needs a unique one. An offset can in principle skip or repeat a row if
 * something is written between pages; over a read that takes a few hundred
 * milliseconds and rows nobody is editing at that moment, that is the smaller risk
 * than a keyset paginator that gets the tie-breaking wrong.
 */
export async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
): Promise<Paged<T>> {
  const rows: T[] = []

  for (;;) {
    const { data, error } = await fetchPage(rows.length, rows.length + PAGE_SIZE - 1)
    if (error) return { failed: 'unreadable' }

    const page = data ?? []
    rows.push(...page)

    // A short page is the last page. Asking again would cost a round trip to be
    // handed nothing, and on an exact multiple of PAGE_SIZE the next call returns
    // empty and ends the loop there instead.
    if (page.length < PAGE_SIZE) return { rows }
    if (rows.length >= MAX_PAGED_ROWS) return { failed: 'tooLarge' }
  }
}

/**
 * The same read, for the callers that have nothing to say about a failure.
 *
 * A page whose whole job is to draw a list already treats a failed query as an
 * empty one — `const { data } = await …` with no error branch is the shape of half
 * the screens in this app — and forcing those callers to unwrap a discriminated
 * union would be churn that changes no behaviour. What it must never do is let a
 * *truncated* read look like a complete one, so `tooLarge` comes back as null
 * rather than as the first twenty thousand rows.
 *
 * Null means "no answer", exactly as a failed PostgREST read does. A caller that
 * needs to tell the reader which of the two happened wants pageAll.
 */
export async function pageOrNull<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
): Promise<T[] | null> {
  const paged = await pageAll(fetchPage)
  return 'rows' in paged ? paged.rows : null
}
