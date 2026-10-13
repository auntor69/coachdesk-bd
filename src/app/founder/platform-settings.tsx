'use client'

/**
 * The three trial lengths, as one small form — §4.3's numbers, which the founder owns.
 *
 * WHY THIS IS A CARD AND NOT A MIGRATION. A price is a reviewed diff: `price_versions` is
 * migration-only for that reason (§11.10). A trial length is policy — what a new account is
 * given before it pays — and it belongs to the person watching the funnel. 20260811000091
 * put them in `platform_settings` (one row) and 20260811000092 made `bootstrap_center` read
 * that row at signup, so this form is the whole write path and the onboarding screen quotes
 * the same numbers.
 *
 * THREE FIELDS AND NO MORE. There is nothing here about prices, plans or grace periods,
 * because those are decisions with a different blast radius: a trial a day too long costs
 * one day of one customer, and a price a taka too low costs every month of every one.
 *
 * STRING LEAVES ONLY on the way in — the `settings` group of the founder dictionary — for
 * the same reason the money card's words are: a group holding a function cannot cross into
 * a client component at all.
 */

import { useActionState } from 'react'

import { Alert, Button, Card, Field } from '@/components/ui'

import { setTrialDays, type FounderState } from './actions'

export type SettingsWords = {
  title: string
  lead: string
  teacherDays: string
  centerDays: string
  institutionDays: string
  save: string
  saving: string
  saved: string
  badDays: string
  failed: string
}

export function PlatformSettings({
  days,
  words,
}: {
  /** The row as it stands, so the boxes open on the truth rather than on a default. */
  days: { teacher: number; center: number; institution: number }
  words: SettingsWords
}) {
  const [state, action, saving] = useActionState<FounderState, FormData>(setTrialDays, null)

  return (
    <Card>
      <h2 className="font-semibold text-ink">{words.title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{words.lead}</p>

      <form action={action} className="mt-3 flex flex-col gap-3">
        {state?.error && <Alert>{state.error}</Alert>}
        {state?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {state.ok}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label={words.teacherDays}
            name="teacherDays"
            // Not type="number": it refuses Bangla digits, and the whole product is typed
            // in them. `parseTaka` reads both scripts, the same way it reads an amount.
            type="text"
            inputMode="numeric"
            maxLength={3}
            defaultValue={String(days.teacher)}
            className="num"
          />
          <Field
            label={words.centerDays}
            name="centerDays"
            type="text"
            inputMode="numeric"
            maxLength={3}
            defaultValue={String(days.center)}
            className="num"
          />
          <Field
            label={words.institutionDays}
            name="institutionDays"
            type="text"
            inputMode="numeric"
            maxLength={3}
            defaultValue={String(days.institution)}
            className="num"
          />
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? words.saving : words.save}
        </Button>
      </form>
    </Card>
  )
}
