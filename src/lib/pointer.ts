'use client'

/**
 * Whether this is a mouse-driven device — asked because `sms:` and `tel:` are not.
 *
 * On a laptop those two links typically do nothing at all. Nothing opens, no error
 * appears, and until this hook existed the chip's `onClick` fired anyway: the app
 * wrote a row saying the family had been texted, the worklist then held them back
 * for the cooldown, and the owner's screen agreed that a message nobody sent had
 * gone. A dead button is a nuisance; a dead button that files a false report is the
 * bug. So the two chips that hand work to a phone ask this first, and offer to copy
 * instead. `wa.me` is untouched on every device — WhatsApp Web exists.
 *
 * CAPABILITY, NOT USER-AGENT. `(hover: hover) and (pointer: fine)` is true of a
 * mouse and false of a finger, which is the closest a browser will answer to "can
 * you hand this to a dialler". It gets the awkward middle right by accident and on
 * purpose: a tablet with a SIM reports a coarse pointer and keeps its real chips, a
 * laptop in tablet mode loses hover and keeps them too — erring, in both directions,
 * towards the device that can actually dial. A user-agent string would get a Windows
 * tablet exactly wrong.
 *
 * It is a media query rather than a stored preference because the answer changes
 * under a running page: a Surface has its keyboard folded back mid-lesson, and a
 * phone plugged into a monitor is a desktop until it is unplugged. `matchMedia`
 * notifies; a value read once at load would strand the owner with the wrong chips
 * until they reloaded.
 *
 * `useSyncExternalStore` for the reason ./drafts.ts gives about localStorage:
 * `window` does not exist during the server render, so the value cannot come from a
 * useState initializer without a hydration mismatch, and reading it in an effect and
 * calling setState is what `react-hooks/set-state-in-effect` exists to stop.
 */
import { useSyncExternalStore } from 'react'

const QUERY = '(hover: hover) and (pointer: fine)'

/**
 * One MediaQueryList for the whole page, created on first use.
 *
 * Lazily rather than at module scope because this module is imported by client
 * components that still get server-rendered, where `window` is not defined. A fresh
 * list per call would also work — `getSnapshot` returns a boolean, so React compares
 * by value — but 150 rows on the progress screen would then build 150 of them on
 * every render.
 */
let query: MediaQueryList | null = null

function media(): MediaQueryList {
  query ??= window.matchMedia(QUERY)
  return query
}

function subscribe(onChange: () => void) {
  const mql = media()
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media().matches,
    // The server render, and the moment before hydration. `false` — the phone
    // shape — because that is who this product is for, so a phone never flickers:
    // the answer it hydrates to is the one already on screen. It is also the safe
    // direction. A laptop showing the real `sms:` chip for one frame is the false
    // log above; a phone showing a copy button for one frame is a wasted tap.
    () => false,
  )
}
