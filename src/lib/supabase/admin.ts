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
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
