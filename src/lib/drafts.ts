'use client'

/**
 * The half-finished sheet in localStorage, and how a screen picks it back up.
 *
 * Both the attendance register and the marks sheet are twenty to forty fields a
 * teacher fills standing in a classroom, and both get lost the same way: a phone
 * call, a locked screen, Chrome discarding a background tab. Re-marking thirty
 * students because the OS reclaimed memory is a real reason to go back to paper,
 * so every change is written straight to storage rather than on an interval — the
 * tab may never get another frame to do it in.
 *
 * The *read* is a `useSyncExternalStore` and not an effect that calls setState.
 * localStorage does not exist during the server render, so the value cannot come
 * from a useState initializer without a hydration mismatch on every controlled
 * input on the screen — and the obvious alternative, reading it in an effect and
 * merging it into state, is exactly what `react-hooks/set-state-in-effect` exists
 * to flag. Storage is an external system; this is the shape React asks for. The
 * server snapshot is null, the client snapshot is whatever is stored, and React
 * does the swap itself after hydration.
 *
 * Which means a screen using this does not hold the draft in state at all. It
 * renders `typed[id] ?? draft[id] ?? theValueTheServerSent` and keeps in state
 * only what the teacher has touched since the page opened. One consequence worth
 * knowing: the first tap writes the whole map, so from the second tap onward the
 * draft no longer participates.
 */
import { useMemo, useSyncExternalStore } from 'react'

/**
 * A storage event fires in the *other* tabs, never in the one that wrote. That is
 * the useful direction: two tabs open on the same register stop disagreeing. It is
 * also why a write does not have to notify anything locally — the writer already
 * knows, and it is holding the value in state.
 *
 * Not keyed on the draft: any storage change re-reads the snapshot, which costs a
 * string comparison on an event that fires when a teacher has two tabs open.
 */
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

/**
 * The stored draft, or null — null on the server, null through hydration, and
 * null when there is nothing saved or what is saved is unreadable.
 */
export function useSavedDraft<T>(key: string): T | null {
  // The raw string, not the parsed object. getSnapshot has to return something
  // that compares equal between calls or React re-renders forever, and JSON.parse
  // hands back a fresh object every time. Strings compare by value, so this is
  // stable for free.
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key)
      } catch {
        // Private mode, or storage disabled by policy. Not worth a broken screen.
        return null
      }
    },
    () => null,
  )

  return useMemo(() => {
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      // A corrupt draft is not worth a broken screen either.
      return null
    }
  }, [raw])
}

/** Silent on failure: a full disk is not worth an error message about storage. */
export function writeDraft(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* the save itself still works, there just won't be a draft */
  }
}

/**
 * Called once the sheet has been saved. Keeping the draft past that point would
 * let it override a correction made later from another device.
 */
export function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* nothing to clean up */
  }
}
