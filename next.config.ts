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
}

export default nextConfig
