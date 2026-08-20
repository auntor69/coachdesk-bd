'use client'

/**
 * The last thing between a failed render and a blank screen.
 *
 * The app had no error boundary at all: a dropped database connection, a Supabase
 * cold start, any unhandled throw in any page, and a coaching centre owner got
 * Next's default error page. On a phone that reads as "the app is gone".
 *
 * It is also the net under the guards. `pageRole` turns a wrong role into a 403
 * screen, but a page that still calls the throwing `requireRole` — or any future
 * one that forgets — lands here instead of on a 500.
 *
 * Both languages at once, and this is the one screen where that is right rather
 * than lazy. An error boundary is a Client Component and receives only the error,
 * so there is no session to read a language from; reaching for `dict` would put
 * the whole i18n module in the crash path, which is exactly the sort of import
 * that might be *what* crashed, and would ship both dictionaries in the client
 * bundle to be used once. Four short strings, no dependencies, no guess about who
 * is reading.
 */
import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // No error service yet, so the console is where this goes. A digest is all
    // the reader can quote back to us — the message itself is stripped in
    // production — so it is printed alongside.
    console.error('CoachDesk crashed:', error.digest ?? '(no digest)', error)
  }, [error])

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-bold text-ink">কিছু একটা ভেঙে গেছে</h1>
        <p className="mt-1 text-sm text-ink-soft">Something went wrong</p>

        <p className="mt-4 text-ink-soft">
          আবার চেষ্টা করুন। বারবার হলে স্ক্রিনশট পাঠাবেন।
        </p>
        <p className="mt-1 text-sm text-ink-faint">
          Try again — if it keeps happening, send us a screenshot.
        </p>
      </div>

      {/* retry(), not reset(): a crash here is almost always a query that failed,
          and reset only re-renders the same failed data. */}
      <button
        type="button"
        onClick={() => retry()}
        className="flex min-h-tap items-center rounded-xl bg-brand-600 px-5
          text-sm font-semibold text-white hover:bg-brand-700"
      >
        আবার চেষ্টা করুন · Try again
      </button>

      {/* The way out when retrying does not help. This boundary sits above
          (app)/layout, so unlike the 403 and 404 screens it renders with no
          header and no nav — a reader whose retry keeps failing would otherwise
          have nothing on the screen that goes anywhere.
          '/' rather than a role's home, because a Client Component has no session
          to ask — the root reads it server-side and redirects, which is exactly
          the indirection this needs. A client navigation, not a full reload: this
          file is a Client Component, so the fact that it rendered at all proves
          the router is alive. What failed was a render on the server. Reloading
          the document would be a slower way to the same place, and slower matters
          on the 3G this runs on. prefetch is off because '/' only ever redirects. */}
      <Link
        href="/"
        prefetch={false}
        className="min-h-tap text-sm font-medium text-brand-700 underline"
      >
        হোমে ফিরুন · Back to home
      </Link>

      {/* The one thing worth quoting in a support message, when there is one. */}
      {error.digest && (
        <p className="num text-xs text-ink-faint">{error.digest}</p>
      )}
    </div>
  )
}
