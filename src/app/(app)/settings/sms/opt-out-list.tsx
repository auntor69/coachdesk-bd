'use client'

/**
 * Who does not get messages, and which of the three ways to reach the ones who do.
 *
 * Every switch here is a decision the centre already made in real life — a
 * number that belongs to someone else, a parent who asked to be left alone, a
 * student who stopped coming. The product's job is to obey it without needing
 * the record deleted, because attendance and marks history should survive a
 * parent opting out of SMS.
 *
 * THE TWO CONTROLS ON A ROW ARE NOT THE SAME KIND OF THING, and they are two forms
 * for exactly that reason. The switch is permission: it decides whether this family
 * may be messaged at all. The dropdown is preference: it decides which button an
 * owner sees first, and it can neither silence a channel nor bring one back. A
 * single form would have the switch writing whatever the dropdown happened to be
 * showing, and a dropdown change toggling the switch.
 *
 * ONE LINE PER FAMILY FROM `sm` (§20.8.11). Two stacked rows per student is right on a
 * phone and absurd on a desktop: three hundred families became six hundred rows, each
 * with a dropdown as wide as the screen. From `sm` the inner block goes `contents` and
 * the row is `name | switch | channel` on one line — no `order-N`, no second markup
 * tree, and the phone keeps the shape the note further down defends.
 */
import { useActionState } from 'react'

import { Alert } from '@/components/ui'
import { setPreferredChannel, toggleSmsOptOut, type ActionState } from '../actions'
import { formatBdMobile } from '@/lib/bd/phone'
import { fill } from '@/lib/i18n/fill'
import type { T } from '@/lib/i18n'
import { CHASE_CHANNELS } from '@/lib/students/channel'
import type { OutreachChannel } from '@/lib/supabase/types'

export type OptOutStudent = {
  id: string
  name: string
  guardianPhone: string | null
  optOut: boolean
  /** Null — the default, and the common case — means nobody has said. */
  preferredChannel: OutreachChannel | null
}

export function OptOutList({
  students,
  subtitle,
  t,
  channels,
}: {
  students: OptOutStudent[]
  /** Already a sentence — see the note where the page resolves it. */
  subtitle: string
  t: T<'optOutList'>
  /** The same three words the chase chips use, so the two cannot drift apart. */
  channels: T<'channels'>
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    toggleSmsOptOut,
    null,
  )
  const [markState, markAction, marking] = useActionState<ActionState, FormData>(
    setPreferredChannel,
    null,
  )

  return (
    /* Capped, because a consent row is a name, a number, a switch and a dropdown —
       at 1,216px the switch ends up a hand's width from the name it belongs to. The
       cap also bounds the two Alerts, which take no className of their own. */
    <section className="flex max-w-4xl flex-col gap-3">
      <div>
        <h2 className="font-semibold text-ink">{t.title}</h2>
        <p className="num mt-0.5 text-sm text-ink-soft">{subtitle}</p>
        <p className="mt-1 text-sm text-ink-faint">{t.channelHint}</p>
      </div>

      {/* Both actions report into the same block. Two successes can be on screen
          at once — the owner did two things — and each sentence is about the one
          they did, which is why neither is phrased as "saved". */}
      {state?.error && <Alert>{state.error}</Alert>}
      {markState?.error && <Alert>{markState.error}</Alert>}
      {state?.ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {state.ok}
        </p>
      )}
      {markState?.ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {markState.ok}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {students.map((student) => (
          <li
            key={student.id}
            className="flex flex-col gap-2 rounded-xl border border-line bg-white
              px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4"
          >
            {/* `contents` from `sm` so the two things inside it become cells of the
                row itself. The alternative was a second copy of the name and the
                switch behind a breakpoint, which is two places to fix a bug in. */}
            <div className="flex items-center gap-3 sm:contents">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{student.name}</p>
                <p className="num truncate text-sm text-ink-faint">
                  {student.guardianPhone
                    ? formatBdMobile(student.guardianPhone)
                    : t.noNumber}
                </p>
              </div>

              <form action={formAction} className="shrink-0">
                <input type="hidden" name="studentId" value={student.id} />
                <input
                  type="hidden"
                  name="optOut"
                  value={student.optOut ? 'false' : 'true'}
                />
                {/* aria-pressed rather than a checkbox, because the switch is the
                    submit — there is no separate save step to forget. The visible
                    word is the state; the label is the action, because a button
                    reading "On" that turns SMS off is unusable without the colour. */}
                <button
                  type="submit"
                  disabled={pending}
                  aria-pressed={!student.optOut}
                  aria-label={fill(student.optOut ? t.turnOn : t.turnOff, {
                    name: student.name,
                  })}
                  className={`min-h-tap rounded-lg border-2 px-4 text-sm font-semibold
                    disabled:opacity-50 ${
                      student.optOut
                        ? 'border-line bg-surface-alt text-ink-soft'
                        : 'border-brand-500 bg-brand-50 text-brand-700'
                    }`}
                >
                  {student.optOut ? t.off : t.on}
                </button>
              </form>
            </div>

            {/* Its own row below `sm`, not squeezed in beside the switch: a 360px
                screen with a Bangla name, an eleven-digit number, a toggle and a
                dropdown on one line is four things nobody can hit with a thumb. From
                `sm` there is room for all four, and 12rem is a dropdown holding one
                of four words — not a control the width of the roster. */}
            <form action={markAction} className="shrink-0 sm:w-48">
              <input type="hidden" name="studentId" value={student.id} />
              {/*
                Submits on change, so there is no save button to leave unpressed —
                the same bargain the switch above makes. Uncontrolled and seeded
                from the server, which is right for the path that works: the value
                the owner picked is the value the database now holds. On a failed
                write the Alert above says so and the dropdown is showing what they
                asked for rather than what is stored, which is the honest reading of
                "that did not save" — reloading the page shows the truth.
              */}
              <select
                name="channel"
                defaultValue={student.preferredChannel ?? ''}
                disabled={marking}
                aria-label={fill(t.channelFor, { name: student.name })}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                className="min-h-tap w-full rounded-xl border-2 border-line bg-white
                  px-4 text-base text-ink outline-none focus:border-brand-500
                  disabled:opacity-50"
              >
                {/* The empty string is how a form says null. See asPreferredChannel. */}
                <option value="">{t.channelAny}</option>
                {/* Mapped from the list the chips render, not typed out again, so a
                    channel can never be offered here and missing there. */}
                {CHASE_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channels[channel]}
                  </option>
                ))}
              </select>
            </form>
          </li>
        ))}
      </ul>
    </section>
  )
}
