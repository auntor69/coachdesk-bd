import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

/**
 * Service-role client. Bypasses every RLS policy.
 *
 * The `server-only` import above makes the build fail if this file is ever
 * pulled into a client component — that failure is deliberate and is the last
 * line of defence for the service-role key.
 *
 * Legitimate uses: cron jobs (SMS queue, reminders), platform-admin screens,
 * and signup, where a row must be created before the user has a center to be
 * scoped to. Everything else uses the request-scoped client in `server.ts`.
 *
 * Any query written here must filter by coaching_center_id by hand. RLS is off.
 *
 * PASS THE ACTOR WHEN A HUMAN ASKED FOR THIS WRITE. A service-role request
 * carries no JWT, so `auth.uid()` is null inside the database and migration 46's
 * audit trigger has nobody to name — the plan change, the capacity purchase and
 * the login it created all land in `audit_log` anonymous. `actor` is sent as the
 * `x-app-actor` header, which migration 56 reads back as the third and last
 * source of an actor: it can only fill a null, never outrank a JWT, and only a
 * holder of this key can send it at all.
 *
 * Leave it out for a machine. The cron worker's honest record is
 * `actor_role = 'service_role'` with no actor, and `tests/admin-actor.test.ts`
 * knows which call sites are which.
 */
export function createAdminClient(actor?: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // Only when there is one. An `x-app-actor: undefined` header would be read
      // as a malformed uuid, which migration 56 turns into null anyway — but a
      // header that says the wrong thing is worse than no header.
      ...(actor ? { global: { headers: { 'x-app-actor': actor } } } : {}),
    },
  )
}
