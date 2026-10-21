import { redirect } from 'next/navigation'

/**
 * `/settings/plan` is a redirect, and the screen it draws is `/settings/billing` —
 * MASTERPLAN §16.1 step 27, "the plan page's 1,253 lines demolished".
 *
 * WHY THE ROUTE STILL EXISTS AT ALL. §20.4 rebuilt billing on the prepaid balance and
 * folded the plan screen into it: the five questions, the day-by-day history, the
 * calculator behind its own disclosure. There is no second pricing screen to keep in step
 * with that one, so this route has nothing left to draw — but it is in shipped URLs. It
 * was the crumb on a receipt printable, it is in the founder's own notes and in whatever
 * an owner bookmarked, and `settings/plan/receipt/*` was the address of a sheet people
 * print and hand across a desk. A 404 on a URL we published is a broken promise; a
 * redirect costs one request.
 *
 * THE CARDS THAT OUTLIVED THE PAGE WENT AT STEP 28. Step 27 could only re-home them, so
 * the places card, the subscription window and the four-tier ladder were drawn under the
 * billing screen until §11.6's cutover landed; then they were deleted, because a balance is
 * what a centre buys now and there is neither coverage left to sell nor a ceiling left to
 * buy past. One block did not retire — the request form, which is `./contact-card` beside
 * the recharge card, since asking to pay is still the way out of read-only (§20.4).
 *
 * IT IS NOT `permanentRedirect`. Next's permanent form is what a browser caches
 * indefinitely, and this route may well be needed again the day something like a receipt
 * route wants its own address; a 307 keeps that cheap and still carries the reader to the
 * screen they meant.
 */
export default function PlanRedirect() {
  redirect('/settings/billing')
}
