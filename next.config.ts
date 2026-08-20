import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Statically typed links. Stable in Next 16 — no longer under `experimental`.
   *
   * Worth the friction: this app is a set of role-scoped screens that link to
   * each other constantly, and a typo in an href is otherwise invisible until a
   * teacher taps it and gets a 404. A build-time failure is much cheaper than a
   * dead end discovered in a classroom.
   */
  typedRoutes: true,

  experimental: {
    /**
     * Lets a page call `forbidden()` and get a real 403 screen, instead of every
     * wrong-role visit throwing an unhandled error and rendering a 500.
     *
     * The screens are role-scoped and the roles overlap: the same person is an
     * owner at the centre they run and a teacher at the centre they visit, so a
     * bookmark, a stale tab, or a centre switch is enough to land a teacher on
     * /fees. Before this, that was a white error page.
     *
     * Experimental, and knowingly taken. If a future Next removes the flag,
     * `forbidden` disappears from `next/navigation` and this fails to compile —
     * loud, at build time, with `AuthError` still carrying the code needed to do
     * it another way. See `pageRole` in lib/auth/session.
     */
    authInterrupts: true,
  },
}

export default nextConfig
