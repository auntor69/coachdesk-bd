import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { getSession } from '@/lib/auth/session'

/**
 * Gate for every signed-in screen.
 *
 * This is a convenience, not the security boundary — RLS is. Next's own docs are
 * explicit that a layout does not re-run on every navigation within the group,
 * so a page that reveals another center's data must be stopped by the database,
 * not by this check. What this earns us is a redirect instead of an empty screen.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Signed in but attached to nothing yet: finish onboarding first, otherwise
  // every screen here would render zero batches and zero students with no
  // explanation of why.
  if (!session.active) redirect('/onboarding')

  return <AppShell session={session}>{children}</AppShell>
}
