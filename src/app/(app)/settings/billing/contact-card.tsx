import { buttonClass, Card } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import { formatDate, todayInDhaka } from '@/lib/bd/time'
import { dict } from '@/lib/i18n'
import { formatTaka } from '@/lib/money'
import {
  PLANS,
  CENTER_MONTHLY_FLOOR_BDT,
  planFor,
  planName,
  type PlanId,
  type PlanLimits,
} from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import { UpgradeRequest } from './upgrade-request'

/**
 * The way to reach us — the one card that outlived the coverage-based buy flow.
 *
 * WHY THIS FILE EXISTS AND `./plan-cards.tsx` DOES NOT. §16.1 step 28 retires the four
 * blocks that were re-homed under billing at step 27: the places card with its pending
 * purchase, the branch asks and their two answers, the subscription window and the
 * four-tier ladder. All four sold either coverage or a ceiling, and §11.6 retires both —
 * money goes into a balance and the tier follows it, so there is nothing left to buy on
 * the old model.
 *
 * WHAT DID NOT RETIRE, and §20.4 says so in its own list: *"the request form and the way
 * to reach us — kept, for the reason `read-only.test.ts` gives for the whole module:
 * asking to pay is the way out."* A centre that has run dry is read-only, and a free
 * teacher who wants Pro has no self-serve path — the Institution tier is priced by
 * conversation by definition. Delete this card and the product has a screen that says
 * what everything costs and no way to say yes. So the container went and this stayed,
 * in a file of its own rather than as a card inside a page that no longer exists.
 *
 * IT IS BESIDE THE RECHARGE CARD AND NOT INSTEAD OF IT. The two doors are for two
 * different readers: an owner with a balance tops it up, and an owner who wants a
 * different tier — or a manager who cannot do either — asks us. A manager is given the
 * sentence rather than a form the database would refuse (`upgrade_requests_owner_insert`
 * is the owner's), but the phone numbers are drawn for whoever is looking: this is the
 * one screen where a centre decides to start paying us.
 *
 * ITS OWN SERVER COMPONENT, like `./recharge-panel.tsx`, and for the same reason: the
 * open request is an owner-only read that a manager's query would return empty anyway
 * (`upgrade_requests_owner_read`), so skipping it is a saved round trip rather than a
 * hidden failure.
 */
export async function ContactCard() {
  const session = await getSession()
  if (!session?.active) return null
  // Bound to a name so the narrowing survives the read below.
  const active = session.active

  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).settings.plan
  const plan = session.plan

  /** Only an owner may file or read a request — `upgrade_requests_owner_read` says so. */
  const isOwner = active.role === 'owner'

  /*
   * This centre's open request, if there is one. `handled_at is null` is what makes it
   * open: a request the founder has ticked off is history, and showing it back as
   * pending would have the owner waiting for a call that already happened.
   *
   * `error: null` on the manager's arm so the note below reads off one shape. A manager
   * is not an owner whose pending request failed to load; they have no request to see.
   */
  const asked = isOwner
    ? await supabase
        .from('upgrade_requests')
        .select('requested_plan, note, created_at')
        .eq('coaching_center_id', active.centerId)
        .is('handled_at', null)
        .maybeSingle()
    : { data: null, error: null }

  /*
   * The tiers an owner may ask to be moved onto: the paid ones, minus the one they are
   * already on. Priced in the option label, because a dropdown that reads "Centre" is
   * asking somebody to remember a figure from three cards up the page.
   */
  const askable = LADDER.filter((tier) => tier.id !== 'teacher_free' && tier.id !== plan.id)
  const choices = askable.map((tier) => ({
    value: tier.id,
    label: `${planName(tier, locale)} · ${priceLine(tier, t)}`,
  }))

  /*
   * The next rung up, which is what almost every request is: a free teacher wanting Pro,
   * a Pro teacher past 150 students wanting Centre. An owner already on the top tier is
   * offered the nearest one below, because there is nothing above it to sell.
   */
  const rung = (id: PlanId) => LADDER.findIndex((tier) => tier.id === id)
  const suggested =
    askable.find((tier) => rung(tier.id) > rung(plan.id))?.id ?? askable[askable.length - 1].id

  /*
   * Composed here rather than in the client component: the group below crosses the
   * server/client boundary whole, so a function in it would not serialise. It names a
   * plan and a date, and the date carries Bangla numerals in Bangla — a Dhaka calendar
   * day, so a request filed at 1am local is not reported as yesterday.
   */
  const pendingLine = asked.data
    ? t.pendingRequest(
        planName(planFor(asked.data.requested_plan), locale),
        formatDate(todayInDhaka(new Date(asked.data.created_at)), locale),
      )
    : null

  // The same one line of config `recharge-panel.tsx` reads, and absent rather than a dead
  // chip: a WhatsApp button that opens a chat with nobody is worse than no button, and this
  // is the screen where trust is being built. It cannot live in the repository — only in the
  // deployment's own environment — so the card is written to be correct either way.
  const salesPhone = normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')
  const salesMessage = t.contactMessage(active.centerName, planName(plan, locale))

  return (
    <Card id="ask">
      <h2 className="font-semibold text-ink">{t.contactTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t.contactBody}</p>

      {isOwner ? (
        <>
          {/* Grey, above the form, and the form stays. A null `asked` used to mean both
              "nothing pending" and "the pending read fell over", and the component
              switches on exactly that — so a dropped read hid an open request and its
              withdraw button, leaving an owner sure we never got it. The form is safe to
              leave up: the write upserts on `coaching_center_id`, so filing again
              replaces the request rather than adding a second one. The silence is not. */}
          {asked.error && <p className="mt-3 text-sm text-ink-soft">{t.pendingUnreadable}</p>}
          <UpgradeRequest
            choices={choices}
            suggested={suggested}
            pendingLine={pendingLine}
            pendingNote={asked.data?.note ?? null}
            words={t.upgrade}
          />
        </>
      ) : (
        /* A manager gets the sentence rather than a form that would be refused. Whoever
           pays for this decides what it costs — the same line
           `upgrade_requests_owner_insert` draws in the database. */
        <p className="mt-3 text-sm text-ink-faint">{t.upgrade.ownerOnly}</p>
      )}

      {salesPhone && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          <a
            // wa.me wants the number without the +, exactly as the fee chips do.
            href={`https://wa.me/${salesPhone.slice(1)}?text=${encodeURIComponent(salesMessage)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('tinted')}
          >
            {t.contactWhatsapp}
          </a>
          <a
            // The number is printed rather than hidden behind "Call", because `tel:` opens
            // nothing on a laptop and this is the one control on the one screen where a
            // centre decides to start paying us. A dead button here is a lost sale; the
            // digits work on any device. ASCII in both languages — it is dialled, not read.
            href={`tel:${salesPhone}`}
            className={buttonClass('secondary')}
          >
            {t.contactCall}
            {/* `ml-1` and not a JSX space. This anchor is an inline-flex, and a space
                there is worth exactly zero pixels — measured: 152.03px wide with the
                space, 152.03px without, 156.03px with this margin. */}
            <span className="num ml-1">{formatBdMobile(salesPhone)}</span>
          </a>
        </div>
      )}
    </Card>
  )
}

/** The four tiers, cheapest first — the order somebody reads a price list in. */
const LADDER: PlanLimits[] = [
  PLANS.teacher_free,
  PLANS.teacher_plus,
  PLANS.center,
  PLANS.institution,
]

/**
 * The price, in as few words as a list will hold.
 *
 * Driven off `pricing` rather than off the id, so a tier added to plans.ts gets a sensible
 * line without this file being touched — and a tier whose pricing shape changes cannot
 * keep showing the old wording.
 */
function priceLine(plan: PlanLimits, t: ReturnType<typeof dict>['settings']['plan']): string {
  if (plan.pricing === 'free') return t.freePrice
  if (plan.pricing === 'flat') return t.monthly(formatTaka(plan.priceBdt))
  // Both per-student tiers are quoted, but only one of them has a published floor to quote
  // from; the institution tier is genuinely bespoke.
  return plan.id === 'center' ? t.from(formatTaka(CENTER_MONTHLY_FLOOR_BDT)) : t.sized
}
