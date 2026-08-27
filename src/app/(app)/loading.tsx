/**
 * What a signed-in screen looks like for the moment between the tap and the data.
 *
 * WHY THIS FILE EXISTS. Until it did there was no Suspense boundary anywhere in the
 * app, and without one a tap on the bottom nav is a blocking server render with
 * nothing on screen to say so: the old page stays put, the new one arrives whenever
 * Supabase answers, and in between the nav looks broken. The fee board alone opens
 * with six parallel queries. On the ৳8,000 Android on one bar of Grameenphone that
 * this product is built for, that gap is long enough for a teacher to tap twice and
 * long enough for an owner to decide the app has hung. This is the file that makes a
 * tap look answered.
 *
 * IT IS ALSO HALF THE OFFLINE STORY, which is the part worth not forgetting.
 * `experimental.useOffline` holds a navigation that had no network and replays it when
 * the network returns — see the long note in next.config.ts — but holding a navigation
 * with no boundary below it renders nothing at all, so the tap simply does nothing
 * until the signal comes back. Next's own offline guide is explicit that a route-level
 * `loading.tsx` is what gives the router a shell to prefetch and show while the
 * request waits. components/offline-banner.tsx then says why it is waiting.
 *
 * ONE FILE FOR THE WHOLE GROUP, not one per screen. Every screen in here is the same
 * shape — a heading, then a stack of cards or rows — so a dozen tailored skeletons
 * would be a dozen guesses at layouts that move, maintained forever to make a
 * placeholder that lasts 300ms slightly more accurate. At the group root it covers
 * every signed-in screen, including the ones not written yet.
 *
 * NO WORDS ON IT, deliberately. A translated "loading" needs the locale, the locale
 * comes from the session cookie, and awaiting a cookie here would make this segment
 * runtime-rendered — which takes it out of the prefetched shell and loses the offline
 * half above. `aria-busy` is the part a screen reader actually needs; the announcement
 * belongs to the heading that arrives a moment later.
 *
 * WHAT IT DOES NOT COVER. `loading.tsx` nests inside the layout rather than above it,
 * which is why the header and the bottom nav stay put and stay tappable — but also why
 * a cold load still waits on (app)/layout.tsx reading the session cookie. This is for
 * the tab-to-tab case, which is every navigation after login. public/sw.js owns the
 * cold start.
 *
 * WHAT IT COSTS, recorded so nobody has to rediscover it. A boundary that renders means
 * the response has begun streaming, and headers are already sent by the time a page
 * reaches its own guard — so the `forbidden()` and `notFound()` calls scattered through
 * this group now answer 200 and stream their screen rather than carrying a 403 or 404
 * status. The screen a person sees is identical, nothing in the product or the tests
 * reads that status, and every route in here sits behind a login where no crawler ever
 * arrives. The alternative was to put the guards before the first `await`, which cannot
 * be done when the guard is a database read.
 */

/** Row widths, so three stacked cards do not read as one shape stamped three times. */
const CARDS = [
  ['w-2/3', 'w-1/3'],
  ['w-1/2', 'w-2/5'],
  ['w-3/5', 'w-1/4'],
]

export default function Loading() {
  return (
    <div
      aria-busy="true"
      className="flex animate-pulse flex-col gap-4 motion-reduce:animate-none
        print:hidden"
    >
      {/* The title block. Every page in the group opens with a heading and a line of
          explanation under it, so the placeholder does too. */}
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="h-6 w-2/5 rounded-lg bg-surface-alt" />
        <div className="h-4 w-3/5 rounded-lg bg-surface-alt" />
      </div>

      {/* Card outlines rather than filled blocks: the border is real on the screen
          that follows, so only what is unknown is grey. */}
      {CARDS.map(([wide, narrow], i) => (
        <div
          key={i}
          aria-hidden="true"
          className="rounded-2xl border border-line bg-white p-5 shadow-sm"
        >
          <div className={`h-5 rounded-lg bg-surface-alt ${wide}`} />
          <div className={`mt-3 h-4 rounded-lg bg-surface-alt ${narrow}`} />
        </div>
      ))}
    </div>
  )
}
