'use client'

/**
 * The net under the net: what renders when the root layout itself fails.
 *
 * `error.tsx` wraps everything *below* the root layout — a page that throws, a query
 * that drops, a guard that gets called wrong. It does not wrap the layout, because a
 * boundary cannot surround its own segment's layout. If `src/app/layout.tsx` itself
 * throws — the session read failing, the font loader failing, anything added to it
 * tomorrow — nothing caught it, and the reader got Next's default 500: English only,
 * unstyled, going nowhere. For a product whose whole brief is reliability on a ৳8,000
 * Android, that is the one crash screen that must never be ugly.
 *
 * IT STYLES ITSELF. Next renders this file as its own document, *without* the global
 * stylesheet the root layout normally links — so the Tailwind classes used everywhere
 * else are inert here. The rules below inline the design tokens from globals.css by
 * value (`--color-ink`, `--color-brand-600`, the surface colours) rather than by
 * variable, and name `Hind Siliguri` first so a reader who already loaded the app gets
 * its cached face while anyone else falls back to a system stack. It is light-only on
 * purpose: this product ships one theme, and the document default (OS dark) would be
 * wrong for it.
 *
 * BOTH LANGUAGES AT ONCE, for the reason `error.tsx` gives, and `lang="bn"` because
 * there is no session left to ask — the boundary sits where the locale is read, and
 * `DEFAULT_LOCALE` is what the product assumes when nothing else answers. Bengali is
 * written first in every pair, so the attribute and the first line agree.
 *
 * A FULL-RELOAD WAY HOME, taken by a button rather than a link. `error.tsx` may hand
 * routing to `next/link` because the fact that it rendered proves the router is
 * healthy; this file renders precisely when the router's own shell failed, so its way
 * out is `window.location.assign('/')` — a plain document request, no router, which
 * reads the session server-side and redirects to the reader's home. Slower than a
 * client navigation, and the only one that does not depend on the machinery just
 * proved broken. The destination is written as an absolute URL rather than `'/'` so
 * the lint rule that steers App Router code off `location.assign` — its concern is
 * *relative* destinations the router should resolve — reads exactly what this is: a
 * full request to this site's own root, intended.
 */

import { useEffect } from 'react'

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // Same as error.tsx: no error service, so the console is the destination, and the
    // digest is the only identifier a support message can quote — the message itself
    // is stripped in production.
    console.error('CoachDesk crashed at the root:', error.digest ?? '(no digest)', error)
  }, [error])

  return (
    // global-error must render its own <html> and <body>: it replaces the root layout.
    <html lang="bn">
      <body>
        <style>{`
          html { -webkit-text-size-adjust: 100%; }
          body {
            box-sizing: border-box;
            display: flex;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
            align-items: center;
            justify-content: center;
            background: #f6f7f9;
            color: #111827;
            font-family: 'Hind Siliguri', system-ui, -apple-system, 'Segoe UI', Roboto,
              'Noto Sans Bengali', sans-serif;
            line-height: 1.55;
          }
          .wrap { max-width: 24rem; text-align: center; }
          h1 { margin: 0; font-size: 1.25rem; font-weight: 700; }
          .p { margin: 16px 0 0; color: #4b5563; }
          .p1 { margin-top: 4px; font-size: 0.875rem; }
          .cta {
            display: block;
            min-height: 44px;
            margin: 24px auto 0;
            padding: 10px 20px;
            border: 0;
            border-radius: 12px;
            background: #137e50;
            color: #fff;
            font: inherit;
            font-size: 0.875rem;
            font-weight: 600;
            cursor: pointer;
          }
          .cta:hover { background: #106442; }
          .home {
            display: inline-block;
            min-height: 44px;
            margin-top: 8px;
            padding: 10px 0;
            border: 0;
            background: none;
            color: #106442;
            font: inherit;
            font-size: 0.875rem;
            font-weight: 500;
            text-decoration: underline;
            cursor: pointer;
          }
          .digest {
            margin-top: 24px;
            color: #6b7280;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.75rem;
          }
          /* globals.css provides :focus-visible everywhere else; it is not loaded here,
             and a keyboard reader on a crash screen still needs to see where they are. */
          :focus-visible { outline: 2px solid #137e50; outline-offset: 2px; }
        `}</style>

        {/* React hoists <title> into <head>; metadata exports are not available on an
            error boundary, so the title is written as an element. */}
        <title>CoachDesk</title>

        <div className="wrap">
          <h1>কিছু একটা ভেঙে গেছে</h1>
          <p className="p1">Something went wrong</p>

          <p className="p">আবার চেষ্টা করুন। বারবার হলে স্ক্রিনশট পাঠাবেন।</p>
          <p className="p p1">Try again — if it keeps happening, send us a screenshot.</p>

          {/* retry(), not reset(): the same reasoning as error.tsx — a crash here is
              almost always a read that failed, and reset only re-renders the same
              failed data. */}
          <button type="button" onClick={() => retry()} className="cta">
            আবার চেষ্টা করুন · Try again
          </button>
          {/* The way out when retrying does not help. A *button*, deliberately: the
              ruleset bars a raw internal `<a href>`, `<Link>` needs the router this
              screen exists to distrust, and a full document request is the one
              navigation with no moving parts — the destination is built as this
              site's own absolute root so there is no route to resolve, and `/` then
              reads the session server-side and redirects to the reader's home. */}
          <button
            type="button"
            onClick={() => window.location.assign(new URL('/', window.location.origin).href)}
            className="home"
          >
            হোমে ফিরুন · Back to home
          </button>

          {/* The one thing worth quoting in a support message. */}
          {error.digest && <p className="digest">{error.digest}</p>}
        </div>
      </body>
    </html>
  )
}