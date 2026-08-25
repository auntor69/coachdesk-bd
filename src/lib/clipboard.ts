'use client'

/**
 * Putting one string on the clipboard, and saying whether it got there.
 *
 * The boolean is the whole reason this is a function rather than one call inline.
 * The chips that use it log a chase to the database, and a chase that is recorded
 * when nothing reached the clipboard is the same lie the dead `sms:` link on a
 * laptop used to tell — see ./pointer.ts. So nothing here is fire-and-forget and
 * nothing swallows a failure quietly: the caller waits, and logs only on true.
 *
 * TWO PATHS, because the modern one has conditions attached. `navigator.clipboard`
 * is undefined outside a secure context and its write can be refused by permission
 * policy; both are unlikely here — the app is HTTPS in production and localhost in
 * development, and every call is inside a real click — but "unlikely" is not the
 * standard for the one control an owner has on a desktop. `execCommand('copy')` is
 * deprecated and works everywhere, including where the first path is missing, which
 * is exactly the trade worth making for a fallback.
 */

/** Returns true only once the text is actually on the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused, or no permission. The older path may still be allowed.
  }

  return legacyCopy(text)
}

/**
 * The pre-Clipboard-API copy: a textarea offscreen, selected, copied, removed.
 *
 * `readOnly` and `position: fixed` at the top left rather than `display: none` or a
 * negative offset — a hidden element cannot be selected, and an element the page has
 * to scroll to reach makes the page jump. `opacity: 0` keeps the single frame it
 * exists for invisible.
 *
 * Wrapped whole rather than per-statement: `execCommand` is gone in some hardened
 * builds, and a throw from it must read as "did not copy" and not as a broken page
 * on top of a fee list.
 */
function legacyCopy(text: string): boolean {
  try {
    const box = document.createElement('textarea')
    box.value = text
    box.readOnly = true
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(box)
    box.select()
    // Explicit range as well as select(), which iOS Safari ignores on a readOnly
    // field. Harmless everywhere else.
    box.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    box.remove()
    return ok
  } catch {
    return false
  }
}
