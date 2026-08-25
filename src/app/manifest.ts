import type { MetadataRoute } from 'next'

/**
 * What an owner installs when they tap "Add to Home screen".
 *
 * Served at /manifest.webmanifest, which src/proxy.ts already exempts from the session
 * check — a browser fetches this before it has decided whether to offer installation,
 * and a 307 to /login is not a manifest.
 *
 * WHY THIS EXISTS AT ALL, given the app works fine in a tab. MASTERPLAN §3 promises
 * "installable, offline-capable" and no native app, and the reason is not a checkbox:
 * a teacher who has to find Chrome, then a tab, then a bookmark before they can mark a
 * register in front of a class uses the paper register instead. An icon on the home
 * screen is one tap, and `standalone` means no address bar eating the top of a 5" screen.
 *
 * NOT LOCALISED, AND NOT ASYNC. A browser fetches the manifest anonymously — no cookies
 * unless the `<link>` carries `crossorigin="use-credentials"`, which Next does not emit
 * — so `readerLocale()` here would read no locale cookie and return the default on every
 * request. An async function that always produces the same answer is worse than a sync
 * one that says so. The strings below are written to read correctly to both readers, the
 * same way the root layout's `title` already is: Bangla first, because that is who this
 * is for, and `short_name` — the only string that ends up under the icon — is a brand
 * name that is the same word in both languages.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CoachDesk — কোচিং সেন্টার ম্যানেজমেন্ট',
    // Eleven or twelve characters is roughly what fits under an Android icon before it
    // is truncated, and a truncated name on a home screen is what makes an app look
    // unfinished. "CoachDesk" fits, and it is what the owner says out loud.
    short_name: 'CoachDesk',
    description:
      'হাজিরা, পরীক্ষার ফলাফল, ফি এবং অভিভাবককে বার্তা — এক জায়গায়। '
      + 'Attendance, exam results, fees and parent messages for Bangladeshi '
      + 'coaching centres.',

    /**
     * The root, not /dashboard and not /teach.
     *
     * Every role opens this icon and they do not share a landing screen: a teacher
     * belongs on /teach, an owner on /dashboard, a guardian on /me. `/` is the one
     * path that knows how to work that out — it reads the session and redirects — so
     * the icon lands each of them where they should be instead of bouncing two thirds
     * of them through a 403.
     */
    start_url: '/',

    /**
     * No browser chrome. The address bar is a good fraction of a cheap Android's
     * screen and this app has a bottom nav of its own, so a URL bar buys nothing and
     * costs a row of the register.
     *
     * The consequence is that there is no reload button and no error page the user
     * recognises, which is exactly why public/sw.js exists: an installed app opened
     * with no network has no other way to show anything at all.
     */
    display: 'standalone',

    // The splash screen while the app boots, and the colour Android tints the status
    // bar. theme_color matches --color-brand-600 and the root layout's viewport; a
    // splash in a different green than the header is a visible flash on every cold
    // start. No `orientation`: locking it would stop a teacher turning the phone
    // sideways to read a marks table, which is the one screen wide enough to want it.
    background_color: '#ffffff',
    theme_color: '#137e50',

    /**
     * Two purposes, because they are cropped differently.
     *
     * `any` is shown as drawn. `maskable` is cropped by the launcher to whatever shape
     * the phone's theme uses — a circle on Pixel, a squircle on Samsung — so its glyph
     * is drawn smaller to survive that. Declaring only `any` means Android shrinks the
     * whole tile onto a white circle and the brand becomes a green stamp in a white
     * ring; declaring only `maskable` means every other surface shows a letter floating
     * in too much green. See scripts/make-icons.mjs for how both are drawn.
     */
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
