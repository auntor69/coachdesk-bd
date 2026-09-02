'use client'

/**
 * Which parts of the job a manager is being given (MASTERPLAN.md §6.2).
 *
 * SIX BOXES AND A SHORTCUT. The boxes are what gets posted and what the database
 * stores; the select above them is a way to tick five of them in one tap, and the word
 * it shows for a set already ticked is a description rather than a state. `bundleOf`
 * decides that word, so a hand-picked set reads as "chosen one by one" instead of
 * pretending to be the nearest job title.
 *
 * ALL SIX ON AN APPOINT FORM, which is the detail everything else here rests on:
 * `parseCapabilities([])` is an observer, so a form that posted no boxes would quietly
 * hand out a look-and-touch-nothing administrator to an owner who never scrolled this
 * far. All six collapses to null in `parseCapabilities`, which is the un-narrowed
 * manager every appointment made before this screen existed.
 *
 * CONTROLLED, unlike BranchPicker, because there are two ways to answer one question
 * and they have to agree: picking Accountant has to move the boxes, and unticking a box
 * has to stop the select claiming Accountant.
 */
import { useState } from 'react'

import type { T } from '@/lib/i18n'
import {
  BUNDLE_NAMES,
  CAPABILITIES,
  CAPABILITY_BUNDLES,
  bundleOf,
  type BundleName,
  type Capability,
} from '@/lib/staff/capabilities'

/** The appoint form's select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

export function CapabilityPicker({
  t,
  current,
}: {
  t: T<'capabilities'>
  /**
   * What they may do today, or `null` for the whole job — which is what an appoint form
   * passes, because that is the manager this screen used to create.
   */
  current: readonly string[] | null
}) {
  const [picked, setPicked] = useState<Set<Capability>>(
    () => new Set(current === null ? CAPABILITIES : CAPABILITIES.filter((c) => current.includes(c))),
  )

  const chosen = CAPABILITIES.filter((c) => picked.has(c))
  const bundle = bundleOf(chosen)

  function apply(name: string) {
    // 'custom' is how the select reports a hand-picked set; choosing it is choosing the
    // set that is already there, so the boxes are left alone.
    if (name === 'custom') return
    const preset = CAPABILITY_BUNDLES[name as BundleName]
    setPicked(new Set(preset ?? CAPABILITIES))
  }

  function toggle(capability: Capability, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(capability)
      else next.delete(capability)
      return next
    })
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium text-ink">{t.legend}</legend>

      <select
        value={bundle ?? 'custom'}
        onChange={(e) => apply(e.target.value)}
        aria-label={t.legend}
        className={SELECT_CLASS}
      >
        {BUNDLE_NAMES.map((name) => (
          <option key={name} value={name}>
            {t.bundle[name]}
          </option>
        ))}
        <option value="custom">{t.custom}</option>
      </select>
      {bundle && <span className="text-sm text-ink-soft">{t.bundleHint[bundle]}</span>}

      {CAPABILITIES.map((capability) => (
        <label
          key={capability}
          className="flex min-h-tap cursor-pointer items-start gap-3"
        >
          <input
            type="checkbox"
            name="capability"
            value={capability}
            checked={picked.has(capability)}
            onChange={(e) => toggle(capability, e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
          />
          <span className="min-w-0">
            <span className="block text-ink">{t.name[capability]}</span>
            <span className="block text-sm text-ink-soft">{t.hint[capability]}</span>
          </span>
        </label>
      ))}

      {/* The one thing the boxes cannot show: all six is stored as "the whole job", so a
          seventh capability added next year lands on them too. */}
      {bundle === 'deputy' && (
        <span className="text-sm text-ink-soft">{t.everything}</span>
      )}
    </fieldset>
  )
}
