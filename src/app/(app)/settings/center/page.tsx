import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { currentPeriodMonth, monthName } from '@/lib/bd/time'
import { formatBdMobile } from '@/lib/bd/phone'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { CenterForm } from './center-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.center.title} — CoachDesk` }
}

/**
 * The centre's name, and the wallet a parent sends fees to.
 *
 * One screen for both because they compete for the same 70 characters. The name
 * signs every reminder and cannot be dropped from one; the payment number is
 * what makes a reminder actionable without a phone call. A long name pushes the
 * number out, and the only way an owner can know that is to be shown it — so the
 * form previews the real message and says plainly which one won.
 *
 * Read by managers, written by owners. `centers_owner_update` has always drawn
 * that line, and it matters more now than when this row held a name and an
 * address: whoever edits the payment number decides where a month of fees goes.
 * A manager still sees the number, because they are the person a parent asks.
 */
export default async function CenterSettingsPage() {
  const session = await pageRole('manager')
  const locale = session.locale
  const t = dict(locale).settings.center
  const supabase = await createClient()
  const periodMonth = currentPeriodMonth()

  const [{ data: center, error: centerError }, { data: student }, { data: batch }]
    = await Promise.all([
      supabase
        .from('coaching_centers')
        .select('name, payment_wallet, payment_number')
        .eq('id', session.active.centerId)
        .maybeSingle(),
      // One real name for the preview, so what the owner reads is a message their
      // own centre would send rather than a mock-up of one.
      //
      // Scoped, and not only by RLS: an owner of two centres passes the policy for
      // both, and this would otherwise put a child from the other centre into the
      // sample message — a minor's name on a screen that is not theirs, over a
      // switcher that says this one.
      //
      // `error` is not read on this one or the next, and that is not the same
      // oversight the row above had. Both are `.limit(1)` off a list, so null is
      // the honest answer for a centre with no active students and no priced batch
      // — and both feed the preview, whose stand-ins below are designed to be seen.
      // A sample message with a stand-in name in it is still a true rendering of
      // what the centre sends.
      supabase
        .from('students')
        .select('name')
        .eq('coaching_center_id', session.active.centerId)
        .eq('status', 'active')
        .order('name')
        .limit(1)
        .maybeSingle(),
      // A representative amount. Not the worst case — a family three months behind
      // owes more than one month's fee — but the figure their reminders will
      // usually carry, and it is their own number rather than a guess. Scoped for
      // the same reason as the name above.
      supabase
        .from('batches')
        .select('monthly_fee_bdt')
        .eq('coaching_center_id', session.active.centerId)
        .eq('active', true)
        .order('monthly_fee_bdt', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  const canEdit = session.active.role === 'owner'
  const wallet = center?.payment_wallet ?? null
  const number = center?.payment_number ?? null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {dict(locale).settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink lg:text-2xl">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.subtitle}</p>
      </div>

      {centerError ? (
        /*
         * THE FORM THAT CLEARS A CENTRE'S PAYMENT NUMBER WITHOUT BEING TOLD TO.
         *
         * `center?.payment_wallet ?? null` read a dropped row as a centre that has
         * no wallet, and CenterForm seeds itself from exactly that: the wallet lands
         * on "none", the number box is not rendered at all, and there is no move on
         * the screen that puts either back. The owner came to fix a typo in the
         * name, taps save, and `saveCenterDetails` writes both columns to null over
         * a centre that had them — successfully, so it says saved.
         *
         * Nothing on this screen shows what that costs. `walletText` blanks for an
         * unconfigured centre, so from the next reminder onwards the messages simply
         * stop saying where to send the money, and keep sending. Same row, same
         * silence, one screen along — see chase.payUnreadable.
         *
         * So the screen goes rather than a note beside it, and the manager's
         * read-only card goes with it: what it draws off the same null is "no
         * payment number yet", told to the person a guardian rings to ask.
         */
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      ) : canEdit ? (
        <CenterForm
          name={center?.name ?? session.active.centerName}
          paymentWallet={wallet}
          paymentNumber={number}
          example={{
            // Bangla, like the preview it feeds: this is a stand-in for a real
            // student's name inside a message a guardian reads.
            studentName: student?.name ?? 'রাফিদ হাসান',
            amount: Number(batch?.monthly_fee_bdt ?? 0) || 1500,
            periodMonth,
            // The month in the reader's language, for the label above the
            // preview. The month *inside* the message stays Bangla.
            monthLabel: monthName(periodMonth, locale),
          }}
          t={dict(locale).centerForm}
          wallets={dict(locale).wallets}
          common={dict(locale).common}
        />
      ) : (
        /* A manager's whole screen is this one card, so it is a card and not a
           column: three short lines stretched to 1,216px is a paragraph nobody can
           find the end of. */
        <Card className="max-w-2xl">
          <p className="font-medium text-ink">
            {center?.name ?? session.active.centerName}
          </p>
          {wallet && number ? (
            <p className="mt-1 text-ink-soft">
              {dict(locale).wallets[wallet]}{' '}
              <span className="num font-medium text-ink">{formatBdMobile(number)}</span>
            </p>
          ) : (
            <p className="mt-1 text-ink-soft">{t.noNumber}</p>
          )}
          <p className="mt-3 text-sm text-ink-faint">{t.readOnly}</p>
        </Card>
      )}
    </div>
  )
}
