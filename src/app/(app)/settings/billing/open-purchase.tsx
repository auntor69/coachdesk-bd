/**
 * A purchase the owner has opened and not paid for yet.
 *
 * THE REFERENCE IS THE ROW'S REASON TO EXIST. The founder matches a bKash transfer to
 * an intent by it, and a transfer that arrives with an empty reference field is one
 * somebody has to ring the owner about. `transferReference` is the same function the
 * founder panel prints, so the code on this screen and the code on theirs cannot drift.
 *
 * It stays on screen after the price lapses, because an owner who already sent the
 * money needs to be able to quote it when they ring. What goes is the instruction to
 * send more.
 *
 * `line` AND `note` ARE COMPOSED BY THE CALLER, because the three cards that use this
 * describe different purchases — "40 more places" and "3 months at ৳7,300, moves you to
 * Institution" — and everything below the first line is identical for all of them.
 *
 * IN ITS OWN FILE because the third caller is on another route: the places bought from
 * the add-student screen are opened there and have to show their reference there, and a
 * screen reaching into a sibling route's page component for a local function would be the
 * wrong shape. The plan card and the add-student card have to agree about what a waiting
 * purchase looks like — an owner who opened one on one screen and reads it on the other
 * is the ordinary case, not the edge one.
 */
import { formatBdMobile } from '@/lib/bd/phone'
import { formatDate, hasPassed, todayInDhaka } from '@/lib/bd/time'
import { transferReference } from '@/lib/billing/receipt'
import type { Dictionary, Locale } from '@/lib/i18n'
import { CancelPurchase } from './cancel-purchase'

export function OpenPurchase({
  id,
  line,
  note,
  expiresAt,
  salesPhone,
  locale,
  t,
}: {
  id: string
  /** What was bought, priced. */
  line: string
  /** A second sentence, or null — the tier a subscription moves them onto. */
  note: string | null
  expiresAt: string | null
  /** Null until the founder's own number is in the environment, which is every
   *  deployment so far — hence `noContact` rather than a blank line. */
  salesPhone: string | null
  locale: Locale
  /** `Dictionary[…]`, not `T<…>`: a server component, so the counted leaves are
      callable. Same rule as places-warning.tsx. */
  t: Dictionary['settings']['plan']
}) {
  // A moment and not a calendar day — settle_payment_intent refuses `expires_at <=
  // now()`, so an hour past is past. The date beside it is the Dhaka day the owner
  // reads, so an expiry at 1am local is not reported as the day before.
  const lapsed = hasPassed(expiresAt)
  const day = expiresAt
    ? formatDate(todayInDhaka(new Date(expiresAt)), locale)
    : null

  return (
    <div
      className={`rounded-xl border p-3 ${
        lapsed ? 'border-late/40 bg-late/5' : 'border-line bg-surface-alt'
      }`}
    >
      <p className="num font-semibold text-ink">{line}</p>
      {note && <p className="mt-0.5 text-sm text-ink-soft">{note}</p>}

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-soft">{t.places.ref}</span>
        <span className="num shrink-0 font-bold text-brand-800">
          {transferReference(id)}
        </span>
      </div>

      {!lapsed && (
        <>
          <p className="mt-2 text-sm font-medium text-ink">
            {salesPhone
              ? t.placesSendTo(formatBdMobile(salesPhone))
              : t.places.noContact}
          </p>
          <p className="mt-1 text-xs text-ink-faint">{t.places.refHint}</p>
        </>
      )}

      {day && (
        <p
          className={`mt-2 text-sm ${
            lapsed ? 'font-medium text-late' : 'text-ink-soft'
          }`}
        >
          {lapsed ? t.placesLapsed(day) : t.placesGoodUntil(day)}
        </p>
      )}
      {lapsed && (
        <p className="mt-1 text-sm text-ink-soft">{t.places.lapsedNote}</p>
      )}

      {/*
        On a lapsed row as well as a live one, and that is the case that matters: a
        subscription intent blocks the next purchase whether or not its price still
        stands, so without this an owner who mistyped twelve months waits a week.
      */}
      <CancelPurchase
        id={id}
        words={{ cancel: t.subscribe.cancel, cancelling: t.subscribe.cancelling }}
      />
    </div>
  )
}
