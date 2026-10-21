'use client'

/**
 * The signature card: the register's own button, when the clock says no.
 *
 * WHAT IT REPLACES. Before 20260811000089 this part of the page was the register —
 * forty names and a save button — for any hour of the day. Now the page draws a
 * sentence and one tick instead, when the class has not started yet or when it ended
 * with nothing filed, and the register appears once the signature is in.
 *
 * WHY A TICK AND NOT A TYPED NAME. The signature is not a legal instrument; it is a
 * named person saying they know the clock's answer and are filing anyway, and the row
 * the database writes is what makes it worth something — who, when, which class, and
 * which wording. A name typed into a box adds nothing to those four facts and costs a
 * teacher standing in a corridor thirty seconds.
 *
 * THE TICK IS `required` AND THE BUTTON IS NOT DISABLED FOR IT, which is a deliberate
 * pair. A disabled button is the stronger signal — the payroll screen learned that in
 * August, when a full-colour button sat over an unticked box — but it is disabled in
 * the *server's* HTML too, so a page whose JavaScript has not arrived yet would show a
 * button that can never be pressed. `required` is the browser's own refusal, it works
 * before the bundle does, and the action refuses as well. What the reader sees is the
 * same either way: nothing is filed until the box is ticked.
 *
 * `useActionState` rather than a plain form action, for the one reason it is used all
 * over this app: a refusal has to come back as a sentence on this card, next to the
 * box that needs ticking, rather than as an error page.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Card } from '@/components/ui'
import { unlockAttendance, type UnlockState } from './actions'

export function AttendanceUnlock({
  batchId,
  sessionDate,
  reason,
  words,
}: {
  batchId: string
  /** Today in Dhaka. The clock gate only exists on the day the class is on. */
  sessionDate: string
  /** 'early' before the class, 'forgot' after it ended with nothing filed. */
  reason: 'early' | 'forgot'
  words: {
    title: string
    body: string
    label: string
    action: string
    saving: string
  }
}) {
  const [state, formAction, pending] = useActionState<UnlockState, FormData>(
    unlockAttendance,
    null,
  )
  const [signed, setSigned] = useState(false)

  return (
    <Card className="max-w-2xl border-late/30 bg-late/5">
      <h2 className="font-semibold text-ink">{words.title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{words.body}</p>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="sessionDate" value={sessionDate} />
        <input type="hidden" name="reason" value={reason} />

        {/* The signature itself. Bold because it is the sentence being agreed to, and
            not a note beside a control — the box is the least interesting part. */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="signed"
            required
            checked={signed}
            onChange={(event) => setSigned(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-brand-600"
          />
          <span className="text-sm font-medium text-ink">{words.label}</span>
        </label>

        {state && !state.ok && <Alert>{state.error}</Alert>}

        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? words.saving : words.action}
        </Button>
      </form>
    </Card>
  )
}
