/**
 * The way to a piece of paper, drawn as a control rather than as a link inside a sentence.
 *
 * WHY THIS EXISTS, and it is a complaint about the product rather than a taste. Every
 * printable here already worked: the fee receipt, the refund slip, the payslip, the expense
 * voucher and the purchase receipt each print, each with a `PrintButton` at the top of it.
 * What did not is the *journey*. After a manager paid a salary the form answered with a
 * sentence — "Paid. Voucher no. 1042." — and the only way to reach the paper was to scroll to
 * the register below and notice that the voucher number in it was underlined. The number was
 * the button, nobody could tell, and the person holding out their hand for a slip waited.
 *
 * SO THE NUMBER KEEPS ITS PLACE AND GAINS A SHAPE. The chip variant is the number in a
 * bordered box with a printer beside it, still inside the row it belongs to, because the
 * number is also what an owner reads off and matches the paper against. The default variant
 * is the button that appears the instant a payment lands.
 *
 * PRINT-VISIBLE IN THE CHIP AND PRINT-HIDDEN IN THE BUTTON, which is the one place the two
 * variants differ in kind rather than in size. `PrintButton` is `print:hidden` because a
 * sheet with a Print button printed on it is a sheet somebody has to explain; the chip is
 * the opposite — `/fees/register` is itself printed, and taking the receipt numbers off the
 * paper copy to make the links pretty on screen would be a register nobody can reconcile
 * afterwards. So the chip drops its border and background on paper and prints as the number
 * it always was.
 *
 * The accessible name is not the visible text in the chip, and that is deliberate: a link
 * whose text is "1042" reads as a number and not as an action, so the caller passes the noun
 * it is a number of (`Payslip: 1042`). The button variant's own words already say it.
 *
 * A server component — nothing here is interactive, and the printable it points at is a
 * route.
 */
import Link, { type LinkProps } from 'next/link'
import type { ReactNode } from 'react'

import { PrintIcon } from './icons'

/** The button, at the 48px tap floor every other control in the app is held to. */
const BUTTON =
  'inline-flex min-h-tap items-center gap-2 rounded-xl border-2 border-brand-500 ' +
  'bg-brand-50 px-4 font-semibold text-brand-800 transition-colors hover:bg-brand-100 ' +
  'print:hidden'

/**
 * The chip, which has the same floor and no `print:hidden`.
 *
 * `min-h-tap` on a table row costs a few pixels of row height and buys the one thing a
 * register is read on — a thumb, on a phone, finding the row it wants. The register was
 * bare text before this, which had no floor at all.
 *
 * On paper the box comes off and the number stays, which is the half `/fees/register`
 * cannot lose: it is printed, and a receipt column that prints as an empty gap is a
 * register nobody can reconcile against the slips in the drawer. The printer glyph goes
 * with the box and not with the number — a second mark beside every figure on a cash sheet
 * is ink spent saying what the column heading already says.
 */
const CHIP =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border-2 border-brand-500 ' +
  'bg-brand-50 px-2 font-medium text-brand-800 transition-colors hover:bg-brand-100 ' +
  'print:min-h-0 print:gap-0 print:rounded-none print:border-0 print:bg-transparent ' +
  'print:px-0 print:text-ink'

/**
 * The props, generic in the route for the reason `Link` itself is.
 *
 * `typedRoutes` is on (next.config.ts), so `href` is checked against the routes the app
 * actually has — and that check only survives if the route type is inferred from the string
 * at the call site, exactly as `<Link href={...}>` does it. Typing this prop as a plain
 * `string`, or as `LinkProps['href']` with the parameter defaulted, would let this component
 * compile against a path that does not exist, which is the one thing the app's link hygiene
 * currently catches for free.
 */
type PaperLinkProps<RouteType> = {
  href: LinkProps<RouteType>['href']
  /** What the reader sees — the action's words, or the voucher number itself. */
  children: ReactNode
  /**
   * The accessible name, when the visible text is a number.
   *
   * Required rather than optional: a chip whose only words are "1042" has no name a screen
   * reader can act on, and the one place that is not obvious is exactly the place a caller
   * would leave it out.
   */
  label: string
  /** The in-row chip rather than the free-standing button. */
  dense?: boolean
  className?: string
}

export function PaperLink<RouteType>({
  href,
  children,
  label,
  dense = false,
  className = '',
}: PaperLinkProps<RouteType>) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`${dense ? CHIP : BUTTON} ${className}`}
    >
      <PrintIcon className={dense ? 'size-4 shrink-0 print:hidden' : 'size-4 shrink-0'} />
      <span className={dense ? 'num' : undefined}>{children}</span>
    </Link>
  )
}
