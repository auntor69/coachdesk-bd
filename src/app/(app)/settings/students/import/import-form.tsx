'use client'

/**
 * Loading a centre's register.
 *
 * The screen is a paste box and a preview, and the preview is the whole point.
 * We are typing somebody else's two hundred students in from a notebook, and the
 * only thing worse than refusing a line is accepting it wrongly — a name filed
 * under the wrong number is a parent who hears nothing for a month and then
 * leaves. So every line is read back before anything is written: what it parsed
 * to, what it could not read, and who is already on the roster.
 *
 * The parser is the same module the Server Action re-runs, so the count on the
 * button is the count the database will report.
 *
 * AND, WHEN THE LIST DOES NOT FIT, §3.5's price. The shortfall is computed here and
 * priced from the same bands the server bills from, because a screen that says ৳3,480
 * and an intent that opens at ৳4,000 is a screen nobody trusts twice. Nothing is
 * created before the money arrives — see the note on the priced block.
 */
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

import { Alert, Button } from '@/components/ui'
import { formatBdMobile } from '@/lib/bd/phone'
import {
  MAX_IMPORT_ROWS,
  parseRoster,
  rosterKey,
  type RosterProblem,
} from '@/lib/bd/roster'
import { fill } from '@/lib/i18n/fill'
import type { T } from '@/lib/i18n'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { formatTaka } from '@/lib/money'
import { ASK_PLACES, capacityBands, capacityCostBdt } from '@/lib/plans'
import {
  buyStudentPlaces,
  requestPlaces,
  withdrawPlacesRequest,
  type UpgradeState,
} from '../../plan/actions'
import { importStudents, type ActionState } from '../../actions'

type BatchOption = { id: string; label: string }

/** A parse failure needs a human; a duplicate has already been dealt with. */
const NEEDS_FIXING = new Set<RosterProblem>([
  'no-phone',
  'bad-phone',
  'no-name',
  'name-too-long',
])

/** How many parsed names are listed at once. A phone renders 500 rows slowly. */
const PREVIEW_LIMIT = 100

export function ImportForm({
  t,
  common,
  batches,
  existingKeys,
  room,
  forSale,
  mayBuy,
  mayAsk,
  asked,
  mayReadPlan,
}: {
  t: T<'importForm'>
  common: T<'common'>
  batches: BatchOption[]
  /** null when the roster is too big to hint with. The import still checks. */
  existingKeys: string[] | null
  /**
   * How many more students this centre may hold. Always a number: every tier has a
   * ceiling now, including the ones that bill per student, whose ceiling is the
   * number of places bought rather than a figure in the plan table. This used to be
   * `number | null` with null meaning unlimited, which is what the centre tiers
   * looked like before `studentCeiling` existed.
   */
  room: number
  /**
   * The PAID ceiling, which is where the bands start — and null on a plan that sells no
   * places at all. See the page for why it is not `session.ceiling`.
   *
   * Two facts in one prop deliberately: "can this centre buy places" and "at what
   * price" are the same question, and a separate boolean could disagree with the number.
   */
  forSale: number | null
  /** Owner only, mirroring requireRole('owner') inside `buyStudentPlaces`. */
  mayBuy: boolean
  /**
   * Manager only, and exactly a manager — §3.7's fork. `planManager` and
   * `capacity_requests_manager_insert` both refuse an owner, who is offered the price
   * above instead.
   */
  mayAsk: boolean
  /** How many places this branch has already asked for, or null if they have not. */
  asked: number | null
  /** Owner or manager — /settings/plan is pageRole('manager'). */
  mayReadPlan: boolean
}) {
  const [text, setText] = useState('')

  /** Which batches everyone on this paste joins. See the note on the checkboxes. */
  const [chosen, setChosen] = useState<string[]>([])

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await importStudents(prev, formData)
      // On success the box keeps exactly the lines that still need a human, so
      // it becomes the to-do list. Clearing it would throw away the twelve lines
      // that failed along with the hundred that worked, and the owner would have
      // to find them again in the notebook.
      if (result?.ok) {
        setText(
          parseRoster(String(formData.get('roster') ?? ''))
            .filter((row) => row.problem !== null && NEEDS_FIXING.has(row.problem))
            .map((row) => row.raw)
            .join('\n'),
        )
      }
      return result
    },
    null,
  )

  /*
   * The purchase, in the same <form> as the import.
   *
   * A SECOND <form> IS ILLEGAL INSIDE THE FIRST, and a link to /settings/plan would
   * throw away a five-hundred-line paste to buy the places that paste needs. So the buy
   * button submits this form to a different action with `formAction`, which is what
   * useActionState's dispatch is for; `buyStudentPlaces` ignores the roster and the
   * batch ticks, `importStudents` ignores the two hidden fields.
   */
  const [bought, buy, buying] = useActionState<UpgradeState, FormData>(
    buyStudentPlaces,
    null,
  )
  const keyRef = useRef<HTMLInputElement>(null)

  /*
   * The ask, in the same <form> again and for the same reason — §3.7's manager cannot
   * buy, and a link away from a five-hundred-line paste is a paste thrown away. Neither
   * action reads a field of the other's: `requestPlaces` takes nothing off the form at
   * all, because how many places to ask for is not a manager's to type.
   */
  const [askState, ask, asking] = useActionState<UpgradeState, FormData>(
    requestPlaces,
    null,
  )
  const [withdrawn, withdraw, withdrawing] = useActionState<UpgradeState, FormData>(
    withdrawPlacesRequest,
    null,
  )

  /** What the row says, plus what this screen has done to it since it loaded. */
  const askOpen = withdrawn?.ok ? null : askState?.ok ? ASK_PLACES : asked

  /*
   * The replay guard, minted after mount because it reads a random source. Reused for a
   * retry on purpose — `openIntent` hands back the row it already opened for a key it
   * has seen, so a second tap after "could not start" is not a second bill.
   *
   * One key per mount is safe here only because the buy control goes away on success:
   * see the priced block. Were it to stay, a bigger paste bought under the same key
   * would land on the first, smaller intent.
   */
  useEffect(() => {
    const input = keyRef.current
    if (input && !input.value) input.value = mintIdempotencyKey()
  }, [])

  const rows = useMemo(() => parseRoster(text), [text])
  const known = useMemo(() => new Set(existingKeys ?? []), [existingKeys])
  const preview = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        alreadyThere:
          row.problem === null && row.name !== null && row.phone !== null
            ? known.has(rosterKey(row.name, row.phone))
            : false,
      })),
    [rows, known],
  )

  const problems = preview.filter((row) => row.problem !== null)
  const ready = preview.filter((row) => row.problem === null)
  const alreadyThere = ready.filter((row) => row.alreadyThere).length
  const hinting = existingKeys !== null
  const newCount = hinting ? ready.length - alreadyThere : ready.length
  const tooMany = rows.length > MAX_IMPORT_ROWS
  const overRoom = newCount > room

  /*
   * §3.5 STEPS 3 TO 5, in three lines: the places needed, then one marginal price for
   * the whole block, then the bands that explain it.
   *
   * `short` is measured against `room` — the effective ceiling, which is what refuses
   * the paste — while the price starts at `forSale`, the paid ceiling. Those are the
   * same number for every centre not on a trial, and the pair is deliberate for one
   * that is: the trial decides what fits, the paid row decides what a place costs.
   *
   * Bounded by the paste, so no clamp is needed here: MAX_IMPORT_ROWS is 500 and
   * MAX_PLACES is 2000, so the hidden field below can never be cut down to a smaller
   * purchase than the one shown.
   */
  const short = overRoom ? newCount - room : 0
  const bands = forSale === null || short === 0 ? [] : capacityBands(forSale, forSale + short)
  const shortCost = forSale === null ? 0 : capacityCostBdt(forSale, forSale + short)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <Alert tone="ok">
          {state.ok}{' · '}
          <Link href="/settings/students" className="underline">
            {t.viewList}
          </Link>
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="roster" className="font-medium text-ink">
          {t.label}
        </label>
        <span id="roster-hint" className="text-sm text-ink-soft">
          {t.hint}
        </span>
        <textarea
          id="roster"
          name="roster"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={t.placeholder}
          aria-describedby="roster-hint"
          // text-base for the same reason Field uses it: iOS Safari zooms the
          // page when a focused field is under 16px and never zooms back.
          className="rounded-xl border-2 border-line bg-white p-4 text-base
            leading-7 outline-none transition-colors placeholder:text-ink-faint
            focus:border-brand-500"
        />
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="num font-semibold text-ink">
            {fill(t.fresh, { n: newCount })}
          </span>
          {hinting && alreadyThere > 0 && (
            <span className="num text-ink-soft">
              {fill(t.alreadyThere, { n: alreadyThere })}
            </span>
          )}
          {problems.length > 0 && (
            <span className="num font-medium text-absent">
              {fill(t.willSkip, { n: problems.length })}
            </span>
          )}
        </div>
      )}

      {tooMany && (
        <Alert tone="warn">
          {fill(t.tooMany, { max: MAX_IMPORT_ROWS, got: rows.length })}
        </Alert>
      )}

      {/* NOTHING IS CREATED BEFORE THE MONEY ARRIVES, which is §3.5's last step and the
          reason this is a price rather than a half-import. The Add button stays disabled
          while the list is over the ceiling; with the manual provider the founder
          confirms the transfer minutes or hours later, so the way back in is a reload
          rather than a queue of half-admitted children sitting in a table.

          Only where places are actually for sale. A teacher tier gets the old sentence:
          its ceiling is written in the plan and no amount of money moves it. */}
      {overRoom &&
        (forSale === null ? (
          <Alert tone="warn">{fill(t.overRoom, { room, fresh: newCount })}</Alert>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border-2 border-late/40 bg-late/5 p-4">
            <div>
              <p className="num font-semibold text-ink">
                {fill(t.shortTitle, { n: short })}
              </p>
              <p className="num mt-1 text-sm text-ink-soft">
                {fill(t.shortBody, { room, fresh: newCount })}
              </p>
            </div>

            {/* The bands, because a single ৳3,480 invites the suspicion it was
                invented. Marginal and in order, straight off capacityBands.

                Gone once a purchase is open, and that is not tidiness: this total is
                recomputed from whatever is in the box now, so a list edited after the
                buy would price a purchase nobody made. What was actually bought is on
                the plan page, against the reference. */}
            {!bought?.ok && (
              <dl className="flex flex-col gap-1 text-sm">
                {bands.map((band) => (
                  <div
                    key={band.rateBdt}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <dt className="num text-ink-soft">
                      {fill(t.shortBand, {
                        n: band.seats,
                        rate: formatTaka(band.rateBdt),
                      })}
                    </dt>
                    <dd className="num text-ink">{formatTaka(band.costBdt)}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 border-t border-late/40 pt-1">
                  <dt className="font-semibold text-ink">{t.shortTotal}</dt>
                  <dd className="num font-semibold text-ink">{formatTaka(shortCost)}</dd>
                </div>
              </dl>
            )}

            {bought?.error && <Alert>{bought.error}</Alert>}
            {(askState?.error || withdrawn?.error) && (
              <Alert>{askState?.error ?? withdrawn?.error}</Alert>
            )}

            {bought?.ok ? (
              <p role="status" className="text-sm font-medium text-brand-700">
                {t.bought}
              </p>
            ) : mayBuy ? (
              <>
                <input type="hidden" name="idempotencyKey" ref={keyRef} />
                <input type="hidden" name="places" value={short} readOnly />
                <Button type="submit" formAction={buy} disabled={buying} full>
                  {buying ? t.shortBuying : fill(t.shortBuy, { taka: formatTaka(shortCost) })}
                </Button>
              </>
            ) : !mayAsk ? (
              <p className="text-sm text-ink-soft">{t.shortAsk}</p>
            ) : askOpen !== null ? (
              <div className="flex flex-col gap-1">
                <p role="status" className="num text-sm font-medium text-brand-700">
                  {fill(t.shortAsked, { n: askOpen })}
                </p>
                <Button
                  type="submit"
                  formAction={withdraw}
                  disabled={withdrawing}
                  variant="ghost"
                  className="self-start px-0"
                >
                  {t.shortAskWithdraw}
                </Button>
              </div>
            ) : (
              <Button
                type="submit"
                formAction={ask}
                disabled={asking}
                variant="secondary"
                full
              >
                {asking ? t.shortAsking : fill(t.shortAskFor, { n: ASK_PLACES })}
              </Button>
            )}

            {mayReadPlan && (
              <Link
                href="/settings/plan"
                className="inline-flex min-h-tap items-center font-medium text-brand-700"
              >
                {t.shortPlanLink} →
              </Link>
            )}
          </div>
        ))}

      {problems.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">{t.problemsTitle}</p>
          <ul className="flex flex-col gap-1.5">
            {problems.slice(0, PREVIEW_LIMIT).map((row) => (
              <li
                key={row.line}
                className="rounded-xl border border-absent/30 bg-absent/5 px-3 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="num shrink-0 text-xs text-ink-faint">{row.line}</span>
                  <span className="min-w-0 break-words text-sm text-ink">{row.raw}</span>
                </div>
                <span className="mt-0.5 block text-xs font-medium text-absent">
                  {row.problem !== null && t.problem[row.problem]}
                </span>
              </li>
            ))}
          </ul>
          {problems.length > PREVIEW_LIMIT && (
            <p className="num text-xs text-ink-soft">
              {fill(t.moreProblems, { n: problems.length - PREVIEW_LIMIT })}
            </p>
          )}
        </div>
      )}

      {ready.length > 0 && (
        <details className="rounded-2xl border border-line bg-white p-4">
          <summary className="min-h-tap cursor-pointer font-medium text-ink-soft">
            {fill(t.readyTitle, { n: ready.length })}
          </summary>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {ready.slice(0, PREVIEW_LIMIT).map((row) => (
              <li key={row.line} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words font-medium text-ink">
                    {row.name}
                  </span>
                  <span className="num shrink-0 text-sm text-ink-soft">
                    {formatBdMobile(row.phone)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-ink-soft">
                  {row.guardianName && (
                    <span>{fill(t.guardian, { name: row.guardianName })}</span>
                  )}
                  {row.alreadyThere && (
                    <span className="font-medium text-late">{t.alreadyOn}</span>
                  )}
                  {row.dropped.length > 0 && (
                    <span className="num">
                      {fill(t.dropped, {
                        numbers: row.dropped.map(formatBdMobile).join(', '),
                      })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {ready.length > PREVIEW_LIMIT && (
            <p className="num mt-2 text-xs text-ink-soft">
              {fill(t.previewNote, { shown: PREVIEW_LIMIT })}
            </p>
          )}
        </details>
      )}

      {batches.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium text-ink">{t.whichBatch}</legend>
          <p className="mb-1 text-sm text-ink-soft">{t.whichBatchBody}</p>
          <div className="flex flex-col gap-2">
            {batches.map((batch) => (
              <label
                key={batch.id}
                className="flex min-h-tap cursor-pointer items-center gap-3
                  rounded-xl border-2 border-line bg-white px-4
                  has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                {/* Controlled, and that is a fix rather than a style. React resets an
                    uncontrolled field after a Server Action, so the batch used to
                    clear itself on success — while the lines that need a human stay
                    in the box on purpose, as the to-do list. Fixing three names and
                    pressing again therefore imported those three into no batch at
                    all. Held in state, the choice survives the submit that the
                    remaining names belong to. */}
                <input
                  type="checkbox"
                  name="batchIds"
                  value={batch.id}
                  checked={chosen.includes(batch.id)}
                  onChange={(event) =>
                    setChosen((prev) =>
                      event.target.checked
                        ? [...prev, batch.id]
                        : prev.filter((id) => id !== batch.id),
                    )
                  }
                  className="h-5 w-5 shrink-0 accent-brand-600"
                />
                <span className="min-w-0 truncate text-ink">{batch.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* WHAT A REGISTER LOADED INTO NO BATCH ACTUALLY DOES, said before the press
          rather than discovered a week later. A student with no enrolment is inert
          here: the generator bills enrolments, the attendance sheet lists a batch,
          and the old-dues screen hangs each debt on one. So a paste with no batch
          ticked adds two hundred names that produce nothing, and the fee board stays
          at ৳0 on the afternoon it is being shown to the owner who is deciding
          whether to pay.

          Not a refusal: names first and batches afterwards is a real way to work,
          and the student's own page can enrol them later. It only has to be a choice
          instead of the default, made in silence.

          Held back until there is something to add. Before that the screen's one job
          is the paste box, and a banner about batches would compete with it; once the
          preview says forty are new, the question is live and this sits directly above
          the button the owner is reaching for. */}
      {newCount > 0 &&
        (batches.length === 0 ? (
          <Alert tone="warn">
            {t.noBatchesYet}{' · '}
            <Link href="/settings/batches/new" className="underline">
              {t.makeBatch}
            </Link>
          </Alert>
        ) : chosen.length === 0 ? (
          <Alert tone="warn">{t.noBatchPicked}</Alert>
        ) : null)}

      <Button
        type="submit"
        full
        disabled={pending || newCount === 0 || tooMany || overRoom}
      >
        {pending
          ? common.adding
          : newCount > 0
            ? fill(t.submit, { n: newCount })
            : t.submitEmpty}
      </Button>
    </form>
  )
}
