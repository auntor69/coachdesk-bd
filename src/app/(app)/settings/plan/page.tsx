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
 * THE CARDS THAT OUTLIVED THE PAGE are not here — they are `./plan-cards` rendered under
 * the billing screen. §11.6 retires the coverage-based buy flow at step 28, and until that
 * cutover lands an owner still has places to buy and a tier to move onto; deleting the page
 * without re-homing them would have left a centre at its ceiling with no door. See the head
 * of that file for what moved and what did not.
 *
 * IT IS NOT `permanentRedirect`. Next's permanent form is what a browser caches
 * indefinitely, and this route may well be needed again the day something like a receipt
 * route wants its own address; a 307 keeps that cheap and still carries the reader to the
 * screen they meant.
 */
export default function PlanRedirect() {
  redirect('/settings/billing')
}
