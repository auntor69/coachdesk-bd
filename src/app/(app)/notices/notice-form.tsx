'use client'

/**
 * Writing the notice, and choosing who it is about.
 *
 * NO PREVIEW AND NO COPY BUTTON HERE, which is the one thing worth knowing before
 * reading further. The chips live on the saved row below, not on this form, and the
 * order that produces — write it, save it, then copy it — is deliberate twice over.
 *
 * It keeps the record ahead of the message: an owner who copies first and then loses
 * the tab has told forty families something the centre has no record of, which is the
 * exact failure this screen exists to fix. And it keeps the sentence a parent reads
 * out of the browser. What goes on the clipboard is built by `buildNoticeSms` on the
 * server, so the centre's name is appended in one place by one author; a live preview
 * would mean a second implementation of that in here, drifting from the first — the
 * same call ../teach/[batchId]/absence-chips.tsx makes about its own message.
 *
 * The cost is that the SMS count appears after saving rather than while typing. That is
 * a real cost and it is the smaller one: the count changes what the owner sends next
 * time, and the record is what they cannot get back.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { MAX_NAME, MAX_NOTICE } from '@/lib/limits'
import { fill } from '@/lib/i18n/fill'
import type { Reach } from '@/lib/notices/audience'
import { postNotice, type NoticeState } from './actions'

export type BatchOption = {
  id: string
  /** The batch's name and its subject, already joined by the page. */
  label: string
  /** Null when the roster could not be read — not when the batch is empty. */
  reach: Reach | null
}

const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

export function NoticeForm({
  batches,
  everyone,
  t,
  common,
}: {
  batches: BatchOption[]
  /** The whole centre, deduplicated across batches. Null on a failed roster read. */
  everyone: Reach | null
  t: T<'notices'>
  common: T<'common'>
}) {
  const [state, action, pending] = useActionState<NoticeState, FormData>(
    postNotice,
    null,
  )

  // '' is the whole centre, which is also the default: an owner opening this screen is
  // more often shutting the building for a holiday than moving one batch's exam, and
  // the narrower choice is one tap away either way.
  const [batchId, setBatchId] = useState('')

  const chosen = batchId ? (batches.find((b) => b.id === batchId)?.reach ?? null) : everyone

  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {state.ok}
        </p>
      )}

      <Field
        label={t.titleLabel}
        name="title"
        placeholder={t.titlePlaceholder}
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.audienceLabel}</span>
        <select
          name="batchId"
          value={batchId}
          onChange={(e) => setBatchId(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t.everyone}</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.label}
            </option>
          ))}
        </select>
        {/* Under the picker rather than beside the button, because it is what the
            picker means: the owner is choosing between two numbers, and the number is
            the thing they are choosing by. Silent when the roster failed — the page
            says so once, above, and saying it twice would read as two faults. */}
        {chosen && (
          <span className="num text-sm text-ink-soft">
            {fill(t.reachLine, { n: String(chosen.phones.length) })}
            {chosen.skippedOptedOut + chosen.skippedNoPhone > 0 && (
              <span className="text-ink-faint">
                {' '}
                {fill(t.reachSkipped, {
                  n: String(chosen.skippedOptedOut + chosen.skippedNoPhone),
                })}
              </span>
            )}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.bodyLabel}</span>
        <textarea
          name="body"
          required
          rows={4}
          maxLength={MAX_NOTICE}
          placeholder={t.bodyPlaceholder}
          className="rounded-xl border-2 border-line bg-white px-4 py-3 text-base
            outline-none placeholder:text-ink-faint focus:border-brand-500"
        />
        {/* Said here rather than after the fact, because it changes what they type:
            the centre's name is added for them, so a notice that ends with it says it
            twice and pays for the second one. */}
        <span className="text-sm text-ink-faint">{t.bodyHint}</span>
      </label>

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : t.submit}
      </Button>
    </form>
  )
}
