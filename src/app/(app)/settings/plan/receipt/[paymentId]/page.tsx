import type { Route } from 'next'
import { redirect } from 'next/navigation'

/**
 * The other half of the promise `/settings/plan` makes: the receipt URLs.
 *
 * WHY THIS FILE EXISTS. The redirect one level up covers `/settings/plan` itself, and its
 * own note names this path as the reason the route was kept at all — "`settings/plan/receipt/*`
 * was the address of a sheet people print and hand across a desk". A folder without a page
 * here would answer that URL with a 404, which is exactly the broken promise the note says a
 * redirect avoids. Step 27 moved the receipt wholesale into `settings/billing/`, and the
 * parameter kept its meaning (`payments.id`) across the move, so forwarding the segment is
 * the whole of the repair.
 *
 * 307 AND NOT A PERMANENT REDIRECT, matching the page above: a 308 is what a browser caches
 * indefinitely, and this path exists for links already in the wild rather than for anything
 * the app draws today. It must stay cheap to change if a receipt ever wants its own address
 * again.
 *
 * NOTHING IS VALIDATED HERE. An id that names no payment is the destination page's business,
 * and it already answers `notFound()` for one — validating twice would only be a second
 * opinion about what a receipt is.
 */
export default async function PlanReceiptRedirect({
  params,
}: {
  params: Promise<{ paymentId: string }>
}) {
  const { paymentId } = await params
  // A literal head on purpose: Next 16's typed routes cannot check a built path, and the
  // cast is the repository's own spelling for that (see `homePathForRole`). The head is
  // also what tests/navigation.test.ts reads to resolve a redirect's guard.
  redirect(`/settings/billing/receipt/${paymentId}` as Route)
}
