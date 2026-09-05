'use client'

/**
 * One row of the subject list or the exam-kind list, with its repairs behind it.
 *
 * Shared by both screens because they are the same errand: an owner has mistyped a
 * name, or has stopped using one. Splitting it in two would mean two panels that
 * drift apart, and the reader would learn one of them twice.
 *
 * SHUT UNTIL ASKED. A settings list is read far more often than it is edited — an
 * owner comes here to check what exists — so a row is a name, what uses it, and a
 * quiet way in. Everything that changes or destroys anything is one tap further.
 *
 * The three refusals arrive as finished sentences from the server, computed by the
 * same `lib/settings/retire.ts` the actions call. So a button is never offered that
 * the action will decline; where one would be, the reason stands in its place.
 *
 * `readOnly` is the one refusal that takes the way in away instead of answering it,
 * because it applies to all three panels at once. See its own note below.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { MAX_NAME } from '@/lib/limits'
import type { ActionState } from './actions'

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>

export function SettingsListRow({
  id,
  idField,
  name,
  nameBn,
  otherName,
  active,
  count,
  countNoun,
  blockedReason,
  offBlockedReason,
  onBlockedReason,
  readOnly,
  rename,
  setActive,
  remove,
  nameLabel,
  placeholder,
  placeholderBn,
  t,
  common,
}: {
  id: string
  /** 'subjectId' or 'examTypeId' — the field name all three actions read. */
  idField: string
  name: string
  nameBn: string
  /**
   * The name in the language the reader is not reading, shown under the primary
   * one when the owner typed both. Worked out by the page, which owns `localName`.
   */
  otherName: string | null
  active: boolean
  /**
   * How many batches teach it, or how many exams were held as it — and `null` when
   * the count did not run. A failed count shows no number at all rather than a
   * zero, because "0 batches" beside a subject the whole timetable teaches is worse
   * than saying nothing.
   */
  count: number | null
  /** The noun for that count, already agreed with it: 'batch' / 'batches'. */
  countNoun: string
  /** Why removing it will be refused, or null when nothing points at it. */
  blockedReason: string | null
  /** Why turning it off will be refused, or null. */
  offBlockedReason: string | null
  /** Why turning it back on will be refused — the plan is full — or null. */
  onBlockedReason: string | null
  /**
   * The fourth refusal, and the only one that is not about this row: §4.4's lapsed
   * centre, where every one of the three panels below would be declined by
   * `requireWritable`. Not a reason string like the others, because there is nothing
   * row-shaped to say — the way in goes instead, and the screen says why once.
   */
  readOnly: boolean
  rename: Action
  setActive: Action
  remove: Action
  nameLabel: string
  placeholder: string
  placeholderBn: string
  t: T<'settingsListRow'>
  common: T<'common'>
}) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)

  const [renamed, renameAction, renaming] = useActionState<ActionState, FormData>(
    rename,
    null,
  )
  const [switched, activeAction, switching] = useActionState<ActionState, FormData>(
    setActive,
    null,
  )
  const [removed, removeAction, removing] = useActionState<ActionState, FormData>(
    remove,
    null,
  )

  return (
    <li className="rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className="truncate">{name}</span>
            {!active && (
              <span
                className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-xs
                  font-semibold text-ink-faint"
              >
                {t.off}
              </span>
            )}
          </p>
          {otherName && otherName !== name && (
            <p className="truncate text-sm text-ink-faint">{otherName}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {count !== null && (
            <span className="text-sm text-ink-soft">
              <span className="num">{count}</span> {countNoun}
            </span>
          )}
          {/* A plain underlined word and not a button, for the reason CancelBill
              gives: the wide buttons in this app do the thing the screen is for,
              and the way into a panel that can destroy a row must not look like
              one at arm's length.

              And gone entirely at a lapsed centre, rather than opening on three
              refusals. Everything behind this word writes, so there is nothing to
              show a reader who cannot save; the screen has already said so once,
              where the add form was. This is also the whole of the fence in this
              file — `open` has no other setter, so the panel below cannot draw. */}
          {!readOnly && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="inline-flex min-h-tap items-center text-sm font-medium
                text-brand-700"
            >
              {open ? common.cancel : common.edit}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          {/* The repair that fixes the mistake nearly everybody makes, first and
              in the ordinary shape of a form. Everything under it is a way of
              taking the row out of use, which is the rarer thing to want. */}
          <form action={renameAction} className="flex flex-col gap-3">
            <input type="hidden" name={idField} value={id} />

            {renamed?.error && <Alert>{renamed.error}</Alert>}
            {renamed?.ok && (
              <p role="status" className="font-medium text-brand-700">
                {renamed.ok} ✓
              </p>
            )}

            {/* Side by side from `sm`, and the ids keyed by the row. `Field` falls
                back to the input's name for its id (ui.tsx:49), so every panel open
                on the screen — and the add form below them — rendered id="name",
                and every label on the page pointed at whichever came first. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id={`${idField}-name-${id}`}
                label={nameLabel}
                name="name"
                defaultValue={name}
                placeholder={placeholder}
                required
                maxLength={MAX_NAME}
                autoComplete="off"
              />
              <Field
                id={`${idField}-nameBn-${id}`}
                label={`${common.bnName} (${common.optional})`}
                name="nameBn"
                defaultValue={nameBn}
                placeholder={placeholderBn}
                maxLength={MAX_NAME}
                autoComplete="off"
              />
            </div>

            {/* Full width on a phone, where the wide button at the bottom is the
                one you press, and its own size from `sm` — a 670px Save under two
                name fields is the desktop-as-giant-phone shape. */}
            <Button
              type="submit"
              disabled={renaming}
              full
              className="sm:w-auto sm:self-start"
            >
              {renaming ? common.saving : common.save}
            </Button>
          </form>

          <div className="border-t border-line pt-3">
            {switched?.error && <Alert>{switched.error}</Alert>}

            {active ? (
              offBlockedReason ? (
                <>
                  <p className="font-medium text-ink">{t.offBlockedTitle}</p>
                  <p className="mt-1 text-sm text-ink-soft">{offBlockedReason}</p>
                </>
              ) : (
                <form action={activeAction}>
                  <input type="hidden" name={idField} value={id} />
                  <input type="hidden" name="next" value="off" />
                  <Button type="submit" variant="secondary" disabled={switching}>
                    {switching ? common.saving : t.turnOff}
                  </Button>
                  {/* Under the button rather than above it, because the word "off"
                      is what worries an owner and this is the answer to the worry. */}
                  <p className="mt-2 text-sm text-ink-soft">{t.offHint}</p>
                </form>
              )
            ) : onBlockedReason ? (
              <>
                <p className="font-medium text-ink">{t.turnOn}</p>
                <p className="mt-1 text-sm text-ink-soft">{onBlockedReason}</p>
              </>
            ) : (
              <form action={activeAction}>
                <input type="hidden" name={idField} value={id} />
                <input type="hidden" name="next" value="on" />
                <Button type="submit" variant="secondary" disabled={switching}>
                  {switching ? common.saving : t.turnOn}
                </Button>
              </form>
            )}
          </div>

          <div className="border-t border-line pt-3">
            {/* An error survives here because nothing moved: a refused removal
                leaves the row, this panel and this list exactly as they were. */}
            {removed?.error && <Alert>{removed.error}</Alert>}

            {!asking ? (
              <button
                type="button"
                onClick={() => setAsking(true)}
                className="inline-flex min-h-tap items-center text-sm text-ink-faint
                  underline"
              >
                {t.removeOpen}
              </button>
            ) : blockedReason ? (
              <>
                <p className="font-medium text-ink">{t.blockedTitle}</p>
                <p className="mt-1 text-sm text-ink-soft">{blockedReason}</p>
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setAsking(false)}
                  >
                    {t.keep}
                  </Button>
                </div>
              </>
            ) : (
              <form action={removeAction} className="flex flex-col gap-3">
                <input type="hidden" name={idField} value={id} />

                <div>
                  <p className="font-medium text-ink">{t.removeHeading}</p>
                  <p className="mt-1 text-sm text-ink-soft">{t.removeWarning}</p>
                </div>

                {/* Keep-it first and full width, remove second and narrow — the
                    same order as the bill cancel step and the exam one, and for
                    the same reason: the habit this app builds is "the wide one at
                    the bottom is the one you press", and a confirm step is the
                    worst place to break it. `self-start` is what makes the second
                    one narrow: a flex column stretches its children, so without it
                    the two buttons were the same width and the sentence above was
                    describing markup that did not exist. */}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAsking(false)}
                    full
                  >
                    {t.keep}
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    disabled={removing}
                    className="self-start"
                  >
                    {removing ? t.removing : t.removeConfirm}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
