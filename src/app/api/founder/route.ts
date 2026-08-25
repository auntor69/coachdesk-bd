import { getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { toCsv, contentDisposition, CSV_CONTENT_TYPE } from '@/lib/csv'
import {
  customers,
  customersFileName,
  customersSheet,
} from '@/lib/platform/centers'

/**
 * The customer list as a CSV, for the one account that may read it.
 *
 * A Route Handler and a plain `<a href>` on the page, for the same reasons
 * /api/export spells out at length: a file is the browser's own download manager's
 * job, it works with no JavaScript, and nothing has to be marshalled through an RSC
 * payload to get it.
 *
 * THE GATE IS RE-CHECKED HERE and does not rely on the page. A Route Handler is a
 * public HTTP endpoint — anybody with a session cookie can request this URL
 * directly, without ever loading /founder — so `is_platform_admin` is asked again.
 * Behind that, `platform_centers()` asks a third time inside the database, which is
 * the check that actually protects the rows.
 *
 * 404 AND NOT 403, matching pagePlatformAdmin. A centre owner who pokes at
 * /api/founder learns nothing about whether such a thing exists, and there is no
 * cost to that: the only reader who needs a distinguishing error is the founder, and
 * for them it will never fire.
 *
 * WHAT THIS FILE CONTAINS: one row per centre. Not one student, mark, invoice or
 * guardian number — the RPC behind it cannot return them, so this cannot leak them
 * even by mistake. "Per-centre export" in the masterplan means a line per customer,
 * and the other reading of it would put every minor in the country in a founder's
 * downloads folder.
 */

/** A plain-text refusal, `no-store` so a stale 404 cannot outlive the reason. */
function refuse(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function GET(): Promise<Response> {
  const session = await getSession()
  const t = dict(session?.locale ?? DEFAULT_LOCALE).founder

  // One answer for "not signed in" and "not the founder" alike. See the note above.
  if (!session?.isPlatformAdmin) return refuse(404, t.notFound)

  const supabase = await createClient()

  // scoped-by: platform_centers() is a security definer RPC over all centres,
  // gated on app.is_platform_admin(). See 20260811000020_platform_panel.sql.
  const { data, error } = await supabase.rpc('platform_centers')

  // 502 rather than an empty file. A CSV with a header row and nothing under it is
  // indistinguishable from having no customers, and this is the one download whose
  // reader would act on that.
  if (error) return refuse(502, t.unreadable)

  const list = customers(data, t.unnamed)
  const { header, rows } = customersSheet(list, {
    headings: t.csv,
    status: t.status,
    // The words the `owes` column holds. Localised rather than TRUE/FALSE so the
    // column can be filtered on in the same language as its heading.
    yes: t.owed.yes,
    no: t.owed.no,
  })

  const name = customersFileName()

  return new Response(toCsv(header, rows), {
    status: 200,
    headers: {
      'content-type': CSV_CONTENT_TYPE,
      // Already ASCII and already dated, so both filename forms are the same
      // string — passed through contentDisposition anyway so this route cannot
      // drift from the header shape every other download here sends.
      'content-disposition': contentDisposition(name, name),
      // Every customer's name, owner and phone number in one file, keyed to a
      // session cookie. Nothing about it may sit in a shared cache.
      'cache-control': 'no-store, private',
    },
  })
}
